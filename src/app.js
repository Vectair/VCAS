/**
 * Eos — main application controller.
 * Production-Certified JavaScript Specification.
 */

(function () {
  "use strict";

  // ---- Central Telemetry Pipeline State ----
  let mode = "nav"; // "nav" | "air"
  let userLat = null, userLon = null;
  let userHeading = 0;
  let userSpeedMph = 0;
  let aircraftList = [];
  let gpsWatchId = null;
  let fetchTimer = null;
  let lastFetchTime = null;
  let lastFetchError = null;

  // Route state tracking
  let activeRoute   = null;
  let routeDestName = "";

  // NAV indicator paging — which page of the ranked relevant-aircraft pool
  // is currently on screen, when there are more than the viewport cap.
  // Manual only (tap the aircraft-count badge to cycle); never auto-rotates.
  let indicatorPage = 0;

  // Manually-suppressed aircraft (via the popup's Suppress button): hex -> expiry timestamp (ms).
  let suppressedUntil = new Map();

  // Hardcoded test destination: Liverpool John Lennon Airport (EGGP)
  const TEST_DEST = { lat: 53.3336, lon: -2.8497, name: "Liverpool Airport" };

  // ---- Init ----

  function init() {
    AdsbExchangeClient.init(CONFIG);

    // Resolve initial theme before map initialization so the first render
    // uses the correct visual style layer palette.
    const initialTheme = ThemeManager.init(_onThemeChange);
    _applyThemeToDom(initialTheme);

    // Synchronized Viewport Resize Matrix Gateway
    ViewportDevPanel.init({
      onViewportChanged() {
        const activeMap = EosMap.getMap();
        if (activeMap) {
          activeMap.resize();
          
          // Enforce strict asynchronous completion check before applying positions
          activeMap.once('resize', () => {
            CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());
            if (mode === "nav" && userLat !== null && userLon !== null) {
              CameraController.transitionToNav(userLat, userLon, userHeading);
            }
          });
        }
      },
    });
    CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());

    LogPanel.init();

    document.body.dataset.mode = "nav";
    showConfigWarningIfNeeded();
    startGps();
    
    // Core Fix: Localised assignment execution handles the button setup cleanly
    bindButtons(); 
    
    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);
  }

  // ---- Core Interface Event Listeners Matrix ---- //

  function bindButtons() {
    // 1. Navigation View Selection Tracking Mode Toggle
    const btnNav = document.getElementById("btn-nav");
    if (btnNav) {
      btnNav.addEventListener("click", (e) => {
        e.preventDefault();
        if (mode === "nav") return;
        mode = "nav";
        indicatorPage = 0; // fresh start when re-entering NAV mode
        document.body.dataset.mode = "nav";
        UI.setModeLabel("nav");
        if (userLat !== null && userLon !== null) {
          CameraController.transitionToNav(userLat, userLon, userHeading);
          refreshIndicators();
        }
      });
    }

    // 2. Airspace View Overview Strategic Selection Toggle
    const btnAir = document.getElementById("btn-air");
    if (btnAir) {
      btnAir.addEventListener("click", (e) => {
        e.preventDefault();
        if (mode === "air") return;
        mode = "air";
        document.body.dataset.mode = "air";
        UI.setModeLabel("air");
        UI.clearIndicators(); // Clear screen edge markers inside 2D views
        if (userLat !== null && userLon !== null) {
          CameraController.transitionToAir(userLat, userLon);
          refreshAirMode();
        }
      });
    }

    // 3. Test Routing Generation Call Target Hookup
    const btnTestRoute = document.getElementById("btn-test-route");
    if (btnTestRoute) {
      btnTestRoute.addEventListener("click", (e) => {
        e.preventDefault();
        requestTestRoute();
      });
    }

    // 4. Flush / Evacuate Active Routing Coordinates Hookup
    const btnClearRoute = document.getElementById("btn-clear-route");
    if (btnClearRoute) {
      btnClearRoute.addEventListener("click", (e) => {
        e.preventDefault();
        clearActiveRoute();
      });
    }
  }

  // ---- Theme ----

  function _onThemeChange(theme) {
    EosMap.setTheme(theme);
    _applyThemeToDom(theme);
  }

  function _applyThemeToDom(theme) {
    document.body.dataset.theme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "day" ? "#f5f3ee" : "#0e1117";

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

  // ---- GPS Telemetry Feed Stream ----

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
      EosMap.init("map", userLat, userLon, ThemeManager.getResolved());
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading, userSpeedMph);
    }

    if (mode === "nav") {
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
      refreshIndicators();
    }
  }

  // ---- Camera Padding Update Engine ----

  function updateMapViewportPadding() {
    let topPadding = 0;
    let bottomPadding = 0;

    // Check layout heights of active navigation cards
    const guidanceCard = document.getElementById("nav-guidance-card");
    if (guidanceCard && !guidanceCard.classList.contains("hidden")) {
      topPadding = guidanceCard.offsetHeight || 90;
    }

    const routeCard = document.getElementById("route-card");
    if (routeCard && !routeCard.classList.contains("hidden")) {
      bottomPadding = routeCard.offsetHeight || 110;
    } else {
      const bottomBar = document.getElementById("bottom-bar");
      if (bottomBar && !bottomBar.classList.contains("hidden")) {
        bottomPadding = bottomBar.offsetHeight || 60;
      }
    }

    // Architectural Fix: Route padding targets directly through the unified Camera Controller API
    CameraController.setViewportPadding(topPadding, bottomPadding + 10);
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

    aircraftList = result.aircraft.filter(a => {
      if (a.lastSeenSeconds >= CONFIG.REMOVE_THRESHOLD_SECONDS) return false;
      // Ground/low-altitude clutter suppression (e.g. busy airports) — only
      // suppresses aircraft with a known altitude below the threshold, never
      // ones with missing altitude data. Applies to both NAV and AIR mode
      // since aircraftList feeds both.
      if (CONFIG.SUPPRESS_LOW_ALTITUDE_ENABLED
          && a.altitudeFt != null
          && a.altitudeFt < CONFIG.SUPPRESS_LOW_ALTITUDE_FT) {
        return false;
      }
      return true;
    });

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
    const { width: vw, height: vh } = ViewportDevPanel.getViewportDimensions();

    let bottomObstructionHeight = 0;
    const routeCard = document.getElementById("route-card");
    if (routeCard && !routeCard.classList.contains("hidden")) {
      bottomObstructionHeight += routeCard.offsetHeight;
    }
    const bottomBar = document.getElementById("bottom-bar");
    if (bottomBar && !bottomBar.classList.contains("hidden")) {
      bottomObstructionHeight += bottomBar.offsetHeight;
    }
    if (bottomObstructionHeight === 0) bottomObstructionHeight = 60;

    const usableViewportHeight = vh - bottomObstructionHeight - 45;

    const userState = {
      lat: userLat, lon: userLon,
      heading: userHeading,
      speedMph: userSpeedMph,
      viewportWidth: vw,
      viewportHeight: usableViewportHeight,
    };

    const camConfig = CameraController.getLastEvaluated();
    if (camConfig) {
      userState.cameraPitch = camConfig.pitch;
      userState.anchorY = camConfig.anchorY; 
    }

    const now = Date.now();
    for (const [hex, expiry] of suppressedUntil) {
      if (expiry <= now) suppressedUntil.delete(hex);
    }

    const allRelevant = Indicators.build(
      aircraftList, userState,
      CONFIG.STALE_THRESHOLD_SECONDS,
      new Set(suppressedUntil.keys())
    );

    // Ground-truth log panel gets everything tracked, unfiltered — including
    // aircraft the relevance gate excluded, since logging "the algorithm was
    // wrong to hide this" is the whole point.
    LogPanel.update(
      Indicators.buildAll(aircraftList, userState, CONFIG.STALE_THRESHOLD_SECONDS),
      userState
    );

    const cap = Indicators.capForViewportWidth(vw);
    const totalPages = Math.max(1, Math.ceil(allRelevant.length / cap));
    if (indicatorPage >= totalPages) indicatorPage = 0;

    const pageStart = indicatorPage * cap;
    const shown = allRelevant.slice(pageStart, pageStart + cap);

    UI.renderIndicators(shown, onIndicatorClick);
    UI.setAircraftCount(shown.length, allRelevant.length, onCycleIndicatorPage);
  }

  function onCycleIndicatorPage() {
    indicatorPage++;
    refreshIndicators(); // re-derives totalPages and wraps back to 0 if past the end
  }

  function onIndicatorClick(ind) {
    UI.showPopup(ind, () => onSuppressAircraft(ind.aircraft.hex));
  }

  function onSuppressAircraft(hex) {
    suppressedUntil.set(hex, Date.now() + CONFIG.SUPPRESS_DURATION_SECONDS * 1000);
    UI.hidePopup();
    refreshIndicators();
  }

  // ---- Air mode ----

  function refreshAirMode() {
    if (userLat === null) return;
    EosMap.renderAirMarkers(aircraftList, userLat, userLon, onAirMarkerClick);
  }

  function onAirMarkerClick(aircraft, vis) {
    UI.showAirPopup(aircraft, vis);
  }

  // ---- Routing Core Integration ---- //

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
    CameraController.setRouteActive(route.geometry); 
    
    document.body.classList.add("route-active");
    _showRouteCard();
    
    // Recalculate camera layout boundaries immediately when cards inject into viewport
    setTimeout(() => {
      updateMapViewportPadding();
      if (userLat !== null && userLon !== null) {
        CameraController.transitionToNav(userLat, userLon, userHeading);
      }
    }, 50);
  }

  function clearActiveRoute() {
    activeRoute   = null;
    routeDestName = "";
    EosMap.clearRoute();
    CameraController.clearRoute(); 
    document.body.classList.remove("route-active");
    _hideRouteCard();
    
    // Reset view constraints completely back to standard panel guidelines
    setTimeout(() => {
      updateMapViewportPadding();
      if (userLat !== null && userLon !== null) {
        CameraController.transitionToNav(userLat, userLon, userHeading);
      }
    }, 50);
  }

  function _showRouteCard() {
    document.getElementById("route-dest-name").textContent = routeDestName;
    document.getElementById("route-dist-text").textContent = _fmtDistance(activeRoute.distanceMeters);
    document.getElementById("route-eta-text").textContent  = _fmtDuration(activeRoute.durationSeconds);
    const arrivalEl = document.getElementById("route-eta-arrival");
    if (arrivalEl) {
      const arrivalMs = Date.now() + activeRoute.durationSeconds * 1000;
      const d  = new Date(arrivalMs);
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      arrivalEl.textContent = hh + ":" + mm;
    }
    document.getElementById("route-card").classList.remove("hidden");
    _showGuidanceCard();
  }

  function _hideRouteCard() {
    document.getElementById("route-card")?.classList.add("hidden");
    _hideGuidanceCard();
  }

  function _showGuidanceCard() {
    if (mode !== "nav" || !activeRoute) return;
    const dest = routeDestName || "destination";
    document.getElementById("ngc-dest-text").textContent = "towards " + dest;
    document.getElementById("nav-guidance-card").classList.remove("hidden");
  }

  function _hideGuidanceCard() {
    document.getElementById("nav-guidance-card")?.classList.add("hidden");
  }

  // ---- Numerical Utilities ----

  function _fmtDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toFixed(1) + " km" : Math.round(meters) + " m";
  }

  function _fmtDuration(seconds) {
    const m = Math.round(seconds / 60);
    return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " m" : m + " min";
  }

  // Global scope bridge mappings
  window.EosApp = { 
    init, 
    requestTestRoute, 
    clearActiveRoute, 
    transitionToNav: () => { mode = "nav"; CameraController.transitionToNav(userLat, userLon, userHeading); }, 
    transitionToAir: () => { mode = "air"; CameraController.transitionToAir(userLat, userLon); } 
  };
  
  document.addEventListener("DOMContentLoaded", init);
})();