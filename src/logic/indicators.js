/**
 * Builds sorted, filtered indicator data for the Driving View.
 */

const Indicators = (() => {
  /**
   * Given the full aircraft list and user state, return the top-N indicators
   * ready for rendering.
   *
   * userState: { lat, lon, heading, viewportWidth, viewportHeight }
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
        const { x, y, side } = Geo.projectToScreenEdge(relativeBearing, viewportWidth, viewportHeight);
        const arrowDeg = Geo.arrowRotation(relativeBearing);
        const isStale = a.lastSeenSeconds > staleThresholdSeconds;

        return {
          aircraft: a,
          bearing,
          distanceNm,
          relativeBearing,
          vis,
          x, y, side,
          arrowDeg,
          isStale,
        };
      });

    // Sort: higher visibility score first, then proximity
    withMeta.sort((a, b) => {
      if (b.vis.score !== a.vis.score) return b.vis.score - a.vis.score;
      return a.distanceNm - b.distanceNm;
    });

    return withMeta.slice(0, maxShown);
  }

  return { build };
})();

if (typeof module !== "undefined") module.exports = Indicators;
