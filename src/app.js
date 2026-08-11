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

  // Destination-pick mode: route button arms it, next map click/tap supplies the target.
  let destPickActive = false;

  // Turn-by-turn text visibility — persisted, so "route line only" sticks across reloads.
  const GUIDANCE_TEXT_KEY = "vcas-guidance-text-enabled";
  let guidanceTextEnabled = true;

  // Transport mode for routing — persisted so it defaults to whatever you used last.
  const ROUTE_MODE_KEY = "vcas-route-mode";
  const MODE_ICONS = { driving: "🚗", cycling: "🚲", walking: "🚶" };
  let routeMode = "driving";

  // Set once the user manually drags/zooms/rotates the map in NAV mode, so the
  // continuous GPS-driven camera stops fighting their pan; cleared by tapping
  // the recenter button (or by any explicit action that already re-centers,
  // like switching modes or activating/clearing a route).
  let navFollowSuspended = false;

  // Minimum spacing between edge-projected indicators sharing a screen edge
  // (see Indicators.declutter) — an estimate matching the indicator's
  // approximate rendered footprint (shape + label), not yet tuned against a
  // real device.
  const INDICATOR_DECLUTTER_GAP_PX = 68;

  // GPS course-over-ground smoothing — raw pos.coords.heading can be jittery
  // tick-to-tick (urban rail corridors, tunnels, etc.), and since every
  // indicator's screen position is (aircraft bearing − userHeading), that
  // noise makes the whole display swing. Same circular-EMA technique as
  // CompassHeading's fallback smoothing (naive linear averaging breaks at
  // the 0/360 wrap), just applied to the GPS reading instead.
  const GPS_HEADING_SMOOTH_FACTOR = 0.3;
  let _gpsHeadingSmoothX = null, _gpsHeadingSmoothY = null;

  function _smoothGpsHeading(rawDeg) {
    const rad = (rawDeg * Math.PI) / 180;
    if (_gpsHeadingSmoothX == null) {
      _gpsHeadingSmoothX = Math.cos(rad);
      _gpsHeadingSmoothY = Math.sin(rad);
    } else {
      _gpsHeadingSmoothX += (Math.cos(rad) - _gpsHeadingSmoothX) * GPS_HEADING_SMOOTH_FACTOR;
      _gpsHeadingSmoothY += (Math.sin(rad) - _gpsHeadingSmoothY) * GPS_HEADING_SMOOTH_FACTOR;
    }
    return ((Math.atan2(_gpsHeadingSmoothY, _gpsHeadingSmoothX) * 180) / Math.PI + 360) % 360;
  }

  // ---- Init ----

  function init() {
    AdsbExchangeClient.init(CONFIG);

    // Resolve initial theme before map initialization so the first render
    // uses the correct visual style layer palette.
    const initialTheme = ThemeManager.init(_onThemeChange);
    _applyThemeToDom(initialTheme);
    ColorblindMode.init();
    _updateColorblindToggleBtn();

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
    SpeedSimPanel.init({ onChange: onSpeedSimChanged });
    AltitudeSuppressPanel.init({ onChange: onAltitudeSuppressChanged });
    initCompassHeading();
    EosMap.onMapClick(onMapClicked);
    EosMap.onUserInteraction(onUserPannedMap);

    const storedGuidance = localStorage.getItem(GUIDANCE_TEXT_KEY);
    if (storedGuidance !== null) guidanceTextEnabled = storedGuidance !== "0";
    _updateGuidanceToggleBtn();

    const storedMode = localStorage.getItem(ROUTE_MODE_KEY);
    if (storedMode && MODE_ICONS[storedMode]) routeMode = storedMode;
    _updateModeButtons();

    document.body.dataset.mode = "nav";
    showConfigWarningIfNeeded();
    startGps();
    
    // Core Fix: Localised assignment execution handles the button setup cleanly
    bindButtons(); 
    
    UI.setModeLabel("nav");
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);

    // Measure the real bottom-bar height immediately so the VIEW/SPD/LOG dev
    // panels clear it from the very first frame, not just after the first
    // route/guidance-toggle event recalculates it.
    updateMapViewportPadding();
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
        navFollowSuspended = false;
        UI.setRecenterVisible(false);
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
        UI.setRecenterVisible(false);
        if (userLat !== null && userLon !== null) {
          CameraController.transitionToAir(userLat, userLon);
          refreshAirMode();
        }
      });
    }

    // 3. Destination-pick arm/disarm — next map tap after arming supplies the target.
    const btnTestRoute = document.getElementById("btn-test-route");
    if (btnTestRoute) {
      btnTestRoute.addEventListener("click", (e) => {
        e.preventDefault();
        toggleDestPickMode();
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

    // 5. Turn-by-turn text on/off (route line stays either way)
    const btnToggleGuidanceText = document.getElementById("btn-toggle-guidance-text");
    if (btnToggleGuidanceText) {
      btnToggleGuidanceText.addEventListener("click", (e) => {
        e.preventDefault();
        toggleGuidanceText();
      });
    }

    // 6. Transport mode selector (shown while picking a destination)
    document.querySelectorAll(".dpb-mode-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setRouteMode(btn.dataset.mode);
      });
    });

    // 7. Recenter on your own position after a manual pan/zoom/rotate
    const btnRecenter = document.getElementById("btn-recenter");
    if (btnRecenter) {
      btnRecenter.addEventListener("click", (e) => {
        e.preventDefault();
        onRecenterClick();
      });
    }

    // 8. Day/Auto/Night theme preference — previously rendered their active
    // state correctly but were never actually wired to a click handler, so
    // tapping any of them did nothing at all.
    ["day", "auto", "night"].forEach(t => {
      const btn = document.getElementById(`btn-theme-${t}`);
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const resolved = ThemeManager.setPreference(t);
        EosMap.setTheme(resolved);
        // setPreference() only fires the onChange callback when the
        // *resolved* theme actually changes (e.g. Auto->Day at 3pm is a
        // no-op resolution-wise) — but the preference itself always
        // changed, and the button highlighting depends on that, not just
        // the resolved value, so update it unconditionally here instead of
        // relying on _onThemeChange.
        _applyThemeToDom(resolved);
      });
    });

    // 9. Colour-blind-safe visibility palette toggle
    const btnColorblind = document.getElementById("btn-colorblind-toggle");
    if (btnColorblind) {
      btnColorblind.addEventListener("click", (e) => {
        e.preventDefault();
        onColorblindToggleClick();
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
    if (meta) meta.content = theme === "day" ? "#f5f3ee" : "#0a0e17";

    ["day", "auto", "night"].forEach(t => {
      const btn = document.getElementById(`btn-theme-${t}`);
      if (!btn) return;
      const active = (t === ThemeManager.getPreference());
      btn.classList.toggle("active-theme", active);
    });
  }

  // ---- Colour-blind-safe visibility palette ----

  function onColorblindToggleClick() {
    ColorblindMode.toggle();
    _updateColorblindToggleBtn();
    // Re-render immediately rather than waiting for the next GPS tick/fetch
    // cycle, so the palette swap is visible the moment you tap it.
    if (userLat === null) return;
    if (mode === "nav") refreshIndicators();
    else refreshAirMode();
  }

  function _updateColorblindToggleBtn() {
    const btn = document.getElementById("btn-colorblind-toggle");
    if (btn) btn.classList.toggle("active", ColorblindMode.isEnabled());
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
    applySpeedOverrideIfActive();

    if (pos.coords.heading != null && !isNaN(pos.coords.heading)
        && userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      userHeading = _smoothGpsHeading(pos.coords.heading);
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      EosMap.init("map", userLat, userLon, ThemeManager.getResolved());
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading, userSpeedMph);
    }

    if (mode === "nav") {
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
      refreshIndicators();
    }
  }

  // ---- Recenter (after a manual pan/zoom/rotate) ----

  function onUserPannedMap() {
    if (mode === "nav") navFollowSuspended = true;
    UI.setRecenterVisible(true);
  }

  function onRecenterClick() {
    UI.setRecenterVisible(false);
    if (userLat === null) return;
    if (mode === "nav") {
      navFollowSuspended = false;
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
    } else {
      CameraController.transitionToAir(userLat, userLon);
    }
  }

  // ---- Dev speed override (SPD panel) ----

  function applySpeedOverrideIfActive() {
    if (SpeedSimPanel.isActive()) {
      userSpeedMph = SpeedSimPanel.getSpeedMph();
    }
  }

  function onSpeedSimChanged() {
    if (userLat === null) return;
    applySpeedOverrideIfActive();
    if (mode === "nav") {
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
      refreshIndicators();
    } else {
      refreshAirMode();
    }
  }

  // ---- Altitude suppression threshold (ALT panel) ----

  function onAltitudeSuppressChanged() {
    // Aircraft below the old threshold were already filtered out of
    // aircraftList entirely (never held in memory), so a looser/disabled
    // threshold can't just re-filter what's already there — re-fetch now
    // instead of waiting up to REFRESH_INTERVAL_SECONDS for it to reappear.
    if (userLat !== null) fetchAircraft();
  }

  // ---- Compass heading fallback (stationary/slow, where GPS course freezes) ----

  function initCompassHeading() {
    if (!CompassHeading.isSupported()) return;

    if (CompassHeading.needsPermission()) {
      // iOS: can't request silently — needs a real user gesture.
      UI.showCompassPermissionBanner(true, async () => {
        const granted = await CompassHeading.requestPermission();
        UI.showCompassPermissionBanner(false);
        if (granted) CompassHeading.start(onCompassHeading);
      });
    } else {
      // Android/others: no explicit permission needed.
      CompassHeading.start(onCompassHeading);
    }
  }

  function onCompassHeading(headingDeg) {
    // Only trusted as a fallback while GPS course-over-ground is itself
    // untrusted — see the matching threshold check in onGpsSuccess. GPS
    // wins whenever it's available and the vehicle is moving fast enough
    // to trust it.
    if (userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) return;
    if (userLat === null) return;

    userHeading = headingDeg;
    EosMap.updateUserPosition(userLat, userLon, userHeading, userSpeedMph);
    if (mode === "nav") {
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph);
      refreshIndicators();
    }
  }

  // ---- Camera Padding Update Engine ----

  function updateMapViewportPadding() {
    let topPadding = 0;
    let bottomPadding = 0;
    // How much space real bottom chrome (the route/ETA toast, or else the
    // normal bottom bar) actually occupies right now — fed to the VIEW/SPD/LOG
    // dev panels below so they float above whatever's visible instead of a
    // hardcoded offset that only ever accounted for the toast, not the
    // always-present bottom bar (which is taller, and was swallowing them
    // whenever no route was active).
    let bottomChromeHeight = 0;

    // Check layout heights of active navigation cards. The guidance card
    // now sits below the top bar (not overlapping/replacing it — see
    // VCAS.css), so the map's actual top obstruction is both combined.
    const guidanceCard = document.getElementById("nav-guidance-card");
    if (guidanceCard && !guidanceCard.classList.contains("hidden")) {
      const topBar = document.getElementById("top-bar");
      topPadding = (topBar?.offsetHeight || 0) + (guidanceCard.offsetHeight || 90);
    }

    const routeCard = document.getElementById("route-card");
    if (routeCard && !routeCard.classList.contains("hidden")) {
      bottomChromeHeight = routeCard.offsetHeight || 110;
      bottomPadding = bottomChromeHeight;
    } else {
      const bottomBar = document.getElementById("bottom-bar");
      if (bottomBar && !bottomBar.classList.contains("hidden")) {
        bottomChromeHeight = bottomBar.offsetHeight || 60;
        bottomPadding = bottomChromeHeight;
      }
    }

    // The VIEW/SPD/LOG dev panels sit at a fixed bottom-corner offset that
    // assumes nothing else occupies that space — push them up above
    // whichever bottom chrome is actually visible right now.
    document.documentElement.style.setProperty("--bottom-toast-offset", bottomChromeHeight + "px");

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

      // Ground service vehicles and fixed obstacles (ADS-B category C1-C5)
      // are never aircraft — unconditional, no toggle.
      if (a.isGroundVehicleOrObstacle) return false;

      // Aircraft themselves on the ground (taxiing/parked) — separate
      // toggle from the altitude threshold below, since their altitude is
      // usually unknown entirely (see normaliseAircraft.js), not just low.
      if (AltitudeSuppressPanel.isGroundHidden() && a.onGround) return false;

      // Ground/low-altitude clutter suppression (e.g. busy airports) — only
      // suppresses aircraft with a known altitude below the threshold, never
      // ones with missing altitude data. Applies to both NAV and AIR mode
      // since aircraftList feeds both.
      if (AltitudeSuppressPanel.isEnabled()
          && a.altitudeFt != null
          && a.altitudeFt < AltitudeSuppressPanel.getThresholdFt()) {
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
    _updateGuidanceCard(camConfig && camConfig.maneuver);

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
    Indicators.declutter(shown, INDICATOR_DECLUTTER_GAP_PX);

    UI.renderIndicators(shown, onIndicatorClick);
    UI.setAircraftCount(shown.length, allRelevant.length, onCycleIndicatorPage);
  }

  function onCycleIndicatorPage() {
    indicatorPage++;
    refreshIndicators(); // re-derives totalPages and wraps back to 0 if past the end
  }

  function onIndicatorClick(ind) {
    UI.showPopup(ind,
      () => onSuppressAircraft(ind.aircraft.hex),
      outcomeCode => onLogOutcome(ind, outcomeCode)
    );
  }

  function onSuppressAircraft(hex) {
    suppressedUntil.set(hex, Date.now() + CONFIG.SUPPRESS_DURATION_SECONDS * 1000);
    UI.hidePopup();
    refreshIndicators();
  }

  // ---- Air mode ----

  function refreshAirMode() {
    if (userLat === null) return;
    const { width: vw, height: vh } = ViewportDevPanel.getViewportDimensions();
    const userState = {
      lat: userLat, lon: userLon,
      heading: userHeading, speedMph: userSpeedMph,
      viewportWidth: vw, viewportHeight: vh,
    };

    // AIR mode stays unfiltered (buildAll, not build) — everything in range
    // is shown regardless of relevance — but now carries the same computed
    // vis/relevance/distance data NAV indicators do, so an AIR-triggered log
    // entry is just as complete, and the LOG panel stays live in AIR mode too.
    const allTracked = Indicators.buildAll(aircraftList, userState, CONFIG.STALE_THRESHOLD_SECONDS);

    EosMap.renderAirMarkers(allTracked, onAirMarkerClick);
    LogPanel.update(allTracked, userState);
  }

  function onAirMarkerClick(item) {
    UI.showAirPopup(item.aircraft, item.vis, outcomeCode => onLogOutcome(item, outcomeCode));
  }

  // ---- Ground-truth logging (shared by the NAV and AIR popups) ----

  async function onLogOutcome(item, outcomeCode) {
    const userState = { lat: userLat, lon: userLon, heading: userHeading, speedMph: userSpeedMph };
    const observation = ObservationLogger.buildObservation(item, userState, outcomeCode);
    await ObservationLogger.record(observation);
  }

  // ---- Routing Core Integration ---- //

  function toggleDestPickMode() {
    destPickActive = !destPickActive;
    EosMap.setPickingCursor(destPickActive);
    UI.setDestPickMode(destPickActive);
  }

  function setRouteMode(mode) {
    if (!MODE_ICONS[mode]) return;
    routeMode = mode;
    localStorage.setItem(ROUTE_MODE_KEY, mode);
    _updateModeButtons();
  }

  function _updateModeButtons() {
    document.querySelectorAll(".dpb-mode-btn").forEach(btn => {
      btn.classList.toggle("active-mode", btn.dataset.mode === routeMode);
    });
  }

  function onMapClicked(lat, lon) {
    if (!destPickActive) return;
    destPickActive = false;
    EosMap.setPickingCursor(false);
    UI.setDestPickMode(false);
    requestRouteTo(lat, lon);
  }

  async function requestRouteTo(lat, lon) {
    if (!userLat) return;

    const btn = document.getElementById("btn-test-route");
    if (btn) { btn.disabled = true; }

    const route = await OrsProvider.getRoute(
      { lat: userLat, lon: userLon },
      { lat, lon },
      routeMode
    );

    if (btn) { btn.disabled = false; }

    if (!route) {
      console.warn("Route request failed — check network or ORS availability/API key.");
      return;
    }

    activeRoute   = route;
    routeDestName = `${MODE_ICONS[routeMode]} ${lat.toFixed(4)}, ${lon.toFixed(4)}`;

    EosMap.showRoute(route.geometry);
    CameraController.setRouteActive(route.geometry);

    document.body.classList.add("route-active");
    _showRouteCard();

    // Activating a route already re-centers the camera, so it doubles as an
    // implicit recenter — clear any pan-suspend state instead of leaving the
    // camera stuck mid-route just because the user panned before picking.
    navFollowSuspended = false;
    UI.setRecenterVisible(false);

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
    if (destPickActive) toggleDestPickMode();
    EosMap.clearRoute();
    CameraController.clearRoute();
    document.body.classList.remove("route-active");
    _hideRouteCard();
    navFollowSuspended = false;
    UI.setRecenterVisible(false);

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
    if (mode !== "nav" || !activeRoute || !guidanceTextEnabled) return;
    const dest = routeDestName || "destination";
    document.getElementById("ngc-dest-text").textContent = "towards " + dest;
    document.getElementById("nav-guidance-card").classList.remove("hidden");
  }

  function _hideGuidanceCard() {
    document.getElementById("nav-guidance-card")?.classList.add("hidden");
  }

  function toggleGuidanceText() {
    guidanceTextEnabled = !guidanceTextEnabled;
    localStorage.setItem(GUIDANCE_TEXT_KEY, guidanceTextEnabled ? "1" : "0");
    _updateGuidanceToggleBtn();

    if (guidanceTextEnabled) _showGuidanceCard();
    else _hideGuidanceCard();

    // Card presence changes the map's top obstruction — recalc padding once
    // the show/hide has taken effect.
    setTimeout(updateMapViewportPadding, 50);
  }

  function _updateGuidanceToggleBtn() {
    const btn = document.getElementById("btn-toggle-guidance-text");
    if (!btn) return;
    btn.classList.toggle("guidance-text-off", !guidanceTextEnabled);
    btn.title = guidanceTextEnabled ? "Hide turn-by-turn text" : "Show turn-by-turn text";
  }

  /**
   * Live turn instruction, driven by NavigationCameraEvaluator's maneuver
   * detection (via CameraController.getLastEvaluated()) — replaces the old
   * static "Continue"/↑ placeholder. Called on every refresh, not just when
   * the route first activates, so the distance countdown and left/right
   * call actually update as you drive.
   */
  function _updateGuidanceCard(maneuver) {
    if (!activeRoute) return;
    const actionEl = document.getElementById("ngc-action-text");
    const iconEl   = document.getElementById("ngc-maneuver-icon");
    if (!actionEl || !iconEl) return;

    if (maneuver && maneuver.exists) {
      const direction = maneuver.bearingDeltaDeg > 0 ? "right" : "left";
      actionEl.textContent = `Turn ${direction} in ${_fmtDistance(maneuver.distanceMeters)}`;
      const iconRotation = Math.max(-120, Math.min(120, maneuver.bearingDeltaDeg));
      iconEl.style.transform = `rotate(${iconRotation}deg)`;
    } else {
      actionEl.textContent = "Continue";
      iconEl.style.transform = "rotate(0deg)";
    }
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
    toggleDestPickMode,
    clearActiveRoute,
    transitionToNav: () => { mode = "nav"; CameraController.transitionToNav(userLat, userLon, userHeading); }, 
    transitionToAir: () => { mode = "air"; CameraController.transitionToAir(userLat, userLon); } 
  };
  
  document.addEventListener("DOMContentLoaded", init);
})();