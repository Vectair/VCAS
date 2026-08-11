/**
 * LogPanel — ground-truth observation tool, on the primary screen.
 *
 * Lists every currently-tracked aircraft (not just the ones NAV is
 * currently showing — see Indicators.buildAll()) with four outcome
 * buttons, so "the algorithm excluded this and that was right/wrong" is
 * loggable too, not just "the algorithm showed this and it was right."
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

  return { init, update };
})();
