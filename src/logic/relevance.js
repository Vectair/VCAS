/**
 * Relevance — decides which aircraft are worth showing in the driving view,
 * independent of how visible they'd be once you look.
 *
 * Modelled on how TCAS's own coverage is illustrated: not a symmetric arc,
 * but a teardrop — long and wide ahead, pinched at the sides, with a small
 * residual allowance directly behind. An aircraft is relevant if:
 *
 *   1. It's nearly overhead (elevation > ~70°) — a plan-view "ahead/behind"
 *      test doesn't mean anything for something almost straight up.
 *   2. It's currently within the teardrop boundary for its bearing.
 *   3. It isn't yet, but projecting both the user's and the aircraft's
 *      motion forward a few seconds puts it inside the teardrop — i.e. it's
 *      converging into view even though it isn't visible *this instant*.
 *
 * Rule 3 only ever adds candidates — something relevant right now via 1 or 2
 * is never excluded because it's about to leave the teardrop a moment later.
 */
const Relevance = (() => {

  const DEFAULTS = {
    rMaxNm:             15,   // teardrop range dead ahead (relative bearing 0°) — floor for
                               // low/mid-altitude traffic; see _effectiveRMaxNm for high-altitude extension
    rMinNm:             3,    // teardrop range dead behind (relative bearing 180°) — never zero
    pinchExponent:      2,    // higher = narrower sides, closer to the reference illustration's waist
    overheadElevationDeg: 70, // matches Visibility's own isOverhead threshold
    lookaheadSeconds:   15,
    lookaheadSamples:   3,
    stationarySpeedMph: 5,    // below this, the user's own motion isn't projected forward
    // A real high-altitude jet is visible (often via contrail) from far
    // beyond a fixed 15nm — that cap was tuned around ordinary low-altitude
    // local traffic, not long-haul cruise-altitude overflights. Confirmed
    // directly (2026-08-21): a real aircraft at ~32,000ft, ~20-25nm ground
    // distance was independently ADS-B-confirmed AND visually confirmed via
    // contrail, but VCAS's fixed 15nm cap excluded it entirely before
    // Visibility.estimate() ever got a chance to score it.
    //
    // Deliberately a flat threshold + flat cap, NOT a gradual elevation-
    // angle formula (an earlier version of this used one, calibrated only
    // to that one reported case — reverted once the real intended model
    // came out: these two numbers are the project owner's own field
    // experience, "no hard work done on this beyond personal experience,"
    // not physically derived). contrailMinAltitudeFt must match Visibility's
    // own CONTRAIL_MIN_ALTITUDE_FT; rangeExtensionCapNm must match its
    // CONTRAIL_MAX_RANGE_NM — the owner's own words on the latter: "50nm
    // was about as far away as identifiable contrails could be... beyond
    // that they can still be seen but I couldn't definitively say they
    // were from a certain aircraft." A gradual geometric formula sounds
    // more rigorous but isn't what was actually observed, and undershoots
    // it badly: it doesn't even reach 50nm until ~54,000ft, well above
    // where most airliners cruise.
    contrailMinAltitudeFt: 26000,
    rangeExtensionCapNm: 50,
  };

  const KT_TO_MPS  = 0.514444;
  const MPH_TO_MPS = 0.44704;

  /**
   * Dead-ahead teardrop range (rMaxNm), extended for high-altitude aircraft.
   * A fixed rMaxNm makes sense for ordinary low-altitude local traffic, but
   * a cruise-altitude jet is identifiable (often via contrail) from much
   * farther out. Mirrors Visibility's own contrail-floor condition exactly
   * — same altitude threshold, same range cap — so an aircraft that gets
   * the contrail visibility floor is guaranteed to have actually been
   * relevant enough to reach Visibility.estimate() in the first place.
   */
  function _effectiveRMaxNm(altitudeFt, opts) {
    if (altitudeFt != null && altitudeFt >= opts.contrailMinAltitudeFt) {
      return Math.max(opts.rMaxNm, opts.rangeExtensionCapNm);
    }
    return opts.rMaxNm;
  }

  /**
   * Maximum relevant slant range for a given relative bearing — the teardrop
   * boundary itself. 0° = dead ahead (rMaxNm), 180° = dead behind (rMinNm).
   */
  function _teardropRangeNm(relativeBearingDeg, opts) {
    const rad = (relativeBearingDeg * Math.PI) / 180;
    const c   = Math.cos(rad); // 1 at 0°, -1 at 180°
    const f   = Math.pow((1 + c) / 2, opts.pinchExponent);
    return opts.rMinNm + (opts.rMaxNm - opts.rMinNm) * f;
  }

  function _inTeardrop(relativeBearingDeg, slantRangeNm, opts) {
    return slantRangeNm <= _teardropRangeNm(relativeBearingDeg, opts);
  }

  /**
   * Sample the user's and aircraft's projected positions forward across the
   * lookahead window; return seconds-until-entry if any sample point falls
   * inside the teardrop, else null.
   *
   * Uses projected horizontal range (not slant range) — altitude is assumed
   * roughly constant over the short window, since a full vertical-rate
   * projection buys little accuracy here for real added complexity.
   */
  function _predictedEntrySeconds(userState, aircraft, opts) {
    if (aircraft.trackDeg == null || aircraft.groundSpeedKt == null) return null;

    const acSpeedMps   = aircraft.groundSpeedKt * KT_TO_MPS;
    const userSpeedMps = (userState.speedMph || 0) * MPH_TO_MPS;
    const userIsMoving  = (userState.speedMph || 0) >= opts.stationarySpeedMph;

    const stepSeconds = opts.lookaheadSeconds / opts.lookaheadSamples;

    for (let i = 1; i <= opts.lookaheadSamples; i++) {
      const t = stepSeconds * i;

      const acPos = Geo.projectPosition(aircraft.lat, aircraft.lon, aircraft.trackDeg, acSpeedMps * t);
      const userPos = userIsMoving
        ? Geo.projectPosition(userState.lat, userState.lon, userState.heading, userSpeedMps * t)
        : { lat: userState.lat, lon: userState.lon };

      const bearing        = Geo.calculateBearing(userPos.lat, userPos.lon, acPos.lat, acPos.lon);
      const relativeBearing = Geo.calculateRelativeBearing(bearing, userState.heading);
      const rangeNm         = Geo.calculateDistanceNm(userPos.lat, userPos.lon, acPos.lat, acPos.lon);

      if (_inTeardrop(relativeBearing, rangeNm, opts)) return t;
    }
    return null;
  }

  /**
   * @param {{lat,lon,heading,speedMph}} userState
   * @param {object} aircraft            Normalised aircraft object (needs lat/lon/trackDeg/groundSpeedKt)
   * @param {number} relativeBearing     Precomputed by the caller (avoids recomputation)
   * @param {object} vis                 Precomputed Visibility.estimate() result (needs slantRangeNm/elevationDeg)
   * @param {object} [options]           Overrides for any DEFAULTS key
   * @returns {{relevant:boolean, reason:("overhead"|"in-view"|"predicted-entry"|null), enterInSeconds:(number|null)}}
   */
  function evaluate(userState, aircraft, relativeBearing, vis, options) {
    const opts = options ? Object.assign({}, DEFAULTS, options) : DEFAULTS;
    // See _effectiveRMaxNm's doc comment — extends the teardrop's dead-ahead
    // range for high-altitude aircraft, which are visible from much farther
    // out than the fixed rMaxNm floor assumes.
    const effectiveOpts = { ...opts, rMaxNm: _effectiveRMaxNm(aircraft.altitudeFt, opts) };

    if (vis.elevationDeg > effectiveOpts.overheadElevationDeg) {
      return { relevant: true, reason: "overhead", enterInSeconds: 0 };
    }

    if (_inTeardrop(relativeBearing, vis.slantRangeNm, effectiveOpts)) {
      return { relevant: true, reason: "in-view", enterInSeconds: 0 };
    }

    const enterInSeconds = _predictedEntrySeconds(userState, aircraft, effectiveOpts);
    if (enterInSeconds != null) {
      return { relevant: true, reason: "predicted-entry", enterInSeconds };
    }

    return { relevant: false, reason: null, enterInSeconds: null };
  }

  return { evaluate, DEFAULTS };
})();

if (typeof module !== "undefined") module.exports = Relevance;
