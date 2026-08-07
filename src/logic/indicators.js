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
   * Given the full aircraft list and user state, return the top-N indicators
   * ready for rendering. Aircraft that Relevance.evaluate() rules out
   * (roughly: behind the user, not close, not converging into view) never
   * reach the sort/cap stage at all — this is a TCAS-style relevance gate,
   * not just a visibility ranking.
   *
   * userState: { lat, lon, heading, speedMph, viewportWidth, viewportHeight }
   */
  function build(aircraftList, userState, maxShown, staleThresholdSeconds) {
    const { lat, lon, heading, viewportWidth, viewportHeight } = userState;

    const withMeta = aircraftList
      .filter(a => a.lastSeenSeconds < staleThresholdSeconds * 3) // hard cut
      .map(a => {
        const bearing = Geo.calculateBearing(lat, lon, a.lat, a.lon);
        const distanceNm = Geo.calculateDistanceNm(lat, lon, a.lat, a.lon);
        const vis = Visibility.estimate(lat, lon, a);
        const relativeBearing = Geo.calculateRelativeBearing(bearing, heading);
        const relevance = Relevance.evaluate(userState, a, relativeBearing, vis);
        const { x, y, side } = Geo.projectToScreenEdge(relativeBearing, viewportWidth, viewportHeight);
        const arrowDeg = Geo.arrowRotation(relativeBearing);
        const isStale = a.lastSeenSeconds > staleThresholdSeconds;

        return {
          aircraft: a,
          bearing,
          distanceNm,
          relativeBearing,
          vis,
          relevance,
          x, y, side,
          arrowDeg,
          isStale,
        };
      })
      .filter(item => item.relevance.relevant);

    // Sort: higher visibility score first, then proximity
    withMeta.sort((a, b) => {
      if (b.vis.score !== a.vis.score) return b.vis.score - a.vis.score;
      return a.distanceNm - b.distanceNm;
    });

    return withMeta.slice(0, maxShown);
  }

  return { build, capForViewportWidth };
})();

if (typeof module !== "undefined") module.exports = Indicators;
