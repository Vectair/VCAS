/**
 * LogPanel — ground-truth observation tool, on the primary screen.
 *
 * Lists every currently-tracked aircraft (not just the ones NAV is
 * currently showing — see Indicators.buildAll()) with a row of outcome
 * buttons (see ObservationLogger.OUTCOMES — the single source for the
 * button set, not duplicated here), so "the algorithm excluded this and
 * that was right/wrong" is loggable too, not just "the algorithm showed
 * this and it was right."
 *
 * "Export buffered observations" used to live in this panel's own menu but
 * moved to the settings screen — everything else here stays on the primary
 * screen, since logging a sighting is something you do in the moment while
 * actively spotting traffic, not a background/administrative action.
 */
const LogPanel = (() => {
  // Deliberately no row cap — a distant, contrail-visible aircraft is
  // exactly the kind of edge case this tool exists to capture, and capping
  // by nearest-N previously hid it (that was a real bug, not a feature).
  // The panel scrolls (see #lp-rows CSS) instead.

  let _menuOpen    = false;
  let _tracked     = [];   // last Indicators.buildAll() result
  let _userState   = null; // last userState passed to update()
  let _speedMph    = 0;    // last known effective speed — see setSpeedMph()

  function init() {
    _buildPanel();
  }

  /**
   * Gates whether the LOG button is interactive at all (2026-08-24, direct
   * instruction — a distraction/safety measure: logging an observation
   * means reading a list and tapping a specific outcome button, real
   * screen attention this app shouldn't invite while actually driving).
   * Reuses CONFIG.GPS_HEADING_MIN_SPEED_MPH (5) rather than a second,
   * separately-tuned threshold — same "stationary or walking" cutoff this
   * app already uses elsewhere, not a new number to keep in sync.
   * Called from app.js's applySpeedOverrideIfActive() on every GPS/speed
   * update, real or dev-simulated.
   */
  function setSpeedMph(mph) {
    _speedMph = mph;
    const toggle = document.getElementById("lp-toggle");
    const interactive = _speedMph <= CONFIG.GPS_HEADING_MIN_SPEED_MPH;
    if (toggle) toggle.classList.toggle("lp-toggle-disabled", !interactive);
    // Force-closes an already-open panel the moment speed crosses the
    // threshold, rather than leaving it open until the user manually taps
    // it shut — that manual close is exactly the distracting interaction
    // this exists to prevent, so it can't be the only way out once moving.
    if (!interactive && _menuOpen) _close();
  }

  function _buildPanel() {
    // Fixed-position, not a top-bar flex child (2026-08-24 follow-up) — the
    // first attempt put it in #top-bar-right, which fixed the original
    // overlap-with-the-aircraft-list bug but landed LOG on its own row,
    // separate from the RAW range/SPD readouts. Direct follow-up request:
    // put it on the SAME row as those. app.js's setPosition() call (in
    // refreshIndicators(), right where it positions the range selector)
    // keeps it left-aligned on that exact row, mirroring the range button's
    // right alignment — [LOG] ... SPD ... [range]. Default left/top below
    // are just a reasonable placeholder for the moment before the first
    // real position update lands (first GPS fix / dev speed change).
    const toggle = document.createElement("button");
    toggle.id = "lp-toggle";
    toggle.textContent = "LOG";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      if (_speedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) return; // see setSpeedMph()
      _menuOpen ? _close() : _open();
    });

    const menu = document.createElement("div");
    menu.id = "lp-menu";
    menu.className = "hidden";

    // Real bug fix (2026-09-14): appending straight to document.body put
    // both elements OUTSIDE #viewport-dev-frame — but #viewport-dev-shell
    // (the frame's own parent) is `position:fixed`, which unconditionally
    // establishes its own stacking context per spec, REGARDLESS of z-index
    // value. That traps every overlay screen that lives inside the frame
    // (#settings-screen z-index:200, #onboarding-screen 250, #view3d-screen
    // 220, #popup) into a LOCAL stacking order that's invisible from the
    // root context — what actually competes against a body-level sibling
    // like this toggle is the SHELL's own effective level (z-index:auto,
    // i.e. auto/0), not any of those internal numbers. Since #lp-toggle's
    // z-index:11 (and #lp-menu's 9999) is a real, explicit value greater
    // than that, it always painted on top of the ENTIRE app — including
    // fully opaque full-screen modals like Settings — no matter how high
    // their own internal z-index was set. Reported directly: the LOG
    // button visibly floating over a Settings-screen button. Confirmed
    // with a real Playwright stacking-context repro before fixing (moving
    // a body-appended fixed element inside the frame correctly resolved
    // it) rather than assumed from the spec alone. Fix: append into
    // #viewport-dev-frame instead — the SAME parent every other overlay
    // screen already lives in, so LOG's z-index is compared fairly
    // against theirs (correctly loses to Settings/Onboarding/3D View,
    // correctly still wins over the plot's own indicators/compass-tape
    // layers, z-index 7-10). Deliberately NOT #viewport-dev-panel's own
    // parent (document.body) — that panel is the meta-control for the
    // viewport-emulation frame itself and has to stay outside what it's
    // simulating/scaling, a genuinely different case from LOG's.
    const host = document.getElementById("viewport-dev-frame") || document.body;
    host.appendChild(toggle);
    host.appendChild(menu);

    document.addEventListener("click", () => { if (_menuOpen) _close(); });
  }

  /**
   * Called from app.js's refreshIndicators(), alongside the range selector
   * and compass tape — keeps LOG genuinely on the same row as both rather
   * than a fixed CSS offset that could drift from their own dynamically-
   * computed position (e.g. when the guidance card changes the real top-bar
   * height). menuTop keeps the expanded menu opening just below the button
   * at its current position, not a stale fixed offset from an old spot.
   */
  function setPosition(x, y) {
    const toggle = document.getElementById("lp-toggle");
    if (toggle) { toggle.style.left = x + "px"; toggle.style.top = y + "px"; }
    const menu = document.getElementById("lp-menu");
    if (menu) { menu.style.left = x + "px"; menu.style.top = (y + 36) + "px"; }
  }

  function _open()  { _menuOpen = true;  document.getElementById("lp-menu").classList.remove("hidden"); _render(); }
  function _close() { _menuOpen = false; document.getElementById("lp-menu")?.classList.add("hidden"); }

  /** Lets callers (app.js's refreshIndicators) skip computing the full
   * Indicators.buildAll() pass — a relevance/visibility scan over every
   * tracked aircraft, not just the ones NAV shows — when this panel isn't
   * even open to display it. update() below already no-ops its own render
   * in that case; this lets the caller avoid the far more expensive
   * upstream computation too. */
  function isOpen() { return _menuOpen; }

  /**
   * @param {Array} trackedList  Result of Indicators.buildAll(aircraftList, userState, staleThresholdSeconds).
   * @param {object} userState   { lat, lon, heading, speedMph, mode }
   */
  function update(trackedList, userState) {
    _tracked   = trackedList || [];
    _userState = userState || null;
    if (_menuOpen) _render();
  }

  function _render() {
    const menu = document.getElementById("lp-menu");
    if (!menu) return;

    menu.innerHTML = `
      <div class="lp-header">
        ${_tracked.length === 0 ? "No tracked aircraft" : `${_tracked.length} tracked`}
      </div>
      <div class="lp-rows"></div>
    `;

    const rowsEl = menu.querySelector(".lp-rows");
    _tracked.forEach(item => rowsEl.appendChild(_buildRow(item)));
  }

  function _buildRow(item) {
    const a = item.aircraft;
    const row = document.createElement("div");
    row.className = "lp-row";

    const info = document.createElement("div");
    info.className = "lp-row-info";
    info.innerHTML = `
      <div class="lp-callsign">${a.callsign || a.hex}<span class="lp-type">${a.type || ""}</span></div>
      <div class="lp-meta">${item.vis.label} · ${item.relevance.reason || "not relevant"} · ${item.distanceNm.toFixed(1)}nm · el ${item.vis.elevationDeg.toFixed(0)}°</div>
    `;

    const actions = document.createElement("div");
    actions.className = "lp-actions";
    ObservationLogger.OUTCOMES.forEach(outcome => {
      const btn = document.createElement("button");
      btn.className = "lp-btn";
      btn.title = outcome.title;
      btn.textContent = outcome.label;
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _logObservation(item, outcome.code);
        row.classList.add("lp-row-logged");
        setTimeout(() => row.classList.remove("lp-row-logged"), 600);
      });
      actions.appendChild(btn);
    });

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  }

  async function _logObservation(item, outcomeCode) {
    if (!_userState) return;
    const observation = ObservationLogger.buildObservation(item, _userState, outcomeCode);
    await ObservationLogger.record(observation);
    if (_menuOpen) _render(); // refresh fallback-count badge if it just changed
  }

  return { init, update, isOpen, setSpeedMph, setPosition };
})();
