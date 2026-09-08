/**
 * UI rendering: edge indicators, popups, status pills.
 */

const UI = (() => {
  let _popupTimer = null;
  const POPUP_DISMISS_MS = 4000;

  // The compass tape's major-tick outer height (renderCompassRing, round 9
  // curved-tape rework) — exported so app.js's tapeRadius derivation
  // (round 10 follow-up) can give the tape's dead-ahead tick real
  // clearance from the real chrome above it, rather than a second,
  // independently-guessed number that could drift from this one.
  const COMPASS_MAJOR_TICK_H = 14;

  // Stage 3: cross-highlight between the on-plot icon and its matching
  // aircraft-list row. Module-level (not per-render) so it survives the
  // ~500ms extrapolation re-render tick — both renderIndicators() and
  // renderAircraftList() re-tag their elements with data-hex and re-apply
  // this on every call, rather than the highlight vanishing after one frame.
  let _selectedHex = null;

  // Popup log/suppress action gating (2026-08-24) — see setSpeedMph()'s own
  // comment below. Separate from logPanel.js's own identical-in-spirit
  // _speedMph — the two modules stay decoupled rather than one importing
  // the other, matching how the rest of this app's modules are structured.
  let _speedMph = 0;

  // Diffed-by-hex element caches for the NAV/RAW indicators layer (full
  // icons and suppressed range-selector edge dots) — see renderIndicators()
  // and renderSuppressedDots() below for why: this layer used to be torn
  // down and rebuilt from scratch on every call, at up to 2-5Hz between GPS
  // fixes and the 500ms extrapolation render tick (app.js), the same cost
  // pattern EosMap.renderAirMarkers (map.js) was already rewritten to avoid
  // for AIR mode. Kept as separate maps (not one, keyed only by hex) since
  // an aircraft can move between "full indicator" and "suppressed dot"
  // tiers (the ND range selector) between renders — a hex reused across
  // tiers must get a fresh element of the new type, not have the old one
  // silently mutated into looking like the other.
  let _indicatorEls = new Map();     // hex -> .indicator element
  let _suppressedDotEls = new Map(); // hex -> .suppressed-dot element

  // Destination names ultimately come from geocoding search results (see
  // orsGeocoder.js), which can echo back place names built from free-text
  // user input — escape before dropping into innerHTML-built SVG/HTML.
  function _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  // ---- Data-source status pills (ADS-B, METAR) ----

  function _setStatusPill(elId, state, text, fallbackLabel) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = "status-pill";
    el.classList.add(state); // "active" | "stale" | "error"
    const label = el.querySelector(".label");
    if (label) label.textContent = text || fallbackLabel;
  }

  function setAdsbStatus(state, text) {
    _setStatusPill("adsb-status", state, text, "adsb.fi");
  }

  /** Same shape/vocabulary as setAdsbStatus() — see MetarProvider.getStatus(). */
  function setMetarStatus(state, text) {
    _setStatusPill("metar-status", state, text, "METAR");
  }

  /**
   * Round 9 (2026-09-08) — MapTiler has no live per-request health signal
   * the way adsb.fi/METAR do (no relay reporting success/failure per
   * poll), so this is a one-time "is it configured" check, not a live
   * health check — same "active"/"stale" vocabulary, called once from
   * app.js's init() with whatever CONFIG.MAPTILER_KEY resolves to.
   */
  function setMaptilerStatus(configured) {
    _setStatusPill("maptiler-status", configured ? "active" : "stale", "MapTiler", "MapTiler");
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

  /**
   * @param {"hybrid"|"raw"|"air"} displayMode  The active one of the three
   *   main-screen buttons — Hybrid/Raw are both NAV mode under the hood
   *   (see NavDisplayStyle), just different basemaps/cameras, but they're
   *   now surfaced as three peer choices rather than NAV/AIR plus a
   *   buried Settings sub-toggle.
   *
   * The top-bar "DRIVING VIEW"/"RAW VIEW" text label (#mode-strip/
   * #mode-label, and the MODE_LABELS text it used to read from) was
   * removed 2026-09-08 (direct instruction: the top bar is now
   * status+settings only, current mode is indicated purely by which
   * bottom-bar button reads active) — this function's only remaining job
   * is toggling that active-mode highlight. Kept under its original
   * name/call sites (app.js calls this in several places) rather than
   * renamed, since renaming would be pure churn with no behavioural
   * benefit.
   */
  function setModeLabel(displayMode) {
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

  // Diffs by hex rather than tearing every indicator down and rebuilding it
  // (see _indicatorEls's own comment for why) — reuses each aircraft's
  // existing outer .indicator element across calls (position + inner
  // shape/label markup still refreshed every time, since those genuinely
  // do change most ticks — track/altitude/color/relevance-reason), avoiding
  // the container-level teardown and re-binding a fresh click listener for
  // aircraft that were already on screen. Every element still gets
  // re-appended each call (reused or new) to keep DOM order matching
  // `indicators`' own priority order — cheap (moves an existing node,
  // doesn't recreate it) but necessary, see the appendChild call below.
  function renderIndicators(indicators, onClickFn) {
    const container = document.getElementById("indicators-layer");
    if (!container) return;

    const seenHexes = new Set();

    indicators.forEach(ind => {
      const hex = ind.aircraft.hex;
      seenHexes.add(hex);

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

      // Type + altitude only — no callsign. Distance was here before (a
      // dot's own plotted radius already encodes range, redundant as label
      // text); callsign was removed the same way once the Stage 3 list
      // panel existed to hold it instead — the label is meant to be the
      // absolute minimum glanceable at a distance, callsign lives in the
      // list rows now, not duplicated on the icon too.
      const altitudeLabel = ind.aircraft.altitudeFt != null ? `${Math.round(ind.aircraft.altitudeFt).toLocaleString()}ft` : "";

      // shapeSvg wrapped in its own .indicator-icon element (2026-08-24)
      // so declutterRenderedIndicators() can obstacle-check the icon and
      // the arrow separately — a label is allowed to sit against its own
      // icon (the "attached tag" look), but not against its own arrow,
      // which carries its own real glanceable information (direction of
      // travel) that a label covering it would defeat. See that function's
      // own comment for the full reasoning.
      const innerHtml = `
        <div class="indicator-shape">${arrowSvg}<div class="indicator-icon">${shapeSvg}</div></div>
        <div class="indicator-label" style="border-color:${_borderColor(ind.vis)}">
          ${type ? `<div class="actype">${type}</div>` : ""}
          ${altitudeLabel ? `<div class="indicator-altitude">${altitudeLabel}</div>` : ""}
        </div>`;

      let el = _indicatorEls.get(hex);
      if (el) {
        el.classList.toggle("stale", !!ind.isStale);
        el.style.left = ind.x + "px";
        el.style.top  = ind.y + "px";
        el.innerHTML = innerHtml;
        // Click handler reads this mutable box on every click rather than
        // capturing `ind`/`onClickFn` directly, so a reused element's
        // single addEventListener (bound once, below) always dispatches
        // against whichever aircraft/callback is current — no re-binding
        // needed each render, same as EosMap.renderAirMarkers' `entry`.
        el._clickState.ind = ind;
        el._clickState.onClickFn = onClickFn;
      } else {
        el = document.createElement("div");
        el.className = "indicator" + (ind.isStale ? " stale" : "") + (hex === _selectedHex ? " selected" : "");
        el.dataset.hex = hex;
        el.style.left = ind.x + "px";
        el.style.top  = ind.y + "px";
        el.innerHTML = innerHtml;
        el._clickState = { ind, onClickFn };
        el.addEventListener("click", () => { selectAircraft(hex); el._clickState.onClickFn(el._clickState.ind); });
        _indicatorEls.set(hex, el);
      }
      // Re-append every element (reused or new) in `indicators`' own order —
      // appendChild() on a node that already has this same parent just MOVES
      // it to the end rather than recreating it, so this stays cheap, but it
      // matters for correctness: declutterRenderedIndicators() (below) reads
      // .indicator elements back out via container.querySelectorAll() and
      // relies on THAT order matching indicators' own priority order (see
      // its doc comment). Without this, a reused element would keep
      // whatever DOM position it was first created at even after its
      // priority rank changed on a later tick, silently feeding decluttering
      // a stale processing order.
      container.appendChild(el);
    });

    for (const [hex, el] of _indicatorEls) {
      if (!seenHexes.has(hex)) {
        el.remove();
        _indicatorEls.delete(hex);
      }
    }
  }

  /**
   * Minimal "something's out there" markers for aircraft the ND-style range
   * selector has dialled past (app.js's selectedRangeIndex/RING_BANDS_NM
   * slice) — still relevant/tracked, just beyond the range the user
   * currently has the plot zoomed to. A real TCAS/ND shows exactly this:
   * traffic beyond the selected range but within its own envelope appears
   * as a plain mark at the display's edge, not a fully-detailed symbol.
   * No shape, no label, no direction arrow — literally just a dot in the
   * aircraft's own visibility colour, at its own bearing, on the plot's
   * outer edge. Position comes for free: Geo.bandedRadiusFraction already
   * clamps anything at/beyond the last active band to radius fraction 1.0,
   * so these items' own ind.x/ind.y (from the SAME Indicators.build() call
   * that produced the full-icon set) already sit exactly on the edge at
   * the correct bearing — this function only decides how to DRAW them.
   *
   * Appended to #indicators-layer rather than clearing it — called right
   * after renderIndicators() each frame, which owns the full icons in the
   * same layer and never touches suppressed-dot elements. Diffed by hex
   * for the same reason renderIndicators() is (see _indicatorEls's own
   * comment): this can run at up to 2-5Hz between GPS fixes and the 500ms
   * extrapolation render tick.
   *
   * @param {Array} items      Same shape as renderIndicators()'s input,
   *   for the subset beyond the selected range — unpaginated, always all
   *   of them (no clutter concern: a bare dot doesn't crowd the display
   *   the way a full label does).
   * @param {function} onClickFn  Same contract as renderIndicators()'s —
   *   still tappable, opens the same popup with full detail even though
   *   nothing is shown by default.
   */
  function renderSuppressedDots(items, onClickFn) {
    const container = document.getElementById("indicators-layer");
    if (!container) return;

    const seenHexes = new Set();

    items.forEach(ind => {
      const hex = ind.aircraft.hex;
      seenHexes.add(hex);

      let el = _suppressedDotEls.get(hex);
      if (el) {
        el.style.left = ind.x + "px";
        el.style.top  = ind.y + "px";
        el.style.background = _displayColor(ind.vis);
        el._clickState.ind = ind;
        el._clickState.onClickFn = onClickFn;
      } else {
        el = document.createElement("div");
        el.className = "suppressed-dot" + (hex === _selectedHex ? " selected" : "");
        el.dataset.hex = hex;
        el.style.left = ind.x + "px";
        el.style.top  = ind.y + "px";
        el.style.background = _displayColor(ind.vis);
        el._clickState = { ind, onClickFn };
        el.addEventListener("click", () => { selectAircraft(hex); el._clickState.onClickFn(el._clickState.ind); });
        container.appendChild(el);
        _suppressedDotEls.set(hex, el);
      }
    });

    for (const [hex, el] of _suppressedDotEls) {
      if (!seenHexes.has(hex)) {
        el.remove();
        _suppressedDotEls.delete(hex);
      }
    }
  }

  /**
   * Cross-highlights an aircraft between the on-plot icon (or suppressed
   * edge dot) and its matching Stage 3 aircraft-list row (spec: "tapping
   * the icon on VCAS highlights the list row and vice versa"). Called from
   * renderIndicators()'s, renderSuppressedDots()'s, and
   * renderAircraftList()'s own click handlers — any of the three can
   * originate a selection, all reflect it.
   */
  function selectAircraft(hex) {
    _selectedHex = hex;
    document.querySelectorAll(".indicator[data-hex], .suppressed-dot[data-hex]").forEach(el => {
      el.classList.toggle("selected", el.dataset.hex === hex);
    });
    const rows = document.querySelectorAll(".raw-list-row[data-hex]");
    rows.forEach(el => el.classList.toggle("selected", el.dataset.hex === hex));
    for (const row of rows) {
      if (row.dataset.hex === hex) { row.scrollIntoView({ block: "nearest" }); break; }
    }
  }

  // Tap-to-deselect (2026-08-24, direct request): tapping anywhere that
  // isn't a selectable element itself, or the detail popup a selection
  // opens (so using the popup's own buttons doesn't clear the highlight
  // underneath it), clears the cross-highlight. Registered once at module
  // load — selection state (_selectedHex) is itself module-level, not tied
  // to any particular render, so this doesn't need re-registering per
  // render either. Runs after the indicator/row/dot's own click handler
  // (none of them stop propagation), so a click that just SET a selection
  // isn't immediately undone by this same listener on the same tap.
  document.addEventListener("click", (e) => {
    if (!_selectedHex) return;
    if (e.target.closest(".indicator, .suppressed-dot, .raw-list-row, #popup")) return;
    selectAircraft(null);
  });

  // 8-point candidate label placement (2026-08-21) — replaces a pure
  // continuous angle-nudge. Modelled on the standard cartographic
  // "point-feature label placement" approach (an NP-hard problem in
  // general; real systems score a small set of discrete candidate
  // positions around each point rather than searching continuously) —
  // scoring 8 fixed compass-direction offsets around each icon by total
  // overlap and picking the best is far more predictable than letting a
  // label settle at an arbitrary in-between angle, and — the actual gap a
  // real-device report exposed in the previous (label-vs-label-only)
  // version — makes it straightforward to check a candidate against
  // EVERY obstacle (every aircraft's icon+arrow, every suppressed dot,
  // every already-placed label), not just other labels. Screenshots
  // showed a label sitting on top of a *different* aircraft's icon/arrow,
  // which a label-vs-label-only check has no way to see as a collision.
  const _LABEL_CANDIDATE_ANGLES_DEG = [0, 45, -45, 90, -90, 135, -135, 180];
  const _LABEL_RADIUS_PX = 24;
  // Leader-line backup tier: a fixed candidate radius has a hard ceiling —
  // in a genuinely dense cluster, no angle around a small fixed circle can
  // avoid every neighbour. Rather than accept overlap (the identification
  // pillar this app exists for makes "which label belongs to which icon"
  // load-bearing in a way TCAS's own collision-avoidance purpose doesn't
  // — worth spending more screen space and an explicit connector line on,
  // a deliberate deviation from real TCAS/ND convention agreed with the
  // project owner), push the label further out along its best-scoring
  // angle in steps until it clears (or the step budget runs out), and
  // draw a thin connecting line back to the icon so the association stays
  // obvious even once the label is no longer tucked right up against it.
  const _LEADER_STEP_PX = 18;
  const _MAX_LEADER_STEPS = 5;
  const _LABEL_OBSTACLE_PADDING_PX = 3;

  function _inflateRect(r, px) {
    return { left: r.left - px, right: r.right + px, top: r.top - px, bottom: r.bottom + px };
  }

  function _rectOverlapArea(a, b) {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }

  /**
   * Nudges apart *rendered* indicator LABELS that visibly overlap — never
   * the icon or its direction arrow, which must always stay exactly where
   * Geo.projectToPolarPosition put them: that point (ind.x/ind.y, i.e.
   * .indicator's own left/top) IS the aircraft's true plotted position,
   * full stop. Call this AFTER renderIndicators() (and renderSuppressedDots(),
   * if called this render — suppressed dots are obstacles too) so the
   * elements actually exist to measure.
   *
   * Processes aircraft in the order given — the SAME priority order
   * Indicators.build() already sorted by and renderIndicators() rendered
   * in — so a higher-priority aircraft's label claims its preferred spot
   * first and a lower-priority one already-placed labels count as an
   * obstacle for takes what's left, rather than fighting over the same
   * candidate. Each aircraft tries its 8 candidate positions in
   * preference order (straight down first, matching the old default, so
   * an uncrowded aircraft's label doesn't move for no reason) and takes
   * the first fully clear one; if none is fully clear, keeps the
   * least-bad candidate's angle and escalates radius until it clears or
   * the step budget runs out, drawing a leader line for that case (see
   * _LEADER_STEP_PX's own comment).
   */
  function declutterRenderedIndicators() {
    const container = document.getElementById("indicators-layer");
    if (!container) return;
    const els = Array.from(container.querySelectorAll(".indicator"));
    if (els.length === 0) return;

    // Fixed obstacles that never move, gathered ONCE up front — every
    // icon, every direction arrow, and every suppressed range-selector edge
    // dot, across the WHOLE layer.
    //
    // Icon and arrow are tracked as TWO SEPARATE obstacles per aircraft
    // (2026-08-24), not one combined .indicator-shape rect — only the icon
    // carries `ownIconExemption: true`, letting an aircraft's OWN label
    // check skip its OWN icon (a label is SUPPOSED to sit close against its
    // own icon, the whole "attached tag" look) while still treating its OWN
    // arrow as a real obstacle. A real device screenshot showed labels
    // sitting on top of their own aircraft's direction arrow — the arrow
    // carries its own glanceable information (which way it's heading) that
    // a label covering it would defeat, so exempting it the same way the
    // icon is exempted was wrong. Every OTHER aircraft's icon and arrow are
    // real obstacles for a label either way, exempt or not.
    //
    // Missing the icon exemption entirely, the first time this obstacle set
    // was built, made even a single isolated aircraft with nothing else on
    // screen register a false self-overlap and escalate straight to a
    // leader line — caught by testing an isolated-aircraft case
    // specifically, not just crowded ones; still guarded against here.
    const fixedObstacles = [];
    els.forEach(el => {
      const hex = el.dataset.hex;
      const icon = el.querySelector(".indicator-icon");
      if (icon) {
        fixedObstacles.push({ hex, ownIconExemption: true, rect: _inflateRect(icon.getBoundingClientRect(), _LABEL_OBSTACLE_PADDING_PX) });
      }
      const arrow = el.querySelector(".direction-arrow");
      if (arrow) {
        fixedObstacles.push({ hex, ownIconExemption: false, rect: _inflateRect(arrow.getBoundingClientRect(), _LABEL_OBSTACLE_PADDING_PX) });
      }
    });
    container.querySelectorAll(".suppressed-dot").forEach(el => {
      fixedObstacles.push({ hex: el.dataset.hex, ownIconExemption: false, rect: _inflateRect(el.getBoundingClientRect(), _LABEL_OBSTACLE_PADDING_PX) });
    });

    const items = els.map(el => {
      const hex = el.dataset.hex;
      const iconX = parseFloat(el.style.left) || 0;
      const iconY = parseFloat(el.style.top) || 0;
      const label = el.querySelector(".indicator-label");
      const rect = label.getBoundingClientRect(); // width/height only — position is about to be overwritten regardless
      return { el, label, hex, iconX, iconY, labelW: rect.width, labelH: rect.height };
    });

    function rectAt(item, radius, angleDeg) {
      const rad = (angleDeg * Math.PI) / 180;
      const cx = item.iconX + radius * Math.sin(rad);
      const cy = item.iconY + radius * Math.cos(rad);
      return { left: cx - item.labelW / 2, right: cx + item.labelW / 2, top: cy - item.labelH / 2, bottom: cy + item.labelH / 2 };
    }

    function totalOverlap(rect, obstacles) {
      let sum = 0;
      for (const o of obstacles) sum += _rectOverlapArea(rect, o);
      return sum;
    }

    const placedLabelRects = [];

    items.forEach(item => {
      // Exclude only THIS aircraft's own icon (ownIconExemption) — its own
      // arrow, and everything belonging to every other aircraft, stay in
      // the obstacle set. See fixedObstacles' own comment above.
      const obstacles = fixedObstacles
        .filter(o => !(o.hex === item.hex && o.ownIconExemption))
        .map(o => o.rect)
        .concat(placedLabelRects);

      let bestAngle = _LABEL_CANDIDATE_ANGLES_DEG[0];
      let bestOverlap = Infinity;
      let bestRect = rectAt(item, _LABEL_RADIUS_PX, bestAngle);
      for (const angleDeg of _LABEL_CANDIDATE_ANGLES_DEG) {
        const rect = rectAt(item, _LABEL_RADIUS_PX, angleDeg);
        const overlap = totalOverlap(rect, obstacles);
        if (overlap < bestOverlap) {
          bestOverlap = overlap; bestAngle = angleDeg; bestRect = rect;
          if (overlap === 0) break; // first clear candidate wins, in preference order
        }
      }

      let finalRadius = _LABEL_RADIUS_PX;
      let finalRect = bestRect;
      let usedLeader = false;
      if (bestOverlap > 0) {
        // All 8 candidates still collide with something — escalate along
        // the least-bad angle rather than searching a whole new angle set
        // at every radius (cheaper, and keeps the label moving in one
        // consistent direction instead of jumping around).
        for (let step = 1; step <= _MAX_LEADER_STEPS; step++) {
          const radius = _LABEL_RADIUS_PX + step * _LEADER_STEP_PX;
          const rect = rectAt(item, radius, bestAngle);
          const overlap = totalOverlap(rect, obstacles);
          usedLeader = true;
          finalRadius = radius;
          finalRect = rect;
          if (overlap === 0) break; // else keep going — last step's position (least overlap reachable) is accepted
        }
      }

      placedLabelRects.push(_inflateRect(finalRect, _LABEL_OBSTACLE_PADDING_PX));

      const rad = (bestAngle * Math.PI) / 180;
      const dx = finalRadius * Math.sin(rad), dy = finalRadius * Math.cos(rad);
      // Offsets relative to .indicator's own origin (its icon, at (0,0) in
      // this local frame) — NOT absolute viewport coordinates, since
      // .indicator-label is positioned relative to its .indicator parent.
      item.label.style.left = dx + "px";
      item.label.style.top  = dy + "px";
      item.label.style.transform = "translate(-50%, -50%)";

      let leader = item.el.querySelector(".indicator-leader");
      if (usedLeader) {
        if (!leader) {
          leader = document.createElement("div");
          leader.className = "indicator-leader";
          item.el.insertBefore(leader, item.el.firstChild); // paints below the shape/label
        }
        leader.style.background = item.label.style.borderColor || "";
        leader.style.width = Math.hypot(dx, dy) + "px";
        leader.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
        leader.style.display = "";
      } else if (leader) {
        leader.style.display = "none";
      }
    });
  }

  function clearIndicators() {
    const container = document.getElementById("indicators-layer");
    if (container) container.innerHTML = "";
    // Must be reset alongside the DOM wipe above — otherwise renderIndicators()/
    // renderSuppressedDots() would think a hex's element is still attached
    // (it's in the map) and try to reuse/reposition a node that's no longer
    // in the document instead of creating and appending a fresh one.
    _indicatorEls.clear();
    _suppressedDotEls.clear();
  }

  // Range rings are now real map layers (see map.js's EosMap.updateRangeRings/
  // clearRangeRings) instead of a screen-space SVG overlay here — drawn as
  // true circles around the user's actual lat/lon so panning/zooming/rotating
  // the map carries them along naturally, the same as the route line.

  // ---- NAV Raw-mode heading/compass tape ----

  /**
   * ND-style heading tape — Raw mode only (per the reference image), since
   * Hybrid's rotating road map already carries its own orientation cues a
   * bare basemap doesn't have. Curved along an arc centred on the SAME
   * anchor point the range rings/aircraft dots use (round 8 follow-up,
   * 2026-09-08, matching the design draft directly: real ND tapes and this
   * app's own range rings both curve around the ownship anchor, so a FLAT
   * horizontal tape sitting above a domed ring was always a mismatch, just
   * not a visually obvious one until compared side-by-side against the
   * draft). Tick marks radiate outward from the anchor like clock hands —
   * a tick at relative bearing 0 points straight up, one at +75° points
   * off to the upper-right, etc. — rather than sliding along a straight
   * line. A fixed lubber line still marks dead-ahead (current heading,
   * always centred, since Raw is heading-up); ticks/labels rotate past it
   * as the vehicle turns, same convention as a real EFIS heading tape.
   * Minor ticks every 10°, labelled major ticks every 30°, labels shortened
   * to tens-shorthand (e.g. 070° → "7", 140° → "14") matching the draft's
   * own compact digit-only labels — a real ND has no room for 3-digit
   * headings on a curved tape this tight.
   *
   * @param {number} cx, cy       The SAME anchor point renderRangeRingsOverlay/
   *   renderRouteLine use (Geo.computePlotLayout's own plot centre/anchorY)
   *   — sharing this exact point, not a second independently-derived one,
   *   is what guarantees the tape's curve always agrees with the rings'
   *   own curve, the same "one shared source" discipline this codebase
   *   already applies to the rings-vs-dots scale.
   * @param {number} tapeRadius   Arc radius the ticks are drawn along —
   *   app.js derives this so the dead-ahead tick sits at the same y the
   *   old flat tape's tickTopY did, just curving now rather than running
   *   straight across.
   * @param {number} headingDeg   Current true heading, any real number
   *   (wrapped to [0, 360) internally).
   * @param {number} fovHalfAngleDeg  Angular half-span either side of dead
   *   ahead — the SAME Indicators.FOV_HALF_ANGLE_DEG the rings/dots are
   *   restricted to, so the tape's own ends land exactly where the rings'
   *   arc ends rather than over- or under-shooting it.
   * @param {object} [vehicleInfo]  { speedMph, leftX }. Drawn as a compact
   *   strip below the heading tape's own tick labels — RAW's equivalent of
   *   a real ND's flight-data strip (GS/TAS/ILS APP/arrival time), reduced
   *   here to just the one figure that's always relevant regardless of
   *   whether a route is active. Omit for no strip. Destination/distance/
   *   ETA moved out of this strip 2026-09-06 — that's now the merged
   *   top nav-status card (#nav-guidance-card + #route-card, see
   *   app.js's _rawChromeInsets()/VCAS.css's RAW overrides) rather than
   *   a second copy living here too. `leftX` (round 6, 2026-09-08) left-
   *   aligns the strip at that x instead of centring it on the viewport —
   *   app.js passes the square's own left margin so this sits in the same
   *   left column as the LOG button, per direct instruction that the
   *   speed readout should move left while staying on the same row.
   */
  function renderCompassRing(cx, cy, tapeRadius, headingDeg, fovHalfAngleDeg, vehicleInfo = null) {
    const svg = document.getElementById("nav-compass-ring");
    if (!svg) return;

    const heading = ((headingDeg % 360) + 360) % 360;
    const halfSpanDeg = fovHalfAngleDeg;
    const startDeg = Math.ceil((heading - halfSpanDeg) / 10) * 10;
    const endDeg = heading + halfSpanDeg;

    // Topmost point of the arc (relative bearing 0, i.e. dead ahead) —
    // where the lubber line/digital heading readout anchor, matching the
    // old flat tape's "everything fixed above tickTopY, centred" layout.
    const topX = cx, topY = cy - tapeRadius;

    // Only ever rendered while Raw is active (see app.js's call site) and
    // Raw's basemap is always forced near-black regardless of Day/Night/
    // Auto — fixed dark-appropriate colours here, not var(--text-secondary)
    // etc., which would follow the resolved theme and wash out on Day.
    // Near-white ticks/labels and a yellow lubber line are pixel-sampled
    // straight from a real ND reference photo's own heading tape.
    let ticks = "";
    for (let deg = startDeg; deg <= endDeg; deg += 10) {
      const wrapped = ((deg % 360) + 360) % 360;
      const relDeg = deg - heading;
      const theta = (relDeg * Math.PI) / 180;
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      const isMajor = wrapped % 30 === 0;
      const tickH = isMajor ? COMPASS_MAJOR_TICK_H : 8;

      // Ticks point outward (away from the anchor), same "radiating like
      // clock hands" composition the range rings' own labels already use.
      const innerX = cx + tapeRadius * sinT, innerY = cy - tapeRadius * cosT;
      const outerR = tapeRadius + tickH;
      const outerX = cx + outerR * sinT, outerY = cy - outerR * cosT;
      ticks += `<line x1="${innerX}" y1="${innerY}" x2="${outerX}" y2="${outerY}"
                  style="stroke:#f0f0f0" stroke-width="1.5" opacity="0.7"/>`;
      if (isMajor) {
        // Tens-shorthand (070° -> "7", 140° -> "14") — a real ND's curved
        // tape has no room for 3-digit headings, matching the draft.
        const label = String(wrapped / 10);
        const labelR = outerR + 12;
        const lx = cx + labelR * sinT, ly = cy - labelR * cosT;
        ticks += `<text x="${lx}" y="${ly}" text-anchor="middle"
                    style="fill:#f0f0f0; font-size:12px" opacity="0.85">${label}</text>`;
      }
    }

    // Fixed lubber line — points down at dead-ahead's own arc point,
    // always centred (heading-up, so dead-ahead never moves).
    const pointer = `<path d="M ${topX - 7} ${topY - 16} L ${topX + 7} ${topY - 16} L ${topX} ${topY - 2} Z"
                fill="#ffff00" opacity="0.9"/>`;

    const hdgRounded = Math.round(heading) % 360;
    const digital = `<text x="${topX}" y="${topY - 22}" text-anchor="middle"
                style="fill:#f0f0f0; font-size:14px; font-weight:600">${String(hdgRounded).padStart(3, "0")}</text>`;

    let infoStrip = "";
    if (vehicleInfo) {
      // One shared <text> assignment per call (svg.innerHTML is set once,
      // below) rather than a separate render call, so this can never
      // clobber — or be clobbered by — the tape markup above.
      //
      // The range rings' own "2/5/10/15" labels are a completely separate
      // rendering system with no position awareness of this strip or vice
      // versa — an opaque background plate keeps this legible regardless
      // of what a ring label does around it, same reasoning the indicator
      // labels already use for the same "something else might be behind
      // this" problem.
      const stripY = topY + 14 + 14 + 20;
      const speedValue = String(Math.round(vehicleInfo.speedMph));
      const speedLabel = `SPD ${speedValue} MPH`;

      // No live text measurement available for a string injected via
      // innerHTML — a rough monospace-ish per-character estimate, generous
      // enough not to clip real content, not trying to be pixel-perfect.
      const boxW = speedLabel.length * 7.2 + 28;
      // Left-aligned (round 6, 2026-09-08, direct instruction: "the speed
      // should stay at the same latitude but move to the left of the
      // screen") when the caller supplies leftX (app.js passes the same
      // square-relative margin the LOG button already uses, so the two
      // sit on one visually-grouped left column); falls back to centred
      // on the arc's own top point if omitted.
      const x0 = vehicleInfo.leftX != null ? vehicleInfo.leftX : topX - boxW / 2;
      const bg = `<rect x="${x0}" y="${stripY - 17}" width="${boxW}" height="26" rx="4"
                  fill="rgba(14,17,23,.82)"/>`;
      // The numeric value alone gets its own <tspan> so it can be coloured
      // green (matching the design draft's own colour-coded readout —
      // see VCAS.css's --raw-value-green) independent of the "SPD"/"MPH"
      // labels around it, which stay the tape's usual near-white.
      const textX = vehicleInfo.leftX != null ? x0 + 14 : topX;
      const textAnchor = vehicleInfo.leftX != null ? "start" : "middle";
      const text = `<text x="${textX}" y="${stripY}" text-anchor="${textAnchor}"
                  style="fill:#f0f0f0; font-size:13px; font-weight:600; letter-spacing:0.5px">SPD <tspan style="fill:var(--raw-value-green)">${speedValue}</tspan> MPH</text>`;
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
   * @param {number} plotLeft, plotTop, plotWidth, plotHeight  The plot
   *   region (Geo.computePlotLayout) — same region the dots plot within,
   *   not the raw viewport, so an aircraft's dot and the ring around it
   *   always agree by construction. No longer necessarily square — see
   *   computePlotLayout's own doc comment (2026-09-08) for why plotWidth
   *   and plotHeight can now differ.
   * @param {number[]} bandsNm         Same array Indicators.RING_BANDS_NM
   *   and the dots' own Geo.projectToPolarPosition call use.
   * @param {number} fovHalfAngleDeg   Same Indicators.FOV_HALF_ANGLE_DEG
   *   the dots are restricted to.
   */
  function renderRangeRingsOverlay(plotLeft, plotTop, plotWidth, plotHeight, anchorY, safeInset, bandsNm, fovHalfAngleDeg, color) {
    const svg = document.getElementById("nav-range-rings-overlay");
    if (!svg) return;

    const cx = plotLeft + plotWidth * 0.5;
    const cy = plotTop + plotHeight * anchorY;
    const plotRadius = Geo.circularPlotRadius(plotWidth, plotHeight, anchorY, safeInset, fovHalfAngleDeg);
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

  // Same RAW route green EosMap uses for the real (Hybrid-only, see
  // map.js's _applyRouteVisibility) geo-referenced route line — duplicated
  // as a literal since ui.js and map.js have no shared palette module to
  // both read from; keep in sync by hand if it's ever re-picked.
  const ROUTE_LINE_COLOR = "#00c800";
  const ROUTE_LINE_MAX_POINTS = 30; // "rudimentary" per spec — a hard cap, not exact clipping

  /**
   * RAW's own screen-space flight-plan line — a rudimentary equivalent of a
   * real ND's green route line, direct instruction (2026-09-06): "if
   * navigation is on there should be a rudimentary line like appears on
   * the actual ND screen." Deliberately NOT the real geo-referenced
   * MapLibre route line EosMap already draws (map.js's showRoute/
   * _initRouteLayer) — that line plots on the map's real geographic zoom,
   * which is NOT the same scale RAW's aircraft dots/range rings use (see
   * "Rings and dots share one scale now" in CLAUDE.md for the full history
   * of exactly this mismatch, previously hit and fixed for the range rings
   * themselves). map.js hides the real route line whenever RAW is active
   * for exactly this reason; this function is RAW's own scale-consistent
   * replacement, built from the identical Geo.projectToPolarPosition call
   * (and identical anchor/scale/FOV params) the aircraft dots use, so a
   * turn plotted here can never disagree with where the rings/dots put the
   * same real-world distance.
   *
   * @param {number[][]} coords   Route geometry coordinates AHEAD of the
   *   user, [lon,lat][], already sliced by the caller (app.js) from the
   *   user's current snapped position forward — this function does not
   *   snap/slice, it only projects and draws what it's given.
   * @param {number} userLat, userLon, userHeading
   * @param {number} plotLeft, plotTop, plotWidth, plotHeight  Same plot
   *   region the dots/rings use (Geo.computePlotLayout) — no longer
   *   necessarily square, see that function's own doc comment.
   * @param {number} anchorY, safeInset   Same values passed to the dots'
   *   own Geo.projectToPolarPosition calls (Indicators._computeAll).
   * @param {number[]} bandsNm   Same array the range rings/dots use.
   * @param {number} fovHalfAngleDeg   Same FOV the dots are restricted to.
   * @param {number|null} turnIndex   Index into `coords` (post-slice) where
   *   the next maneuver happens, or null if unknown.
   * @param {string} turnLabel   Plain street/junction name for the turn
   *   (ManeuverTracker's own `.name`, NOT the full `.instruction` sentence
   *   the guidance card shows) — drawn only if `turnIndex` is on-screen.
   */
  function renderRouteLine(coords, userLat, userLon, userHeading, plotLeft, plotTop, plotWidth, plotHeight, anchorY, safeInset, bandsNm, fovHalfAngleDeg, turnIndex, turnLabel) {
    const svg = document.getElementById("nav-route-line-overlay");
    if (!svg) return;
    if (!Array.isArray(coords) || coords.length === 0) { clearRouteLine(); return; }

    const points = [];
    let turnPoint = null;
    for (let i = 0; i < coords.length && points.length < ROUTE_LINE_MAX_POINTS; i++) {
      const [lon, lat] = coords[i];
      const bearing = Geo.calculateBearing(userLat, userLon, lat, lon);
      const relativeBearing = Geo.calculateRelativeBearing(bearing, userHeading);
      const rangeNm = Geo.calculateDistanceNm(userLat, userLon, lat, lon);
      const pos = Geo.projectToPolarPosition(relativeBearing, rangeNm, plotWidth, plotHeight, bandsNm, anchorY, safeInset, fovHalfAngleDeg, plotLeft, plotTop);
      if (!pos) break; // outside the FOV — the route has turned away from dead-ahead; stop rather than exact-clip
      points.push(pos);
      if (turnIndex != null && i === turnIndex) turnPoint = pos;
    }

    if (points.length < 2) { clearRouteLine(); return; }

    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    let markup = `<path d="${d}" fill="none" stroke="${ROUTE_LINE_COLOR}" stroke-width="2.5"
                    stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`;

    if (turnPoint && turnLabel) {
      markup += `<text x="${turnPoint.x}" y="${turnPoint.y - 8}" text-anchor="middle"
                    style="fill:${ROUTE_LINE_COLOR}; font-size:11px; font-weight:600"
                    opacity="0.9">${_escapeHtml(turnLabel)}</text>`;
    }

    svg.innerHTML = markup;
    svg.classList.remove("hidden");
  }

  function clearRouteLine() {
    const svg = document.getElementById("nav-route-line-overlay");
    if (svg) { svg.innerHTML = ""; svg.classList.add("hidden"); }
  }

  // ---- RAW mode range selector ----

  /**
   * ND-style range knob equivalent — a real A320-family EFIS control panel
   * has a physical knob next to the ND that cycles its displayed range; a
   * touchscreen has no separate hardware for that, so this is a small
   * tappable readout sitting in the corner of the square plot itself
   * (matching where a real ND prints its own current range) rather than a
   * separate floating control that would need its own layout negotiation
   * against the Stage 3 list panel. Positioned by the caller (app.js) from
   * the SAME square layout the plot/rings use, so it always sits inside
   * the square regardless of portrait/landscape.
   *
   * @param {number} x, y      Top-right corner of the square, in viewport px.
   * @param {number} rangeNm   Current selected range (one of
   *   Indicators.RING_BANDS_NM) — displayed as e.g. "10NM".
   * @param {function} onClick  Called with no args on tap; app.js advances
   *   to the next preset and re-renders.
   */
  function renderRangeSelector(x, y, rangeNm, onClick) {
    const btn = document.getElementById("btn-raw-range");
    if (!btn) return;
    btn.textContent = rangeNm + "NM";
    btn.style.left = x + "px";
    btn.style.top  = y + "px";
    btn.onclick = onClick; // overwritten each render, not addEventListener — avoids stacking a new listener every frame
    btn.classList.remove("hidden");
  }

  function clearRangeSelector() {
    const btn = document.getElementById("btn-raw-range");
    if (btn) btn.classList.add("hidden");
  }

  /**
   * RAW-only slate chrome backdrop behind the aircraft-list panel's own
   * region — see index.html's comment on #raw-rows-backdrop for why this
   * exists. Takes the exact same `rowsRect` (Geo.computePlotLayout's
   * `rows`) renderAircraftList() does, unlike that function it does NOT
   * apply PANEL_MARGIN_PX — this is a full-bleed backdrop filling the
   * whole rows rect, with the (smaller, margined) list panel drawing on
   * top of it.
   *
   * Hides under the exact same MIN_PANEL_WIDTH_PX/MIN_PANEL_HEIGHT_PX gate
   * renderAircraftList() uses (declared below, but already initialised by
   * the time this is ever actually called) — a real bug found on a real
   * device (2026-09-08): this used to show unconditionally, so on a
   * screen where the rows region was too small for the list panel itself
   * to render, the result was a big empty slate rectangle with nothing in
   * it instead of either a real list or nothing at all.
   */
  function renderRowsBackdrop(rowsRect) {
    const el = document.getElementById("raw-rows-backdrop");
    if (!el) return;
    if (rowsRect.width < MIN_PANEL_WIDTH_PX || rowsRect.height < MIN_PANEL_HEIGHT_PX) {
      el.classList.add("hidden");
      return;
    }
    el.style.left   = rowsRect.left + "px";
    el.style.top    = rowsRect.top + "px";
    el.style.width  = rowsRect.width + "px";
    el.style.height = rowsRect.height + "px";
    el.classList.remove("hidden");
  }

  function clearRowsBackdrop() {
    const el = document.getElementById("raw-rows-backdrop");
    if (el) el.classList.add("hidden");
  }

  // ---- RAW mode aircraft list panel (Stage 3) ----

  // Below these dimensions there isn't room to show callsign+type+altitude+
  // range legibly (or even a header + a single row) — the panel hides
  // entirely rather than render an unreadably-cramped sliver. Height
  // bumped from 70 (2026-09-08) now that the panel has a title bar again
  // (see renderAircraftList's own doc comment) — that alone eats ~30px,
  // so the old threshold could leave room for a header but no actual row.
  const MIN_PANEL_WIDTH_PX = 90;
  const MIN_PANEL_HEIGHT_PX = 100;
  const PANEL_MARGIN_PX = 8;

  /**
   * Aircraft-list panel, RAW mode only — fills the rectangle
   * complementary to the plot (Geo.computePlotLayout's
   * `rows`): below the square on portrait screens (square = full width),
   * to its right on landscape screens (square = full height). Direct
   * instruction: the plot is a fixed-aspect instrument, not a shape that
   * stretches to soak up the whole screen — whatever's left over is
   * exactly this panel's own region, not something it has to go compute
   * "is there room" for itself the way the pre-square version did.
   * Hidden entirely — not just empty — when that region is too small to
   * be legible; see MIN_PANEL_WIDTH_PX/MIN_PANEL_HEIGHT_PX.
   *
   * @param {Array} items       Same shape as Indicators.build()'s output,
   *   in Indicators.build()'s own priority order (visibility score desc,
   *   then proximity) — this function renders in the order given and
   *   doesn't re-sort. Re-sorting was removed 2026-09-06 (direct
   *   instruction): "less interaction" is the right default for an
   *   Android-Auto-bound list, so the panel is always most-visible-first
   *   now, matching the plot's own icon-priority order exactly rather than
   *   letting the two diverge. A plain, non-interactive "AIRCRAFT NEARBY
   *   {count}" title bar was added back 2026-09-08 (per the same design
   *   draft as the rest of this round) — this is a label, not a control,
   *   so it doesn't reopen the "less interaction" concern the sort
   *   buttons above were actually about; `items.length` is this panel's
   *   own full relevant-set count, which can legitimately differ from the
   *   bottom bar's own `aircraft-count` figure (they've always represented
   *   different things — see app.js's own notes on `withinRange` vs
   *   `allRelevant`).
   * @param {object} rowsRect   { left, top, width, height } — the exact
   *   region to fill, straight from Geo.computePlotLayout(...).rows.
   * @param {function} onRowClick   Called with the indicator item (same
   *   shape renderIndicators()'s onClickFn receives) when a row is tapped.
   * @param {Set<string>} [beyondRangeHexes]  Hex codes currently beyond the
   *   ND-style range selector's selected range (see renderSuppressedDots) —
   *   the list still shows every relevant aircraft regardless of range, but
   *   these get a dimmed row so it's clear why they have no full plot icon
   *   of their own right now, just an edge dot (or nothing, if outside the
   *   FOV entirely).
   */
  function renderAircraftList(items, rowsRect, onRowClick, beyondRangeHexes) {
    const panel = document.getElementById("raw-aircraft-list");
    if (!panel) return;

    if (rowsRect.width < MIN_PANEL_WIDTH_PX || rowsRect.height < MIN_PANEL_HEIGHT_PX) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }

    panel.style.left   = (rowsRect.left + PANEL_MARGIN_PX) + "px";
    panel.style.top    = (rowsRect.top + PANEL_MARGIN_PX) + "px";
    panel.style.width  = (rowsRect.width - PANEL_MARGIN_PX * 2) + "px";
    panel.style.height = (rowsRect.height - PANEL_MARGIN_PX * 2) + "px";

    const rows = items.length === 0
      ? `<div class="raw-list-empty">No traffic</div>`
      : items.map(ind => {
          const a = ind.aircraft;
          const callsign = _escapeHtml(a.callsign || a.hex);
          const type = a.type ? _escapeHtml(a.type) : "—";
          const altLabel = a.altitudeFt != null ? `${Math.round(a.altitudeFt).toLocaleString()}ft` : "—";
          const rangeLabel = `${ind.distanceNm.toFixed(1)}nm`;
          const color = _displayColor(ind.vis);
          const selected = a.hex === _selectedHex ? " selected" : "";
          const beyondRange = beyondRangeHexes && beyondRangeHexes.has(a.hex) ? " beyond-range" : "";
          return `
            <div class="raw-list-row${selected}${beyondRange}" data-hex="${_escapeHtml(a.hex)}">
              <div class="rlr-chevron" style="color:${color}">&#10094;</div>
              <div class="rlr-info">
                <div class="rlr-callsign">${callsign}</div>
                <div class="rlr-meta">${type} · ${altLabel} · ${rangeLabel}</div>
              </div>
            </div>`;
        }).join("");

    const titleBar = `<div class="raw-list-title-bar">AIRCRAFT NEARBY <span class="raw-list-title-count">${items.length}</span></div>`;
    panel.innerHTML = `${titleBar}<div class="raw-list-body">${rows}</div>`;

    panel.querySelectorAll(".raw-list-row[data-hex]").forEach(rowEl => {
      const hex = rowEl.dataset.hex;
      const ind = items.find(it => it.aircraft.hex === hex);
      if (!ind) return;
      rowEl.addEventListener("click", () => { selectAircraft(hex); onRowClick(ind); });
    });

    panel.classList.remove("hidden");
  }

  function clearAircraftList() {
    const panel = document.getElementById("raw-aircraft-list");
    if (panel) { panel.classList.add("hidden"); panel.innerHTML = ""; }
  }

  // ---- Popup ----

  /**
   * Same distraction/safety gate as logPanel.js's own LOG button
   * (2026-08-24) — extended here since the popup's log-outcome and Suppress
   * buttons are the SAME kind of "read a list, tap a specific action"
   * interaction the LOG panel gate exists to prevent, just reached via
   * tapping an aircraft instead of the LOG toggle. Deliberately does NOT
   * gate the popup's existence or its read-only info (distance/altitude/
   * bearing/vis badge) — glancing at that is core identification
   * functionality, not the distraction risk being mitigated; only the
   * action buttons that record/suppress something are disabled.
   */
  function _actionsInteractive() {
    return _speedMph <= CONFIG.GPS_HEADING_MIN_SPEED_MPH;
  }

  /** Shared row of ground-truth log buttons, embedded in both popups below. */
  function _logButtonsHtml() {
    const disabled = _actionsInteractive() ? "" : " pop-action-disabled";
    return `
      <div class="pop-log-actions">
        ${ObservationLogger.OUTCOMES.map(o =>
          `<button type="button" class="pop-log-btn${disabled}" data-outcome="${o.code}" title="${o.title}">${o.label}</button>`
        ).join("")}
      </div>`;
  }

  function _wireLogButtons(el, onLogOutcome) {
    if (!onLogOutcome) return;
    el.querySelectorAll(".pop-log-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!_actionsInteractive()) return; // see _actionsInteractive()
        onLogOutcome(btn.dataset.outcome);
        btn.classList.add("pop-log-btn-done");
        setTimeout(() => btn.classList.remove("pop-log-btn-done"), 600);
      });
    });
  }

  /**
   * Called from app.js's applySpeedOverrideIfActive(), alongside
   * LogPanel.setSpeedMph() — updates any ALREADY-OPEN popup's action
   * buttons live (without a full re-render) so a popup opened while
   * stationary correctly disables its own buttons the moment you start
   * moving, not just on the next tap.
   */
  function setSpeedMph(mph) {
    _speedMph = mph;
    const interactive = _actionsInteractive();
    document.querySelectorAll(".pop-log-btn, .pop-suppress-btn").forEach(btn => {
      btn.classList.toggle("pop-action-disabled", !interactive);
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
        <button type="button" class="pop-suppress-btn${_actionsInteractive() ? "" : " pop-action-disabled"}">Suppress</button>
      </div>` : ""}`;

    _wireLogButtons(el, onLogOutcome);

    if (onSuppressClick) {
      el.querySelector(".pop-suppress-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!_actionsInteractive()) return; // see _actionsInteractive()
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
    setMetarStatus,
    setMaptilerStatus,
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
    renderSuppressedDots,
    declutterRenderedIndicators,
    setSpeedMph,
    clearIndicators,
    selectAircraft,
    renderCompassRing,
    clearCompassRing,
    COMPASS_MAJOR_TICK_H,
    renderRangeRingsOverlay,
    clearRangeRingsOverlay,
    renderRouteLine,
    clearRouteLine,
    renderRangeSelector,
    clearRangeSelector,
    renderAircraftList,
    clearAircraftList,
    renderRowsBackdrop,
    clearRowsBackdrop,
    showPopup,
    showAirPopup,
    hidePopup,
  };
})();

if (typeof module !== "undefined") module.exports = UI;