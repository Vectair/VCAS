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
  const MIN_DISTANCE_FLOOR_NM = 1; // stops a ~0nm source taking ~100% share

  const WEIGHT_RULE =
    "Share = inverse of distance (min 1nm) across METAR, Open-Meteo and USEREP. " +
    "Descriptive only: the model uses each source independently, not a blend.";

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

    if (metar) {
      out.push({
        id: "metar",
        name: "METAR " + (metar.stationId || "station"),
        lat: _round(metar.stationLat, 4), lon: _round(metar.stationLon, 4),
        distanceNm: _round(typeof metar.distanceNm === "number" ? metar.distanceNm
          : _nmBetween(user.lat, user.lon, metar.stationLat, metar.stationLon), 1),
        feeds: ["cloud layers", "prevailing visibility"],
        detail: {
          visibilitySm: metar.visibilitySm != null ? metar.visibilitySm : null,
          clouds: Array.isArray(metar.allClouds)
            ? metar.allClouds.map(c => ({ cover: c.cover, baseFt: c.baseFt != null ? c.baseFt : null })) : [],
          wx: metar.wxString || null,
        },
      });
    }

    if (upperAir) {
      out.push({
        id: "upperAir",
        name: "Open-Meteo grid cell",
        lat: _round(upperAir.gridLat, 4), lon: _round(upperAir.gridLon, 4),
        distanceNm: _round(_nmBetween(user.lat, user.lon, upperAir.gridLat, upperAir.gridLon), 1),
        feeds: ["cloud bands (low/mid/high)", "contrail physics"],
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
        detail: {
          combinedDensity: _round(localObstruction.combinedDensity, 3),
          buildingDensity: _round(localObstruction.buildingDensity, 3),
          vegetationDensity: _round(localObstruction.vegetationDensity, 3),
          radiusM: localObstruction.radiusM != null ? localObstruction.radiusM : null,
        },
      });
    }

    // Inverse-distance shares across the three remote sources only — the
    // map-tile source sits at the user by definition, so it has no share.
    const remote = out.filter(s => s.id !== "localObstruction" && s.distanceNm != null);
    const total = remote.reduce((sum, s) => sum + 1 / Math.max(s.distanceNm, MIN_DISTANCE_FLOOR_NM), 0);
    out.forEach(s => {
      s.sharePct = (total > 0 && remote.includes(s))
        ? _round(100 * (1 / Math.max(s.distanceNm, MIN_DISTANCE_FLOOR_NM)) / total, 1)
        : null;
    });
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
      s.affected = aircraft.filter(a => a.trace.some(t => t.stage === s.id && t.changed)).length;
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
