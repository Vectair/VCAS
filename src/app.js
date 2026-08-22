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
  // Set once CompassHeading is actually allowed to listen (Android: always,
  // once initCompassHeading() runs; iOS: only after the user grants the
  // explicit permission prompt) — lets onGpsSuccess safely stop()/start()
  // the sensor listener based on speed without racing iOS's one-time
  // permission gesture (see the power-efficiency note by CompassHeading.stop()
  // below for why this toggling exists at all).
  let compassPermissionGranted = false;
  let fetchTimer = null;
  let renderTickTimer = null;
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

  // Stage 3 aircraft-list panel (RAW only) — which field it's currently
  // sorted by. In-memory only, like indicatorPage above; not a persisted
  // setting, just live display state for the current session.
  let rawListSortMode = "priority";

  // ND-style range selector (RAW only) — index into Indicators.RING_BANDS_NM,
  // matching a real EFIS control panel's physical range knob. Defaults to
  // the LAST index (the full 2/5/10/15/50nm scale) so a fresh session's
  // behaviour is identical to before this existed — dialling it down is an
  // explicit user action, not a new default anyone has to opt out of.
  let selectedRangeIndex = Indicators.RING_BANDS_NM.length - 1;

  // Destination-pick mode: route button arms it, next map click/tap supplies the target.
  let destPickActive = false;

  // Destination search-by-name — debounce timer, and a token to discard a
  // stale response if a newer search superseded it before the fetch resolved.
  let _destSearchDebounceTimer = null;
  let _destSearchToken = 0;

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

  // RAW's plot is a 1:1 square (Geo.computeSquarePlotLayout) that has to
  // start below the compass tape's real rendered content — ticks/labels,
  // lubber line, digital heading, and (when a route is active) the info
  // strip — see UI.renderCompassRing's own internal layout math. A fixed
  // worst-case constant rather than a live DOM measurement: the compass
  // tape is an SVG overlay drawn AFTER the square's own layout is decided
  // (its cx needs the square's contentTop to know where to start), so
  // measuring it first would be circular; and this same number has to be
  // shared with CameraController.followNav's real-camera anchor calc
  // (see _rawChromeInsets() below) — using the SAME fixed constant in both
  // rather than two different live measurements is what keeps them unable
  // to drift apart, not just unlikely to.
  const RAW_COMPASS_RESERVED_PX = 80;

  // Small fixed margin for the plot's own edges WITHIN its square — not a
  // chrome margin (real chrome is already fully excluded via
  // squareContentTop/squareContentHeight below), just enough that a dot at
  // the literal edge of the plot doesn't render flush against the square's
  // own boundary.
  const SQUARE_EDGE_MARGIN_PX = 16;

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
    AirRangeRingsOption.init();
    _updateAirRingsToggleBtn();

    DevMode.init();
    _initDevTools();
    // Always needed regardless of dev mode — ViewportDevPanel.getCurrentPresetId()
    // safely defaults to "full" (real window dimensions) even when never init()'d.
    CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());

    LogPanel.init();
    AltitudeSuppressPanel.init({ onChange: onAltitudeSuppressChanged });
    NavDisplayStyle.init({ onChange: onNavDisplayStyleChanged });
    _applyNavStyleToDom();
    WakeLock.init();
    initCompassHeading();
    EosMap.onMapClick(onMapClicked);
    EosMap.onUserInteraction(onUserPannedMap);
    _initSettingsScreen();
    _initDevModeUnlock();

    const storedGuidance = localStorage.getItem(GUIDANCE_TEXT_KEY);
    if (storedGuidance !== null) guidanceTextEnabled = storedGuidance !== "0";
    _updateGuidanceToggleBtn();

    const storedMode = localStorage.getItem(ROUTE_MODE_KEY);
    if (storedMode && MODE_ICONS[storedMode]) routeMode = storedMode;
    _updateModeButtons();

    document.body.dataset.mode = "nav";
    WakeLock.enable(); // NAV is the default starting mode — keep the screen on like a real nav app
    showConfigWarningIfNeeded();
    startGps();
    
    // Core Fix: Localised assignment execution handles the button setup cleanly
    bindButtons(); 
    
    UI.setModeLabel(_activeDisplayMode());
    UI.setAdsbStatus("error", "ADS-B");
    UI.setLoading(false);

    // Measure the real bottom-bar height immediately so the VIEW/SPD/LOG dev
    // panels clear it from the very first frame, not just after the first
    // route/guidance-toggle event recalculates it.
    updateMapViewportPadding();
  }

  // ---- Developer tools (VIEW/SPD) — hidden behind DevMode, see _initDevModeUnlock ----

  function _initDevTools() {
    if (!DevMode.isEnabled()) return;

    ViewportDevPanel.init({
      onViewportChanged() {
        const activeMap = EosMap.getMap();
        if (activeMap) {
          activeMap.resize();
          activeMap.once('resize', () => {
            CameraController.setViewportPreset(ViewportDevPanel.getCurrentPresetId());
            if (mode === "nav" && userLat !== null && userLon !== null) {
              CameraController.transitionToNav(userLat, userLon, userHeading);
            }
          });
        }
      },
    });
    SpeedSimPanel.init({ onChange: onSpeedSimChanged });
  }

  /**
   * Same convention Android itself uses for its own hidden developer
   * options: tap the brand mark 7 times within a few seconds. VIEW/SPD
   * aren't end-user features, so they're deliberately not in the primary
   * screen or the real settings screen — just not gone entirely, since
   * they're still useful for verifying speed/viewport-gated behavior.
   */
  function _initDevModeUnlock() {
    const target = document.getElementById("brand-tap-target");
    if (!target) return;

    let tapCount = 0;
    let resetTimer = null;

    target.addEventListener("click", () => {
      tapCount++;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { tapCount = 0; }, 3000);

      if (tapCount >= 7) {
        tapCount = 0;
        const enabled = DevMode.toggle();
        alert(`Developer mode ${enabled ? "enabled" : "disabled"} — reloading.`);
        location.reload();
      }
    });
  }

  // ---- Settings screen ----

  function _initSettingsScreen() {
    const screen = document.getElementById("settings-screen");

    document.getElementById("btn-settings")?.addEventListener("click", (e) => {
      e.preventDefault();
      screen?.classList.remove("hidden");
      _refreshSettingsScreen();
    });

    document.getElementById("btn-settings-close")?.addEventListener("click", (e) => {
      e.preventDefault();
      screen?.classList.add("hidden");
    });

    document.getElementById("btn-settings-ground-toggle")?.addEventListener("click", (e) => {
      e.preventDefault();
      AltitudeSuppressPanel.setGroundHidden(!AltitudeSuppressPanel.isGroundHidden());
      _refreshSettingsScreen();
    });

    document.getElementById("btn-settings-export")?.addEventListener("click", (e) => {
      e.preventDefault();
      ObservationLogger.exportFallback();
      _refreshSettingsScreen();
    });

    _renderAltPresets();
    _refreshSettingsScreen();
  }

  function _renderAltPresets() {
    const container = document.getElementById("settings-alt-presets");
    if (!container) return;
    container.innerHTML = "";

    const offBtn = document.createElement("button");
    offBtn.type = "button";
    offBtn.className = "settings-preset-btn";
    offBtn.dataset.ft = "off";
    offBtn.textContent = "Off (show everything)";
    offBtn.addEventListener("click", () => {
      AltitudeSuppressPanel.setThreshold(false, AltitudeSuppressPanel.getThresholdFt());
      _refreshSettingsScreen();
    });
    container.appendChild(offBtn);

    AltitudeSuppressPanel.PRESETS_FT.forEach(ft => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-preset-btn";
      btn.dataset.ft = String(ft);
      btn.textContent = `Below ${ft} ft`;
      btn.addEventListener("click", () => {
        AltitudeSuppressPanel.setThreshold(true, ft);
        _refreshSettingsScreen();
      });
      container.appendChild(btn);
    });
  }

  /** Re-syncs every dynamic bit of the settings screen with current state —
   * called on open and after any control inside it changes something. */
  function _refreshSettingsScreen() {
    const groundBtn = document.getElementById("btn-settings-ground-toggle");
    if (groundBtn) {
      const on = AltitudeSuppressPanel.isGroundHidden();
      groundBtn.textContent = on ? "On" : "Off";
      groundBtn.classList.toggle("active", on);
    }

    const enabled     = AltitudeSuppressPanel.isEnabled();
    const thresholdFt = String(AltitudeSuppressPanel.getThresholdFt());
    document.querySelectorAll("#settings-alt-presets .settings-preset-btn").forEach(btn => {
      const active = btn.dataset.ft === "off" ? !enabled : (enabled && btn.dataset.ft === thresholdFt);
      btn.classList.toggle("active", active);
    });

    const exportLabel = document.getElementById("settings-export-label");
    const exportBtn   = document.getElementById("btn-settings-export");
    if (exportLabel && exportBtn) {
      const count = ObservationLogger.fallbackCount();
      exportLabel.textContent = count > 0
        ? `${count} buffered observation${count === 1 ? "" : "s"}`
        : "No buffered observations";
      exportBtn.disabled = count === 0;
    }

    _updateColorblindToggleBtn();
  }

  // ---- Core Interface Event Listeners Matrix ---- //

  function bindButtons() {
    // 1 & 2. Hybrid / Raw — both enter NAV mode, just with a different
    // NavDisplayStyle; surfaced as two peer main-screen buttons rather than
    // one NAV button plus a buried Settings sub-toggle.
    const btnHybrid = document.getElementById("btn-hybrid");
    if (btnHybrid) {
      btnHybrid.addEventListener("click", (e) => {
        e.preventDefault();
        _enterNavMode(NavDisplayStyle.HYBRID);
      });
    }

    const btnRaw = document.getElementById("btn-raw");
    if (btnRaw) {
      btnRaw.addEventListener("click", (e) => {
        e.preventDefault();
        _enterNavMode(NavDisplayStyle.RAW);
      });
    }

    // 3. Airspace View Overview Strategic Selection Toggle
    const btnAir = document.getElementById("btn-air");
    if (btnAir) {
      btnAir.addEventListener("click", (e) => {
        e.preventDefault();
        if (mode === "air") return;
        mode = "air";
        document.body.dataset.mode = "air";
        UI.setModeLabel("air");
        UI.clearIndicators(); // Clear screen edge markers inside 2D views
        // Cleared unconditionally here; refreshAirMode() below repopulates
        // them immediately if the AIR rings option (settings) is on.
        EosMap.clearRangeRings();
        UI.clearCompassRing(); // Only ever shown in NAV's Raw style
        // Both screen-space RAW overlays — same reasoning as clearCompassRing
        // above: refreshIndicators() (which normally clears these on a
        // Hybrid/Raw switch) never runs again once in AIR mode, so leaving
        // either uncleared here means stale RAW content floats over the AIR
        // map for as long as the user stays there. renderRangeRingsOverlay
        // was already missing this before the aircraft-list panel existed —
        // fixed alongside it since it's the identical bug at the same call site.
        UI.clearRangeRingsOverlay();
        UI.clearAircraftList();
        UI.clearRangeSelector(); // same bug pattern as the two clears above
        UI.setRecenterVisible(false);
        WakeLock.disable(); // Only NAV (Hybrid/Raw) needs to keep the screen on, like a real nav app
        if (window._mapInitialised) EosMap.setTheme(_effectiveMapTheme(ThemeManager.getResolved()));
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

    // 6a. Destination search-by-name — debounced as-you-type; Enter forces
    // an immediate lookup rather than waiting out the debounce.
    const destSearchInput = document.getElementById("dpb-search-input");
    if (destSearchInput) {
      destSearchInput.addEventListener("input", () => {
        clearTimeout(_destSearchDebounceTimer);
        _destSearchDebounceTimer = setTimeout(() => _searchDestination(destSearchInput.value), 350);
      });
      destSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(_destSearchDebounceTimer);
          _searchDestination(destSearchInput.value);
        }
      });
    }

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
        EosMap.setTheme(_effectiveMapTheme(resolved));
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

    // 10. Range rings in Air view toggle
    const btnAirRings = document.getElementById("btn-air-rings-toggle");
    if (btnAirRings) {
      btnAirRings.addEventListener("click", (e) => {
        e.preventDefault();
        onAirRingsToggleClick();
      });
    }
  }

  // ---- Theme ----

  /**
   * The map basemap's actual theme, which isn't always just the resolved
   * Day/Night/Auto preference: NAV's Raw display style overrides it to the
   * "raw" instrument-screen look (always dark, no road/building/label
   * detail) regardless of Day/Night/Auto — a TCAS/ND doesn't have a day
   * mode. Only the map basemap is affected; UI chrome (settings, the
   * status bar meta colour, etc.) still follows the real resolved theme via
   * _applyThemeToDom(), unrelated to this.
   */
  function _effectiveMapTheme(resolvedTheme) {
    return (mode === "nav" && NavDisplayStyle.isRaw()) ? "raw" : resolvedTheme;
  }

  function _onThemeChange(theme) {
    EosMap.setTheme(_effectiveMapTheme(theme));
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

  /**
   * Reflects the active NAV display style on <body> so CSS can key off it —
   * specifically, the "indicators are secondary" dimming below is right for
   * Hybrid (traffic overlaid on a real road map) but wrong for Raw (traffic
   * IS the display; there's no map to be secondary to), so it needs its own
   * selector rather than applying unconditionally in NAV mode.
   */
  function _applyNavStyleToDom() {
    document.body.dataset.navStyle = NavDisplayStyle.get();
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
    if (!btn) return;
    const on = ColorblindMode.isEnabled();
    btn.textContent = on ? "On" : "Off";
    btn.classList.toggle("active", on);
  }

  // ---- Range rings in Air view ----

  function onAirRingsToggleClick() {
    const enabled = AirRangeRingsOption.toggle();
    _updateAirRingsToggleBtn();
    // Re-render immediately if already in AIR mode, same as the colour-blind
    // toggle — otherwise it only takes effect the next time AIR is entered.
    if (mode !== "air" || userLat === null) return;
    if (enabled) refreshAirMode();
    else EosMap.clearRangeRings();
  }

  function _updateAirRingsToggleBtn() {
    const btn = document.getElementById("btn-air-rings-toggle");
    if (!btn) return;
    const on = AirRangeRingsOption.isEnabled();
    btn.textContent = on ? "On" : "Off";
    btn.classList.toggle("active", on);
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

    // Power: the device-orientation sensor (magnetometer/gyro) keeps the
    // JS thread waking on every reading for as long as something is
    // listening, whether or not onCompassHeading() actually uses the
    // value — and it never does above GPS_HEADING_MIN_SPEED_MPH (GPS
    // course wins there, see onCompassHeading's own matching check). Most
    // of an actual drive is spent above that threshold, so stop()ing the
    // listener there — and start()ing it again once slow/stopped, where
    // it's the only source of heading — cuts a continuous sensor drain
    // down to just the stationary/slow portion of a session where it's
    // actually read. Both calls are idempotent (no-op if already in the
    // requested state), so this is safe to run on every single GPS fix.
    if (compassPermissionGranted) {
      if (userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) CompassHeading.stop();
      else CompassHeading.start(onCompassHeading);
    }

    if (!window._mapInitialised) {
      window._mapInitialised = true;
      EosMap.init("map", userLat, userLon, _effectiveMapTheme(ThemeManager.getResolved()));
      scheduleFetch();
    } else {
      EosMap.updateUserPosition(userLat, userLon, userHeading, userSpeedMph);
    }

    if (mode === "nav") {
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
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
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
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
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
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

  // ---- NAV display style (Hybrid vs Raw) ----

  /** Which of the three main-screen buttons should read "active" right now. */
  function _activeDisplayMode() {
    return mode === "air" ? "air" : (NavDisplayStyle.isRaw() ? "raw" : "hybrid");
  }

  function onNavDisplayStyleChanged() {
    // Swap the basemap between the normal themed map (Hybrid) and the raw
    // instrument-screen look (Raw), and re-evaluate the camera immediately
    // rather than waiting for the next GPS tick, so flipping the setting
    // visibly takes effect right away.
    _applyNavStyleToDom();
    UI.setModeLabel(_activeDisplayMode());
    if (window._mapInitialised) {
      EosMap.setTheme(_effectiveMapTheme(ThemeManager.getResolved()));
    }
    if (mode === "nav" && userLat !== null) {
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
      refreshIndicators(); // range rings appear/disappear immediately too
    }
  }

  /**
   * Shared entry point for the Hybrid and Raw main-screen buttons — both are
   * NAV mode under the hood (see `mode`), just a different NavDisplayStyle.
   * Setting the style BEFORE doing any camera/mode work (rather than relying
   * solely on onNavDisplayStyleChanged's side effects) means a same-tap
   * AIR->Raw jump picks up the right camera preset on its very first
   * transitionToNav() call, not a Hybrid one corrected a frame later.
   */
  function _enterNavMode(style) {
    const styleChanging = NavDisplayStyle.get() !== style;
    const modeChanging = mode !== "nav";

    if (!styleChanging && !modeChanging) return; // already exactly this view

    if (styleChanging) NavDisplayStyle.set(style); // fires onNavDisplayStyleChanged

    if (!modeChanging) return; // style-only change: onNavDisplayStyleChanged already handled it

    mode = "nav";
    indicatorPage = 0; // fresh start when re-entering NAV mode
    document.body.dataset.mode = "nav";
    UI.setModeLabel(_activeDisplayMode());
    navFollowSuspended = false;
    UI.setRecenterVisible(false);
    WakeLock.enable();
    if (window._mapInitialised) EosMap.setTheme(_effectiveMapTheme(ThemeManager.getResolved()));
    if (userLat !== null && userLon !== null) {
      CameraController.transitionToNav(userLat, userLon, userHeading, _rawChromeInsets());
      refreshIndicators();
    }
  }

  // ---- Compass heading fallback (stationary/slow, where GPS course freezes) ----

  function initCompassHeading() {
    if (!CompassHeading.isSupported()) return;

    if (CompassHeading.needsPermission()) {
      // iOS: can't request silently — needs a real user gesture.
      UI.showCompassPermissionBanner(true, async () => {
        const granted = await CompassHeading.requestPermission();
        UI.showCompassPermissionBanner(false);
        if (granted) {
          compassPermissionGranted = true;
          CompassHeading.start(onCompassHeading);
        }
      });
    } else {
      // Android/others: no explicit permission needed.
      compassPermissionGranted = true;
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
      if (!navFollowSuspended) CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
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
        EosMap.init("map", 51.5, -0.12, _effectiveMapTheme(ThemeManager.getResolved()));
      }
    }
  }

  // ---- Data fetch loop ----

  let _fetchInFlight = false;
  let _loadingIndicatorTimer = null;
  const LOADING_INDICATOR_DELAY_MS = 500;

  // How often to re-render aircraft position between actual ADS-B polls —
  // see _currentAircraftList()/AircraftExtrapolation. Independent of (and
  // much shorter than) CONFIG.REFRESH_INTERVAL_SECONDS: this doesn't fetch
  // anything, just re-projects already-known aircraft along their reported
  // track/speed, so a fast-moving nearby aircraft glides between polls
  // instead of jumping once every 3s.
  const RENDER_TICK_MS = 500;

  function scheduleFetch() {
    fetchAircraft();
    fetchTimer = setInterval(fetchAircraft, CONFIG.REFRESH_INTERVAL_SECONDS * 1000);
    renderTickTimer = setInterval(_extrapolationRenderTick, RENDER_TICK_MS);
  }

  /** Aircraft positions extrapolated forward from the last real fix using
   * their own reported speed/track (AircraftExtrapolation) — capped at
   * STALE_THRESHOLD_SECONDS so a run of failed polls holds position rather
   * than projecting further and further from an increasingly untrustworthy
   * fix. */
  function _currentAircraftList() {
    if (lastFetchTime === null) return aircraftList;
    const elapsedSeconds = (Date.now() - lastFetchTime) / 1000;
    return AircraftExtrapolation.extrapolateAll(aircraftList, elapsedSeconds, CONFIG.STALE_THRESHOLD_SECONDS);
  }

  function _extrapolationRenderTick() {
    if (userLat === null) return;
    if (mode === "nav") refreshIndicators();
    else refreshAirMode();
  }

  async function fetchAircraft() {
    if (userLat === null) return;

    // Cheap to call every tick — MetarProvider internally no-ops until its
    // own ~15min interval elapses, so this just piggybacks on the existing
    // poll loop rather than needing a separate timer. Fire-and-forget: the
    // very next refreshIndicators()/refreshAirMode() call just reads
    // whatever's cached (possibly still null on the first few ticks).
    MetarProvider.refresh(userLat, userLon);

    // setInterval fires on a fixed clock regardless of whether the previous
    // call finished — on a slow connection a single fetch (up to the 8s
    // AdsbExchangeClient timeout) can easily outlast the 3s poll interval,
    // which without this guard stacks up overlapping in-flight requests and
    // makes the loading spinner flicker on/off as each one resolves out of
    // order. Skipping the tick instead lets the effective interval stretch
    // to match how slow the connection actually is, rather than compounding it.
    if (_fetchInFlight) return;
    _fetchInFlight = true;

    // Most polls resolve in well under a second — showing "Fetching
    // aircraft…" on every single one flashed it on/off roughly every 3s,
    // distracting rather than useful. Only actually show it if THIS fetch
    // is taking a while; a fast one never triggers the timer at all.
    _loadingIndicatorTimer = setTimeout(() => UI.setLoading(true), LOADING_INDICATOR_DELAY_MS);
    const result = await AdsbExchangeClient.fetchNearby(userLat, userLon, CONFIG.DEFAULT_RANGE_NM);
    clearTimeout(_loadingIndicatorTimer);
    UI.setLoading(false);
    _fetchInFlight = false;

    lastFetchTime = Date.now();
    lastFetchError = result.error;

    if (result.error) {
      if (result.error === "not_configured") {
        UI.setAdsbStatus("error", "ADS-B");
      } else if (result.error === "auth_failed") {
        UI.setAdsbStatus("error", "Auth error");
      } else {
        // Surface the actual failure reason (timeout / network / http_xxx —
        // see AdsbExchangeClient.fetchNearby) directly in the pill instead
        // of a bare "No data" — this is the only diagnostic signal visible
        // from a screenshot on a phone, where opening dev tools isn't
        // practical, and "no data" alone doesn't distinguish a dead
        // connection from the provider itself rejecting/erroring requests.
        UI.setAdsbStatus("stale", `No data (${result.error})`);
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

  /**
   * Real DOM-measured layout numbers RAW's square plot (Geo.
   * computeSquarePlotLayout) needs — the SINGLE place these are computed,
   * consumed both by the screen-space rendering in refreshIndicators()
   * below (dots/rings/list) and by CameraController.followNav's real-
   * camera anchor calc (see that function's own doc comment for why
   * passing it the SAME numbers, not separately re-measuring them, is what
   * keeps the real user-marker and the screen-space square unable to drift
   * apart). Cheap DOM reads only — safe to call once per GPS/compass tick
   * and again per refreshIndicators() call.
   */
  function _rawChromeInsets() {
    const { width: vw, height: vh } = ViewportDevPanel.getViewportDimensions();

    // How much room the bottom chrome (ETA card and/or the bottom bar,
    // which can be stacked together when a route is active) actually
    // occupies right now.
    let bottomInset = 0;
    const routeCard = document.getElementById("route-card");
    if (routeCard && !routeCard.classList.contains("hidden")) {
      bottomInset += routeCard.offsetHeight;
    }
    const bottomBar = document.getElementById("bottom-bar");
    if (bottomBar && !bottomBar.classList.contains("hidden")) {
      bottomInset += bottomBar.offsetHeight;
    }
    if (bottomInset === 0) bottomInset = 60;

    // Real top-bar (+ guidance card, when a route is active) height — the
    // square's own contentTop adds RAW_COMPASS_RESERVED_PX on top of this
    // so the square also clears the compass tape (see that constant's own
    // comment for why it's a fixed worst-case number, not measured).
    let chromeTopInset = 0;
    const topBar = document.getElementById("top-bar");
    if (topBar) chromeTopInset += topBar.offsetHeight;
    const guidanceCard = document.getElementById("nav-guidance-card");
    if (guidanceCard && !guidanceCard.classList.contains("hidden")) {
      chromeTopInset += guidanceCard.offsetHeight;
    }

    const squareContentTop = chromeTopInset + RAW_COMPASS_RESERVED_PX;
    return {
      viewportWidth: vw, viewportHeight: vh,
      chromeTopInset, bottomInset,
      squareContentTop,
      squareContentHeight: Math.max(0, vh - squareContentTop - bottomInset),
    };
  }

  function refreshIndicators() {
    if (userLat === null) return;
    const insets = _rawChromeInsets();
    const vw = insets.viewportWidth, vh = insets.viewportHeight;

    const userState = {
      lat: userLat, lon: userLon,
      heading: userHeading,
      speedMph: userSpeedMph,
      viewportWidth: vw,
      viewportHeight: vh,
      // Hybrid's own unrestricted teardrop (Geo.maxRadiusForBearing with no
      // fovHalfAngleDeg) still scales against the full viewport with this
      // as its "keep dots clear of the bottom chrome" margin — kept as the
      // real chrome height for that case. RAW overrides this below with a
      // small fixed in-square margin instead, since chrome is already
      // fully excluded from the square's own bounds by that point.
      safeInset: insets.bottomInset,
      metar: MetarProvider.getCached(),
    };

    const camConfig = CameraController.getLastEvaluated();
    if (camConfig) {
      userState.cameraPitch = camConfig.pitch;
      userState.anchorY = camConfig.anchorY;
    }
    _updateGuidanceCard(camConfig && camConfig.maneuver);

    // RAW's plot is a 1:1 square (Geo.computeSquarePlotLayout) — "as large
    // an area as possible" within the available content, matching a real
    // ND's fixed-aspect traffic display, NOT a shape that stretches to use
    // whatever asymmetric headroom a full-viewport anchor happens to leave
    // (the pre-2026-08-21 approach, which left near-zero side margin on a
    // plain portrait phone — the common case — for the Stage 3 list panel
    // to ever actually show in). Hybrid's edge indicators aren't a "round
    // display" at all and keep the full teardrop Relevance computes against
    // the plain full viewport, so none of this applies there.
    const isRawView = NavDisplayStyle.isRaw();
    let square = null;
    let activeBandsNm = Indicators.RING_BANDS_NM;
    let selectedRangeNm = Indicators.RING_BANDS_NM[Indicators.RING_BANDS_NM.length - 1];
    if (isRawView) {
      square = Geo.computeSquarePlotLayout(vw, insets.squareContentTop, insets.squareContentHeight);
      userState.fovHalfAngleDeg = Indicators.FOV_HALF_ANGLE_DEG;
      // The within-square anchor fraction — NOT userState.anchorY's usual
      // full-viewport meaning. Must equal NavigationCameraEvaluator's own
      // STATE_PRESETS.NAV_RAW.anchorY (the fraction the real camera derives
      // its full-viewport anchorY from for this exact square, so the real
      // user-marker lands on the same point these screen-space dots plot
      // against) — read directly from there rather than a second constant,
      // so the two can't quietly drift out of sync with each other.
      userState.anchorY = NavigationCameraEvaluator.STATE_PRESETS.NAV_RAW.anchorY;
      userState.plotWidth = square.squareSize;
      userState.plotHeight = square.squareSize;
      userState.plotOffsetX = square.squareLeft;
      userState.plotOffsetY = square.squareTop;
      userState.plotSafeInset = SQUARE_EDGE_MARGIN_PX;

      // ND-style range selector — a shorter prefix of the same band array
      // the rings already draw, so dialling down to (say) 10nm both
      // rescales the plot (the 10nm band now maps to the full radius
      // instead of a small inner fraction of it, matching a real ND
      // zooming in) and — via Geo.bandedRadiusFraction's own existing
      // clamp-to-edge behaviour for anything at/beyond the last band —
      // pushes traffic beyond 10nm out to the plot's outer edge, which is
      // exactly the position the suppressed edge-dot below wants.
      activeBandsNm = Indicators.RING_BANDS_NM.slice(0, selectedRangeIndex + 1);
      selectedRangeNm = activeBandsNm[activeBandsNm.length - 1];
      userState.plotBandsNm = activeBandsNm;
    }

    const now = Date.now();
    for (const [hex, expiry] of suppressedUntil) {
      if (expiry <= now) suppressedUntil.delete(hex);
    }

    const currentAircraft = _currentAircraftList();

    // The FOV filter (x === null) only ever excludes anything when
    // fovHalfAngleDeg is set — a no-op for Hybrid, which never sets it.
    const allRelevant = Indicators.build(
      currentAircraft, userState,
      CONFIG.STALE_THRESHOLD_SECONDS,
      new Set(suppressedUntil.keys())
    ).filter(item => item.x !== null);

    // Ground-truth log panel gets everything tracked, unfiltered — including
    // aircraft the relevance gate excluded, since logging "the algorithm was
    // wrong to hide this" is the whole point. Indicators.buildAll() is a
    // full second relevance/visibility pass over every tracked aircraft
    // (not just the ones NAV shows) — real cost, run every ~500ms-1s by
    // this function's own callers, purely to feed a panel that's closed
    // the vast majority of the time (LogPanel.update() already no-ops its
    // own render then). Skipping the computation itself when the panel
    // isn't open leaves _tracked briefly stale for at most one tick after
    // it's re-opened (the next refreshIndicators() call sees isOpen()
    // true and refreshes it), which is a fine trade for a diagnostic tool.
    if (LogPanel.isOpen()) {
      LogPanel.update(
        Indicators.buildAll(currentAircraft, userState, CONFIG.STALE_THRESHOLD_SECONDS),
        userState
      );
    }

    // ND range selector split — vis.slantRangeNm is the SAME figure
    // Indicators.build() plotted the dot's radius from (see indicators.js),
    // so this agrees exactly with what's visibly at/past the plot's edge.
    // Relevance itself is untouched by the range selector (an aircraft
    // doesn't stop being "relevant" just because the user zoomed in) —
    // this only decides full-icon-with-label vs bare edge dot. Hybrid
    // never dials the selector down (activeBandsNm stays the full array,
    // selectedRangeNm stays its max), so beyondRange is always empty there.
    const withinRange = isRawView ? allRelevant.filter(it => it.vis.slantRangeNm <= selectedRangeNm) : allRelevant;
    const beyondRange = isRawView ? allRelevant.filter(it => it.vis.slantRangeNm > selectedRangeNm) : [];

    const cap = Indicators.capForViewportWidth(vw);
    const totalPages = Math.max(1, Math.ceil(withinRange.length / cap));
    if (indicatorPage >= totalPages) indicatorPage = 0;

    const pageStart = indicatorPage * cap;
    const shown = withinRange.slice(pageStart, pageStart + cap);

    UI.renderIndicators(shown, onIndicatorClick);
    // Beyond-range traffic renders as bare edge dots, always in full (never
    // paginated — a dot carries no label, so it doesn't compete for the
    // same "keep it glanceable" room a page cap exists to protect).
    UI.renderSuppressedDots(beyondRange, onIndicatorClick);
    // Nudges apart only the rendered LABEL boxes that visibly overlap —
    // never the icon or its direction arrow, which stay exactly at each
    // aircraft's true plotted position (ind.x/ind.y) no matter what. No
    // anchor argument needed any more: it operates per-aircraft, in a
    // local frame centred on that aircraft's own already-fixed icon, not
    // around the plot's shared ownship anchor the way an earlier version
    // did (see the function's own doc comment for why that was wrong —
    // it let a crowded label drag its icon+arrow along with it).
    UI.declutterRenderedIndicators();
    // Scoped to withinRange, not allRelevant — "N of M shown, tap for more"
    // is about PAGINATION overflow within the current range; traffic held
    // back by the range selector instead is a separate concept (the
    // suppressed edge dots + list panel's dimmed rows already communicate
    // that), not something this badge's "more" wording should conflate it with.
    UI.setAircraftCount(shown.length, withinRange.length, onCycleIndicatorPage);

    // TCAS/ND-style range rings — Raw only. Screen-space, sharing the same
    // square/scale/FOV the aircraft dots above use (see
    // UI.renderRangeRingsOverlay's own doc comment for why this replaced
    // EosMap's real geo-referenced MapLibre layer for RAW specifically —
    // that's still what AIR's own opt-in rings use, since AIR's real 1:1
    // map scale has no banding to stay consistent with). Not drawn for
    // Hybrid — its own real road/building detail already gives spatial
    // reference, and it never adopted the banded scale in the first place.
    EosMap.clearRangeRings(); // RAW no longer uses the real-geo layer at all
    if (isRawView) {
      // activeBandsNm, not the full Indicators.RING_BANDS_NM — only the
      // rings within the currently-selected range actually draw, matching
      // the dots above (both already only ever reach RING_BANDS_NM's own
      // boundaries anyway; this just stops short at whichever one the user
      // picked, same "zoom" effect the plot's own rescale gets from it).
      UI.renderRangeRingsOverlay(square.squareLeft, square.squareTop, square.squareSize, userState.anchorY, SQUARE_EDGE_MARGIN_PX, activeBandsNm, Indicators.FOV_HALF_ANGLE_DEG, "#f0f0f0");
      // ND-style range selector — sits in the square's own top-right
      // corner, matching where a real ND prints its current range.
      UI.renderRangeSelector(square.squareLeft + square.squareSize - 8, square.squareTop + 8, selectedRangeNm, onRawRangeCycleClick);
    } else {
      UI.clearRangeRingsOverlay();
      UI.clearRangeSelector();
    }

    // ND-style heading tape — Raw only, matching the reference image; Hybrid's
    // rotating road map already carries its own orientation cues. safeInset
    // is the real top-bar(+guidance card) height here — not the default 60
    // the function falls back to otherwise — so ticks start right below the
    // real chrome instead of a magic number that happened to be close.
    if (isRawView) {
      // Compact vehicle/route strip below the heading tape — RAW's
      // equivalent of a real ND's flight-data strip (GS/TAS/ILS APP/
      // arrival time), adapted to what's actually relevant driving a car.
      const vehicleInfo = {
        speedMph: userSpeedMph,
        route: activeRoute
          ? { destName: routeDestName || "destination", distanceMeters: activeRoute.distanceMeters, durationSeconds: activeRoute.durationSeconds }
          : null,
      };
      UI.renderCompassRing(vw, userHeading, insets.chromeTopInset, vehicleInfo);
    } else {
      UI.clearCompassRing();
    }

    // Stage 3: sortable aircraft-list panel — Raw only, filling the exact
    // rectangle complementary to the square (Geo.computeSquarePlotLayout's
    // own `rows`) — below the square in portrait, to its right in
    // landscape. Deliberately built from allRelevant (the FULL relevant
    // set), not the paginated `shown` subset the plot caps to
    // (Indicators.capForViewportWidth) — the list is exactly the escape
    // hatch for "more relevant traffic than the plot shows icons for", not
    // a mirror of whatever page is currently up. Tapping a row for an
    // aircraft not on the current icon page still opens its popup (at its
    // computed, if unrendered, plot position); it doesn't auto-advance the
    // page to bring the icon into view.
    if (isRawView) {
      const listItems = _sortForRawList(allRelevant, rawListSortMode);
      const beyondRangeHexes = new Set(beyondRange.map(it => it.aircraft.hex));
      UI.renderAircraftList(listItems, square.rows, rawListSortMode, onRawListSortClick, onIndicatorClick, beyondRangeHexes);
    } else {
      UI.clearAircraftList();
    }
  }

  function onRawRangeCycleClick() {
    selectedRangeIndex = (selectedRangeIndex + 1) % Indicators.RING_BANDS_NM.length;
    refreshIndicators();
  }

  /**
   * Re-orders (never re-filters) the Stage 3 list panel's own display
   * order. "priority" is a no-op — allRelevant already arrives sorted by
   * visibility score then proximity (Indicators.build()'s own default),
   * and that's also what governs which aircraft get plot icons/pagination
   * at all, so it must stay untouched here rather than being re-derived.
   * The other three modes only affect how the LIST reads; they never
   * touch the plot's own icon selection/order.
   */
  function _sortForRawList(items, mode) {
    if (mode === "priority") return items;
    const sorted = items.slice();
    if (mode === "range") {
      sorted.sort((a, b) => a.distanceNm - b.distanceNm);
    } else if (mode === "altitude") {
      sorted.sort((a, b) => {
        const aAlt = a.aircraft.altitudeFt, bAlt = b.aircraft.altitudeFt;
        if (aAlt == null && bAlt == null) return 0;
        if (aAlt == null) return 1; // unknown altitude sorts last, not first
        if (bAlt == null) return -1;
        return aAlt - bAlt;
      });
    } else if (mode === "type") {
      sorted.sort((a, b) =>
        (a.aircraft.type || a.aircraft.callsign || "").localeCompare(b.aircraft.type || b.aircraft.callsign || "")
      );
    }
    return sorted;
  }

  function onRawListSortClick(sortMode) {
    rawListSortMode = sortMode;
    refreshIndicators();
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
      metar: MetarProvider.getCached(),
    };

    // AIR mode stays unfiltered (buildAll, not build) — everything in range
    // is shown regardless of relevance — but now carries the same computed
    // vis/relevance/distance data NAV indicators do, so an AIR-triggered log
    // entry is just as complete, and the LOG panel stays live in AIR mode too.
    const allTracked = Indicators.buildAll(_currentAircraftList(), userState, CONFIG.STALE_THRESHOLD_SECONDS);

    EosMap.renderAirMarkers(allTracked, onAirMarkerClick);
    LogPanel.update(allTracked, userState);

    // Range rings in AIR are opt-in (see settings) — at AIR's real map
    // scale a true nm circle is a much bigger, more legitimate reference
    // than in NAV, but it's still an extra layer of clutter over an already
    // map-native view some people won't want by default.
    if (AirRangeRingsOption.isEnabled()) {
      EosMap.updateRangeRings(userLat, userLon, Indicators.RING_BANDS_NM);
    }

    // fetchAircraft()'s own setAircraftCount() uses aircraftList.length directly
    // and runs on every poll regardless of mode, but switching NAV -> AIR mid-
    // cycle (or the colour-blind toggle's immediate re-render) calls this
    // function without going through a fresh fetch — without this, the counter
    // keeps showing whatever NAV's relevance-filtered count last was until the
    // next poll tick, up to REFRESH_INTERVAL_SECONDS later.
    UI.setAircraftCount(allTracked.length);
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

  /**
   * Debounced input handler's target — geocodes `query` via OrsGeocoder and
   * renders whatever comes back. Guarded with a token so a slow response to
   * an earlier keystroke can't clobber a faster response to a later one.
   */
  async function _searchDestination(query) {
    const text = (query || "").trim();
    if (text.length < 3) {
      UI.clearDestSearchResults();
      return;
    }

    const token = ++_destSearchToken;
    const focus = (userLat !== null) ? { lat: userLat, lon: userLon } : null;
    const results = await OrsGeocoder.search(text, focus);
    if (token !== _destSearchToken) return; // superseded by a newer search

    UI.renderDestSearchResults(results, _onDestSearchResultSelected);
  }

  function _onDestSearchResultSelected(result) {
    if (destPickActive) toggleDestPickMode(); // disarms + resets the search UI
    requestRouteTo(result.lat, result.lon, result.label);
  }

  async function requestRouteTo(lat, lon, label) {
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
    // A search result already has a real place name — much more useful on
    // the route card than raw coordinates, which is all tap-to-pick has.
    routeDestName = `${MODE_ICONS[routeMode]} ${label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`}`;

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

  // ORS maneuver type code -> guidance-card icon. See maneuverTracker.js's
  // own comment for the full caveat: this schema is ORS's long-stable
  // public one, but wasn't verified against a live response from this
  // sandbox (network access to api.openrouteservice.org is blocked here).
  // An unrecognised/missing code falls back to a plain unrotated arrow
  // rather than guessing, so a schema surprise degrades quietly.
  const MANEUVER_ICONS = {
    0:  { rotation: -90,  glyph: "↑" }, // turn left
    1:  { rotation: 90,   glyph: "↑" }, // turn right
    2:  { rotation: -135, glyph: "↑" }, // sharp left
    3:  { rotation: 135,  glyph: "↑" }, // sharp right
    4:  { rotation: -45,  glyph: "↑" }, // slight left
    5:  { rotation: 45,   glyph: "↑" }, // slight right
    6:  { rotation: 0,    glyph: "↑" }, // continue straight
    7:  { rotation: 0,    glyph: "⟳" }, // enter roundabout
    8:  { rotation: 0,    glyph: "⟳" }, // exit roundabout
    9:  { rotation: 180,  glyph: "↑" }, // u-turn
    10: { rotation: 0,    glyph: "📍" }, // arrive
    11: { rotation: 0,    glyph: "↑" }, // depart
    12: { rotation: -30,  glyph: "↑" }, // keep left
    13: { rotation: 30,   glyph: "↑" }, // keep right
  };
  const DEFAULT_MANEUVER_ICON = { rotation: 0, glyph: "↑" };

  /**
   * Live turn instruction. Primary source is ManeuverTracker against ORS's
   * own turn-by-turn steps (real street names, real maneuver types,
   * roundabout/arrival detection) — falls back to NavigationCameraEvaluator's
   * geometric bearing-delta detector (via CameraController.getLastEvaluated())
   * only when a route has no usable steps (an older/unexpected ORS response
   * shape), so the card still shows *something* rather than going blank.
   * Called on every refresh, not just when the route first activates, so
   * the distance countdown and instruction actually update as you drive.
   */
  function _updateGuidanceCard(fallbackManeuver) {
    if (!activeRoute) return;
    const actionEl = document.getElementById("ngc-action-text");
    const iconEl   = document.getElementById("ngc-maneuver-icon");
    if (!actionEl || !iconEl) return;

    const hasSteps = Array.isArray(activeRoute.steps) && activeRoute.steps.length > 0;
    const routeManeuver = (hasSteps && userLat !== null && userLon !== null)
      ? ManeuverTracker.nextManeuver(activeRoute.geometry.coordinates, activeRoute.steps, userLon, userLat)
      : { exists: false };

    if (routeManeuver.exists) {
      const icon = MANEUVER_ICONS[routeManeuver.type] || DEFAULT_MANEUVER_ICON;
      const instruction = routeManeuver.instruction || (routeManeuver.isArrival ? "Arrive at destination" : "Continue");
      actionEl.textContent = routeManeuver.isArrival
        ? instruction
        : `${instruction} — ${_fmtDistance(routeManeuver.distanceMeters)}`;
      iconEl.textContent = icon.glyph;
      iconEl.style.transform = `rotate(${icon.rotation}deg)`;
      return;
    }

    if (fallbackManeuver && fallbackManeuver.exists) {
      const direction = fallbackManeuver.bearingDeltaDeg > 0 ? "right" : "left";
      actionEl.textContent = `Turn ${direction} in ${_fmtDistance(fallbackManeuver.distanceMeters)}`;
      iconEl.textContent = "↑";
      const iconRotation = Math.max(-120, Math.min(120, fallbackManeuver.bearingDeltaDeg));
      iconEl.style.transform = `rotate(${iconRotation}deg)`;
      return;
    }

    actionEl.textContent = "Continue";
    iconEl.textContent = "↑";
    iconEl.style.transform = "rotate(0deg)";
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