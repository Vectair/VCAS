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
   */
  const POLAR_MAX_RANGE_NM = Relevance.DEFAULTS.rMaxNm;

  /**
   * Ring band boundaries (nm) for the plot's non-linear distance scale —
   * see Geo.bandedRadiusFraction(). Each band gets an equal slice of the
   * available radius regardless of its real nm width, so close traffic
   * (where resolving "is this one a bit closer than that one" actually
   * matters) gets more usable screen space than a strictly linear scale
   * would give it, while distant traffic still visibly separates into "how
   * far, roughly" bands instead of a single distant blob. Deliberately
   * capped at POLAR_MAX_RANGE_NM (not the full 50nm originally proposed) —
   * relevance itself still governs what's shown at all; this only changes
   * how what IS shown gets spaced out within that same range.
   */
  const RING_BANDS_NM = [2, 5, 10, POLAR_MAX_RANGE_NM];

  /**
   * Shared per-aircraft computation used by both build() and buildAll() —
   * bearing/distance/visibility/relevance/polar screen position/direction-
   * of-travel, for every aircraft that passes the hard staleness cutoff.
   * Does NOT filter by relevance or suppression; callers decide what to do
   * with that.
   */
  function _computeAll(aircraftList, userState, staleThresholdSeconds) {
    const { lat, lon, heading, viewportWidth, viewportHeight } = userState;

    return aircraftList
      .filter(a => a.lastSeenSeconds < staleThresholdSeconds * 3) // hard cut
      .map(a => {
        const bearing = Geo.calculateBearing(lat, lon, a.lat, a.lon);
        const distanceNm = Geo.calculateDistanceNm(lat, lon, a.lat, a.lon);
        const vis = Visibility.estimate(lat, lon, a);
        const relativeBearing = Geo.calculateRelativeBearing(bearing, heading);
        const relevance = Relevance.evaluate(userState, a, relativeBearing, vis);
        // Slant range (not flat horizontal distance) — the same figure
        // Relevance itself compares against the teardrop, so an aircraft's
        // plotted radius agrees with whether it's near the edge of relevance.
        const { x, y } = Geo.projectToPolarPosition(relativeBearing, vis.slantRangeNm, viewportWidth, viewportHeight, RING_BANDS_NM);
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
   * userState: { lat, lon, heading, speedMph, viewportWidth, viewportHeight }
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

  return { build, buildAll, capForViewportWidth, declutter, POLAR_MAX_RANGE_NM, RING_BANDS_NM };
})();

if (typeof module !== "undefined") module.exports = Indicators;
