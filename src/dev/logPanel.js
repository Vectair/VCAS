/**
 * LogPanel — dev-only ground-truth observation tool.
 *
 * Lists every currently-tracked aircraft (not just the ones NAV is
 * currently showing — see Indicators.buildAll()) with four outcome
 * buttons, so "the algorithm excluded this and that was right/wrong" is
 * loggable too, not just "the algorithm showed this and it was right."
 *
 * Purely a dev tool — always present, opt-in to open, same convention as
 * ViewportDevPanel (VIEW button). Not shown to end users of the app in
 * any special way, just never linked from production UI flows.
 */
const LogPanel = (() => {
  const MAX_ROWS_SHOWN = 20; // nearest N — a 50nm radius can return far more than is useful to hand-triage

  const OUTCOMES = [
    { code: "visible_airframe",       label: "✈",  title: "Visible — airframe" },
    { code: "visible_contrail",       label: "〜", title: "Visible — contrail only" },
    { code: "not_visible_obstruction", label: "▨", title: "Not visible — obstruction" },
    { code: "not_visible_missed",     label: "✕",  title: "Not visible — just not seen" },
  ];

  let _menuOpen    = false;
  let _tracked     = [];   // last Indicators.buildAll() result
  let _userState   = null; // last userState passed to update()

  function init() {
    _buildPanel();
  }

  function _buildPanel() {
    const panel = document.createElement("div");
    panel.id = "log-panel";

    const toggle = document.createElement("button");
    toggle.id = "lp-toggle";
    toggle.textContent = "LOG";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      _menuOpen ? _close() : _open();
    });

    const menu = document.createElement("div");
    menu.id = "lp-menu";
    menu.className = "hidden";

    panel.appendChild(toggle);
    panel.appendChild(menu);
    document.body.appendChild(panel);

    document.addEventListener("click", () => { if (_menuOpen) _close(); });
  }

  function _open()  { _menuOpen = true;  document.getElementById("lp-menu").classList.remove("hidden"); _render(); }
  function _close() { _menuOpen = false; document.getElementById("lp-menu")?.classList.add("hidden"); }

  /**
   * @param {Array} trackedList  Result of Indicators.buildAll(aircraftList, userState, staleThresholdSeconds).
   * @param {object} userState   { lat, lon, heading, speedMph }
   */
  function update(trackedList, userState) {
    _tracked   = trackedList || [];
    _userState = userState || null;
    if (_menuOpen) _render();
  }

  function _render() {
    const menu = document.getElementById("lp-menu");
    if (!menu) return;

    const fallbackCount = ObservationLogger.fallbackCount();
    const shown = _tracked.slice(0, MAX_ROWS_SHOWN);

    menu.innerHTML = `
      <div class="lp-header">
        ${_tracked.length === 0 ? "No tracked aircraft" : `${shown.length} of ${_tracked.length} tracked`}
        ${fallbackCount > 0 ? `<button class="lp-export-btn">Export ${fallbackCount} buffered</button>` : ""}
      </div>
      <div class="lp-rows"></div>
    `;

    const exportBtn = menu.querySelector(".lp-export-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", e => {
        e.stopPropagation();
        ObservationLogger.exportFallback();
        _render();
      });
    }

    const rowsEl = menu.querySelector(".lp-rows");
    shown.forEach(item => rowsEl.appendChild(_buildRow(item)));
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
    OUTCOMES.forEach(outcome => {
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
    const a = item.aircraft;

    const observation = {
      timestamp: new Date().toISOString(),
      user: {
        lat: _userState.lat, lon: _userState.lon,
        heading: _userState.heading, speedMph: _userState.speedMph,
      },
      aircraft: {
        hex: a.hex, callsign: a.callsign, type: a.type,
        lat: a.lat, lon: a.lon, altitudeFt: a.altitudeFt,
        trackDeg: a.trackDeg, groundSpeedKt: a.groundSpeedKt,
        lastSeenSeconds: a.lastSeenSeconds,
      },
      computed: {
        distanceNm: item.distanceNm,
        relativeBearing: item.relativeBearing,
        visibility: {
          label: item.vis.label, score: item.vis.score,
          angularSizeDeg: item.vis.angularSizeDeg, elevationDeg: item.vis.elevationDeg,
          slantRangeNm: item.vis.slantRangeNm,
        },
        relevance: item.relevance,
      },
      outcome: outcomeCode,
    };

    await ObservationLogger.record(observation);
    if (_menuOpen) _render(); // refresh fallback-count badge if it just changed
  }

  return { init, update };
})();
