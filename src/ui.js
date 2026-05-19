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

  // ---- Loading pill ----

  function setLoading(show) {
    const el = document.getElementById("loading");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  // ---- Aircraft count ----

  function setAircraftCount(n) {
    const el = document.getElementById("aircraft-count");
    if (!el) return;
    el.textContent = n === 0 ? "No aircraft in range" : `${n} aircraft nearby`;
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

      el.innerHTML = `
        <div class="indicator-arrow" style="color:${ind.vis.color};transform:rotate(${ind.arrowDeg}deg)">▲</div>
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

  function showPopup(ind) {
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
      </div>`;

    // Position near indicator, keeping on screen
    const vw = window.innerWidth, vh = window.innerHeight;
    const popW = 220, popH = 180;
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

  function showAirPopup(aircraft, vis, mapContainer) {
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
      </div>`;

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
    setLoading,
    setAircraftCount,
    setModeLabel,
    renderIndicators,
    clearIndicators,
    showPopup,
    showAirPopup,
    hidePopup,
    // Add a safe fallback hook to prevent external caller crashes
    bindButtons: () => { console.warn("CameraController buttons bound internally via core application layer."); }
  };
})();

if (typeof module !== "undefined") module.exports = UI;