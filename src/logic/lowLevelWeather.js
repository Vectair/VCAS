/**
 * LowLevelWeather — builds a best-guess LOW-LEVEL (surface to ~5,000ft AGL)
 * weather observation for the user's own position by blending up to the 3
 * nearest METAR stations, weighted by distance, with Open-Meteo filling in
 * whatever share the METARs can't credibly claim (2026-10-11, direct design
 * from the project owner: "VCAS is attempting to build a best guess current
 * weather observation for where the user is").
 *
 * Weighting rule:
 *   - Each candidate station (nearest 3 with a usable, not-stale report)
 *     gets inverse-distance-SQUARED weight, distance floored at 0.5nm, so
 *     standing at an airfield makes that station ~100% of the METAR part,
 *     and being equidistant between two makes them 50/50.
 *   - Each station also carries a TRUST factor: 1.0 within TRUST_FULL_NM,
 *     fading linearly to 0 at TRUST_ZERO_NM. A station that's far away
 *     isn't allowed to speak for the user's sky just because it's the only
 *     one: the untrusted remainder of the low-level weight goes to
 *     Open-Meteo. No METAR-producing field nearby at all => Open-Meteo is
 *     100% of the low-level estimate too.
 *   - Wind: stations upwind of the user get a multiplier on their weight
 *     (weaker for fog-type reports); see _windMult.
 *   - Above LOW_TOP_AGL_FT, Open-Meteo is the only source (METAR cloud
 *     layers above that height are deliberately not used — see
 *     visibility.js's _applyLowLevelWeatherAdjustment).
 *
 * Pure: no DOM, no network. Distances are recomputed from the user's CURRENT
 * position on every call (stations are fetched once per ~15 min / ~15nm of
 * movement, the user keeps moving), and blend() is memoised on its inputs
 * since Visibility.estimate() calls it once per aircraft per tick.
 *
 * The constants below are tuned guesses, not derived: same provenance as
 * the other tuned numbers in this codebase.
 */
