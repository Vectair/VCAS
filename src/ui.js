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

  // ---- Destination-pick mode (route button armed, waiting for a map tap) ----

  function setDestPickMode(active) {
    const btn = document.getElementById("btn-test-route");
    if (btn) {
      btn.classList.toggle("picking", active);
      btn.title = active ? "Tap the map to set your destination (tap again to cancel)" : "Set destination";
    }
    const banner = document.getElementById("dest-pick-banner");
    if (banner) banner.classList.toggle("hidden", !active);

    // Fresh slate every time the banner opens OR closes — a re-armed
    // search shouldn't show whatever was typed/found last time, and a
    // closed one shouldn't leave stale results sitting in the DOM.
    const input = document.getElementById("dpb-search-input");
    if (input) input.value = "";
    clearDestSearchResults();
  }

  /**
   * @param {Array<{label:string, lat:number, lon:number}>} results
   * @param {function} onSelect  Called with the chosen result on tap.
   */
  function renderDestSearchResults(results, onSelect) {
    const container = document.getElementById("dpb-search-results");
    if (!container) return;

    if (!results || results.length === 0) {
      container.innerHTML = `<div class="dpb-result-empty">No matches found</div>`;
      container.classList.remove("hidden");
      return;
    }

    container.innerHTML = "";
    results.forEach(result => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dpb-result-btn";
      btn.textContent = result.label;
      btn.addEventListener("click", () => onSelect(result));
      container.appendChild(btn);
    });
    container.classList.remove("hidden");
  }

  function clearDestSearchResults() {
    const container = document.getElementById("dpb-search-results");
    if (container) { container.innerHTML = ""; container.classList.add("hidden"); }
  }

  // ---- Recenter button (shown after the user manually pans/zooms/rotates) ----

  function setRecenterVisible(show) {
    const btn = document.getElementById("btn-recenter");
    if (btn) btn.classList.toggle("hidden", !show);
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

  const MODE_LABELS = { hybrid: "DRIVING VIEW", raw: "RAW VIEW", air: "AIRSPACE VIEW" };

  /**
   * @param {"hybrid"|"raw"|"air"} displayMode  The active one of the three
   *   main-screen buttons — Hybrid/Raw are both NAV mode under the hood
   *   (see NavDisplayStyle), just different basemaps/cameras, but they're
   *   now surfaced as three peer choices rather than NAV/AIR plus a
   *   buried Settings sub-toggle.
   */
  function setModeLabel(displayMode) {
    const el = document.getElementById("mode-label");
    if (!el) return;
    el.textContent = MODE_LABELS[displayMode] || MODE_LABELS.hybrid;

    document.getElementById("btn-hybrid")?.classList.toggle("active-mode", displayMode === "hybrid");
    document.getElementById("btn-raw")?.classList.toggle("active-mode", displayMode === "raw");
    document.getElementById("btn-air")?.classList.toggle("active-mode", displayMode === "air");
  }

  // ---- Edge indicators ----

  /**
   * The category `color` values are tuned for the night theme's dark
   * background; on the day theme's light one, the same colors (especially
   * the yellow) are a near-worst-case low-contrast pairing. `colorDay` is a
   * darker, theme-safe variant for exactly that case. When the colorblind
   * toggle is on, swaps to the Okabe-Ito-based colorblindSafe/
   * colorblindSafeDay pair instead — see visibility.js for why. Falls back
   * to `color` if a caller ever passes a vis object missing a variant.
   */
  function _displayColor(vis) {
    const day = ThemeManager.getResolved() === "day";
    // Accessibility wins over reference-fidelity — colourblind-safe applies
    // even in RAW style, checked first regardless of which style is active.
    if (ColorblindMode.isEnabled()) {
      return (day ? vis.colorblindSafeDay : vis.colorblindSafe) || vis.color;
    }
    if (typeof NavDisplayStyle !== "undefined" && NavDisplayStyle.isRaw()) {
      return vis.colorRaw || vis.color;
    }
    return (day ? vis.colorDay : null) || vis.color;
  }

  /** Border alpha alone (independent of colorDay) was too faint against the
   * day theme's near-white label background — stronger on day, unchanged
   * (still subtle, by design) on night. RAW's label box is always dark
   * regardless of Day/Night/Auto (see the CSS for .indicator-label under
   * [data-nav-style="raw"]), so it always wants the night-strength alpha —
   * otherwise a Day-resolved theme would give RAW a much stronger border
   * than a Night-resolved one, even though the box looks identical either
   * way. */
  function _borderColor(vis) {
    const raw = (typeof NavDisplayStyle !== "undefined") && NavDisplayStyle.isRaw();
    const alpha = (!raw && ThemeManager.getResolved() === "day") ? "cc" : "33";
    return _displayColor(vis) + alpha;
  }

  /** Small chevron pointing "up" before rotation — see relativeTrackDeg usage above. */
  function _directionArrowSvg(color) {
    return `<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><path d="M5 0 L10 9 L5 6.5 L0 9 Z" fill="${color}"/></svg>`;
  }

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
      const displayColor = _displayColor(ind.vis);
      const shapeSvg = AircraftSymbol.svg(ind.vis.shape, displayColor, 20, ind.vis.fillOpacity, {
        predicted: ind.relevance.reason === "predicted-entry",
        overhead:  ind.relevance.reason === "overhead",
      });
      // Direction-of-travel indicator — the aircraft's own ground track,
      // relative to the observer's heading-up view (0deg = travelling the
      // same way "up"/ahead reads on this screen). Omitted when the
      // aircraft isn't transmitting a track, rather than guessing.
      const arrowSvg = ind.relativeTrackDeg != null
        ? `<div class="direction-arrow" style="transform:translate(-50%,-50%) rotate(${ind.relativeTrackDeg}deg) translateY(-18px)">${_directionArrowSvg(displayColor)}</div>`
        : "";

      // Explicit distance readout — the polar plot's radius is proportional
      // to real distance, but a dot's screen position alone doesn't reliably
      // read as "how far away is that" the way a real map's landmarks do;
      // slantRangeNm (not flat horizontal distance) matches the figure that
      // actually drives where the dot is plotted (Geo.projectToPolarPosition).
      const distanceLabel = `${ind.vis.slantRangeNm.toFixed(1)}nm`;

      el.innerHTML = `
        <div class="indicator-shape">${arrowSvg}${shapeSvg}</div>
        <div class="indicator-label" style="border-color:${_borderColor(ind.vis)}">
          <div class="callsign" style="color:${displayColor}">${callsign}</div>
          ${type ? `<div class="actype">${type}</div>` : ""}
          <div class="indicator-distance">${distanceLabel}</div>
        </div>`;

      el.addEventListener("click", () => onClickFn(ind));
      container.appendChild(el);
    });
  }

  function clearIndicators() {
    const container = document.getElementById("indicators-layer");
    if (container) container.innerHTML = "";
  }

  // ---- NAV top-down range rings ----

  /**
   * Dashed, plain-circular range rings centred on the same bottom-anchored
   * point the polar-plotted indicators use — the TCAS/ND-style "radar
   * screen" cue that was missing from the flat top-down view, matching a
   * real ND's own plain circular rings.
   *
   * (Two non-circular versions were tried in between and both reverted: an
   * "archway" shape and an ellipse, each meant to make an off-axis
   * aircraft's plotted radius exactly equal its own ring band's radius at
   * every bearing — mathematically sound, but visibly not a circle, which
   * mattered more. Geo.projectToPolarPosition() keeps a uniform circular
   * NM-to-pixel scale and only clamps individual points right at the true
   * screen edge — see its own comment — so this plain circle is close to,
   * not exactly, where a wide-angle aircraft plots; the trade-off is
   * deliberate.)
   *
   * One ring per band in `bandsNm`, each at an equal fraction of the
   * available radius (1/N, 2/N, ... N/N) — matching how
   * Geo.bandedRadiusFraction() allocates plot radius, so a ring genuinely
   * marks "this band's outer edge," not a linear distance. Each ring is
   * labelled with its own nm boundary so the compression is legible: the
   * gaps between rings look equal on screen but represent very unequal
   * real distances (e.g. [2, 5, 10, 15] -> rings 1nm apart in screen terms
   * but 2, 3, 5, and 5 nm apart in reality).
   *
   * @param {number[]} bandsNm  Ring band boundaries in nm, ascending — see
   *   Geo.bandedRadiusFraction(). Same array Indicators.RING_BANDS_NM /
   *   projectToPolarPosition() use, so rings line up with plotted aircraft.
   */
  function renderRangeRings(viewportWidth, viewportHeight, bandsNm, anchorY = 0.8, safeInset = 60) {
    const svg = document.getElementById("nav-range-rings");
    if (!svg) return;

    const cx = viewportWidth * 0.5;
    const cy = viewportHeight * anchorY;
    const maxRadius = Geo.maxRadiusForBearing(0, viewportWidth, viewportHeight, anchorY, safeInset);

    if (maxRadius <= 0 || !bandsNm || bandsNm.length === 0) {
      svg.innerHTML = "";
      svg.classList.add("hidden");
      return;
    }

    const n = bandsNm.length;
    // Off dead-ahead so labels don't sit under the busiest part of the
    // plot (straight up), at a fixed pixel offset from centre — not an
    // angle scaled by each ring's own radius — so the outer rings' labels
    // land just beside their own crest instead of sliding out past the
    // screen edge on a narrow phone.
    const labelDx = 22;

    // Raw's basemap is always forced near-black regardless of Day/Night/
    // Auto (see NavStyle's "raw" theme) — var(--text-secondary) is the
    // resolved theme's OWN colour, which washes out badly when that
    // resolves to Day (a mid-grey tuned for a pale background, not black).
    // Hybrid keeps following the real theme since its basemap does too.
    const isRaw = (typeof NavDisplayStyle !== "undefined") && NavDisplayStyle.isRaw();
    const ringColor = isRaw ? "#8b949e" : "var(--text-secondary)";

    const parts = bandsNm.map((nm, i) => {
      const r = maxRadius * ((i + 1) / n);
      // Semicircle: left -> top (through "ahead") -> right.
      const ring = `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
                fill="none" style="stroke:${ringColor}" stroke-width="1.5"
                stroke-dasharray="5,6" opacity="0.55"/>`;
      const dx = Math.min(labelDx, r);
      const lx = cx + dx;
      const ly = cy - Math.sqrt(Math.max(0, r * r - dx * dx));
      const label = `<text x="${lx}" y="${ly}" text-anchor="start" dominant-baseline="middle"
                style="fill:${ringColor}; font-size:11px" opacity="0.7">${nm}</text>`;
      return ring + label;
    }).join("");

    svg.innerHTML = parts;
    svg.classList.remove("hidden");
  }

  function clearRangeRings() {
    const svg = document.getElementById("nav-range-rings");
    if (svg) { svg.innerHTML = ""; svg.classList.add("hidden"); }
  }

  // ---- NAV Raw-mode heading/compass tape ----

  /**
   * ND-style heading tape across the top of the screen — Raw mode only
   * (per the reference image), since Hybrid's rotating road map already
   * carries its own orientation cues a bare basemap doesn't have. A fixed
   * lubber line marks dead-ahead (the current heading, always centred,
   * since Raw is heading-up); tick marks and 3-digit heading labels slide
   * past it as the aircraft turns, same convention as a real EFIS heading
   * tape. Minor ticks every 10°, labelled major ticks every 30°.
   *
   * @param {number} viewportWidth
   * @param {number} headingDeg    Current true heading, any real number
   *   (wrapped to [0, 360) internally).
   * @param {number} safeInset     Top clearance to draw below (matches the
   *   same safe-area constant used for range rings/indicator plotting).
   */
  function renderCompassRing(viewportWidth, headingDeg, safeInset = 60) {
    const svg = document.getElementById("nav-compass-ring");
    if (!svg) return;

    const cx = viewportWidth * 0.5;
    const tickTopY = safeInset;
    const PX_PER_DEG = 6;
    const halfSpanDeg = Math.min(60, viewportWidth / (2 * PX_PER_DEG));
    const heading = ((headingDeg % 360) + 360) % 360;

    const startDeg = Math.ceil((heading - halfSpanDeg) / 10) * 10;
    const endDeg = heading + halfSpanDeg;

    // Only ever rendered while Raw is active (see app.js's call site) and
    // Raw's basemap is always forced near-black regardless of Day/Night/
    // Auto — fixed dark-appropriate colours here, not var(--text-secondary)
    // etc., which would follow the resolved theme and wash out on Day.
    let ticks = "";
    for (let deg = startDeg; deg <= endDeg; deg += 10) {
      const wrapped = ((deg % 360) + 360) % 360;
      const x = cx + (deg - heading) * PX_PER_DEG;
      const isMajor = wrapped % 30 === 0;
      const tickH = isMajor ? 14 : 8;
      ticks += `<line x1="${x}" y1="${tickTopY}" x2="${x}" y2="${tickTopY + tickH}"
                  style="stroke:#8b949e" stroke-width="1.5" opacity="0.7"/>`;
      if (isMajor) {
        const label = String(wrapped).padStart(3, "0");
        ticks += `<text x="${x}" y="${tickTopY + tickH + 14}" text-anchor="middle"
                    style="fill:#8b949e; font-size:12px" opacity="0.85">${label}</text>`;
      }
    }

    // Fixed lubber line — points down at the tick baseline, always centred.
    const pointer = `<path d="M ${cx - 7} ${tickTopY - 16} L ${cx + 7} ${tickTopY - 16} L ${cx} ${tickTopY - 2} Z"
                fill="#1191d8" opacity="0.9"/>`;

    const hdgRounded = Math.round(heading) % 360;
    const digital = `<text x="${cx}" y="${tickTopY - 22}" text-anchor="middle"
                style="fill:#e6edf3; font-size:14px; font-weight:600">${String(hdgRounded).padStart(3, "0")}</text>`;

    svg.innerHTML = ticks + pointer + digital;
    svg.classList.remove("hidden");
  }

  function clearCompassRing() {
    const svg = document.getElementById("nav-compass-ring");
    if (svg) { svg.innerHTML = ""; svg.classList.add("hidden"); }
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
        <span class="pop-vis-badge" style="background:${_displayColor(ind.vis)}">${ind.vis.label}</span>
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
        <span class="pop-vis-badge" style="background:${_displayColor(vis)}">${vis.label}</span>
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
    setDestPickMode,
    renderDestSearchResults,
    clearDestSearchResults,
    setRecenterVisible,
    setLoading,
    setAircraftCount,
    setModeLabel,
    renderIndicators,
    clearIndicators,
    renderRangeRings,
    clearRangeRings,
    renderCompassRing,
    clearCompassRing,
    showPopup,
    showAirPopup,
    hidePopup,
  };
})();

if (typeof module !== "undefined") module.exports = UI;