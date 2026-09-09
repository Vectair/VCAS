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
  // The destination itself, kept separately from activeRoute — a reroute
  // (below) needs to re-request FROM the user's current position TO this
  // same point, without making the user re-pick it. Set once in
  // requestRouteTo(), untouched by a reroute (only the geometry/steps in
  // activeRoute change), cleared alongside everything else in
  // clearActiveRoute().
  let routeDestLat = null, routeDestLon = null;
  // Off-route detection / rerouting (see _checkOffRoute()/
  // _rerouteFromCurrentPosition() below). _offRouteSinceMs is the
  // timestamp the user was FIRST found beyond CONFIG.OFF_ROUTE_THRESHOLD_
  // METERS from the active route, null while on-route — a real deviation
  // has to persist for CONFIG.OFF_ROUTE_REROUTE_DELAY_SECONDS before a
  // reroute actually fires, so momentary GPS noise or briefly crossing a
  // nearby parallel road doesn't trigger one. _rerouteInFlight guards
  // against firing a second request while one is already in progress.
  let _offRouteSinceMs = null;
  let _rerouteInFlight = false;
  // Incremented on every requestRouteTo()/_rerouteFromCurrentPosition() call
  // — same pattern as _destSearchToken below — so a slow/stale request that
  // resolves after being superseded by a newer one (user cleared the route
  // and picked a different destination while a reroute was still in
  // flight, say) can tell it's stale and discard its own result instead of
  // clobbering whatever's actually active now.
  let _routeRequestToken = 0;

  // NAV indicator paging — which page of the ranked relevant-aircraft pool
  // is currently on screen, when there are more than the viewport cap.
  // Manual only (tap the aircraft-count badge to cycle); never auto-rotates.
  let indicatorPage = 0;

  // Manually-suppressed aircraft (via the popup's Suppress button): hex -> expiry timestamp (ms).
  let suppressedUntil = new Map();

  // ND-style range selector (RAW only) — index into Indicators.RING_BANDS_NM,
  // matching a real EFIS control panel's physical range knob. Defaults to
  // 10nm (2026-08-24, direct instruction) — computed via indexOf rather than
  // a hardcoded index so this can't silently point at the wrong band if
  // RING_BANDS_NM's own values ever change.
  let selectedRangeIndex = Indicators.RING_BANDS_NM.indexOf(10);

  // Destination-pick mode: route button arms it, next map click/tap supplies the target.
  let destPickActive = false;

  // Destination search-by-name — debounce timer, and a token to discard a
  // stale response if a newer search superseded it before the fetch resolved.
  let _destSearchDebounceTimer = null;
  let _destSearchToken = 0;

  // Traffic Rules settings-screen form state — which rule the form is
  // currently editing, and (only when the form was opened for a rule just
  // created via "+ Filter rule"/"+ Highlight rule") the id to delete
  // outright on Cancel rather than leave as an orphaned disabled rule.
  // See _openTrafficRuleForm()/_cancelTrafficRuleForm().
  let _trEditingId = null;
  let _trPendingNewRuleId = null;

  // Turn-by-turn text visibility — persisted, so "route line only" sticks across reloads.
  const GUIDANCE_TEXT_KEY = "vcas-guidance-text-enabled";
  let guidanceTextEnabled = true;

  // Transport mode for routing — persisted so it defaults to whatever you used last.
  const ROUTE_MODE_KEY = "vcas-route-mode";
  const MODE_ICONS = { driving: "🚗", cycling: "🚲", walking: "🚶" };
  let routeMode = "driving";

  // First-launch onboarding — shown once, not on every open like the launch
  // screen (see index.html's #onboarding-screen). Versioned so a future
  // symbology/UI change that genuinely warrants re-showing it can bump this
  // rather than needing a separate migration.
  const ONBOARDING_SEEN_KEY = "vcas-onboarding-seen-v1";

  // Set once the user manually drags/zooms/rotates the map in NAV mode, so the
  // continuous GPS-driven camera stops fighting their pan; cleared by tapping
  // the recenter button (or by any explicit action that already re-centers,
  // like switching modes or activating/clearing a route).
  let navFollowSuspended = false;

  // RAW's plot (Geo.computePlotLayout) is pulled up (round 6, 2026-09-08)
  // to sit almost flush with the real chrome above it, per direct
  // instruction with an annotated screenshot: "the top of the radar should
  // be almost flush with the menu/status bar, essentially where the top of
  // the speed indication is." The compass tape itself (ticks/labels/
  // lubber/digital heading, drawn by UI.renderCompassRing — its dead-ahead
  // tick derived from insets.chromeTopInset, entirely UNCHANGED by this
  // value — see that call site) still starts at the same absolute Y it
  // always has; only the
  // plot's own top edge moves up to meet it, so the tape's tick labels and
  // the SPD readout now render ON TOP of the plot/rings' topmost edge
  // instead of in a separate reserved band above it — the same "tape
  // rides the rim of the display" composition a real ND uses, not empty
  // dead space. 31, not 0: leaves a few px so the plot doesn't start
  // pixel-for-pixel under real chrome ("almost flush", not literally
  // flush), and lands the plot's own top edge almost exactly at the SPD
  // readout's own top edge (stripY - 17 in renderCompassRing, i.e.
  // tickTopY + 31 — not a coincidence, chosen to match). A fixed worst-
  // case constant rather than a live DOM measurement: the compass tape is
  // an SVG overlay drawn AFTER the plot's own layout is decided (its cx
  // needs the plot's contentTop to know where to start), so measuring it
  // first would be circular; and this same number has to be shared with
  // CameraController.followNav's real-camera anchor calc (see
  // _rawChromeInsets() below) — using the SAME fixed constant in both
  // rather than two different live measurements is what keeps them unable
  // to drift apart, not just unlikely to.
  const RAW_COMPASS_RESERVED_PX = 31;

  // Small fixed margin for the plot's own edges WITHIN its own box — not a
  // chrome margin (real chrome is already fully excluded via
  // squareContentTop/squareContentHeight below), just enough that a dot at
  // the literal edge of the plot doesn't render flush against the plot's
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

  // App-shell caching only — VCAS's live GPS/ADS-B function can't work
  // offline anyway, so this isn't an "offline mode." It buys near-instant
  // repeat opens and real hardening against the documented "blank screen
  // on load" bug (see CLAUDE.md and sw.js's own top comment). Deliberately
  // NOT a <script> tag of its own: a failed script load is what makes the
  // crash reporter's capture-phase listener show the "didn't load
  // correctly" reload banner (index.html), and registration failing here
  // is a pure enhancement miss, not an app crash — calling it as a plain
  // function from inside init() keeps it out of that listener's reach.
  function _registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("sw.js?v=__BUILD_ID__", { updateViaCache: "none" })
      .catch(() => {});

    // Auto-reload once a NEW worker actually takes control of this page
    // (2026-09-01, added alongside a deploy-pages.yml fix for the
    // build-id placeholder above — the sed substitution previously never
    // reached this file, so it registered the exact same, never-changing
    // scriptURL on every deploy; see that fix's own comment. Deliberately
    // not spelling out the placeholder's literal token in this comment, so
    // it isn't itself rewritten by that same sed step). Belt-and-suspenders:
    // that fix means each deploy now registers a genuinely new scriptURL,
    // so the browser reliably fetches/installs/activates the new worker —
    // but an already-open tab from BEFORE that install completes has no
    // reason to start using it without a reload. `controllerchange` fires
    // exactly once the new worker (already skipWaiting()'d +
    // clients.claim()'d in sw.js) takes over — reloading right then means a
    // tester never has to notice or manually intervene. `_reloadedForSw`
    // guards against a reload loop (controllerchange can in principle fire
    // more than once in one page lifetime — this must only ever act on the
    // first).
    let _reloadedForSw = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (_reloadedForSw) return;
      _reloadedForSw = true;
      window.location.reload();
    });
  }

  // Plain-language one-liners for the onboarding legend, keyed by the same
  // `label` string Visibility.getCategories()/popups already use — not a
  // parallel data source, just display copy layered on top of the real
  // tier data (angular-size thresholds are deliberately left out here;
  // "quick explanation" for non-technical testers, not a physics readout).
  const ONBOARDING_LEGEND_COPY = {
    "Certainly visible": "Big and close — you shouldn't be able to miss it.",
    "Likely visible": "Large enough to actually resolve as an aircraft shape.",
    "Possibly visible": "Worth a look if you're already looking that way.",
    "Very unlikely/not visible": "Probably too small or far to spot by eye.",
  };

  function _renderOnboardingLegend() {
    const container = document.getElementById("onboarding-legend");
    if (!container) return;
    // Real icon-drawing code (AircraftSymbol.svg) and the real tier table
    // (Visibility.getCategories()) — not hand-approximated shapes/colours —
    // so this can't silently drift from what the app actually renders.
    container.innerHTML = Visibility.getCategories()
      .map((cat) => {
        const icon = AircraftSymbol.svg(cat.shape, cat.color, 22, cat.fillOpacity);
        const desc = ONBOARDING_LEGEND_COPY[cat.label] || "";
        return `<div class="onboarding-legend-row">
          <span class="onboarding-legend-icon">${icon}</span>
          <div>
            <div class="onboarding-legend-label">${cat.label}</div>
            <div class="onboarding-legend-desc">${desc}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  // Shown once per install (ONBOARDING_SEEN_KEY), not on every open like the
  // launch screen. Called right after the launch screen starts its fade —
  // #onboarding-screen sits at a normal app z-index (250), far below the
  // splash's 2147483000, so it's already present but hidden underneath and
  // simply becomes visible the moment the splash finishes fading out and
  // removes itself — no separate delay/timer needed to sequence the two.
  function _maybeShowOnboarding() {
    if (localStorage.getItem(ONBOARDING_SEEN_KEY)) return;
    _renderOnboardingLegend();
    document.getElementById("onboarding-screen")?.classList.remove("hidden");
  }

  function _initOnboarding() {
    document.getElementById("btn-onboarding-dismiss")?.addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
      document.getElementById("onboarding-screen")?.classList.add("hidden");
    });
  }

  function init() {
    _registerServiceWorker();

    AdsbExchangeClient.init(CONFIG);

    // Resolve initial theme before map initialization so the first render
    // uses the correct visual style layer palette.
    const initialTheme = ThemeManager.init(_onThemeChange);
    _applyThemeToDom(initialTheme);
    ColorblindMode.init();
    _updateColorblindToggleBtn();
    AirRangeRingsOption.init();
    _updateAirRingsToggleBtn();
    ModeButtonOrder.init();
    _applyModeButtonOrder();
    TrafficRules.init();
    ManualTilt.init();

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
    _initOnboarding();

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
    UI.setAdsbStatus("error", "adsb.fi");
    // "Configured" not "live health" — MapTiler has no per-request success/
    // failure signal the way adsb.fi/METAR's own relays report; this just
    // confirms a real key is present, set once here since it never changes
    // at runtime (see UI.setMaptilerStatus's own doc comment).
    UI.setMaptilerStatus(!!(CONFIG && CONFIG.MAPTILER_KEY));
    UI.setLoading(false);

    // Measure the real bottom-bar height immediately so the VIEW/SPD/LOG dev
    // panels clear it from the very first frame, not just after the first
    // route/guidance-toggle event recalculates it.
    updateMapViewportPadding();

    // Dismiss the launch screen now that startup has genuinely finished —
    // gated on the exact same "actually ready" condition as the line below,
    // not a fixed timer, so it can't outlast a slow load or vanish before a
    // fast one is real. If it's already gone (or never existed) this is a
    // silent no-op.
    const launchScreen = document.getElementById("launch-screen");
    if (launchScreen) {
      launchScreen.style.transition = "opacity 300ms ease-out";
      launchScreen.style.opacity = "0";
      setTimeout(() => launchScreen.remove(), 300);
    }

    // First-launch onboarding, if not seen before — see _maybeShowOnboarding's
    // own comment for why no extra delay is needed to sequence it after the
    // launch screen above.
    _maybeShowOnboarding();

    // The one reliable "the app actually finished starting" signal — read
    // by index.html's inline crash reporter's watchdog timer to decide
    // whether to show a "reload" prompt. Deliberately the LAST line of
    // init(): if anything above throws (the exact documented "blank
    // screen" bug — a missing script's global used somewhere in this
    // function), this line never runs and the watchdog correctly treats
    // the app as not-ready, even though app.js itself loaded fine.
    window._vcasAppReady = true;
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
      // Closing the whole screen with the rule-builder form still open on a
      // just-added, never-saved rule is treated as an implicit Cancel — see
      // _cancelTrafficRuleForm()'s own comment on why that rule shouldn't
      // be left behind as an orphaned disabled entry.
      if (_trPendingNewRuleId) _cancelTrafficRuleForm();
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

    document.getElementById("btn-mode-order-reset")?.addEventListener("click", (e) => {
      e.preventDefault();
      ModeButtonOrder.reset();
      _applyModeButtonOrder();
      _renderModeOrderList();
    });

    document.getElementById("btn-add-filter-rule")?.addEventListener("click", (e) => {
      e.preventDefault();
      const rule = TrafficRules.add("filter");
      _renderTrafficRulesList();
      _openTrafficRuleForm(rule.id, true);
    });

    document.getElementById("btn-add-highlight-rule")?.addEventListener("click", (e) => {
      e.preventDefault();
      const rule = TrafficRules.add("highlight");
      _renderTrafficRulesList();
      _openTrafficRuleForm(rule.id, true);
    });

    document.getElementById("btn-traffic-rule-save")?.addEventListener("click", (e) => {
      e.preventDefault();
      _saveTrafficRuleForm();
    });

    document.getElementById("btn-traffic-rule-cancel")?.addEventListener("click", (e) => {
      e.preventDefault();
      _cancelTrafficRuleForm();
    });

    _renderAltPresets();
    _renderModeOrderList();
    _renderTrafficRulesList();
    _refreshSettingsScreen();
  }

  /** Moves the real #btn-raw/#btn-air/#btn-hybrid elements into
   * ModeButtonOrder's current saved order — appendChild on a node that
   * already has this same parent just MOVES it to the end rather than
   * cloning/recreating it, so each button keeps its own already-bound
   * click listener untouched (same "move, don't recreate" pattern
   * ui.js's own indicator-diffing uses to keep DOM order in sync with a
   * priority order — see CLAUDE.md's "Power efficiency pass" follow-up). */
  function _applyModeButtonOrder() {
    const container = document.querySelector("#mode-row .mode-toggle");
    if (!container) return;
    const idToBtn = {
      raw: document.getElementById("btn-raw"),
      air: document.getElementById("btn-air"),
      hybrid: document.getElementById("btn-hybrid"),
    };
    ModeButtonOrder.get().forEach(id => {
      const btn = idToBtn[id];
      if (btn) container.appendChild(btn);
    });
  }

  const MODE_ORDER_LABELS = { raw: "RAW", air: "AIR", hybrid: "HYBRID" };

  /** Rebuilds the Settings screen's reorder rows from ModeButtonOrder's
   * current order — full rebuild each call (same pattern _renderAltPresets()
   * already uses), since this is a handful of rows, not the render-cost-
   * sensitive NAV/RAW indicator layer. Tap-based move (▲/▼), not
   * drag-to-reorder — see the CSS's own comment on why. */
  function _renderModeOrderList() {
    const container = document.getElementById("settings-mode-order-list");
    if (!container) return;
    container.innerHTML = "";
    const order = ModeButtonOrder.get();
    order.forEach((id, index) => {
      const row = document.createElement("div");
      row.className = "settings-order-row";

      const label = document.createElement("span");
      label.className = "settings-order-label";
      label.textContent = MODE_ORDER_LABELS[id] || id.toUpperCase();

      const moves = document.createElement("div");
      moves.className = "settings-order-moves";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "settings-order-move-btn";
      upBtn.textContent = "▲";
      upBtn.disabled = index === 0;
      upBtn.title = "Move earlier";
      upBtn.addEventListener("click", (e) => {
        e.preventDefault();
        ModeButtonOrder.move(index, -1);
        _applyModeButtonOrder();
        _renderModeOrderList();
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "settings-order-move-btn";
      downBtn.textContent = "▼";
      downBtn.disabled = index === order.length - 1;
      downBtn.title = "Move later";
      downBtn.addEventListener("click", (e) => {
        e.preventDefault();
        ModeButtonOrder.move(index, 1);
        _applyModeButtonOrder();
        _renderModeOrderList();
      });

      moves.appendChild(upBtn);
      moves.appendChild(downBtn);
      row.appendChild(label);
      row.appendChild(moves);
      container.appendChild(row);
    });
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

  // ---- Traffic Rules (settings screen) — hide (filter) or mark
  // (highlight) aircraft by type/category/altitude/military-vs-civil.
  // Rendering/CRUD wiring only; the actual match logic lives in
  // TrafficRulesLogic (src/logic/trafficRules.js), the persisted list in
  // TrafficRules (src/trafficRules.js). ----

  /** One-line human-readable summary of a rule's conditions, e.g.
   * `Type contains "A320" · Above 10,000ft` — or "Any aircraft" if the
   * rule has no conditions set at all (matches everything). */
  function _trConditionSummary(conditions) {
    const parts = [];
    if (conditions.typeQuery) {
      const terms = conditions.typeQuery.split(",").map(t => t.trim()).filter(Boolean);
      parts.push(terms.length > 1
        ? `Type is any of: ${terms.join(", ")}`
        : `Type contains "${conditions.typeQuery}"`);
    }
    if (conditions.category && conditions.category !== "any") {
      const cats = TrafficRulesLogic.getCategories();
      parts.push(cats[conditions.category] || conditions.category);
    }
    if (conditions.altitude && conditions.altitude.enabled) {
      const dir = conditions.altitude.direction === "below" ? "Below" : "Above";
      parts.push(`${dir} ${Math.round(conditions.altitude.ft).toLocaleString()}ft`);
    }
    if (conditions.traffic && conditions.traffic !== "any") {
      parts.push(conditions.traffic === "military" ? "Military (OAT)" : "Civil (GAT)");
    }
    return parts.length ? parts.join(" · ") : "Any aircraft";
  }

  /** Full rebuild each call — a handful of rows, not the render-cost-
   * sensitive NAV/RAW indicator layer (same reasoning already established
   * for _renderModeOrderList()/_renderAltPresets()). */
  function _renderTrafficRulesList() {
    const container = document.getElementById("traffic-rules-list");
    if (!container) return;
    container.innerHTML = "";

    const rules = TrafficRules.list();
    if (rules.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-hint";
      empty.style.margin = "0 0 10px";
      empty.textContent = "No rules yet — every tracked aircraft shows normally.";
      container.appendChild(empty);
      return;
    }

    rules.forEach(rule => {
      const row = document.createElement("div");
      row.className = "traffic-rule-row" + (rule.enabled ? "" : " disabled");

      const swatch = document.createElement("span");
      swatch.className = "traffic-rule-swatch";
      if (rule.mode === "highlight") {
        swatch.style.background = rule.color;
      } else {
        swatch.textContent = "✕";
      }

      const summary = document.createElement("span");
      summary.className = "traffic-rule-summary";
      summary.textContent = (rule.mode === "highlight" ? "Highlight: " : "Filter: ") + _trConditionSummary(rule.conditions);

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "traffic-rule-row-btn";
      toggleBtn.title = rule.enabled ? "Disable rule" : "Enable rule";
      toggleBtn.textContent = rule.enabled ? "●" : "○";
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        TrafficRules.toggleEnabled(rule.id);
        _renderTrafficRulesList();
      });

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "traffic-rule-row-btn";
      editBtn.title = "Edit rule";
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", (e) => {
        e.preventDefault();
        _openTrafficRuleForm(rule.id, false);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "traffic-rule-row-btn";
      deleteBtn.title = "Delete rule";
      deleteBtn.textContent = "🗑";
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        TrafficRules.remove(rule.id);
        if (_trEditingId === rule.id) _closeTrafficRuleForm();
        _renderTrafficRulesList();
      });

      row.appendChild(swatch);
      row.appendChild(summary);
      row.appendChild(toggleBtn);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      container.appendChild(row);
    });
  }

  /** Built once — TrafficRulesLogic.getCategories() is a fixed static
   * table, no reason to rebuild the <option> list on every form open. */
  function _populateTrafficCategoryOptions() {
    const select = document.getElementById("tr-category");
    if (!select || select.options.length > 0) return;
    const anyOpt = document.createElement("option");
    anyOpt.value = "any";
    anyOpt.textContent = "Any";
    select.appendChild(anyOpt);
    const cats = TrafficRulesLogic.getCategories();
    Object.keys(cats).forEach(code => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `${cats[code]} (${code})`;
      select.appendChild(opt);
    });
  }

  /** Opens the shared rule-builder form pre-filled from `ruleId`'s current
   * (or, for a just-added rule, still-default) conditions. `isNew` marks
   * the rule as a not-yet-saved draft — see _trPendingNewRuleId's own
   * comment for why Cancel needs to know this. */
  function _openTrafficRuleForm(ruleId, isNew) {
    const rule = TrafficRules.list().find(r => r.id === ruleId);
    if (!rule) return;
    _trEditingId = ruleId;
    _trPendingNewRuleId = isNew ? ruleId : null;

    _populateTrafficCategoryOptions();

    document.getElementById("tr-type-query").value = rule.conditions.typeQuery || "";
    document.getElementById("tr-category").value = rule.conditions.category || "any";
    const altEnabled = !!(rule.conditions.altitude && rule.conditions.altitude.enabled);
    document.getElementById("tr-alt-enabled").value = altEnabled ? rule.conditions.altitude.direction : "off";
    document.getElementById("tr-alt-ft").value = (rule.conditions.altitude && rule.conditions.altitude.ft) || 10000;
    document.getElementById("tr-traffic").value = rule.conditions.traffic || "any";

    const colorRow = document.getElementById("tr-color-row");
    if (rule.mode === "highlight") {
      colorRow.classList.remove("hidden");
      document.getElementById("tr-color").value = rule.color || TrafficRules.DEFAULT_HIGHLIGHT_COLOR;
    } else {
      colorRow.classList.add("hidden");
    }

    const form = document.getElementById("traffic-rule-form");
    form.classList.remove("hidden");
    form.scrollIntoView({ block: "nearest" });
  }

  function _closeTrafficRuleForm() {
    document.getElementById("traffic-rule-form")?.classList.add("hidden");
    _trEditingId = null;
    _trPendingNewRuleId = null;
  }

  function _saveTrafficRuleForm() {
    if (!_trEditingId) return;

    const altMode = document.getElementById("tr-alt-enabled").value;
    const altFtRaw = parseFloat(document.getElementById("tr-alt-ft").value);

    const conditions = {
      typeQuery: document.getElementById("tr-type-query").value.trim(),
      category: document.getElementById("tr-category").value,
      altitude: {
        enabled: altMode !== "off",
        direction: altMode === "below" ? "below" : "above",
        ft: isNaN(altFtRaw) ? 10000 : altFtRaw,
      },
      traffic: document.getElementById("tr-traffic").value,
    };
    const color = document.getElementById("tr-color").value;

    // Saving is what actually turns a brand-new rule "live" — see
    // TrafficRules.add()'s own comment on why it starts disabled.
    TrafficRules.update(_trEditingId, { enabled: true, conditions, color });
    _trPendingNewRuleId = null;
    _closeTrafficRuleForm();
    _renderTrafficRulesList();
  }

  /** A rule that was just created (never saved) is deleted outright rather
   * than left behind as an orphaned disabled rule — see
   * TrafficRules.add()'s own comment. Editing an EXISTING rule and hitting
   * Cancel just discards the in-form edits; the rule itself is untouched. */
  function _cancelTrafficRuleForm() {
    if (_trPendingNewRuleId) TrafficRules.remove(_trPendingNewRuleId);
    _closeTrafficRuleForm();
    _renderTrafficRulesList();
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
        UI.clearRouteLine(); // same bug pattern again — see renderRouteLine's own call site
        UI.clearRowsBackdrop(); // and again — see renderRowsBackdrop's own call site
        _hideManualTiltControls(); // and again — Hybrid-only, see that function's own comment
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

    // 11. Hybrid-only manual camera-tilt override (2026-09-09) — see
    // manualTilt.js / CLAUDE.md.
    const btnManualTiltToggle = document.getElementById("btn-manual-tilt-toggle");
    if (btnManualTiltToggle) {
      btnManualTiltToggle.addEventListener("click", (e) => {
        e.preventDefault();
        onManualTiltToggleClick();
      });
    }
    const btnManualTiltReset = document.getElementById("btn-manual-tilt-reset");
    if (btnManualTiltReset) {
      btnManualTiltReset.addEventListener("click", (e) => {
        e.preventDefault();
        onManualTiltResetClick();
      });
    }
    const manualTiltSlider = document.getElementById("manual-tilt-slider");
    if (manualTiltSlider) {
      manualTiltSlider.addEventListener("input", (e) => {
        onManualTiltSliderInput(parseFloat(e.target.value));
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

    // Kept in sync BY HAND with VCAS.css's --bg-dark for each theme
    // (Night #12181c / Day #d4dde2) — the OS status-bar tint has no way to
    // read a CSS custom property, so this duplication is unavoidable, not
    // an oversight. These values drifted from the real cockpit-rebrand
    // palette for a while (were #0a0e17/#f5f3ee, the pre-2026-08-22
    // pre-rebrand colours) until the 2026-08-24 "double load screen /
    // background inconsistency" fix caught it — see CLAUDE.md.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "day" ? "#d4dde2" : "#12181c";

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

  // ---- Hybrid-only manual camera-tilt override (2026-09-09) ---- //
  // See manualTilt.js's own doc comment for the full design/rationale.

  /** Positions/shows the toggle+reset+panel just below the real measured
   * top chrome (top bar + guidance card) — the SAME chromeTopInset
   * _rawChromeInsets() already computes for everything else up there (the
   * square plot, the range selector, LOG), not a second independently-
   * guessed offset. Called every refreshIndicators() tick, i.e. on every
   * GPS/compass fix and the 500ms extrapolation tick, same cadence every
   * other Hybrid/RAW-conditional floating control already re-positions on.
   * Hidden entirely outside Hybrid — RAW has no tilt concept of its own
   * (see cameraController.js's own comment on why the override is
   * RAW-excluded) and AIR is handled separately by _hideManualTiltControls
   * at the AIR-mode entry point, since refreshIndicators() never runs
   * there for it to re-hide these on. */
  function _positionManualTiltControls(insets) {
    const toggle = document.getElementById("btn-manual-tilt-toggle");
    const reset = document.getElementById("btn-manual-tilt-reset");
    const panel = document.getElementById("manual-tilt-panel");
    if (!toggle || !reset || !panel) return;

    if (mode !== "nav" || NavDisplayStyle.isRaw()) {
      toggle.classList.add("hidden");
      reset.classList.add("hidden");
      panel.classList.add("hidden");
      return;
    }

    const top = insets.chromeTopInset + 12;
    toggle.style.top = top + "px";
    toggle.classList.remove("hidden");
    panel.style.top = top + "px";

    // Reset sits bottom-left instead of top-left (2026-09-09 follow-up,
    // direct real-device report: "the camera reset looks like it covers or
    // replaces the log button so maybe move this down to the bottom left
    // like it is in raw mode"). LOG has no Hybrid-mode position of its own
    // — LogPanel.setPosition() is only ever called from the isRawView
    // branch above, so in Hybrid it's left sitting wherever it was last
    // set in RAW (or its CSS default, left:14px/top:100px, if RAW was
    // never entered this session) — right where Reset's old top-left spot
    // collided with it. Anchored from insets.bottomInset, the same real
    // bottom-chrome-height number _rawChromeInsets() already derives for
    // everything else down there, not a second independently-guessed
    // offset — the closest Hybrid equivalent to "bottom of the plot box"
    // RAW itself uses, since Hybrid has no plot box of its own.
    reset.style.top = "auto";
    reset.style.bottom = (insets.bottomInset + 12) + "px";

    _syncManualTiltUI();
  }

  /** Immediately hides every manual-tilt control, unconditionally — called
   * once at the AIR-mode entry point (same bug class/fix pattern this
   * codebase already applies there to UI.clearRangeRingsOverlay()/
   * clearAircraftList()/etc.: refreshIndicators() never runs again once in
   * AIR mode, so nothing else would ever re-hide a control left showing
   * from a Hybrid session before the switch). Does NOT touch ManualTilt's
   * own enabled/pitch state — only the DOM visibility — so returning to
   * Hybrid resumes exactly where it was left, per the "position should
   * persist" instruction. */
  function _hideManualTiltControls() {
    const toggle = document.getElementById("btn-manual-tilt-toggle");
    const reset = document.getElementById("btn-manual-tilt-reset");
    const panel = document.getElementById("manual-tilt-panel");
    if (toggle) toggle.classList.add("hidden");
    if (reset) reset.classList.add("hidden");
    if (panel) panel.classList.add("hidden");
  }

  /** Keeps the toggle's dimmed/active state and the panel's own visibility/
   * slider value in sync with ManualTilt's current state. Called after
   * every speed update (applySpeedOverrideIfActive, so the toggle reads
   * "temporarily unavailable" the instant speed crosses the 5mph gate —
   * same LogPanel/UI.setSpeedMph convergence-point pattern this codebase
   * already establishes for the identical reason) and after every direct
   * action on these controls themselves. A no-op if the controls are
   * currently hidden outright (RAW/AIR) — nothing to sync toward. */
  function _syncManualTiltUI() {
    const toggle = document.getElementById("btn-manual-tilt-toggle");
    if (!toggle || toggle.classList.contains("hidden")) return;
    const reset = document.getElementById("btn-manual-tilt-reset");
    const panel = document.getElementById("manual-tilt-panel");
    const slider = document.getElementById("manual-tilt-slider");
    const valueLabel = document.getElementById("manual-tilt-value");

    const disabledBySpeed = userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH;
    toggle.classList.toggle("manual-tilt-toggle-disabled", disabledBySpeed);
    toggle.classList.toggle("active", ManualTilt.isEnabled());

    const showPanel = ManualTilt.isEnabled();
    if (reset) reset.classList.toggle("hidden", !showPanel);
    if (panel) panel.classList.toggle("hidden", !showPanel);

    const pitch = ManualTilt.getPitchDeg();
    if (slider) slider.value = pitch;
    if (valueLabel) valueLabel.textContent = Math.round(pitch) + "°";
  }

  /** Re-evaluates the camera immediately rather than waiting for the next
   * GPS tick, so any manual-tilt action visibly takes effect right away —
   * the same pattern onNavDisplayStyleChanged() already establishes for
   * the identical reason. */
  function _reapplyCameraNow() {
    if (mode === "nav" && userLat !== null) {
      CameraController.followNav(userLat, userLon, userHeading, userSpeedMph, _rawChromeInsets());
    }
  }

  function onManualTiltToggleClick() {
    if (userSpeedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) return; // can't even enable while moving
    ManualTilt.setEnabled(!ManualTilt.isEnabled());
    _syncManualTiltUI();
    _reapplyCameraNow();
  }

  function onManualTiltSliderInput(value) {
    ManualTilt.setPitchDeg(value);
    const valueLabel = document.getElementById("manual-tilt-value");
    if (valueLabel) valueLabel.textContent = Math.round(ManualTilt.getPitchDeg()) + "°";
    _reapplyCameraNow();
  }

  function onManualTiltResetClick() {
    ManualTilt.reset();
    _syncManualTiltUI();
    _reapplyCameraNow();
  }

  function showConfigWarningIfNeeded() {
    if (!AdsbExchangeClient.isConfigured()) {
      UI.showConfigBanner(true);
      UI.setAdsbStatus("error", "adsb.fi");
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
    // Gates whether the LOG panel — and, same rationale, the detail
    // popup's own log-outcome/Suppress buttons (2026-08-24 follow-up,
    // ui.js's setSpeedMph) — are interactive right now (distraction/safety
    // measure). Called from here rather than each individual call site, so
    // both the real GPS path (onGpsSuccess) and the dev speed override
    // (onSpeedSimChanged) stay in sync with a single line, not two that
    // could drift.
    LogPanel.setSpeedMph(userSpeedMph);
    UI.setSpeedMph(userSpeedMph);
    // Hybrid's manual-tilt override (2026-09-09) — same convergence point,
    // same reasoning: force-disables the override the instant speed
    // crosses CONFIG.GPS_HEADING_MIN_SPEED_MPH (direct instruction: "if
    // the user... go[es] over the 5mph limit it will automatically revert
    // to the default position"), and keeps the toggle's dimmed state /
    // panel visibility in sync either way.
    ManualTilt.setSpeedMph(userSpeedMph);
    _syncManualTiltUI();
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
    // The METAR status pill itself was removed (2026-09-08) once the
    // Open-Meteo pill took over as the app's own weather-status indicator
    // — METAR data still feeds Visibility.estimate() exactly as before,
    // only its dedicated UI pill is gone, so this call is unchanged.
    MetarProvider.refresh(userLat, userLon);
    // Same "safe to call every tick, internally no-ops" contract —
    // LocalObstruction only actually re-queries once the user has moved
    // far enough (or the cached result is stale), and queryLocalDensity()
    // itself is synchronous (reads already-loaded map tile data, no
    // network call), so this is cheap even on ticks where nothing happens.
    LocalObstruction.refresh(EosMap, userLat, userLon);
    // Same "safe to call every tick" contract, and — uniquely among the
    // three environmental-scoring providers — genuinely no CORS relay
    // involved at all: Open-Meteo's own server sends
    // Access-Control-Allow-Origin: * (confirmed directly against their
    // real server source, see upperAirProvider.js's own comment), so this
    // fetch()es api.open-meteo.com directly from the browser.
    UpperAirProvider.refresh(userLat, userLon).then(() => UI.setUpperAirStatus(UpperAirProvider.getStatus()));

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
        UI.setAdsbStatus("error", "adsb.fi");
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
      UI.setAdsbStatus("active", "adsb.fi");
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

      // User-defined traffic rules (src/logic/trafficRules.js /
      // src/trafficRules.js) — a "filter" rule hides matching traffic, same
      // single filtering point both NAV and AIR read from as every other
      // exclusion above. Highlight-mode rules are NOT applied here — they
      // never remove an aircraft from this list, only mark it at render
      // time (see ui.js's renderIndicators / map.js's _airMarkerHtml).
      if (TrafficRulesLogic.evaluateFilter(a, TrafficRules.list())) return false;

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
   * computePlotLayout) needs — the SINGLE place these are computed,
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

    // RAW (2026-09-06) moves #route-card from its usual bottom-pinned spot
    // to directly under #nav-guidance-card at the top, so the two read as
    // one merged nav-status panel matching the ND reference's own layout
    // (see VCAS.css's RAW override for the actual repositioning) — the
    // insets below have to agree with wherever it actually is, or the
    // square plot/compass tape would either overlap it or leave a gap
    // where it used to be.
    const routeCard = document.getElementById("route-card");
    const routeCardAtTop = NavDisplayStyle.isRaw();

    // How much room the bottom chrome (ETA card and/or the bottom bar,
    // which can be stacked together when a route is active) actually
    // occupies right now.
    let bottomInset = 0;
    if (routeCard && !routeCard.classList.contains("hidden") && !routeCardAtTop) {
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

    // #route-card is position:fixed (normally bottom:0, see VCAS.css) — CSS
    // alone can't attach it directly under #nav-guidance-card, since the
    // guidance card's own real height depends on #top-bar's real height,
    // both of which vary by content/viewport. Positioned here, right where
    // both real heights are already measured for the insets calc below, so
    // there's one source for "where does RAW's merged nav-status panel
    // actually start" rather than a second guess living in CSS.
    if (routeCard) {
      if (routeCardAtTop) {
        routeCard.style.top = (topBar ? topBar.offsetHeight : 0) + (guidanceCard ? guidanceCard.offsetHeight : 0) + "px";
        routeCard.style.bottom = "auto";
      } else {
        routeCard.style.top = "";
        routeCard.style.bottom = "";
      }
    }
    if (routeCardAtTop && routeCard && !routeCard.classList.contains("hidden")) {
      chromeTopInset += routeCard.offsetHeight;
    }

    const squareContentTop = chromeTopInset + RAW_COMPASS_RESERVED_PX;
    return {
      viewportWidth: vw, viewportHeight: vh,
      chromeTopInset, bottomInset,
      squareContentTop,
      squareContentHeight: Math.max(0, vh - squareContentTop - bottomInset),
      // Passed straight through to CameraController.followNav ->
      // NavigationCameraEvaluator's own NAV_RAW branch, so its
      // Geo.computePlotLayout() call uses the EXACT same safeInset/
      // fovHalfAngleDeg refreshIndicators() does below — one shared
      // source, not two independently-typed literals that could drift.
      plotSafeInset: SQUARE_EDGE_MARGIN_PX,
      plotFovHalfAngleDeg: Indicators.FOV_HALF_ANGLE_DEG,
    };
  }

  function refreshIndicators() {
    if (userLat === null) return;
    const insets = _rawChromeInsets();
    const vw = insets.viewportWidth, vh = insets.viewportHeight;
    _positionManualTiltControls(insets);

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
      localObstruction: LocalObstruction.getCached(),
      upperAir: UpperAirProvider.getCached(),
      // Not read by Indicators.build() itself — carried through purely so
      // LogPanel.update()'s own copy of this object (see below) can hand it
      // to ObservationLogger.buildObservation(), which was missing "which
      // screen was this logged from" entirely until 2026-09-08.
      mode: _activeDisplayMode(),
    };

    const camConfig = CameraController.getLastEvaluated();
    if (camConfig) {
      userState.cameraPitch = camConfig.pitch;
      userState.anchorY = camConfig.anchorY;
    }
    // Computed once here (not inside _updateGuidanceCard itself any more)
    // so RAW's own screen-space flight-plan line (below, once `square` is
    // known) reads the EXACT same "what's the next maneuver" answer the
    // guidance card does — the same "one shared computation, not two that
    // could silently drift" discipline this file already applies to
    // anchorY/the rings-dots scale elsewhere.
    const routeManeuver = _computeRouteManeuver();
    _updateGuidanceCard(routeManeuver, camConfig && camConfig.maneuver);
    _updateRouteCard();
    _checkOffRoute();

    // RAW's plot is pinned to the top in portrait / left in landscape,
    // "as large an area as possible" along its PRIMARY axis (Geo.
    // computePlotLayout) — matching a real ND's fixed-aspect traffic
    // display, NOT a shape that stretches to use whatever asymmetric
    // headroom a full-viewport anchor happens to leave (the pre-2026-08-21
    // approach, which left near-zero side margin on a plain portrait phone
    // — the common case — for the Stage 3 list panel to ever actually show
    // in). Its SECONDARY axis is no longer forced to match the primary one
    // 1:1 (round 6 follow-up, 2026-09-08) — see computePlotLayout's own
    // doc comment for why a literal square left real, reported dead space
    // between the plot's own box and where the rings/dots actually render.
    // Hybrid's edge indicators aren't a "round display" at all and keep
    // the full teardrop Relevance computes against the plain full
    // viewport, so none of this applies there.
    const isRawView = NavDisplayStyle.isRaw();
    let square = null;
    let activeBandsNm = Indicators.RING_BANDS_NM;
    let selectedRangeNm = Indicators.RING_BANDS_NM[Indicators.RING_BANDS_NM.length - 1];
    if (isRawView) {
      square = Geo.computePlotLayout(vw, insets.squareContentTop, insets.squareContentHeight, {
        desiredAnchorY: NavigationCameraEvaluator.STATE_PRESETS.NAV_RAW.anchorY,
        safeInset: SQUARE_EDGE_MARGIN_PX,
        fovHalfAngleDeg: Indicators.FOV_HALF_ANGLE_DEG,
      });
      userState.fovHalfAngleDeg = Indicators.FOV_HALF_ANGLE_DEG;
      // The within-plot anchor fraction — NOT userState.anchorY's usual
      // full-viewport meaning. Read directly from square.anchorY (computed
      // by Geo.computePlotLayout, the single shared source) rather than
      // NavigationCameraEvaluator's own STATE_PRESETS.NAV_RAW.anchorY
      // constant directly — that constant is now only a SEED/fallback
      // computePlotLayout takes as an input, not the fraction actually in
      // effect once the plot's own box has been tightened to fit its real
      // content. Reading the derived value here is what keeps the real
      // camera anchor (NavigationCameraEvaluator's own NAV_RAW branch,
      // which calls the exact same function) and these screen-space dots/
      // rings unable to drift apart, not just unlikely to.
      userState.anchorY = square.anchorY;
      userState.plotWidth = square.plotWidth;
      userState.plotHeight = square.plotHeight;
      userState.plotOffsetX = square.plotLeft;
      userState.plotOffsetY = square.plotTop;
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
      UI.renderRangeRingsOverlay(square.plotLeft, square.plotTop, square.plotWidth, square.plotHeight, userState.anchorY, SQUARE_EDGE_MARGIN_PX, activeBandsNm, Indicators.FOV_HALF_ANGLE_DEG, "#f0f0f0");
      // ND-style range selector + LOG button, both moved to the BOTTOM of
      // the plot box (round 8, 2026-09-08, direct instruction with an
      // annotated screenshot) — X stays at the plot's own left/right edges
      // (still correct in both portrait and landscape, where the plot's
      // own position already differs), just the row itself moved from the
      // top (where it shared a row with the SPD readout) to the bottom, to
      // stay clear of the SPD readout now occupying that whole top-left
      // corner on its own (see the leftX comment below). 40px up from the
      // plot's own bottom edge — comfortably inside the box, above where
      // the aircraft-list panel begins at plotTop+plotHeight.
      const bottomRowY = square.plotTop + square.plotHeight - 40;
      UI.renderRangeSelector(square.plotLeft + square.plotWidth - 8, bottomRowY, selectedRangeNm, onRawRangeCycleClick);
      LogPanel.setPosition(square.plotLeft + 8, bottomRowY);

      // Screen-space flight-plan line (2026-09-06) — NOT the real geo-
      // referenced MapLibre route line (map.js hides that one while RAW is
      // active; see EosMap's own _applyRouteVisibility doc comment for
      // why). Shares the exact square/anchor/bands/FOV params the dots and
      // rings above use, so it can't disagree with them the way the old
      // real-geo rings once did.
      const routeCoords = activeRoute && activeRoute.geometry && activeRoute.geometry.coordinates;
      if (activeRoute && userLat !== null && userLon !== null && Array.isArray(routeCoords) && routeCoords.length >= 2) {
        const { segIdx } = RouteGeometry.nearestOnLine(routeCoords, userLon, userLat);
        const aheadCoords = routeCoords.slice(segIdx);
        const turnIndex = (routeManeuver.exists && routeManeuver.targetCoordIndex != null)
          ? Math.max(0, routeManeuver.targetCoordIndex - segIdx)
          : null;
        UI.renderRouteLine(
          aheadCoords, userLat, userLon, userHeading,
          square.plotLeft, square.plotTop, square.plotWidth, square.plotHeight,
          userState.anchorY, SQUARE_EDGE_MARGIN_PX, activeBandsNm, Indicators.FOV_HALF_ANGLE_DEG,
          turnIndex, routeManeuver.name || null
        );
      } else {
        UI.clearRouteLine();
      }
    } else {
      UI.clearRangeRingsOverlay();
      UI.clearRangeSelector();
      UI.clearRouteLine();
    }

    // ND-style heading tape — Raw only, matching the reference image; Hybrid's
    // rotating road map already carries its own orientation cues. Curved
    // (round 8 follow-up, 2026-09-08) around the exact same anchor the
    // range rings/route line use, radius derived from insets.chromeTopInset
    // so the dead-ahead tick still starts right below the real chrome —
    // see renderCompassRing's own doc comment for the full reasoning.
    if (isRawView) {
      // Compact speed strip below the heading tape — RAW's equivalent of a
      // real ND's flight-data strip (GS/TAS/ILS APP/arrival time). Only
      // shown passively (no active route): once a route exists, the exact
      // same speed figure moves into the merged top nav-status card's own
      // second row (#route-eta-speed, see _updateRouteCard()) alongside
      // distance — showing it in both places at once would be a real
      // duplicate readout, not two different pieces of information.
      // leftX — round 6 (2026-09-08) moved SPD left of centre, sharing the
      // row with LOG/range; round 8 (same day, direct instruction with an
      // annotated screenshot) moved LOG/range to the bottom of the plot box
      // instead, freeing the whole top-left corner for SPD alone — so this
      // now uses LOG's OLD left margin (square.plotLeft + 8, matching
      // LogPanel.setPosition's own former x) rather than sitting just to
      // its right.
      // Curved along the exact same anchor renderRangeRingsOverlay/
      // renderRouteLine use (round 8 follow-up, 2026-09-08) — tapeRadius
      // is derived, not a second independently-chosen number, so the
      // dead-ahead tick lands at the same y the old flat tape's tickTopY
      // (insets.chromeTopInset) did, while the curve itself agrees with
      // the rings' own dome by construction (same cx/cy, same
      // fovHalfAngleDeg), not by two formulas that happen to currently
      // match — see renderCompassRing's own doc comment.
      // Round 10 (2026-09-08) follow-up, from a real device screenshot:
      // ticks radiate OUTWARD from tapeRadius (see renderCompassRing's own
      // comment), and at dead-ahead "outward" means UP — a major tick's
      // outer tip reaches tapeRadius+COMPASS_MAJOR_TICK_H, i.e.
      // COMPASS_MAJOR_TICK_H px above insets.chromeTopInset. Without this
      // clearance, the dead-ahead-most tick pokes that far into the real
      // #top-bar sitting right above it (same z-index, later in DOM order,
      // so it wins and hides whatever's underneath) — reproducing exactly
      // the truncated/cut-off tick marks reported. TICK_CLEARANCE_PX adds
      // a few px of "not literally touching" room on top of the bare
      // minimum, same "almost flush, not literally flush" spirit
      // RAW_COMPASS_RESERVED_PX's own comment already establishes.
      const TICK_CLEARANCE_PX = UI.COMPASS_MAJOR_TICK_H + 4;
      const tapeCx = square.plotLeft + square.plotWidth * 0.5;
      const tapeCy = square.plotTop + square.plotHeight * square.anchorY;
      const tapeRadius = Math.max(0, tapeCy - insets.chromeTopInset - TICK_CLEARANCE_PX);
      UI.renderCompassRing(tapeCx, tapeCy, tapeRadius, userHeading, Indicators.FOV_HALF_ANGLE_DEG, activeRoute ? null : { speedMph: userSpeedMph, leftX: square.plotLeft + 8 });
    } else {
      UI.clearCompassRing();
    }

    // Stage 3: aircraft-list panel — Raw only, filling the exact
    // rectangle complementary to the plot (Geo.computePlotLayout's
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
      // allRelevant already arrives sorted by Indicators.build()'s own
      // priority order (visibility score desc, then proximity) — the same
      // order that governs plot icon selection/pagination, so the list is
      // rendered straight from it with no re-sort. Resorting was removed
      // 2026-09-06 (direct instruction): Android-Auto-bound, so less
      // interaction is the right default — always most-visible-first.
      const beyondRangeHexes = new Set(beyondRange.map(it => it.aircraft.hex));
      // Same square.rows rect the list panel itself uses — see
      // UI.renderRowsBackdrop's own doc comment for why this has to be
      // the identical source, not a second measurement.
      UI.renderRowsBackdrop(square.rows);
      UI.renderAircraftList(allRelevant, square.rows, onIndicatorClick, beyondRangeHexes);
    } else {
      UI.clearRowsBackdrop();
      UI.clearAircraftList();
    }
  }

  function onRawRangeCycleClick() {
    selectedRangeIndex = (selectedRangeIndex + 1) % Indicators.RING_BANDS_NM.length;
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
      localObstruction: LocalObstruction.getCached(),
      upperAir: UpperAirProvider.getCached(),
      mode: _activeDisplayMode(),
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
    const userState = {
      lat: userLat, lon: userLon, heading: userHeading, speedMph: userSpeedMph,
      mode: _activeDisplayMode(),
    };
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
    const myToken = ++_routeRequestToken;

    const btn = document.getElementById("btn-test-route");
    if (btn) { btn.disabled = true; }

    const route = await OrsProvider.getRoute(
      { lat: userLat, lon: userLon },
      { lat, lon },
      routeMode
    );

    if (btn) { btn.disabled = false; }

    if (myToken !== _routeRequestToken) return; // superseded by a newer request

    if (!route) {
      console.warn("Route request failed — check network or ORS availability/API key.");
      return;
    }

    activeRoute   = route;
    routeDestLat  = lat;
    routeDestLon  = lon;
    _offRouteSinceMs = null; // fresh route from here — definitionally on it
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
    routeDestLat  = null;
    routeDestLon  = null;
    _offRouteSinceMs = null;
    _rerouteInFlight = false;
    if (destPickActive) toggleDestPickMode();
    EosMap.clearRoute();
    CameraController.clearRoute();
    UI.clearRouteLine(); // immediate, same as EosMap.clearRoute() above — don't wait for the next tick
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
    _updateRouteCard();
    document.getElementById("route-card").classList.remove("hidden");
    _showGuidanceCard();
  }

  /**
   * Recomputes and writes the route card's distance/ETA/arrival-clock from
   * the user's CURRENT position along the route, rather than the one-time
   * trip-start totals `_showRouteCard()` used to write and never touch
   * again. Called on the same cadence `_updateGuidanceCard()` already is
   * (every GPS fix + the 500ms extrapolation tick, via refreshIndicators())
   * — see that call site — not a new timer.
   */
  function _updateRouteCard() {
    if (!activeRoute) return;

    // Falls back to the route's own full trip totals (what used to be
    // shown permanently) when there's no GPS fix yet or the route has no
    // usable geometry, rather than showing nothing.
    let remainingDistanceMeters = activeRoute.distanceMeters;
    let remainingDurationSeconds = activeRoute.durationSeconds;

    const coords = activeRoute.geometry && activeRoute.geometry.coordinates;
    if (userLat !== null && userLon !== null && Array.isArray(coords) && coords.length >= 2) {
      // Same snapping primitives ManeuverTracker.nextManeuver() already
      // uses for the guidance card's own live countdown — not a separately
      // invented calculation — just targeting the route's FINAL coordinate
      // index instead of the current step's end.
      const { segIdx, t } = RouteGeometry.nearestOnLine(coords, userLon, userLat);
      remainingDistanceMeters = RouteGeometry.distanceToIndex(coords, segIdx, t, coords.length - 1);
      // Duration scales proportionally against the route's own ORS-declared
      // total duration/distance, rather than summing activeRoute.steps'
      // individual durations — simpler, and works even when steps is empty
      // (a real possibility per orsProvider.js's own fallback), and ORS's
      // declared pace for the whole route already reflects its real mix of
      // road-type speeds better than the user's live/instantaneous GPS
      // speed would (too noisy across traffic lights/turns for a stable
      // countdown).
      remainingDurationSeconds = activeRoute.distanceMeters > 0
        ? activeRoute.durationSeconds * (remainingDistanceMeters / activeRoute.distanceMeters)
        : 0;
    }

    document.getElementById("route-dist-text").textContent = _fmtDistance(remainingDistanceMeters);
    document.getElementById("route-eta-text").textContent  = _fmtDuration(remainingDurationSeconds);
    const arrivalClock = _fmtClock(Date.now() + remainingDurationSeconds * 1000);
    const arrivalEl = document.getElementById("route-eta-arrival");
    if (arrivalEl) arrivalEl.textContent = arrivalClock;

    // RAW-only elements (2026-09-08) — always written alongside the
    // Hybrid ones above regardless of which style is active; VCAS.css
    // decides which set is actually visible (see #route-card's own
    // comment in index.html). #ngc-eta-text lives inside #nav-guidance-
    // card, not #route-card, but is populated here too since it's the
    // exact same arrival-clock value, not a second calculation.
    const ngcEtaEl = document.getElementById("ngc-eta-text");
    if (ngcEtaEl) ngcEtaEl.textContent = arrivalClock;
    const rawDistEl = document.getElementById("route-dist-text-raw");
    if (rawDistEl) rawDistEl.textContent = _fmtDistance(remainingDistanceMeters);
    const rawSpeedEl = document.getElementById("route-eta-speed");
    if (rawSpeedEl) rawSpeedEl.textContent = "SPD " + Math.round(userSpeedMph) + " MPH";
  }

  /**
   * Off-route detection — measures the user's real perpendicular distance
   * to the active route polyline (not the "snapped" distance-along-route
   * figures _updateRouteCard()/ManeuverTracker use, which always find a
   * nearest point regardless of how far away it actually is). Beyond
   * CONFIG.OFF_ROUTE_THRESHOLD_METERS continuously for
   * CONFIG.OFF_ROUTE_REROUTE_DELAY_SECONDS triggers a reroute — the dwell
   * requirement is deliberate hysteresis so momentary GPS noise or briefly
   * crossing a nearby parallel road doesn't fire one. Called from the same
   * refreshIndicators() cadence _updateRouteCard()/_updateGuidanceCard()
   * already run on (every GPS fix + the 500ms tick), not a separate timer.
   */
  function _checkOffRoute() {
    if (!activeRoute || userLat === null || userLon === null) { _offRouteSinceMs = null; return; }
    const coords = activeRoute.geometry && activeRoute.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;

    const { point } = RouteGeometry.nearestOnLine(coords, userLon, userLat);
    const distanceMeters = Geo.calculateDistanceMeters(userLat, userLon, point[1], point[0]);

    if (distanceMeters <= CONFIG.OFF_ROUTE_THRESHOLD_METERS) {
      _offRouteSinceMs = null;
      return;
    }

    if (_offRouteSinceMs === null) {
      _offRouteSinceMs = Date.now();
      return;
    }

    const offRouteMs = Date.now() - _offRouteSinceMs;
    if (offRouteMs >= CONFIG.OFF_ROUTE_REROUTE_DELAY_SECONDS * 1000 && !_rerouteInFlight) {
      _rerouteFromCurrentPosition();
    }
  }

  /**
   * Re-requests a route FROM the user's current position TO the same
   * destination they originally picked (routeDestLat/Lon — untouched by
   * this, only activeRoute's own geometry/steps change) and swaps it in,
   * without making the user re-pick anything. Guarded by _rerouteInFlight
   * against firing a second request while one's already out, and by
   * _routeRequestToken (same pattern as _destSearchToken above) against a
   * stale response clobbering a route the user has since cleared or
   * replaced while this was in flight.
   */
  async function _rerouteFromCurrentPosition() {
    if (_rerouteInFlight || !activeRoute || routeDestLat === null || userLat === null) return;
    _rerouteInFlight = true;
    const myToken = ++_routeRequestToken;

    const route = await OrsProvider.getRoute(
      { lat: userLat, lon: userLon },
      { lat: routeDestLat, lon: routeDestLon },
      routeMode
    );

    _rerouteInFlight = false;
    if (myToken !== _routeRequestToken) return; // superseded by a newer request

    if (!route) {
      // Retry after the same dwell delay rather than hammering ORS every
      // tick while genuinely off-route and failing (network hiccup, ORS
      // error) — _checkOffRoute() only fires again once _offRouteSinceMs
      // is this old.
      _offRouteSinceMs = Date.now();
      console.warn("Reroute request failed — will retry.");
      return;
    }

    activeRoute = route;
    _offRouteSinceMs = null; // freshly rerouted — definitionally on it now

    EosMap.showRoute(route.geometry);
    CameraController.setRouteActive(route.geometry);
    _updateRouteCard();
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

  /** RAW's abbreviated ND-instrument readout (round 8, 2026-09-08) reads
   * "IN {dist} TURN {direction}" rather than Hybrid's full prose
   * instruction — a real ND has no room for street names, just a
   * compact digital-style direction word. Same maneuver `type` codes as
   * MANEUVER_ICONS above. */
  const MANEUVER_DIRECTION_WORD = {
    0: "LEFT", 1: "RIGHT", 2: "LEFT", 3: "RIGHT", 4: "LEFT", 5: "RIGHT",
    6: "STRAIGHT", 7: "ROUNDABOUT", 8: "ROUNDABOUT", 9: "U-TURN",
    11: "DEPART", 12: "LEFT", 13: "RIGHT",
  };
  const DEFAULT_DIRECTION_WORD = "AHEAD";

  /**
   * The ManeuverTracker call itself, hoisted out of _updateGuidanceCard so
   * refreshIndicators() can compute it exactly once per tick and hand the
   * SAME result to both the guidance card and (RAW only) the screen-space
   * flight-plan line's turn label — see that call site's own comment.
   */
  function _computeRouteManeuver() {
    if (!activeRoute) return { exists: false };
    const hasSteps = Array.isArray(activeRoute.steps) && activeRoute.steps.length > 0;
    return (hasSteps && userLat !== null && userLon !== null)
      ? ManeuverTracker.nextManeuver(activeRoute.geometry.coordinates, activeRoute.steps, userLon, userLat)
      : { exists: false };
  }

  /**
   * Live turn instruction. Primary source is ManeuverTracker against ORS's
   * own turn-by-turn steps (real street names, real maneuver types,
   * roundabout/arrival detection) — falls back to NavigationCameraEvaluator's
   * geometric bearing-delta detector (via CameraController.getLastEvaluated())
   * only when a route has no usable steps (an older/unexpected ORS response
   * shape), so the card still shows *something* rather than going blank.
   * Called on every refresh, not just when the route first activates, so
   * the distance countdown and instruction actually update as you drive.
   *
   * @param {object} routeManeuver  Already-computed via _computeRouteManeuver()
   *   (see refreshIndicators()'s call site) rather than derived again here.
   */
  function _updateGuidanceCard(routeManeuver, fallbackManeuver) {
    if (!activeRoute) return;
    const actionEl = document.getElementById("ngc-action-text");
    const iconEl   = document.getElementById("ngc-maneuver-icon");
    if (!actionEl || !iconEl) return;

    // Surfaces the background reroute rather than leaving the old (now
    // wrong) instruction on screen for however long the request takes —
    // overwritten the moment _rerouteFromCurrentPosition() resolves and
    // the next tick's ManeuverTracker call runs against the new route.
    if (_rerouteInFlight) {
      actionEl.textContent = "Rerouting…";
      iconEl.textContent = "↻";
      iconEl.style.transform = "rotate(0deg)";
      return;
    }

    const isRaw = NavDisplayStyle.isRaw();

    if (routeManeuver.exists) {
      const icon = MANEUVER_ICONS[routeManeuver.type] || DEFAULT_MANEUVER_ICON;
      const instruction = routeManeuver.instruction || (routeManeuver.isArrival ? "Arrive at destination" : "Continue");
      if (isRaw) {
        // Abbreviated ND-instrument readout, matching the design draft:
        // "IN {dist} TURN {direction}" (or bare "TURN ARRIVE" at the
        // final step) — no street names, an ND has no room for prose.
        // Reuses the same .ngc-dist-value/.ngc-direction-value colour
        // classes the geometric fallback branch below already uses.
        const directionWord = routeManeuver.isArrival
          ? "ARRIVE"
          : (MANEUVER_DIRECTION_WORD[routeManeuver.type] || DEFAULT_DIRECTION_WORD);
        actionEl.innerHTML = routeManeuver.isArrival
          ? `TURN <span class="ngc-direction-value">${directionWord}</span>`
          : `IN <span class="ngc-dist-value">${_fmtDistance(routeManeuver.distanceMeters).toUpperCase()}</span> TURN <span class="ngc-direction-value">${directionWord}</span>`;
      } else {
        // innerHTML (not textContent) so the distance figure can be
        // wrapped in its own colour-coded span — instruction is real ORS
        // response text, so it's escaped before landing in innerHTML the
        // same as any other interpolated string this codebase injects
        // this way (see ui.js's own _escapeHtml precedent).
        actionEl.innerHTML = routeManeuver.isArrival
          ? _escapeHtml(instruction)
          : `${_escapeHtml(instruction)} — <span class="ngc-dist-value">${_fmtDistance(routeManeuver.distanceMeters)}</span>`;
      }
      iconEl.textContent = icon.glyph;
      iconEl.style.transform = `rotate(${icon.rotation}deg)`;
      return;
    }

    if (fallbackManeuver && fallbackManeuver.exists) {
      const direction = fallbackManeuver.bearingDeltaDeg > 0 ? "right" : "left";
      actionEl.innerHTML = isRaw
        ? `IN <span class="ngc-dist-value">${_fmtDistance(fallbackManeuver.distanceMeters).toUpperCase()}</span> TURN <span class="ngc-direction-value">${direction.toUpperCase()}</span>`
        : `Turn <span class="ngc-direction-value">${direction}</span> in <span class="ngc-dist-value">${_fmtDistance(fallbackManeuver.distanceMeters)}</span>`;
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

  /** Same shape as ui.js's own _escapeHtml — needed here now that
   * _updateGuidanceCard() injects ORS response text via innerHTML (for the
   * colour-coded distance span) rather than plain textContent. */
  function _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function _fmtDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toFixed(1) + " km" : Math.round(meters) + " m";
  }

  function _fmtDuration(seconds) {
    const m = Math.round(seconds / 60);
    return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " m" : m + " min";
  }

  /** HH:MM wall-clock formatting for an arrival estimate — shared by
   * _updateRouteCard()'s Hybrid ("route-eta-arrival") and RAW
   * ("ngc-eta-text") readouts, which show the identical arrival time. */
  function _fmtClock(ms) {
    const d = new Date(ms);
    return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
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