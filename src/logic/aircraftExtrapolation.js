/**
 * Dead-reckons aircraft positions between ADS-B polls, using each aircraft's
 * own reported ground speed + track — same principle real TCAS/ND displays
 * use to stay smooth between radar sweeps. adsb.fi's feed only updates every
 * REFRESH_INTERVAL_SECONDS; without this, a fast-moving aircraft close to
 * the user visibly teleports between polls, while a distant one (which
 * barely changes position over the same interval) gets no benefit from
 * polling that often. Extrapolating client-side fixes the near case for
 * free, at zero extra API cost, and helps every aircraft rather than just
 * the close ones a tiered-polling approach would target.
 *
 * Pure, no DOM — same convention as visibility.js/indicators.js/relevance.js.
 */

const AircraftExtrapolation = (() => {
  const KT_TO_MPS = 0.514444;

  /**
   * @param {object} aircraft        Normalised aircraft object.
   * @param {number} elapsedSeconds  Time since the fix this aircraft's
   *   lat/lon came from.
   * @param {number} maxElapsedSeconds  Cap on how far to project — beyond
   *   this the fix is too old to trust a straight-line projection from, so
   *   position is held rather than extrapolated further.
   */
  function extrapolate(aircraft, elapsedSeconds, maxElapsedSeconds) {
    if (aircraft.groundSpeedKt == null || aircraft.trackDeg == null) return aircraft;
    // Taxiing aircraft turn corners along taxiways; a straight-line
    // projection would visibly cut across them, so leave on-ground traffic
    // at its last reported fix instead.
    if (aircraft.onGround) return aircraft;

    const seconds = Math.min(Math.max(elapsedSeconds, 0), maxElapsedSeconds);
    if (seconds === 0) return aircraft;

    const distanceMeters = aircraft.groundSpeedKt * KT_TO_MPS * seconds;
    const dest = Geo.destinationPoint(aircraft.lat, aircraft.lon, aircraft.trackDeg, distanceMeters);
    return { ...aircraft, lat: dest.lat, lon: dest.lon };
  }

  function extrapolateAll(aircraftList, elapsedSeconds, maxElapsedSeconds) {
    return aircraftList.map(a => extrapolate(a, elapsedSeconds, maxElapsedSeconds));
  }

  return { extrapolate, extrapolateAll };
})();

if (typeof module !== "undefined") module.exports = AircraftExtrapolation;
