/**
 * UI rendering: edge indicators, popups, status pills.
 */

const UI = (() => {
  let _popupTimer = null;
  const POPUP_DISMISS_MS = 4000;

  // Destination names ultimately come from geocoding search results (see
  // orsGeocoder.js), which can echo back place names built from free-text
  // user input — escape before dropping into innerHTML-built SVG/HTML.
  function _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

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

  /**
   * Nudges apart *rendered* indicator labels that visibly overlap —
   * complements Indicators.declutter() (which only pushes apart raw x/y
   * dot centres by a fixed radius, before anything is on screen at all).
   * A fixed centre-to-centre gap can't know how wide a real label box is
   * going to be once actual callsign/type text is measured — two dots
   * comfortably outside that gap can still have their (much wider) label
   * boxes overlap, especially once several aircraft land in the same
   * outer band of the plot (see indicators.js's RING_BANDS_NM). Call this
   * AFTER renderIndicators() so the elements actually exist to measure.
   *
   * @param {number} anchorX  Same cx Geo.projectToPolarPosition used for
   *   this render (viewportWidth * 0.5).
   * @param {number} anchorY  Same cy Geo.projectToPolarPosition used for
   *   this render (viewportHeight * anchorY).
   *
   * First version of this moved each .indicator freely in x/y (standard
   * AABB minimum-translation separation) — shipped, then reverted the same
   * day once real testing showed it: pushing freely lets an aircraft's
   * label shove it RADIALLY, which can make a closer aircraft end up
   * rendering farther from the anchor than a genuinely more distant one,
   * silently destroying the one thing the plot's radius is supposed to
   * mean. Reworked to re-parametrise each aircraft as (radius, angle)
   * around the anchor and only ever adjust ANGLE to resolve an overlap —
   * radius (true distance-derived position) is never touched, so no
   * amount of label crowding can invert distance ordering, by
   * construction. Verified with the literal reported scenario: before this
   * rework, a 15.9nm aircraft rendered farther from the anchor than a
   * 25.9nm and a 33.7nm one; after, every aircraft's radius exactly
   * matches what Geo.projectToPolarPosition computed, unchanged.
   */
  function declutterRenderedIndicators(anchorX, anchorY) {
    const container = document.getElementById("indicators-layer");
    if (!container) return;
    const els = Array.from(container.querySelectorAll(".indicator"));
    if (els.length < 2) return;

    const items = els.map(el => {
      const trueX = parseFloat(el.style.left) || 0;
      const trueY = parseFloat(el.style.top) || 0;
      const rdx = trueX - anchorX, rdy = trueY - anchorY;
      const radius = Math.hypot(rdx, rdy);
      // Matches Geo.projectToPolarPosition's own x/y construction
      // (x = cx + r*sinθ, y = cy - r*cosθ) inverted to solve for θ.
      const angle = Math.atan2(rdx, -rdy);
      const label = el.querySelector(".indicator-label") || el;
      const rect = label.getBoundingClientRect();
      // The label's own offset from the true dot position (CSS stacks it
      // below the shape via flex, it isn't centred exactly ON the dot) —
      // preserved across angle adjustments so the label keeps the same
      // relationship to its shape it always had.
      return {
        el, radius, angle,
        labelW: rect.width, labelH: rect.height,
        offsetX: (rect.left + rect.width / 2) - trueX,
        offsetY: (rect.top + rect.height / 2) - trueY,
      };
    });

    function labelRect(item) {
      const cx = anchorX + item.radius * Math.sin(item.angle) + item.offsetX;
      const cy = anchorY - item.radius * Math.cos(item.angle) + item.offsetY;
      return { left: cx - item.labelW / 2, right: cx + item.labelW / 2, top: cy - item.labelH / 2, bottom: cy + item.labelH / 2 };
    }

    const PADDING_PX = 4;
    const MAX_PASSES = 8;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const ar = labelRect(a), br = labelRect(b);
          const overlapX = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
          const overlapY = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
          if (overlapX <= 0 || overlapY <= 0) continue;

          moved = true;
          // Convert the needed screen-space separation into an angular
          // push via arc length (s = r * θ) at each item's own radius —
          // never adjusts radius itself.
          const overlapPx = Math.min(overlapX, overlapY) / 2 + PADDING_PX;
          const avgRadius = Math.max(20, (a.radius + b.radius) / 2);
          const pushAngle = overlapPx / avgRadius;
          const sign = a.angle <= b.angle ? -1 : 1;
          a.angle += sign * pushAngle;
          b.angle -= sign * pushAngle;
        }
      }
      if (!moved) break;
    }

    items.forEach(item => {
      item.el.style.left = (anchorX + item.radius * Math.sin(item.angle)) + "px";
      item.el.style.top  = (anchorY - item.radius * Math.cos(item.angle)) + "px";
    });
  }

  function clearIndicators() {
    const container = document.getElementById("indicators-layer");
    if (container) container.innerHTML = "";
  }

  // Range rings are now real map layers (see map.js's EosMap.updateRangeRings/
  // clearRangeRings) instead of a screen-space SVG overlay here — drawn as
  // true circles around the user's actual lat/lon so panning/zooming/rotating
  // the map carries them along naturally, the same as the route line.

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
  /**
   * @param {object} [vehicleInfo]  { speedMph, route: {destName, distanceMeters, durationSeconds} | null }.
   *   Drawn as a compact strip below the heading tape's own tick labels —
   *   RAW's equivalent of a real ND's flight-data strip (GS/TAS/ILS APP/
   *   arrival time), adapted to what's actually relevant driving a car
   *   instead of flying: current speed, and — when a route is active —
   *   distance/ETA to destination. Omit for no strip (matches prior
   *   behaviour exactly).
   */
  function renderCompassRing(viewportWidth, headingDeg, safeInset = 60, vehicleInfo = null) {
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
    // Near-white ticks/labels and a yellow lubber line are pixel-sampled
    // straight from a real ND reference photo's own heading tape.
    let ticks = "";
    for (let deg = startDeg; deg <= endDeg; deg += 10) {
      const wrapped = ((deg % 360) + 360) % 360;
      const x = cx + (deg - heading) * PX_PER_DEG;
      const isMajor = wrapped % 30 === 0;
      const tickH = isMajor ? 14 : 8;
      ticks += `<line x1="${x}" y1="${tickTopY}" x2="${x}" y2="${tickTopY + tickH}"
                  style="stroke:#f0f0f0" stroke-width="1.5" opacity="0.7"/>`;
      if (isMajor) {
        const label = String(wrapped).padStart(3, "0");
        ticks += `<text x="${x}" y="${tickTopY + tickH + 14}" text-anchor="middle"
                    style="fill:#f0f0f0; font-size:12px" opacity="0.85">${label}</text>`;
      }
    }

    // Fixed lubber line — points down at the tick baseline, always centred.
    const pointer = `<path d="M ${cx - 7} ${tickTopY - 16} L ${cx + 7} ${tickTopY - 16} L ${cx} ${tickTopY - 2} Z"
                fill="#ffff00" opacity="0.9"/>`;

    const hdgRounded = Math.round(heading) % 360;
    const digital = `<text x="${cx}" y="${tickTopY - 22}" text-anchor="middle"
                style="fill:#f0f0f0; font-size:14px; font-weight:600">${String(hdgRounded).padStart(3, "0")}</text>`;

    let infoStrip = "";
    if (vehicleInfo) {
      // One shared <text> assignment per call (svg.innerHTML is set once,
      // below) rather than a separate render call, so this can never
      // clobber — or be clobbered by — the tape markup above.
      //
      // The range rings' own "2/5/10/15" labels are a completely separate
      // rendering system (real geo-projected MapLibre symbols, not this
      // SVG) with no position awareness of this strip or vice versa — a
      // far-out ring's label can legitimately land anywhere in this upper
      // area depending on the user's real position, so there's no fixed Y
      // offset here that's guaranteed collision-free (confirmed: the
      // deployed version visibly overlapped a ring label in testing).
      // Same fix as the indicator labels already use for the same
      // "something else might be behind this" problem — an opaque
      // background plate (--label-bg's raw value, since this SVG can't
      // reference CSS custom properties) — rather than trying to predict
      // where a real geo-projected ring will or won't land.
      const stripY = tickTopY + 14 + 14 + 20;
      const speedLabel = `SPD ${Math.round(vehicleInfo.speedMph)} MPH`;
      let routeLine = null;
      if (vehicleInfo.route) {
        const { destName, distanceMeters, durationSeconds } = vehicleInfo.route;
        const distLabel = distanceMeters >= 1000 ? (distanceMeters / 1000).toFixed(1) + "km" : Math.round(distanceMeters) + "m";
        const arrivalMs = Date.now() + durationSeconds * 1000;
        const d = new Date(arrivalMs);
        const arrivalLabel = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
        const shortDest = destName.length > 22 ? destName.slice(0, 21) + "…" : destName;
        routeLine = `${shortDest} · ${distLabel} · ETA ${arrivalLabel}`;
      }

      // No live text measurement available for a string injected via
      // innerHTML — a rough monospace-ish per-character estimate, generous
      // enough not to clip real content, not trying to be pixel-perfect.
      const estWidth = str => str.length * 7.2;
      const boxW = Math.max(estWidth(speedLabel), routeLine ? estWidth(routeLine) : 0) + 28;
      const boxH = routeLine ? 46 : 26;
      const bg = `<rect x="${cx - boxW / 2}" y="${stripY - 17}" width="${boxW}" height="${boxH}" rx="4"
                  fill="rgba(14,17,23,.82)"/>`;

      let text = `<text x="${cx}" y="${stripY}" text-anchor="middle"
                  style="fill:#f0f0f0; font-size:13px; font-weight:600; letter-spacing:0.5px">${speedLabel}</text>`;
      if (routeLine) {
        text += `<text x="${cx}" y="${stripY + 18}" text-anchor="middle"
                    style="fill:#f0f0f0; font-size:12px" opacity="0.85">${_escapeHtml(routeLine)}</text>`;
      }
      infoStrip = bg + text;
    }

    svg.innerHTML = ticks + pointer + digital + infoStrip;
    svg.classList.remove("hidden");
  }

  function clearCompassRing() {
    const svg = document.getElementById("nav-compass-ring");
    if (svg) { svg.innerHTML = ""; svg.classList.add("hidden"); }
  }

  /**
   * RAW mode's range rings, drawn as screen-space arcs sharing the EXACT
   * same anchor/scale/FOV the aircraft dots use (Geo.circularPlotRadius +
   * Geo.bandedRadiusFraction) — NOT the real geo-projected MapLibre layers
   * EosMap.updateRangeRings draws for AIR's own optional rings. Both used
   * to exist for RAW too, and had nothing in common: dots plotted on the
   * deliberately non-linear banded scale, rings on the literal real-world
   * nm-to-pixel scale — so an aircraft's plotted position and the rings
   * around it could (and did, reported directly against the deployed app)
   * disagree completely, e.g. an 8nm aircraft rendering INSIDE a literal
   * 2nm ring. Making the ring itself just another point on the SAME
   * formula the dot uses guarantees they can never disagree, by
   * construction, not by coincidence of matching numbers.
   *
   * Safe specifically because RAW has no real map texture underneath to
   * visually detach from (pure black background, no vector tile source at
   * all) — the "rings must be real map layers" decision elsewhere in this
   * codebase was about Hybrid/AIR's real road/building detail, which
   * doesn't exist in RAW.
   *
   * @param {number[]} bandsNm         Same array Indicators.RING_BANDS_NM
   *   and the dots' own Geo.projectToPolarPosition call use.
   * @param {number} fovHalfAngleDeg   Same Indicators.FOV_HALF_ANGLE_DEG
   *   the dots are restricted to.
   */
  function renderRangeRingsOverlay(viewportWidth, viewportHeight, anchorY, safeInset, bandsNm, fovHalfAngleDeg, color) {
    const svg = document.getElementById("nav-range-rings-overlay");
    if (!svg) return;

    const cx = viewportWidth * 0.5;
    const cy = viewportHeight * anchorY;
    const plotRadius = Geo.circularPlotRadius(viewportWidth, viewportHeight, anchorY, safeInset, fovHalfAngleDeg);
    const fovRad = (fovHalfAngleDeg * Math.PI) / 180;

    let rings = "";
    bandsNm.forEach(nm => {
      const radius = Geo.bandedRadiusFraction(nm, bandsNm) * plotRadius;
      if (radius < 4) return; // too small to read as a ring at all

      const startX = cx + radius * Math.sin(-fovRad), startY = cy - radius * Math.cos(-fovRad);
      const endX   = cx + radius * Math.sin(fovRad),  endY   = cy - radius * Math.cos(fovRad);
      // 150° < 180°, so large-arc-flag is always 0; sweep-flag 1 draws the
      // arc through dead-ahead (angle 0), not the long way round the back.
      rings += `<path d="M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}"
                  fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.55"/>`;

      // Always along dead-ahead (angle 0 = straight up from the anchor) —
      // no heading-rotation concern at all here, unlike the old real-geo
      // rings, since this is screen-space relative to dead-ahead already.
      rings += `<text x="${cx}" y="${cy - radius - 4}" text-anchor="middle"
                  style="fill:${color}; font-size:11px" opacity="0.7">${nm}</text>`;
    });

    svg.innerHTML = rings;
    svg.classList.remove("hidden");
  }

  function clearRangeRingsOverlay() {
    const svg = document.getElementById("nav-range-rings-overlay");
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
    declutterRenderedIndicators,
    clearIndicators,
    renderCompassRing,
    clearCompassRing,
    renderRangeRingsOverlay,
    clearRangeRingsOverlay,
    showPopup,
    showAirPopup,
    hidePopup,
  };
})();

if (typeof module !== "undefined") module.exports = UI;