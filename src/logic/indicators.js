/**
 * Builds sorted, filtered indicator data for the Driving View.
 */

const Indicators = (() => {
  // Viewport-tiered NAV display cap — small phone screens stay glanceable
  // with fewer indicators; larger tablet/infotainment-style displays have
  // room for more before it becomes clutter.
  const NAV_CAP_SMALL_MAX_WIDTH  = 500; // px, exclusive
  const NAV_CAP_MEDIUM_MAX_WIDTH = 900; // px, inclusive
  const NAV_CAP_SMALL  = 5;
  const NAV_CAP_MEDIUM = 7;
  const NAV_CAP_LARGE  = 10;

  /**
   * @param {number} width  Viewport width in px (real or emulated).
   * @returns {number} Max NAV indicators to show at that width.
   */
  function capForViewportWidth(width) {
    if (width < NAV_CAP_SMALL_MAX_WIDTH) return NAV_CAP_SMALL;
    if (width <= NAV_CAP_MEDIUM_MAX_WIDTH) return NAV_CAP_MEDIUM;
    return NAV_CAP_LARGE;
  }

  /**
   * True polar plot range — the distance (nm) that maps to the full
   * available radius from the anchor. Reuses Relevance's own dead-ahead
   * teardrop range rather than a separate made-up number, so the plotted
   * scale actually means something: an aircraft at the plot's outer edge is
   * an aircraft at (or beyond) the edge of relevance for that bearing.
   *
   * This is `rangeExtensionCapNm` (50), not the base `rMaxNm` (15) —
   * updated 2026-08-21 alongside the contrail-visibility work. Before that,
   * relevance never reached past 15nm for anything, so tying the plot's
   * scale to 15 and to relevance's own max were the same thing. Now a
   * high-altitude aircraft can be relevant out to 50nm, and leaving the
   * plot's own scale capped at 15 meant every one of those aircraft —
   * regardless of whether it was 16nm or 46nm away — clamped to the exact
   * same outer-edge radius: no differentiation, no correlation with the
   * range rings, and (with several of them at once) no room to avoid their
   * labels overlapping either. Reported directly against the deployed app.
   */
  const POLAR_MAX_RANGE_NM = Relevance.DEFAULTS.rangeExtensionCapNm;

  /**
   * Ring band boundaries (nm) for the plot's non-linear distance scale —
   * see Geo.bandedRadiusFraction(). Each band gets an equal slice of the
   * available radius regardless of its real nm width, so close traffic
   * (where resolving "is this one a bit closer than that one" actually
   * matters) gets more usable screen space than a strictly linear scale
   * would give it, while distant traffic still visibly separates into "how
   * far, roughly" bands instead of a single distant blob. The final band
   * (15 to POLAR_MAX_RANGE_NM/50) is deliberately wide — it only ever holds
   * high-altitude/contrail-relevant traffic (see relevance.js), which is
   * inherently sparser than low-altitude local traffic, so one wide band
   * is enough to keep them from collapsing onto the exact same point
   * without needing the same fine-grained resolution the close bands have.
   * The map's own range rings (EosMap.updateRangeRings, real geo circles)
   * are drawn at these same nm values, but a 50nm ring's true geo radius
   * doesn't fit on screen at RAW's zoom regardless — same as the 15nm ring
   * already sometimes doesn't (see "Range rings" below) — so it's harmless
   * that it's declared here even though it'll rarely if ever actually be
   * visible; the banded *plot position* for far traffic is the part that
   * matters.
   */
  const RING_BANDS_NM = [2, 5, 10, 15, POLAR_MAX_RANGE_NM];

  /**
   * Half-angle (deg) of RAW mode's forward field of view — 75° either side
   * of dead-ahead, ~150° total, matching a real TCAS/ND reference photo
   * (which shows a forward arc, never a full 360° sweep) and RAW's own
   * rationale: it exists to show what's ahead while driving, not a
   * behind-the-vehicle picture. Passed through as userState.fovHalfAngleDeg
   * by RAW's caller only — Hybrid's edge indicators have no "round display"
   * to fit an arc into and keep the full teardrop Relevance computes.
   */
  const FOV_HALF_ANGLE_DEG = 75;

  /**
   * Shared per-aircraft computation used by both build() and buildAll() —
   * bearing/distance/visibility/relevance/polar screen position/direction-
   * of-travel, for every aircraft that passes the hard staleness cutoff.
   * Does NOT filter by relevance or suppression; callers decide what to do
   * with that.
   */
  function _computeAll(aircraftList, userState, staleThresholdSeconds) {
    const { lat, lon, heading, viewportWidth, viewportHeight, metar } = userState;
    // Must match what the camera actually used for this frame (see
    // CameraController/geo.js's projectToPolarPosition doc comment) or the
    // plotted origin silently drifts from where the user marker and range
    // rings really are. anchorY defaults to projectToPolarPosition's own
    // default (0.8) if the caller didn't evaluate a camera frame yet (e.g.
    // before the first followNav() call); safeInset likewise falls back to
    // its own default.
    const anchorY = userState.anchorY;
    const fovHalfAngleDeg = userState.fovHalfAngleDeg;
    // RAW's plot lives inside a 1:1 square sub-region of the real viewport
    // (Geo.computeSquarePlotLayout), not the full viewport itself — these
    // default back to the plain viewport with no offset when unset, so
    // Hybrid (which never sets them) is completely unaffected.
    const plotWidth = userState.plotWidth != null ? userState.plotWidth : viewportWidth;
    const plotHeight = userState.plotHeight != null ? userState.plotHeight : viewportHeight;
    const plotOffsetX = userState.plotOffsetX || 0;
    const plotOffsetY = userState.plotOffsetY || 0;
    // safeInset means "real chrome height to stay clear of" for Hybrid's
    // unrestricted, full-viewport teardrop — but the square ALREADY
    // excludes all real chrome from its own bounds (see app.js's
    // _rawChromeInsets), so reusing that same ~60-100px value as margin
    // WITHIN the square would carve out a needlessly huge chunk of a
    // region that's already chrome-free. plotSafeInset (set only for RAW)
    // is a small fixed in-square margin instead; falling back to safeInset
    // keeps Hybrid's existing behaviour exactly as it was.
    const safeInset = userState.plotSafeInset != null ? userState.plotSafeInset : userState.safeInset;
    // The user-selectable ND-style range knob (app.js's selectedRangeIndex)
    // overrides which band boundaries are "in play" for THIS render — e.g.
    // dialled down to 10nm, bandsNm becomes [2,5,10] instead of the full
    // [2,5,10,15,50], so bandedRadiusFraction's own existing clamp-to-1.0
    // behaviour (anything at/beyond the last band plots at the outer edge)
    // is what naturally produces the "suppressed edge dot" position for
    // traffic beyond the selected range — no separate geometry needed for
    // that, see app.js's refreshIndicators. Falls back to the full array
    // for Hybrid/LogPanel callers, which never set this.
    const bandsNm = userState.plotBandsNm || RING_BANDS_NM;

    return aircraftList
      .filter(a => a.lastSeenSeconds < staleThresholdSeconds * 3) // hard cut
      .map(a => {
        const bearing = Geo.calculateBearing(lat, lon, a.lat, a.lon);
        const distanceNm = Geo.calculateDistanceNm(lat, lon, a.lat, a.lon);
        const vis = Visibility.estimate(lat, lon, a, metar);
        const relativeBearing = Geo.calculateRelativeBearing(bearing, heading);
        const relevance = Relevance.evaluate(userState, a, relativeBearing, vis);
        // Slant range (not flat horizontal distance) — the same figure
        // Relevance itself compares against the teardrop, so an aircraft's
        // plotted radius agrees with whether it's near the edge of relevance.
        // null when fovHalfAngleDeg is set and this bearing falls outside
        // RAW's forward field of view — callers must skip rendering those
        // (still relevant/tracked for Hybrid/logging, just not drawable
        // inside RAW's arc-restricted plot).
        const pos = Geo.projectToPolarPosition(relativeBearing, vis.slantRangeNm, plotWidth, plotHeight, bandsNm, anchorY, safeInset, fovHalfAngleDeg, plotOffsetX, plotOffsetY);
        const x = pos ? pos.x : null;
        const y = pos ? pos.y : null;
        // Direction-of-travel indicator — the aircraft's own ground track,
        // expressed relative to the observer's heading-up view the same way
        // relativeBearing expresses the aircraft's *position*. null when the
        // aircraft isn't transmitting a track (no arrow drawn for those).
        const relativeTrackDeg = a.trackDeg != null ? Geo.calculateRelativeBearing(a.trackDeg, heading) : null;
        const isStale = a.lastSeenSeconds > staleThresholdSeconds;

        return {
          aircraft: a,
          bearing,
          distanceNm,
          relativeBearing,
          relativeTrackDeg,
          vis,
          relevance,
          x, y,
          isStale,
        };
      });
  }

  /**
   * Given the full aircraft list and user state, return every relevant
   * aircraft, sorted best-candidate-first. Aircraft that Relevance.evaluate()
   * rules out (roughly: behind the user, not close, not converging into
   * view) never reach the sort stage at all — this is a TCAS-style
   * relevance gate, not just a visibility ranking.
   *
   * Deliberately unpaginated — the caller decides how many to actually
   * display (via capForViewportWidth) and which page, since that's
   * display/interaction state, not something this pure function should own.
   *
   * userState: { lat, lon, heading, speedMph, viewportWidth, viewportHeight, metar }
   *   metar (optional): current MetarProvider.getCached() snapshot, passed
   *   straight through to Visibility.estimate() — see there for what it does.
   * @param {Set<string>} [suppressedHexes]  Aircraft hex codes to exclude regardless of
   *   relevance (manually dismissed via the popup's Suppress button). Applies uniformly —
   *   there's no relevance reason exempt from suppression, including overhead/close cases.
   */
  function build(aircraftList, userState, staleThresholdSeconds, suppressedHexes) {
    const withMeta = _computeAll(aircraftList, userState, staleThresholdSeconds)
      .filter(item => !suppressedHexes || !suppressedHexes.has(item.aircraft.hex))
      .filter(item => item.relevance.relevant);

    // Sort: higher visibility score first, then proximity
    withMeta.sort((a, b) => {
      if (b.vis.score !== a.vis.score) return b.vis.score - a.vis.score;
      return a.distanceNm - b.distanceNm;
    });

    return withMeta;
  }

  /**
   * Same per-aircraft computation as build(), but with NO relevance or
   * suppression filtering — every tracked aircraft, nearest first. Used by
   * the ground-truth logging panel (src/dev/logPanel.js), which needs to
   * log "not visible" observations against aircraft the relevance filter
   * already excluded, not just the ones NAV currently shows.
   */
  function buildAll(aircraftList, userState, staleThresholdSeconds) {
    const withMeta = _computeAll(aircraftList, userState, staleThresholdSeconds);
    withMeta.sort((a, b) => a.distanceNm - b.distanceNm);
    return withMeta;
  }

  /**
   * Nudges apart indicators whose projected screen positions land too close
   * together. Now that Geo.projectToPolarPosition() scatters aircraft across
   * the whole plot by bearing AND distance rather than confining them to a
   * shared edge, two indicators can end up close in ANY direction — not just
   * along one shared axis — so this resolves plain 2D proximity: any pair
   * closer than minGapPx is pushed apart along the line between their
   * centres, split evenly between the two. A few passes handle chains (A
   * pushed into B's space gets resolved on the next pass). Mutates and
   * returns the same array; only meant to run on the already-capped/
   * paginated subset actually being rendered, not the full relevant list.
   *
   * @param {Array} items      Items with x/y, as produced by build()/buildAll().
   * @param {number} minGapPx  Minimum centre-to-centre spacing.
   */
  function declutter(items, minGapPx) {
    const MAX_PASSES = 4;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let movedAny = false;

      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);

          if (dist === 0) {
            // Exactly coincident — no direction to push along, so pick one.
            a.x -= minGapPx / 2;
            b.x += minGapPx / 2;
            movedAny = true;
          } else if (dist < minGapPx) {
            const push = (minGapPx - dist) / 2;
            const ux = dx / dist, uy = dy / dist;
            a.x -= ux * push; a.y -= uy * push;
            b.x += ux * push; b.y += uy * push;
            movedAny = true;
          }
        }
      }

      if (!movedAny) break;
    }

    items.forEach(item => {
      item.x = Math.round(item.x);
      item.y = Math.round(item.y);
    });

    return items;
  }

  return { build, buildAll, capForViewportWidth, declutter, POLAR_MAX_RANGE_NM, RING_BANDS_NM, FOV_HALF_ANGLE_DEG };
})();

if (typeof module !== "undefined") module.exports = Indicators;