const LowLevelWeather = (() => {
  const MAX_STATIONS = 3;
  const MIN_DISTANCE_NM = 0.5;   // floor so ~0nm doesn't give infinite weight
  const TRUST_FULL_NM = 15;      // full trust inside this range...
  const TRUST_ZERO_NM = 40;      // ...none at/after this one
  const MAX_OBS_AGE_MIN = 120;   // a METAR older than this is ignored (closed field, stale report)
  const LOW_TOP_AGL_FT = 5000;
  // Wind / upwind weighting (2026-10-11): a station UPWIND of the user (the
  // wind blows from it towards the user) is a better predictor of the user's
  // weather than one downwind. Applied as a multiplier on the station's
  // distance weight BEFORE normalising. Modest for cloud/precipitation, much
  // weaker for fog-type reports (fog forms in place, it doesn't advect much).
  const WIND_MIN_KT = 3, WIND_FULL_KT = 15;
  const WIND_STRENGTH = 0.5, WIND_STRENGTH_FOG = 0.15;
  const WIND_MULT_FLOOR = 0.3;

  /** Multiplier (~0.3..1.5) from the station's wind; 1 when wind is unknown/variable/calm. */
  function _windMult(userLat, userLon, s, fogLike) {
    const dir = s.windDirDeg, spd = s.windSpeedKt;
    if (typeof dir !== "number" || typeof spd !== "number" || !Number.isFinite(dir) || !Number.isFinite(spd)) return 1;
    if (spd < WIND_MIN_KT) return 1;
    if (typeof s.stationLat !== "number" || typeof s.stationLon !== "number") return 1;
    // wind FROM dir: air at the station moves towards the user when the
    // station lies in direction `dir` from the user.
    const toStation = Geo.calculateBearing(userLat, userLon, s.stationLat, s.stationLon);
    let diff = Math.abs(((toStation - dir) % 360 + 540) % 360 - 180); // 0 = directly upwind, 180 = downwind
    const align = Math.cos(diff * Math.PI / 180);
    const strength = (fogLike ? WIND_STRENGTH_FOG : WIND_STRENGTH) * Math.min(1, spd / WIND_FULL_KT);
    return Math.max(WIND_MULT_FLOOR, 1 + strength * align);
  }

  function _trust(d) {
    if (d <= TRUST_FULL_NM) return 1;
    if (d >= TRUST_ZERO_NM) return 0;
    return (TRUST_ZERO_NM - d) / (TRUST_ZERO_NM - TRUST_FULL_NM);
  }

  function _round(n, dp) {
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
  }

  /** Station records: metar.stations if present, else the legacy single-station shape. */
  function _candidates(metar) {
    if (!metar) return [];
    if (Array.isArray(metar.stations)) return metar.stations;
    return [metar];
  }

  function _ageMin(obsTime, nowMs) {
    // obsTime is epoch seconds per aviationweather.gov's JSON (unverified
    // against a live response — see metarProvider.js's header caveat);
    // anything that isn't a plausible epoch is treated as "age unknown".
    if (typeof obsTime !== "number" || !Number.isFinite(obsTime) || obsTime < 1e9) return null;
    return Math.max(0, (nowMs - obsTime * 1000) / 60000);
  }

  /**
   * @returns {{stations:Array, metarPct:number, upperAirPct:number, hasMetar:boolean, lowTopAglFt:number}}
   *   stations[i] = { stationId, lat, lon, distanceNm, weightPct, visibilitySm, clouds, wxString, ageMin }
   *   weightPct is the station's share of the LOW-LEVEL estimate (0-100);
   *   metarPct + upperAirPct = 100.
   */
  function _blend(userLat, userLon, metar, nowMs) {
    const scored = [];
    for (const s of _candidates(metar)) {
      if (!s) continue;
      let d = null;
      if (typeof s.stationLat === "number" && typeof s.stationLon === "number") {
        d = Geo.calculateDistanceNm(userLat, userLon, s.stationLat, s.stationLon);
      } else if (typeof s.distanceNm === "number") {
        d = s.distanceNm;
      } else {
        d = 0; // legacy/test shape with no position: treat as right here
      }
      const age = _ageMin(s.obsTime, nowMs);
      if (age != null && age > MAX_OBS_AGE_MIN) continue;
      const wx = PresentWeather.analyse(s.wxString, age);
      scored.push({ s, d, age, wx, windM: _windMult(userLat, userLon, s, wx.fogLike) });
    }
    scored.sort((a, b) => a.d - b.d);
    const top = scored.slice(0, MAX_STATIONS);

    const idwOf = x => x.windM / Math.pow(Math.max(x.d, MIN_DISTANCE_NM), 2);
    const idwSum = top.reduce((n, x) => n + idwOf(x), 0);
    const stations = top.map(x => {
      const idw = idwOf(x);
      const w = idwSum > 0 ? (idw / idwSum) * _trust(x.d) : 0;
      return {
        stationId: x.s.stationId || null,
        lat: typeof x.s.stationLat === "number" ? x.s.stationLat : null,
        lon: typeof x.s.stationLon === "number" ? x.s.stationLon : null,
        distanceNm: _round(x.d, 1),
        weight: w,
        visibilitySm: x.s.visibilitySm != null ? x.s.visibilitySm : null,
        clouds: Array.isArray(x.s.clouds) ? x.s.clouds : [],
        wxString: x.s.wxString || null,
        wx: x.wx,
        windDirDeg: typeof x.s.windDirDeg === "number" ? x.s.windDirDeg : null,
        windSpeedKt: typeof x.s.windSpeedKt === "number" ? x.s.windSpeedKt : null,
        windMult: _round(x.windM, 2),
        elevationFt: typeof x.s.elevationFt === "number" ? x.s.elevationFt : null,
        ageMin: x.age != null ? Math.round(x.age) : null,
      };
    });
    const metarW = stations.reduce((n, s) => n + s.weight, 0);
    stations.forEach(s => { s.weightPct = _round(100 * s.weight, 1); });
    return {
      stations,
      metarWeight: metarW,
      metarPct: _round(100 * metarW, 1),
      upperAirPct: _round(100 * (1 - metarW), 1),
      hasMetar: metarW > 0,
      lowTopAglFt: LOW_TOP_AGL_FT,
    };
  }

  let _memo = null;
  function blend(userLat, userLon, metar, nowMs) {
    const now = nowMs != null ? nowMs : Date.now();
    const key = [userLat.toFixed(4), userLon.toFixed(4)].join(",");
    // Re-blend at most once a minute for the same inputs (age filter is the
    // only time-dependent part).
    if (_memo && _memo.metar === metar && _memo.key === key && now - _memo.at < 60000) return _memo.out;
    const out = _blend(userLat, userLon, metar, now);
    _memo = { metar, key, at: now, out };
    return out;
  }

  return {
    blend, MAX_STATIONS, MIN_DISTANCE_NM, TRUST_FULL_NM, TRUST_ZERO_NM, MAX_OBS_AGE_MIN, LOW_TOP_AGL_FT,
    WIND_MIN_KT, WIND_FULL_KT, WIND_STRENGTH, WIND_STRENGTH_FOG, WIND_MULT_FLOOR,
  };
})();

if (typeof module !== "undefined") module.exports = LowLevelWeather;
