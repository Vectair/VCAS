/**
 * LiveSnapshot — builds the compact "what is this user's visibility
 * pipeline doing right now" payload the admin dashboard's Live Pipeline tab
 * renders (see src/dev/livePresence.js for the transport, and CLAUDE.md's
 * 2026-10-10 entry for the whole design).
 *
 * Pure: no DOM, no network, no storage — everything comes in as arguments,
 * so it's testable in plain Node like the rest of src/logic/. It
 * deliberately does NOT re-derive any scoring: per-aircraft stage detail is
 * the `trace` Visibility.estimate() itself records as it runs, so the
 * dashboard can only ever show what the app really computed.
 *
 * Location data is included on purpose (closed test, no privacy concern per
 * the project owner) — this is NOT something to ship to an open audience.
 *
 * Weather-source "shares" are DESCRIPTIVE, not part of the model: the real
 * scoring uses the single nearest METAR station, the single Open-Meteo
 * cell, and the single freshest USEREP independently (each for different
 * inputs), never a blend. `sharePct` is an inverse-distance share across
 * those three so the dashboard can show roughly how local each source is;
 * `affected` (aircraft whose tier that source actually changed) is the
 * number that shows real influence.
 */
const LiveSnapshot = (() => {
  const MAX_AIRCRAFT = 40;        // nearest-first cap, bounds payload size

  const WEIGHT_RULE =
    "Share = influence on the low-level (below 5,000ft) weather estimate: up to 3 nearest METARs weighted by " +
    "inverse distance squared, trust fading from 15nm to 40nm, Open-Meteo taking the remainder. " +
    "Above 5,000ft Open-Meteo is 100%. USEREP and map tiles are separate adjustments.";

  function _round(n, dp) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
  }

  function _nmBetween(lat1, lon1, lat2, lon2) {
    if (typeof lat2 !== "number" || typeof lon2 !== "number") return null;
    return Geo.calculateDistanceNm(lat1, lon1, lat2, lon2);
  }

  function _weatherSources(user, metar, upperAir, userep, localObstruction, nowMs) {
    const out = [];

    // One row per METAR station in the low-level blend (up to 3), each with
    // its real share of the below-5000ft estimate (LowLevelWeather).
    const ll = (metar || upperAir) ? LowLevelWeather.blend(user.lat, user.lon, metar, nowMs) : null;
    if (ll) {
      ll.stations.forEach(st => {
        out.push({
          id: "metar",
          name: "METAR " + (st.stationId || "station"),
          lat: _round(st.lat, 4), lon: _round(st.lon, 4),
          distanceNm: _round(st.distanceNm, 1),
          feeds: ["low-level cloud (below 5,000ft)", "prevailing visibility", "present weather"],
          sharePct: st.weightPct,
          detail: {
            visibilitySm: st.visibilitySm != null ? st.visibilitySm : null,
            clouds: (st.clouds || []).map(c => ({ cover: c.cover, baseFt: c.baseFt != null ? c.baseFt : null })),
            wx: st.wxString || null,
            wind: st.windSpeedKt != null ? { dirDeg: st.windDirDeg, kt: st.windSpeedKt, weightMult: st.windMult } : null,
            wxEffect: st.wx && st.wx.present ? { impliedVisSm: st.wx.impliedVisSm, impliedVisFogSm: st.wx.impliedVisFogSm, fogAdd: st.wx.fogAdd, precipAdd: st.wx.precipAdd } : null,
            ageMin: st.ageMin,
          },
        });
      });
    }

    if (upperAir) {
      out.push({
        id: "upperAir",
        name: "Open-Meteo grid cell",
        lat: _round(upperAir.gridLat, 4), lon: _round(upperAir.gridLon, 4),
        distanceNm: _round(_nmBetween(user.lat, user.lon, upperAir.gridLat, upperAir.gridLon), 1),
        feeds: ["all cloud above 5,000ft", "contrail physics", "low level too where METARs are absent/far"],
        sharePct: ll ? ll.upperAirPct : 100,
        detail: {
          lowPct: upperAir.cloudCoverLowPct, midPct: upperAir.cloudCoverMidPct, highPct: upperAir.cloudCoverHighPct,
          pressureLevels: Array.isArray(upperAir.pressureProfile) ? upperAir.pressureProfile.length : 0,
        },
      });
    }

    if (userep) {
      const ageMin = typeof userep.submittedAt === "number"
        ? Math.max(0, Math.round((nowMs - userep.submittedAt * 1000) / 60000)) : null;
      out.push({
        id: "userep",
        name: "USEREP (nearby user)",
        lat: _round(userep.lat, 4), lon: _round(userep.lon, 4),
        distanceNm: _round(_nmBetween(user.lat, user.lon, userep.lat, userep.lon), 1),
        feeds: ["sky/visibility report, can raise or lower tier"],
        sharePct: null,
        detail: {
          sky: userep.sky, visibility: userep.visibility, cloudHeight: userep.cloudHeight || null,
          phenomena: userep.phenomena || [], ageMin,
        },
      });
    }

    if (localObstruction) {
      out.push({
        id: "localObstruction",
        name: "Map tiles at user position",
        lat: _round(user.lat, 4), lon: _round(user.lon, 4),
        distanceNm: 0,
        feeds: ["building/woodland density"],
        sharePct: null,
        detail: {
          combinedDensity: _round(localObstruction.combinedDensity, 3),
          buildingDensity: _round(localObstruction.buildingDensity, 3),
          vegetationDensity: _round(localObstruction.vegetationDensity, 3),
          radiusM: localObstruction.radiusM != null ? localObstruction.radiusM : null,
        },
      });
    }

    return out;
  }

  /**
   * @param {object} p
   * @param {string} p.installId
   * @param {string} p.mode            "raw" | "hybrid" | "air"
   * @param {{lat:number,lon:number,heading:number,speedMph:number}} p.user
   * @param {Array}  p.tracked         Indicators.buildAll() output
   * @param {object} [p.metar] [p.upperAir] [p.userep] [p.localObstruction]  provider cache snapshots
   * @param {string} [p.modelVersion]
   * @param {number} [p.now]           epoch ms (injectable for tests)
   */
  function build(p) {
    const now = p.now != null ? p.now : Date.now();
    const user = p.user;
    const tracked = Array.isArray(p.tracked) ? p.tracked : [];

    const aircraft = tracked.slice(0, MAX_AIRCRAFT).map(item => {
      const a = item.aircraft, v = item.vis;
      return {
        hex: a.hex,
        callsign: a.callsign || null,
        type: a.type || null,
        altitudeFt: a.altitudeFt != null ? Math.round(a.altitudeFt) : null,
        distanceNm: _round(item.distanceNm, 1),
        bearing: _round(item.bearing, 0),
        relevant: !!(item.relevance && item.relevance.relevant),
        relevanceReason: item.relevance ? item.relevance.reason : null,
        label: v.label,
        pct: v.score,
        angularSizeDeg: _round(v.angularSizeDeg, 3),
        elevationDeg: _round(v.elevationDeg, 1),
        stale: !!item.isStale,
        trace: Array.isArray(v.trace) ? v.trace : [],
      };
    });

    const sources = _weatherSources(user, p.metar, p.upperAir, p.userep, p.localObstruction, now);

    // How many of the sent aircraft each source actually changed the tier
    // of — the real measure of influence (see header comment).
    sources.forEach(s => {
      // All METAR stations feed ONE blended stage, so a per-station count
      // would be meaningless: report it once on the first station only.
      s.affected = (s.id === "metar" && !(sources.find(x => x.id === "metar") === s)) ? null
        : aircraft.filter(a => a.trace.some(t => t.stage === s.id && t.changed)).length;
    });

    return {
      v: 1,
      ts: now,
      installId: p.installId,
      mode: p.mode || null,
      modelVersion: p.modelVersion || null,
      user: {
        lat: _round(user.lat, 5), lon: _round(user.lon, 5),
        heading: _round(user.heading, 0), speedMph: _round(user.speedMph, 0),
      },
      weightRule: WEIGHT_RULE,
      sources,
      totalTracked: tracked.length,
      aircraft,
    };
  }

  return { build, MAX_AIRCRAFT };
})();

if (typeof module !== "undefined") module.exports = LiveSnapshot;
