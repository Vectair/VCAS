#!/usr/bin/env node
/**
 * Backfill historic weather onto logged observations (2026-10-12).
 *
 *   node tools/backfill_weather.js <logs-dir> <out.json> [--stations 3]
 *
 * <logs-dir> is a checkout of Vectair/vcas-logs (its observations/*.json).
 * For each observation it reconstructs what the model WOULD have seen:
 *   - METARs: the 3 nearest GB ASOS/METAR stations from the Iowa
 *     Environmental Mesonet archive, the report closest in time to the sighting;
 *   - Open-Meteo: archived hourly low/mid/high cloud cover at the position.
 * Output is a JSON array of { file, timestamp, weatherBackfilled } where
 * weatherBackfilled.source === "reconstructed" — always kept separate from
 * what the app actually recorded (computed.weatherUsed). Needs network access
 * to mesonet.agron.iastate.edu and archive-api.open-meteo.com (not reachable
 * from the default cloud sandbox). Plain Node 18+, no dependencies.
 *
 * NOT verified against live responses from the authoring sandbox: field names
 * follow IEM's documented asos.py "data=all" CSV and Open-Meteo's archive API.
 */
const fs = require("fs");
const path = require("path");

const [dir, outFile] = process.argv.slice(2);
if (!dir || !outFile) { console.error("usage: backfill_weather.js <logs-dir> <out.json>"); process.exit(1); }
const NSTA = 3, WINDOW_H = 2, MAX_NM = 60;

const rad = d => d * Math.PI / 180;
function nm(a, b, c, d) { // haversine, nautical miles
  const R = 3440.065, dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let omBlocked = false; // set once Open-Meteo reports its daily limit (429): stop asking
async function get(url, asText) {
  for (let i = 0; i < 3; i++) {
    try {
      if (omBlocked && url.includes("open-meteo")) return null;
      const r = await fetch(url);
      if (r.ok) return asText ? r.text() : r.json();
      if (r.status === 429 && url.includes("open-meteo")) { omBlocked = true; console.error("Open-Meteo rate limited; skipping upperAir"); return null; }
    } catch (e) { /* retry */ }
    await sleep(1000 * (i + 1));
  }
  return null;
}

function parseCsv(text) {
  const lines = text.split("\n").filter(l => l && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const head = lines[0].split(",");
  return lines.slice(1).map(l => { const v = l.split(","); const o = {}; head.forEach((h, i) => o[h] = v[i]); return o; });
}
const num = v => (v == null || v === "" || v === "M") ? null : Number(v);

function toStation(row, st, userLat, userLon, elevFt) {
  const clouds = [];
  for (let i = 1; i <= 4; i++) {
    const cover = row["skyc" + i], base = num(row["skyl" + i]);
    if (!cover || cover === "M") continue;
    const baseFt = base;
    clouds.push({ cover, baseFt, baseMslFt: baseFt == null ? null : baseFt + (elevFt || 0) });
  }
  const wx = (row.wxcodes && row.wxcodes !== "M") ? row.wxcodes.trim() : null;
  return {
    stationId: st.sid, stationLat: st.lat, stationLon: st.lon, elevationFt: elevFt,
    distanceNm: nm(userLat, userLon, st.lat, st.lon),
    visibilitySm: num(row.vsby), clouds: clouds.filter(c => ["BKN", "OVC", "VV"].includes(c.cover) && c.baseFt != null),
    allClouds: clouds, wxString: wx,
    windDirDeg: num(row.drct), windSpeedKt: num(row.sknt),
    obsTime: Math.floor(new Date(row.valid.replace(" ", "T") + "Z").getTime() / 1000), rawOb: row.metar || null,
  };
}

(async () => {
  const files = fs.readdirSync(path.join(dir, "observations")).filter(f => f.endsWith(".json")).sort();
  console.error("observations:", files.length);
  const net = await get("https://mesonet.agron.iastate.edu/geojson/network/GB__ASOS.geojson");
  if (!net) { console.error("could not fetch IEM station list (network blocked?)"); process.exit(2); }
  const stations = net.features.map(f => ({ sid: f.properties.sid, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], elevM: f.properties.elevation }));
  const out = [];
  for (const f of files) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, "observations", f), "utf8"));
    const lat = o.user && o.user.lat, lon = o.user && o.user.lon, t = new Date(o.timestamp);
    if (typeof lat !== "number" || isNaN(t)) continue;
    const near = stations.map(s => Object.assign({ d: nm(lat, lon, s.lat, s.lon) }, s)).filter(s => s.d <= MAX_NM).sort((a, b) => a.d - b.d).slice(0, NSTA + 3);
    const from = new Date(t.getTime() - WINDOW_H * 3600e3), to = new Date(t.getTime() + WINDOW_H * 3600e3);
    const rec = [];
    for (const s of near) {
      const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${s.sid}&data=all&year1=${from.getUTCFullYear()}&month1=${from.getUTCMonth() + 1}&day1=${from.getUTCDate()}&hour1=${from.getUTCHours()}&year2=${to.getUTCFullYear()}&month2=${to.getUTCMonth() + 1}&day2=${to.getUTCDate()}&hour2=${to.getUTCHours()}&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&direct=no&report_type=3&report_type=4`;
      const rows = parseCsv(await get(url, true) || "");
      // report closest in time that is not AFTER the sighting by more than 10 min (the app only ever sees past reports)
      let best = null;
      for (const r of rows) {
        const dt = new Date(r.valid.replace(" ", "T") + "Z").getTime() - t.getTime();
        if (dt > 10 * 60e3) continue;
        if (!best || dt > best.dt) best = { r, dt };
      }
      if (best) rec.push(toStation(best.r, s, lat, lon, s.elevM != null ? s.elevM * 3.28084 : null));
      await sleep(250);
    }
    const day = t.toISOString().slice(0, 10);
    const om = await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${day}&end_date=${day}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=UTC`);
    let upperAir = null;
    if (om && om.hourly && om.hourly.time) {
      const idx = om.hourly.time.findIndex(x => new Date(x + "Z").getUTCHours() === t.getUTCHours());
      if (idx >= 0) upperAir = { cloudCoverLowPct: om.hourly.cloud_cover_low[idx], cloudCoverMidPct: om.hourly.cloud_cover_mid[idx], cloudCoverHighPct: om.hourly.cloud_cover_high[idx], elevationFt: om.elevation != null ? om.elevation * 3.28084 : null, gridLat: om.latitude, gridLon: om.longitude };
    }
    out.push({ file: f, timestamp: o.timestamp, weatherBackfilled: { source: "reconstructed", metar: rec.length ? Object.assign({}, rec[0], { stations: rec.sort((a, b) => a.distanceNm - b.distanceNm) }) : null, upperAir } });
    console.error("done", f, rec.length, "stations");
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.error("wrote", outFile);
})();
