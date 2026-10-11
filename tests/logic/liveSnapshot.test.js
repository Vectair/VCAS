/**
 * Real-execution checks for src/logic/liveSnapshot.js and the per-stage
 * `trace` Visibility.estimate() records (2026-10-10, admin dashboard Live
 * Pipeline tab). The trace tests assert that tracing never changes a
 * scoring result and that each stage reports what really happened.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo, Visibility, Indicators, LiveSnapshot } = loadLogic();
const t = createSuite("liveSnapshot.js + Visibility trace");

const USER = { lat: 53.55, lon: -3.07 };
function acBearing(distNm, bearing, extra) {
  const d = Geo.destinationPoint(USER.lat, USER.lon, bearing, distNm * 1852);
  return Object.assign({ hex: "abc123", callsign: "TST1", type: "A320", lat: d.lat, lon: d.lon,
    altitudeFt: 3000, lastSeenSeconds: 1, category: "A3", trackDeg: 90, groundSpeedKt: 250 }, extra || {});
}

// ---- trace: shape and ordering ----
{
  const v = Visibility.estimate(USER.lat, USER.lon, acBearing(5, 0), null, null, null, null);
  t.ok(Array.isArray(v.trace), "estimate() returns a trace array");
  const stages = v.trace.map(s => s.stage);
  t.eq(stages[0], "angularSize", "first stage is angularSize");
  ["staleness", "metar", "upperAir", "localObstruction", "userep"].forEach(name =>
    t.ok(stages.includes(name), "trace includes stage " + name));
  t.eq(stages[stages.length - 1], "userep", "userep is the last stage");
  t.eq(v.trace[v.trace.length - 1].after, v.label, "final stage's tier equals the returned label");
  t.eq(v.trace[v.trace.length - 1].score, v.score, "final stage's score equals the returned score");
  t.ok(v.trace.every(s => s.changed === false), "no stage changes anything with no environmental data and a fresh aircraft");
}

// ---- trace: stages report real changes ----
{
  const metar = { stationId: "EGNO", visibilitySm: 10, clouds: [{ cover: "OVC", baseMslFt: 1000, baseFt: 1000 }] };
  const v = Visibility.estimate(USER.lat, USER.lon, acBearing(3, 0, { altitudeFt: 5000 }), metar, null, null, null);
  const m = v.trace.find(s => s.stage === "metar");
  t.ok(m.changed, "overcast below the aircraft: metar stage changed the tier");
  t.eq(v.label, "Very unlikely/not visible", "overcast block drops to the worst tier");
  t.ok(/EGNO/.test(m.note), "metar note names the station");
  const noMetar = Visibility.estimate(USER.lat, USER.lon, acBearing(3, 0, { altitudeFt: 5000 }), null, null, null, null);
  t.ok(noMetar.score > v.score, "same aircraft without METAR scores higher (trace didn't alter scoring)");
}
{
  const v = Visibility.estimate(USER.lat, USER.lon, acBearing(5, 0, { lastSeenSeconds: 40 }), null, null, null, null);
  t.ok(v.trace.find(s => s.stage === "staleness").changed, "stale aircraft: staleness stage changed the tier");
}
{
  const v = Visibility.estimate(USER.lat, USER.lon, acBearing(0.3, 0, { altitudeFt: 200 }), null, null, null, null);
  t.ok(v.trace.some(s => s.stage === "veryClose"), "very close low aircraft records a veryClose stage");
}
{
  const v = Visibility.estimate(USER.lat, USER.lon, acBearing(45, 0, { altitudeFt: 5000 }), null, null, null, null);
  t.ok(v.trace.some(s => s.stage === "rangeCap"), "beyond 40nm low aircraft records a rangeCap stage");
}

// ---- snapshot ----
function snap(over) {
  const metar = { stationId: "EGNO", stationLat: 53.58, stationLon: -3.06, distanceNm: 2, visibilitySm: 6,
    clouds: [], allClouds: [{ cover: "SCT", baseFt: 3000 }], wxString: "BR" };
  const upperAir = { gridLat: 53.6, gridLon: -3.1, cloudCoverLowPct: 10, cloudCoverMidPct: 80, cloudCoverHighPct: 5, pressureProfile: [] };
  const userState = { lat: USER.lat, lon: USER.lon, heading: 0, speedMph: 0, viewportWidth: 400, viewportHeight: 800, metar, upperAir };
  const list = [acBearing(4, 0, { hex: "a1", altitudeFt: 15000 }), acBearing(9, 90, { hex: "a2" })];
  const tracked = Indicators.buildAll(list, userState, 15);
  return LiveSnapshot.build(Object.assign({
    installId: "inst-1", mode: "raw", user: { lat: USER.lat, lon: USER.lon, heading: 0, speedMph: 0 },
    tracked, metar, upperAir, userep: null, localObstruction: { combinedDensity: 0.1, buildingDensity: 0.05, vegetationDensity: 0.05, radiusM: 300 },
    modelVersion: Visibility.MODEL_VERSION, now: 1700000000000,
  }, over || {}));
}
{
  const s = snap();
  t.eq(s.installId, "inst-1", "installId carried");
  t.eq(s.ts, 1700000000000, "ts uses injected now");
  t.eq(s.aircraft.length, 2, "both aircraft included");
  t.eq(s.totalTracked, 2, "totalTracked counts all");
  t.ok(s.aircraft[0].trace.length > 0, "aircraft carry their trace");
  t.ok(s.aircraft.every(a => a.pct === 10 || a.pct === 33 || a.pct === 66 || a.pct === 100), "pct is a tier score");
  t.eq(s.sources.map(x => x.id).join(","), "metar,upperAir,localObstruction", "sources present: only what is cached");

  const metar = s.sources.find(x => x.id === "metar");
  const air = s.sources.find(x => x.id === "upperAir");
  t.approx(metar.sharePct + air.sharePct, 100, 0.2, "low-level shares sum to ~100");
  t.ok(metar.sharePct > air.sharePct, "nearer source (METAR 2nm) has the larger share than Open-Meteo");
  t.eq(s.sources.find(x => x.id === "localObstruction").sharePct, null, "map-tile source has no share");
  t.ok(typeof s.weightRule === "string" && /5,000ft/.test(s.weightRule), "weight rule is stated");
  t.ok(s.sources.every(x => typeof x.affected === "number"), "every source has an affected count (single station here)");
}
{
  const s = snap({ metar: null, upperAir: null, localObstruction: null });
  t.eq(s.sources.length, 0, "no providers cached: no sources");
}
{
  // cap + own-position share
  const many = [];
  for (let i = 0; i < 60; i++) many.push(acBearing(1 + i * 0.1, i * 5, { hex: "h" + i }));
  const userState = { lat: USER.lat, lon: USER.lon, heading: 0, speedMph: 0, viewportWidth: 400, viewportHeight: 800 };
  const tracked = Indicators.buildAll(many, userState, 15);
  const s = LiveSnapshot.build({ installId: "x", user: { lat: USER.lat, lon: USER.lon, heading: 0, speedMph: 0 }, tracked, now: 1 });
  t.eq(s.aircraft.length, LiveSnapshot.MAX_AIRCRAFT, "aircraft capped at MAX_AIRCRAFT");
  t.eq(s.totalTracked, 60, "totalTracked still reports the true count");
  const close = LiveSnapshot.build({ installId: "x", user: { lat: USER.lat, lon: USER.lon, heading: 0, speedMph: 0 }, tracked: [], now: 1,
    metar: { stationId: "A", stationLat: USER.lat, stationLon: USER.lon, distanceNm: 0 },
    upperAir: { gridLat: USER.lat + 0.5, gridLon: USER.lon, pressureProfile: [] } });
  const sm = close.sources.find(x => x.id === "metar").sharePct;
  t.ok(sm > 99 && sm <= 100, "a station at the user's own position is ~100% of the low-level estimate (got " + sm + ")");
  t.ok(close.sources.find(x => x.id === "upperAir").sharePct < 1, "...leaving Open-Meteo ~0% below 5,000ft");
}

// ---- JSON round-trip (what the relay stores) ----
{
  const s = snap();
  const back = JSON.parse(JSON.stringify(s));
  t.eq(back.aircraft.length, s.aircraft.length, "snapshot survives JSON round-trip");
  t.ok(JSON.stringify(s).length < 60000, "40-aircraft-scale payload stays well under the relay size cap (this 2-aircraft one is tiny)");
}

t.done();
