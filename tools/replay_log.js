#!/usr/bin/env node
/**
 * Replay logged observations through the CURRENT scoring code (2026-10-12).
 *
 *   node tools/replay_log.js <logs-dir> [backfill.json]
 *
 * For each observation: rebuilds the aircraft + user state from the log and
 * re-runs Visibility.estimate() with (a) the weather the app actually
 * recorded (computed.metar / upperAir), or (b) the reconstructed weather from
 * tools/backfill_weather.js when given and the record had none. Prints a
 * crosstab of outcome vs predicted tier (logged vs replayed) so constants in
 * visibility.js / lowLevelWeather.js / presentWeather.js can be tuned against
 * real outcomes. Plain Node, no dependencies.
 */
const fs = require("fs");
const path = require("path");
const { loadLogic } = require("../tests/support/loadLogic");
const { Visibility } = loadLogic();

const [dir, backfillFile] = process.argv.slice(2);
if (!dir) { console.error("usage: replay_log.js <logs-dir> [backfill.json]"); process.exit(1); }
const back = {};
if (backfillFile) for (const b of JSON.parse(fs.readFileSync(backfillFile, "utf8"))) back[b.file] = b.weatherBackfilled;

const files = fs.readdirSync(path.join(dir, "observations")).filter(f => f.endsWith(".json")).sort();
const table = {};
let n = 0, changed = 0;
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(path.join(dir, "observations", f), "utf8"));
  if (o.kind === "error" || !o.aircraft || !o.user) continue;
  const c = o.computed || {};
  const bf = back[f];
  const metar = c.metar || (bf && bf.metar) || null;
  const upperAir = c.upperAir || (bf && bf.upperAir) || null;
  const a = o.aircraft;
  const ac = Object.assign({}, a, { category: a.category || "A3", onGround: false });
  let v;
  try { v = Visibility.estimate(o.user.lat, o.user.lon, ac, metar, c.localObstruction || null, upperAir, null); } catch (e) { continue; }
  const logged = c.visibility && c.visibility.label || "?";
  const key = o.outcome + " | logged: " + logged + " -> replay: " + v.label;
  table[key] = (table[key] || 0) + 1;
  n++; if (logged !== v.label) changed++;
}
console.log("replayed", n, "observations;", changed, "changed tier\n");
Object.keys(table).sort().forEach(k => console.log(String(table[k]).padStart(4), k));
