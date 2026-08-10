/**
 * UI rendering: edge indicators, popups, status pills.
 */

const UI = (() => {
  let _popupTimer = null;
  const POPUP_DISMISS_MS = 4000;

  // ---- ADS-B status pill ----

  function setAdsbStatus(state, text) {
    const el = document.getElementById("adsb-status");
    if (!el) return;
    el.className = "";
    el.classList.add(state); // "active" | "stale" | "error"
    const label = el.querySelector(".label");
    if (label) label.textContent = text || "ADS-B";
  }

  // ---- Config banner ----

  function showConfigBanner(show) {
    const el = document.getElementById("config-banner");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  // ---- GPS message ----

  function showGpsMessage(show) {
    const el = document.getElementById("gps-message");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  // ---- Compass permission banner ----

  let _compassBtnBound = false;

  /**
   * @param {boolean} show
   * @param {function} [onEnableClick]  Called when the Enable button is tapped.
   *   The click listener is only ever bound once (button persists across
   *   show/hide, unlike the popup's freshly-rebuilt content), so this only
   *   needs to be passed the first time; pass it every call for simplicity.
   */
  function showCompassPermissionBanner(show, onEnableClick) {
    const el = document.getElementById("compass-permission-banner");
    if (!el) return;
    el.classList.toggle("hidden", !show);

    if (onEnableClick && !_compassBtnBound) {
      const btn = document.getElementById("compass-permission-btn");
      if (btn) {
        btn.addEventListener("click", onEnableClick);
        _compassBtnBound = true;
      }
    }
  }

  // ---- Loading pill ----

  function setLoading(show) {
    const el = document.getElementById("loading");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  // ---- Aircraft count ----

  /**
   * @param {number} shownCount        Aircraft actually displayed right now.
   * @param {number} [totalCount]      Total relevant aircraft available (may exceed shownCount
   *                                   when there's more than fits on one page). Defaults to
   *                                   shownCount — i.e. "no overflow" — when omitted, so existing
   *                                   callers that only care about a plain count are unaffected.
   * @param {function} [onCycleClick]  Called when the overflow badge is tapped. Only wired up
   *                                   when there's actually overflow to cycle through.
   */
  function setAircraftCount(shownCount, totalCount, onCycleClick) {
    const el = document.getElementById("aircraft-count");
    if (!el) return;

    const total = totalCount != null ? totalCount : shownCount;
    const hasOverflow = total > shownCount;

    if (total === 0) {
      el.textContent = "No aircraft in range";
    } else if (!hasOverflow) {
      el.textContent = `${shownCount} aircraft nearby`;
    } else {
      el.textContent = `${shownCount} of ${total} shown — tap for more`;
    }

    el.classList.toggle("clickable", hasOverflow);
    el.onclick = hasOverflow ? onCycleClick : null;
  }

  // ---- Mode label ----

  function setModeLabel(mode) {
    const el = document.getElementById("mode-label");
    if (!el) return;
    el.textContent = mode === "nav" ? "DRIVING VIEW" : "AIRSPACE VIEW";

    document.getElementById("btn-nav")?.classList.toggle("active-mode", mode === "nav");
    document.getElementById("btn-air")?.classList.toggle("active-mode", mode === "air");
  }

  // ---- Edge indicators ----

  function renderIndicators(indicators, onClickFn) {
    const container = document.getElementById("indicators-layer");
    if (!container) return;
    container.innerHTML = "";

    indicators.forEach(ind => {
      const el = document.createElement("div");
      el.className = "indicator" + (ind.isStale ? " stale" : "");
      el.style.left = ind.x + "px";
      el.style.top  = ind.y + "px";

      const callsign = ind.aircraft.callsign || ind.aircraft.hex;
      const type     = ind.aircraft.type || "";
      const shapeSvg = AircraftSymbol.svg(ind.relevance.reason, ind.vis.color, 20);

      el.innerHTML = `
        <div class="indicator-shape">${shapeSvg}</div>
        <div class="indicator-label" style="border-color:${ind.vis.color}33">
          <div class="callsign" style="color:${ind.vis.color}">${callsign}</div>
          ${type ? `<div class="actype">${type}</div>` : ""}
        </div>`;

      el.addEventListener("click", () => onClickFn(ind));
      container.appendChild(el);
    });
  }

  function clearIndicators() {
    const container = document.getElementById("indicators-layer");
    if (container) container.innerHTML = "";
  }

  // ---- Popup ----

  /** Shared row of ground-truth log buttons, embedded in both popups below. */
  function _logButtonsHtml() {
    return `
      <div class="pop-log-actions">
        ${ObservationLogger.OUTCOMES.map(o =>
          `<button type="button" class="pop-log-btn" data-outcome="${o.code}" title="${o.title}">${o.label}</button>`
        ).join("")}
      </div>`;
  }

  function _wireLogButtons(el, onLogOutcome) {
    if (!onLogOutcome) return;
    el.querySelectorAll(".pop-log-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onLogOutcome(btn.dataset.outcome);
        btn.classList.add("pop-log-btn-done");
        setTimeout(() => btn.classList.remove("pop-log-btn-done"), 600);
      });
    });
  }

  /**
   * @param {object} ind                 Indicator data (as built by Indicators.build()).
   * @param {function} [onSuppressClick] Called with no args when the Suppress button is
   *   tapped. Omit to render the popup without a Suppress button (used for the AIR mode
   *   popup, where nothing is relevance-filtered so there's nothing to suppress from).
   * @param {function} [onLogOutcome]    Called with an outcome code when a ground-truth
   *   log button is tapped. Omit to render the popup without log buttons.
   */
  function showPopup(ind, onSuppressClick, onLogOutcome) {
    const el = document.getElementById("popup");
    if (!el) return;

    const a = ind.aircraft;
    const callsign = a.callsign || a.hex;
    const type     = a.type  || "Unknown";
    const distStr  = ind.distanceNm != null ? ind.distanceNm.toFixed(1) + " NM" : "—";
    const altStr   = a.altitudeFt != null ? a.altitudeFt.toLocaleString() + " ft" : "Unknown";
    const bearingLabel = _bearingLabel(ind.relativeBearing, ind.vis.isOverhead);
    const updatedStr = a.lastSeenSeconds != null ? Math.round(a.lastSeenSeconds) + "s ago" : "—";

    el.innerHTML = `
      <div class="pop-callsign">${callsign}</div>
      <div class="pop-type">${type}</div>
      <div class="pop-row"><span class="pop-key">Distance</span><span class="pop-val">${distStr}</span></div>
      <div class="pop-row"><span class="pop-key">Altitude</span><span class="pop-val">${altStr}</span></div>
      <div class="pop-row"><span class="pop-key">Bearing</span><span class="pop-val">${bearingLabel}</span></div>
      <div class="pop-row"><span class="pop-key">Updated</span><span class="pop-val">${updatedStr}</span></div>
      <div>
        <span class="pop-vis-badge" style="background:${ind.vis.color}">${ind.vis.label}</span>
      </div>
      ${onLogOutcome ? _logButtonsHtml() : ""}
      ${onSuppressClick ? `
      <div class="pop-actions">
        <button type="button" class="pop-suppress-btn">Suppress</button>
      </div>` : ""}`;

    _wireLogButtons(el, onLogOutcome);

    if (onSuppressClick) {
      el.querySelector(".pop-suppress-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        onSuppressClick();
      });
    }

    // Position near indicator, keeping on screen
    const vw = window.innerWidth, vh = window.innerHeight;
    const popW = 220;
    const popH = 180 + (onLogOutcome ? 34 : 0) + (onSuppressClick ? 35 : 0);
    let left = ind.x - popW / 2;
    let top  = ind.y - popH - 14;
    left = Math.max(8, Math.min(vw - popW - 8, left));
    top  = Math.max(8, Math.min(vh - popH - 8, top));
    el.style.left = left + "px";
    el.style.top  = top  + "px";

    el.classList.remove("hidden");

    clearTimeout(_popupTimer);
    _popupTimer = setTimeout(() => el.classList.add("hidden"), POPUP_DISMISS_MS);
  }

  /**
   * @param {function} [onLogOutcome]  Called with an outcome code when a ground-truth
   *   log button is tapped. Omit to render the popup without log buttons.
   */
  function showAirPopup(aircraft, vis, onLogOutcome) {
    const el = document.getElementById("popup");
    if (!el) return;

    const callsign = aircraft.callsign || aircraft.hex;
    const type     = aircraft.type  || "Unknown";
    const altStr   = aircraft.altitudeFt != null ? aircraft.altitudeFt.toLocaleString() + " ft" : "Unknown";
    const spdStr   = aircraft.groundSpeedKt != null ? aircraft.groundSpeedKt.toFixed(0) + " kt" : "—";

    el.innerHTML = `
      <div class="pop-callsign">${callsign}</div>
      <div class="pop-type">${type}</div>
      <div class="pop-row"><span class="pop-key">Altitude</span><span class="pop-val">${altStr}</span></div>
      <div class="pop-row"><span class="pop-key">Speed</span><span class="pop-val">${spdStr}</span></div>
      <div class="pop-row"><span class="pop-key">Updated</span><span class="pop-val">${Math.round(aircraft.lastSeenSeconds)}s ago</span></div>
      <div>
        <span class="pop-vis-badge" style="background:${vis.color}">${vis.label}</span>
      </div>
      ${onLogOutcome ? _logButtonsHtml() : ""}`;

    _wireLogButtons(el, onLogOutcome);

    // Centre on screen in air mode
    el.style.left = "50%";
    el.style.top  = "40%";
    el.style.transform = "translate(-50%, -50%)";
    el.classList.remove("hidden");

    clearTimeout(_popupTimer);
    _popupTimer = setTimeout(() => {
      el.classList.add("hidden");
      el.style.transform = "";
    }, POPUP_DISMISS_MS);
  }

  function hidePopup() {
    const el = document.getElementById("popup");
    if (el) el.classList.add("hidden");
    clearTimeout(_popupTimer);
  }

  // ---- Helpers ----

  function _bearingLabel(relativeBearing, isOverhead) {
    if (isOverhead) return "overhead";
    const abs = Math.abs(relativeBearing);
    if (abs <= 20)        return "ahead";
    if (abs >= 160)       return "behind";
    const side = relativeBearing > 0 ? "right" : "left";
    if (abs <= 60)        return `${side}-front`;
    if (abs <= 120)       return side;
    return `${side}-rear`;
  }

  return {
    setAdsbStatus,
    showConfigBanner,
    showGpsMessage,
    showCompassPermissionBanner,
    setLoading,
    setAircraftCount,
    setModeLabel,
    renderIndicators,
    clearIndicators,
    showPopup,
    showAirPopup,
    hidePopup,
  };
})();

if (typeof module !== "undefined") module.exports = UI;