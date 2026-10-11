/**
 * Real-execution checks for src/logic/lowLevelWeather.js and its use in
 * Visibility.estimate() — the blended low-level weather estimate
 * (2026-10-11): up to 3 nearest METARs by inverse-distance-squared, trust
 * fading with range, Open-Meteo taking the remainder.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");
const { Geo, LowLevelWeather: LL, Visibility } = loadLogic();
const t = createSuite("lowLevelWeather.js");

const U = { lat: 53.5, lon: -3.0 };
const at = (distNm, bearing) => Geo.destinationPoint(U.lat, U.lon, bearing, distNm * 1852);
const st = (id, distNm, bearing, extra) => {
  const p = at(distNm, bearing);
  return Object.assign({ stationId: id, stationLat: p.lat, stationLon: p.lon, visibilitySm: 10, clouds: [] }, extra || {});
};
const blend = stations => LL.blend(U.lat, U.lon, { stations }, Date.now() + Math.random());

// No stations at all -> Open-Meteo is the whole low-level estimate
{
  const b = blend([]);
  t.eq(b.stations.length, 0, "no stations -> none blended");
  t.eq(b.upperAirPct, 100, "no stations -> Open-Meteo is 100%");
  t.ok(!b.hasMetar, "hasMetar false");
}
// Standing at an airfield: ~100% that station
{
  const b = blend([st("EGGP", 0.2, 10), st("EGCW", 9, 90), st("EGNO", 10, 200)]);
  t.ok(b.stations[0].weightPct > 99, "at the airfield, that METAR is >99% (got " + b.stations[0].weightPct + ")");
  t.ok(b.metarPct > 99.5, "METAR total >99.5%");
}
// Equidistant between two -> 50/50
{
  const b = blend([st("A", 8, 0), st("B", 8, 180)]);
  t.approx(b.stations[0].weightPct, 50, 0.2, "equidistant stations split 50/50");
  t.approx(b.stations[1].weightPct, 50, 0.2, "equidistant stations split 50/50 (other)");
  t.approx(b.upperAirPct, 0, 0.2, "both trusted -> Open-Meteo ~0% low-level");
}
// Only the 3 nearest are used
{
  const b = blend([st("A", 3, 0), st("B", 4, 90), st("C", 5, 180), st("D", 6, 270)]);
  t.eq(b.stations.length, 3, "caps at 3 stations");
  t.ok(!b.stations.some(s => s.stationId === "D"), "the farthest is dropped");
}
// Nearer station weighs more
{
  const b = blend([st("NEAR", 4, 0), st("FAR", 12, 180)]);
  t.ok(b.stations[0].stationId === "NEAR" && b.stations[0].weightPct > b.stations[1].weightPct, "nearer station has the larger share");
}
// Trust fades: lone station at 27.5nm (midpoint of 15..40) -> ~50% METAR
{
  const b = blend([st("LONE", 27.5, 0)]);
  t.approx(b.metarPct, 50, 1, "lone station at the trust midpoint is ~50% METAR");
  t.approx(b.upperAirPct, 50, 1, "...and ~50% Open-Meteo");
}
{
  const b = blend([st("FAR", 45, 0)]);
  t.eq(b.metarPct, 0, "station beyond the trust range gets no weight");
  t.eq(b.upperAirPct, 100, "Open-Meteo takes all of the low level");
}
// Stale METAR (closed field) is ignored
{
  const old = Math.floor(Date.now() / 1000) - 3 * 3600;
  const b = blend([st("OLD", 2, 0, { obsTime: old }), st("OK", 10, 90)]);
  t.ok(!b.stations.some(s => s.stationId === "OLD"), "a >2h-old METAR is ignored");
}
// Legacy single-station shape (no .stations) still works
{
  const b = LL.blend(U.lat, U.lon, st("LEG", 1, 0), Date.now() + 5);
  t.eq(b.stations.length, 1, "legacy single-station metar object is accepted");
}

// ---- in Visibility.estimate ----
const ac = (distNm, altFt) => {
  const p = at(distNm, 45);
  return { hex: "x", lat: p.lat, lon: p.lon, altitudeFt: altFt, type: "B738", category: "A3", lastSeenSeconds: 2 };
};
const baseline = Visibility.estimate(U.lat, U.lon, ac(2, 4000), null, null, null, null);
const ovcHere = st("HERE", 0.3, 0, { clouds: [{ cover: "OVC", baseFt: 1500, baseMslFt: 1500 }] });
const clr = (id, d, b) => st(id, d, b);
{
  const r = Visibility.estimate(U.lat, U.lon, ac(2, 4000), { stations: [ovcHere] }, null, null, null);
  t.eq(r.label, "Very unlikely/not visible", "overcast at the user's own station blocks an aircraft above it");
}
{
  // 2 clear + 1 overcast, all similar distance: blended severity ~0.33 -> stays below the 0.35 broken threshold
  const r = Visibility.estimate(U.lat, U.lon, ac(2, 4000), { stations: [
    clr("A", 8, 0), clr("B", 8, 120), st("C", 8, 240, { clouds: [{ cover: "OVC", baseFt: 1500, baseMslFt: 1500 }] })] }, null, null, null);
  t.eq(r.label, baseline.label, "one overcast station of three equal ones does not block (weighted ~33%)");
}
{
  // 1 clear + 1 overcast equal distance: 50% -> broken-like cap
  const r = Visibility.estimate(U.lat, U.lon, ac(2, 4000), { stations: [
    clr("A", 8, 0), st("C", 8, 180, { clouds: [{ cover: "OVC", baseFt: 1500, baseMslFt: 1500 }] })] }, null, null, null);
  t.ok(r.score <= 33, "half the weight on overcast caps at Possibly visible");
}
{
  // Cloud layer above 5000ft AGL is ignored by the low-level blend
  const r = Visibility.estimate(U.lat, U.lon, ac(2, 20000), { stations: [
    st("HERE", 0.3, 0, { clouds: [{ cover: "OVC", baseFt: 8000, baseMslFt: 8000 }] })] }, null, null, null);
  const base = Visibility.estimate(U.lat, U.lon, ac(2, 20000), null, null, null, null);
  t.eq(r.label, base.label, "METAR layers above 5000ft AGL are not used (Open-Meteo's job)");
}
{
  // Blended visibility: 1sm here vs 10sm elsewhere, equal weights -> 5.5sm = 4.8nm; aircraft at 6nm is capped, at 3nm is not
  const stations = [st("A", 8, 0, { visibilitySm: 1 }), st("B", 8, 180, { visibilitySm: 10 })];
  const far = Visibility.estimate(U.lat, U.lon, ac(6, 3000), { stations }, null, null, null);
  const near = Visibility.estimate(U.lat, U.lon, ac(3, 3000), { stations }, null, null, null);
  const farBase = Visibility.estimate(U.lat, U.lon, ac(6, 3000), null, null, null, null);
  t.ok(far.score < farBase.score || farBase.score <= 33, "aircraft beyond the blended visibility is capped");
  const nearBase = Visibility.estimate(U.lat, U.lon, ac(3, 3000), null, null, null, null);
  t.eq(near.label, nearBase.label, "aircraft inside the blended visibility is untouched");
}
{
  // Trace note names the blend
  const r = Visibility.estimate(U.lat, U.lon, ac(2, 4000), { stations: [clr("EGGP", 8, 0), clr("EGCW", 8, 180)] }, null, null, null);
  const m = r.trace.find(x => x.stage === "metar");
  t.ok(/EGGP 50%/.test(m.note) && /EGCW 50%/.test(m.note), "trace note shows each station's share (" + m.note + ")");
}

t.done();
