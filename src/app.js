/**
 * Eos — Main Application Controller (Production JS Engine Specification)
 * Serves as a pure telemetry pass-through bridging location events to map controllers.
 */

(function () {
  "use strict";

  let mode = "nav"; 
  let userLat = null, userLon = null;
  let userHeading = 0;
  let userSpeedMph = 0;
  let aircraftList = [];
  let gpsWatchId = null;
  let fetchTimer = null;

  let activeRoute   = null;
  let routeDestName = "";

  const TEST_DEST = { lat: 53.3336, lon: -2.8497, name: "Liverpool Airport" };

  function init() {
    AdsbExchangeClient.init(CONFIG);

    const initialTheme = ThemeManager.init(_onThemeChange);
    _applyThemeToDom(initialTheme);

    ViewportDevPanel.init({
      onViewportChanged() {
        const activeMap = EosMap.getMap();
        if (activeMap) {
          activeMap.resize();
          CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());
          if (mode === "nav" && userLat !== null && userLon !== null) {
            CameraController.transitionToNav(userLat, userLon, userHeading);
          }
        }
      },
    });
    
    CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());
    document.body.dataset.mode = "nav";
    
    showConfigWarningIfNeeded();
    startGps();
    
    // CRITICAL FIX: Explicitly retain local app button connection layouts
    if (typeof bindButtons === "function") {
      bindButtons(); 
    } else {
      _fallbackInternalCoreButtonBindings();
    }

    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);
  }

  function startGps() {
    if (!navigator.geolocation) {
      UI.showGpsMessage(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000,
    });

    gpsWatchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }

  function onGpsSuccess(pos) {
    UI.showGpsMessage(false);

    userLat = pos.coords.latitude;
    userLon = pos.coords.longitude;
    userSpeedMph = (pos.coords.speed || 0) * 2.23694;

    if (pos.coords.heading !== null && !isNaN(pos.coords.heading) && userSpeedMph > 3.0) {
      userHeading = pos.coords.heading;
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      EosMap.init("map", userLat, userLon, ThemeManager.getResolved());
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading, userSpeedMph);
    }

    // Pushes fresh telemetry values to the single-source camera thread
    if (mode === "nav") {
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
      refreshIndicators();
    }
  }

  function scheduleFetch() {
    fetchAircraft();
    fetchTimer = setInterval(fetchAircraft, CONFIG.REFRESH_INTERVAL_SECONDS * 1000);
  }

  async function fetchAircraft() {
    if (userLat === null) return;

    UI.setLoading(true);
    const result = await AdsbExchangeClient.fetchNearby(userLat, userLon, CONFIG.DEFAULT_RANGE_NM);
    UI.setLoading(false);

    if (result.error) {
      _handleAdsbFetchErrors(result.error);
      return;
    }

    UI.setAdsbStatus("active", "ADS-B");
    UI.showConfigBanner(false);

    aircraftList = result.aircraft.filter(
      a => a.lastSeenSeconds < CONFIG.REMOVE_THRESHOLD_SECONDS
    );

    UI.setAircraftCount(aircraftList.length);

    if (mode === "nav") {
      refreshIndicators();
    } else {
      refreshAirMode();
    }
  }

  function _handleAdsbFetchErrors(errorString) {
    if (errorString === "not_configured") {
      UI.setAdsbStatus("error", "ADS-B");
    } else if (errorString === "auth_failed") {
      UI.setAdsbStatus("error", "Auth error");
    } else {
      UI.setAdsbStatus("stale", "No data");
    }
  }

  function refreshIndicators() {
    if (userLat === null) return;
    const { width: vw, height: vh } = ViewportDevPanel.getViewportDimensions();

    const userState = {
      lat: userLat, lon: userLon,
      heading: userHeading,
      viewportWidth: vw,
      viewportHeight: vh,
    };

    const indicators = Indicators.build(
      aircraftList, userState,
      CONFIG.MAX_AIRCRAFT_SHOWN,
      CONFIG.STALE_THRESHOLD_SECONDS
    );

    UI.renderIndicators(indicators, onIndicatorClick);
  }

  async function requestTestRoute() {
    if (!userLat) return;

    const btn = document.getElementById("btn-test-route");
    if (btn) { btn.textContent = "…"; btn.disabled = true; }

    const route = await OsrmProvider.getRoute(
      { lat: userLat, lon: userLon },
      { lat: TEST_DEST.lat, lon: TEST_DEST.lon }
    );

    if (btn) { btn.textContent = "↗"; btn.disabled = false; }
    if (!route) return;

    activeRoute   = route;
    routeDestName = TEST_DEST.name;
    
    EosMap.showRoute(route.geometry);
    CameraController.setRouteActive(route.geometry);
    
    document.body.classList.add("route-active");
    _showRouteCard();
  }

  function clearActiveRoute() {
    activeRoute   = null;
    routeDestName = "";
    EosMap.clearRoute();
    CameraController.clearRoute();
    document.body.classList.remove("route-active");
    _hideRouteCard();
  }

  function _fallbackInternalCoreButtonBindings() {
    // Standard fail-safe hookups mapping interface nodes if code snippets separate
    const testRouteBtn = document.getElementById("btn-test-route");
    if (testRouteBtn) testRouteBtn.addEventListener("click", requestTestRoute);
    
    const clearRouteBtn = document.getElementById("btn-clear-route");
    if (clearRouteBtn) clearRouteBtn.addEventListener("click", clearActiveRoute);
  }

  function _showRouteCard() {
    document.getElementById("route-dest-name").textContent = routeDestName;
    document.getElementById("route-dist-text").textContent = _fmtDistance(activeRoute.distanceMeters);
    document.getElementById("route-eta-text").textContent  = _fmtDuration(activeRoute.durationSeconds);
    const arrivalEl = document.getElementById("route-eta-arrival");
    if (arrivalEl) {
      const arrivalMs = Date.now() + activeRoute.durationSeconds * 1000;
      const d  = new Date(arrivalMs);
      document.getElementById("route-eta-arrival").textContent = 
        d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
    }
    document.getElementById("route-card").classList.remove("hidden");
    _showGuidanceCard();
  }

  function _onThemeChange(theme) { EosMap.setTheme(theme); _applyThemeToDom(theme); }
  function _applyThemeToDom(theme) { document.body.dataset.theme = theme; }
  function _hideRouteCard() { document.getElementById("route-card")?.classList.add("hidden"); _hideGuidanceCard(); }
  function _showGuidanceCard() { if (mode !== "nav" || !activeRoute) return; document.getElementById("ngc-dest-text").textContent = "towards " + (routeDestName || "destination"); document.getElementById("nav-guidance-card").classList.remove("hidden"); }
  function _hideGuidanceCard() { document.getElementById("nav-guidance-card")?.classList.add("hidden"); }
  function onIndicatorClick(ind) { UI.showPopup(ind); }
  function refreshAirMode() { if (userLat !== null) EosMap.renderAirMarkers(aircraftList, userLat, userLon, onAirMarkerClick); }
  function onAirMarkerClick(aircraft, vis) { UI.showAirPopup(aircraft, vis); }
  function onGpsError(err) { console.warn("GPS error:", err.message); }
  function showConfigWarningIfNeeded() { if (!AdsbExchangeClient.isConfigured()) { UI.showConfigBanner(true); UI.setAdsbStatus("error", "ADS-B"); } }
  function _fmtDistance(meters) { return meters >= 1000 ? (meters / 1000).toFixed(1) + " km" : Math.round(meters) + " m"; }
  function _fmtDuration(seconds) { const m = Math.round(seconds / 60); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " m" : m + " min"; }

  window.EosApp = { init, requestTestRoute, clearActiveRoute, transitionToNav: () => { mode = "nav"; CameraController.transitionToNav(userLat, userLon, userHeading); }, transitionToAir: () => { mode = "air"; CameraController.transitionToAir(userLat, userLon); } };
  document.addEventListener("DOMContentLoaded", init);
})();
