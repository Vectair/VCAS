/**
 * Eos V1 — main application controller.
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

  // ---- Init ----

  function init() {
    AdsbExchangeClient.init(CONFIG);

    showConfigWarningIfNeeded();
    startGps();
    bindButtons();
    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);
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

    // First fix
    navigator.geolocation.getCurrentPosition(onGpsSuccess, onGpsError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });

    // Continuous watch
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
    userSpeedMph = (pos.coords.speed || 0) * 2.23694; // m/s → mph

    // Use GPS course when moving, else keep last heading
    if (pos.coords.heading != null && !isNaN(pos.coords.heading) && userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      userHeading = pos.coords.heading;
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      EosMap.init("map", userLat, userLon);
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon);
    }

    if (mode === "nav") refreshIndicators();
  }

  function onGpsError(err) {
    console.warn("GPS error:", err.message);
    if (userLat === null) {
      UI.showGpsMessage(true);
      // Still init map at a generic position so the UI is functional
      if (!window._mapInitialised) {
        window._mapInitialised = true;
        EosMap.init("map", 51.5, -0.12); // London as fallback
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

    // Merge new data; keep aircraft whose last seen is still fresh
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

  // ---- Mode switching ----

  function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    EosMap.setMode(newMode);
    UI.setModeLabel(newMode);
    UI.hidePopup();

    if (newMode === "nav") {
      EosMap.clearAirMarkers();
      if (userLat !== null) EosMap.flyTo(userLat, userLon, CONFIG.DEFAULT_ZOOM_DRIVING);
      refreshIndicators();
    } else {
      UI.clearIndicators();
      if (userLat !== null) EosMap.flyTo(userLat, userLon, CONFIG.DEFAULT_ZOOM_AIR);
      refreshAirMode();
    }
  }

  // ---- Button bindings ----

  function bindButtons() {
    document.getElementById("btn-air")?.addEventListener("click", () => setMode("air"));
    document.getElementById("btn-nav")?.addEventListener("click", () => setMode("nav"));

    // Re-render indicators on resize (viewport changes edge positions)
    window.addEventListener("resize", () => {
      if (mode === "nav") refreshIndicators();
    });

    // Dismiss popup on map tap
    document.getElementById("map")?.addEventListener("click", () => UI.hidePopup());
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", init);
})();
