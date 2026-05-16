/**
 * Eos — main application controller.
 */

(function () {
  "use strict";

  // ---- State ----
  let mode = "nav"; // "nav" | "air"
  let userLat = null, userLon = null;
  let userHeading = 0;
  let userSpeedMph = 0;
  let aircraftList = [];
  let gpsWatchId = null;
  let fetchTimer = null;
  let lastFetchTime = null;
  let lastFetchError = null;

  // Route state
  let activeRoute   = null;
  let routeDestName = "";

  // Hardcoded test destination: Liverpool John Lennon Airport (EGGP)
  const TEST_DEST = { lat: 53.3336, lon: -2.8497, name: "Liverpool Airport" };

  // ---- Init ----

  function init() {
    AdsbExchangeClient.init(CONFIG);

    // Theme must be initialised before the map so EosMap.init() reads the
    // correct effective theme when building its initial map style.
    ThemeController.init(function (theme) {
      EosMap.setTheme(theme);
    });
    _syncThemePicker();

    showConfigWarningIfNeeded();
    startGps();
    bindButtons();
    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);
  }

  // ---- Theme ----

  function _onThemeChange(theme) {
    EosMap.setTheme(theme);
    _applyThemeToDom(theme);
  }

  function _applyThemeToDom(theme) {
    document.body.dataset.theme = theme; // triggers CSS variable overrides

    // Update PWA status-bar colour
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "day" ? "#f5f3ee" : "#0e1117";

    // Reflect active state on theme buttons
    ["day", "auto", "night"].forEach(t => {
      const btn = document.getElementById(`btn-theme-${t}`);
      if (!btn) return;
      const active = (t === ThemeManager.getPreference());
      btn.classList.toggle("active-theme", active);
    });
  }

  function showConfigWarningIfNeeded() {
    if (!AdsbExchangeClient.isConfigured()) {
      UI.showConfigBanner(true);
      UI.setAdsbStatus("error", "ADS-B");
    }
  }

  // ---- GPS ----

  function startGps() {
    if (!navigator.geolocation) {
      UI.showGpsMessage(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });

    gpsWatchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000,
    });
  }

  function onGpsSuccess(pos) {
    UI.showGpsMessage(false);

    userLat = pos.coords.latitude;
    userLon = pos.coords.longitude;
    userSpeedMph = (pos.coords.speed || 0) * 2.23694;

    if (pos.coords.heading != null && !isNaN(pos.coords.heading)
        && userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      userHeading = pos.coords.heading;
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      // Pass the already-resolved theme so the first render is correct.
      EosMap.init("map", userLat, userLon, ThemeManager.getResolved());
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading);
    }

    if (mode === "nav") refreshIndicators();
  }

  function onGpsError(err) {
    console.warn("GPS error:", err.message);
    if (userLat === null) {
      UI.showGpsMessage(true);
      if (!window._mapInitialised) {
        window._mapInitialised = true;
        EosMap.init("map", 51.5, -0.12, ThemeManager.getResolved());
      }
    }
  }

  // ---- Data fetch loop ----

  function scheduleFetch() {
    fetchAircraft();
    fetchTimer = setInterval(fetchAircraft, CONFIG.REFRESH_INTERVAL_SECONDS * 1000);
  }

  async function fetchAircraft() {
    if (userLat === null) return;

    UI.setLoading(true);
    const result = await AdsbExchangeClient.fetchNearby(userLat, userLon, CONFIG.DEFAULT_RANGE_NM);
    UI.setLoading(false);

    lastFetchTime = Date.now();
    lastFetchError = result.error;

    if (result.error) {
      if (result.error === "not_configured") {
        UI.setAdsbStatus("error", "ADS-B");
      } else if (result.error === "auth_failed") {
        UI.setAdsbStatus("error", "Auth error");
      } else {
        UI.setAdsbStatus("stale", "No data");
      }
    } else {
      UI.setAdsbStatus("active", "ADS-B");
      UI.showConfigBanner(false);
    }

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

  // ---- Driving view ----

  function refreshIndicators() {
    if (userLat === null) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

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

  function onIndicatorClick(ind) {
    UI.showPopup(ind);
  }

  // ---- Air mode ----

  function refreshAirMode() {
    if (userLat === null) return;
    EosMap.renderAirMarkers(aircraftList, userLat, userLon, onAirMarkerClick);
  }

  function onAirMarkerClick(aircraft, vis) {
    UI.showAirPopup(aircraft, vis);
  }

  // ---- Routing ----

  async function requestTestRoute() {
    if (!userLat) return;

    const btn = document.getElementById("btn-test-route");
    if (btn) { btn.textContent = "…"; btn.disabled = true; }

    const route = await OsrmProvider.getRoute(
      { lat: userLat, lon: userLon },
      { lat: TEST_DEST.lat, lon: TEST_DEST.lon }
    );

    if (btn) { btn.textContent = "↗"; btn.disabled = false; }

    if (!route) {
      console.warn("Route request failed — check network or OSRM availability.");
      return;
    }

    activeRoute   = route;
    routeDestName = TEST_DEST.name;
    EosMap.showRoute(route.geometry);
    _showRouteCard();
  }

  function clearActiveRoute() {
    activeRoute   = null;
    routeDestName = "";
    EosMap.clearRoute();
    _hideRouteCard();
  }

  function _showRouteCard() {
    document.getElementById("route-dest-name").textContent = routeDestName;
    document.getElementById("route-dist-text").textContent = _fmtDistance(activeRoute.distanceMeters);
    document.getElementById("route-eta-text").textContent  = _fmtDuration(activeRoute.durationSeconds);
    document.getElementById("route-card").classList.remove("hidden");
  }

  function _hideRouteCard() {
    document.getElementById("route-card")?.classList.add("hidden");
  }

  function _fmtDistance(meters) {
    return meters >= 1000
      ? (meters / 1000).toFixed(1) + " km"
      : Math.round(meters) + " m";
  }

  function _fmtDuration(seconds) {
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return h + "h " + m + "m";
    }
    return Math.floor(seconds / 60) + " min";
  }

  // ---- Mode switching ----

  function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    UI.setModeLabel(newMode);
    UI.hidePopup();

    EosMap.setMode(newMode, userLat, userLon, userHeading);

    if (newMode === "nav") {
      EosMap.clearAirMarkers();
      refreshIndicators();
    } else {
      UI.clearIndicators();
      refreshAirMode();
    }
  }

  // ---- Theme picker sync ----

  function _syncThemePicker() {
    const current = ThemeController.getMode();
    ["day", "night", "auto"].forEach(function (m) {
      const btn = document.getElementById("theme-btn-" + m);
      if (btn) btn.classList.toggle("active", m === current);
    });
  }

  // ---- Button bindings ----

  function bindButtons() {
    document.getElementById("btn-air")?.addEventListener("click", () => setMode("air"));
    document.getElementById("btn-nav")?.addEventListener("click", () => setMode("nav"));
    document.getElementById("btn-test-route")?.addEventListener("click", requestTestRoute);
    document.getElementById("btn-clear-route")?.addEventListener("click", clearActiveRoute);

    // Theme buttons
    ["day", "auto", "night"].forEach(t => {
      document.getElementById(`btn-theme-${t}`)?.addEventListener("click", () => {
        ThemeManager.setPreference(t);
        _applyThemeToDom(ThemeManager.getResolved());
      });
    });

    // Theme picker buttons
    ["day", "night", "auto"].forEach(function (m) {
      document.getElementById("theme-btn-" + m)?.addEventListener("click", function () {
        ThemeController.setMode(m);
        _syncThemePicker();
      });
    });

    // Re-render indicators on resize (viewport changes edge positions)
    window.addEventListener("resize", () => {
      if (mode === "nav") refreshIndicators();
    });

    document.getElementById("map")?.addEventListener("click", () => UI.hidePopup());
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", init);
})();
