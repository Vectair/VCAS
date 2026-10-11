/**
 * Real-execution checks for src/logic/presentWeather.js and its use by
 * LowLevelWeather (wind/upwind weighting) and Visibility.estimate()
 * (2026-10-12): present-weather modifiers, capped and geometry-aware.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");
const { Geo, LowLevelWeather: LL, PresentWeather: PW, Visibility } = loadLogic();
const t = createSuite("presentWeather.js");

// --- parsing / classification ---
t.ok(!PW.analyse(null).present && !PW.analyse("").present, "empty/null -> no weather");
t.ok(!PW.analyse("NOTACODE").present, "garbage token ignored");
{
  const fg = PW.analyse("FG");
  t.eq(fg.impliedVisFogSm, 0.6, "fog implies <1km vis (fog-type ceiling)");
  t.eq(fg.impliedVisSm, null, "fog is not an any-height ceiling");
  t.ok(fg.fogAdd >= 0.5, "fog -> strong low-level add");
  t.eq(fg.precipAdd, 0, "fog is not precipitation");
  const shallow = PW.analyse("MIFG");
  t.eq(shallow.impliedVisFogSm, null, "shallow fog: no horizontal vis ceiling");
  t.eq(shallow.fogAdd, 0, "shallow fog: no severity (sky above stays clear)");
  t.ok(shallow.fogLike, "shallow fog still flagged fog-like (wind weighting)");
  t.ok(PW.analyse("BCFG").fogAdd === 0 && PW.analyse("PRFG").fogAdd === 0, "patches/partial fog also shallow");
}
{
  const l = PW.analyse("-RA"), m = PW.analyse("RA"), h = PW.analyse("+RA");
  t.ok(l.precipAdd < m.precipAdd && m.precipAdd < h.precipAdd, "rain add grows with intensity");
  t.ok(l.impliedVisSm > m.impliedVisSm && m.impliedVisSm > h.impliedVisSm, "rain vis ceiling falls with intensity");
  t.eq(h.precipAdd, PW.MAX_ADD, "heavy rain reaches the cap");
}
{
  const ra = PW.analyse("RA"), sh = PW.analyse("SHRA"), vc = PW.analyse("VCSH");
  t.ok(sh.precipAdd < ra.precipAdd, "showers are patchier than continuous rain");
  t.ok(sh.impliedVisSm >= 5, "showers: vis dips are local (ceiling relaxed)");
  t.ok(vc.precipAdd < sh.precipAdd, "vicinity weaker than at-station");
  t.eq(vc.impliedVisSm, null, "vicinity gives no vis ceiling");
}
{
  const ts = PW.analyse("TS"), tsra = PW.analyse("+TSRA");
  t.ok(ts.present && ts.precipAdd >= 0.4, "bare TS is a strong modifier");
  t.eq(tsra.precipAdd, PW.MAX_ADD, "heavy TSRA at the cap");
  t.ok(PW.analyse("VCTS").precipAdd < ts.precipAdd, "VCTS weaker than TS");
}
t.ok(PW.analyse("-RA BR").impliedVisFogSm === 3 && PW.analyse("-RA BR").fogAdd > 0, "multiple groups combine (mist sets the ceiling)");
t.ok(PW.analyse("RASN").present, "two-phenomenon token parsed");
t.ok(PW.analyse("-FZRA").precipAdd > PW.analyse("-RA").precipAdd, "freezing adds a bit");

// --- age decay: transient weather decays, fog does not ---
{
  const fresh = PW.analyse("SHRA", 5), old = PW.analyse("SHRA", 100);
  t.ok(old.precipAdd < fresh.precipAdd && old.precipAdd > 0, "old shower report counts for less, not zero");
  t.eq(PW.analyse("FG", 5).fogAdd, PW.analyse("FG", 100).fogAdd, "fog does not decay with age");
}

// --- geometry: fog is shallow, precipitation reaches higher ---
{
  const fg = PW.analyse("FG"), ra = PW.analyse("+RA");
  t.eq(PW.visCeilingFor(fg, 500), 0.6, "low aircraft: fog ceiling applies");
  t.eq(PW.visCeilingFor(fg, 3500), null, "high aircraft: fog ceiling does not");
  t.ok(PW.severityAdd(fg, 500) > 0.4, "fog hits a low aircraft");
  t.eq(PW.severityAdd(fg, 3500), 0, "fog does not touch an aircraft above 3,000ft AGL");
  t.ok(PW.severityAdd(ra, 4000) > 0.4, "heavy rain still affects a 4,000ft aircraft");
  t.eq(PW.severityAdd(ra, 12000), 0, "rain fades out by 10,000ft AGL");
  t.ok(PW.severityAdd(fg, 500) <= PW.MAX_ADD && PW.severityAdd(ra, 500) <= PW.MAX_ADD, "never above the cap");
  t.eq(PW.severityAdd(null, 500), 0, "no weather -> 0");
}

// --- wind / upwind weighting in the blend ---
const U = { lat: 53.5, lon: -3.0 };
const at = (d, b) => Geo.destinationPoint(U.lat, U.lon, b, d * 1852);
const stn = (id, d, b, extra) => { const p = at(d, b); return Object.assign({ stationId: id, stationLat: p.lat, stationLon: p.lon, visibilitySm: 10, clouds: [] }, extra || {}); };
const blend = stations => LL.blend(U.lat, U.lon, { stations }, Date.now() + Math.random());
{
  // North station + south station, equidistant. Wind FROM the north (360) at 15kt
  // carries the north station's weather to the user: north should outweigh south.
  const b = blend([stn("N", 10, 0, { windDirDeg: 360, windSpeedKt: 15 }), stn("S", 10, 180, { windDirDeg: 360, windSpeedKt: 15 })]);
  const n = b.stations.find(s => s.stationId === "N"), s = b.stations.find(s => s.stationId === "S");
  t.ok(n.weightPct > s.weightPct, "upwind station outweighs downwind (" + n.weightPct + " vs " + s.weightPct + ")");
  const bs = blend([stn("N", 10, 0, { windDirDeg: 180, windSpeedKt: 15 }), stn("S", 10, 180, { windDirDeg: 180, windSpeedKt: 15 })]);
  t.ok(bs.stations.find(x => x.stationId === "S").weightPct > bs.stations.find(x => x.stationId === "N").weightPct, "southerly flips it");
}
{
  const calm = blend([stn("N", 10, 0, { windDirDeg: 360, windSpeedKt: 2 }), stn("S", 10, 180, { windDirDeg: 360, windSpeedKt: 2 })]);
  t.ok(Math.abs(calm.stations[0].weightPct - calm.stations[1].weightPct) < 0.2, "calm wind -> no bias");
  const none = blend([stn("N", 10, 0), stn("S", 10, 180)]);
  t.ok(Math.abs(none.stations[0].weightPct - none.stations[1].weightPct) < 0.2, "no wind data -> no bias");
  const vrb = blend([stn("N", 10, 0, { windDirDeg: null, windSpeedKt: 12 }), stn("S", 10, 180, { windDirDeg: null, windSpeedKt: 12 })]);
  t.ok(Math.abs(vrb.stations[0].weightPct - vrb.stations[1].weightPct) < 0.2, "variable wind -> no bias");
}
{
  const cl = blend([stn("N", 10, 0, { windDirDeg: 360, windSpeedKt: 15 }), stn("S", 10, 180, { windDirDeg: 360, windSpeedKt: 15 })]);
  const fog = blend([stn("N", 10, 0, { windDirDeg: 360, windSpeedKt: 15, wxString: "BR" }), stn("S", 10, 180, { windDirDeg: 360, windSpeedKt: 15 })]);
  const gapCloud = cl.stations.find(s => s.stationId === "N").weightPct - cl.stations.find(s => s.stationId === "S").weightPct;
  const gapFog = fog.stations.find(s => s.stationId === "N").weightPct - fog.stations.find(s => s.stationId === "S").weightPct;
  t.ok(gapFog < gapCloud, "fog-type reports respond less to wind than cloud/rain");
}
{
  // Weights still never exceed 100% in total, and trust still applies
  const b = blend([stn("N", 10, 0, { windDirDeg: 360, windSpeedKt: 25 }), stn("S", 10, 180, { windDirDeg: 360, windSpeedKt: 25 })]);
  t.ok(b.metarPct <= 100.01, "metarPct <= 100");
}

// --- scoring: present weather moves tiers, without double-counting ---
const AC = { hex: "x", type: "A320", category: "A3", altitudeFt: 3000, lastSeenSeconds: 1 };
const acAt = (d, extra) => { const p = at(d, 90); return Object.assign({}, AC, { lat: p.lat, lon: p.lon }, extra || {}); };
const est = (ac, stations) => Visibility.estimate(U.lat, U.lon, ac, { stations: stations.map(s => Object.assign({ distanceNm: 0 }, s)) }, null, null, null);
{
  const ac = acAt(4);
  const clear = est(ac, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000 })]);
  const heavy = est(ac, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000, wxString: "+RA" })]);
  t.ok(heavy.score < clear.score, "heavy rain at the station lowers a good-vis aircraft (" + clear.label + " -> " + heavy.label + ")");
  t.ok(heavy.score > 10, "present weather alone never drops to the worst tier");
  const light = est(ac, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000, wxString: "-DZ" })]);
  t.ok(light.score >= heavy.score, "drizzle weaker than heavy rain");
}
{
  // Fog does not touch a high aircraft
  const hi = acAt(4, { altitudeFt: 9000 });
  const a = est(hi, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000 })]);
  const b = est(hi, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000, wxString: "FG", visibilitySm: 10 })]);
  t.ok(b.score >= a.score || b.trace.find(x => x.stage === "metar"), "(structure) fog case evaluated");
  const loFog = est(acAt(1, { altitudeFt: 400 }), [stn("A", 0.3, 0, { obsTime: Date.now() / 1000, wxString: "FG", visibilitySm: 10 })]);
  const loClear = est(acAt(1, { altitudeFt: 400 }), [stn("A", 0.3, 0, { obsTime: Date.now() / 1000 })]);
  t.ok(loFog.score < loClear.score, "fog hits a low aircraft even if prevailing vis was left at 10");
  t.eq(b.score, a.score, "fog does not change a 9,000ft aircraft");
}
{
  // No double-counting: vis already low + fog reports once
  const ac = acAt(3, { altitudeFt: 600 });
  const both = est(ac, [stn("A", 0.3, 0, { obsTime: Date.now() / 1000, wxString: "FG", visibilitySm: 0.3 })]);
  t.ok(both.score >= 10, "still a valid tier");
  const note = both.trace.find(x => x.stage === "metar").note;
  t.ok(/FG/.test(note), "trace note mentions the weather group");
}
t.done();
