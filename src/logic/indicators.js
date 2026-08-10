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
   * Shared per-aircraft computation used by both build() and buildAll() —
   * bearing/distance/visibility/relevance/screen-edge position, for every
   * aircraft that passes the hard staleness cutoff. Does NOT filter by
   * relevance or suppression; callers decide what to do with that.
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
        const { x, y, side } = Geo.projectToScreenEdge(relativeBearing, viewportWidth, viewportHeight);
        const isStale = a.lastSeenSeconds > staleThresholdSeconds;

        return {
          aircraft: a,
          bearing,
          distanceNm,
          relativeBearing,
          vis,
          relevance,
          x, y, side,
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

  return { build, buildAll, capForViewportWidth };
})();

if (typeof module !== "undefined") module.exports = Indicators;
