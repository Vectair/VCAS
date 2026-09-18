/**
 * Real-execution checks for src/logic/contrail.js — the Schmidt-Appleman-
 * criterion (SAC) contrail formation/persistence check that replaced the
 * flat contrail floor in visibility.js. See CLAUDE.md's "Real
 * Schmidt-Appleman physics replaces the flat contrail floor" entry for the
 * full design writeup — this module is pure physics with no I/O, mirroring
 * geo.js's own precedent of self-contained math kept in its own file.
 *
 * Boundary values below are solved analytically from the module's own
 * formulas (reimplemented independently in a throwaway script, not copied
 * from contrail.js itself) rather than hand-guessed, the same discipline
 * every other test file in this suite already follows for its own
 * boundary checks.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Contrail } = loadLogic();
const t = createSuite("contrail.js");

// ---- degenerate inputs: never throws, always the same safe default ----
t.eq(JSON.stringify(Contrail.evaluate(null, 0.3)), JSON.stringify({ forms: false, persistent: false }),
  "null conditions -> forms/persistent both false");
t.eq(JSON.stringify(Contrail.evaluate(undefined, 0.3)), JSON.stringify({ forms: false, persistent: false }),
  "undefined conditions -> forms/persistent both false");
t.eq(JSON.stringify(Contrail.evaluate({ pressureHpa: null, temperatureC: -55, relativeHumidityPct: 70 }, 0.3)),
  JSON.stringify({ forms: false, persistent: false }), "null pressureHpa -> false/false");
t.eq(JSON.stringify(Contrail.evaluate({ pressureHpa: 238, temperatureC: null, relativeHumidityPct: 70 }, 0.3)),
  JSON.stringify({ forms: false, persistent: false }), "null temperatureC -> false/false");
t.eq(JSON.stringify(Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: null }, 0.3)),
  JSON.stringify({ forms: false, persistent: false }), "null relativeHumidityPct -> false/false");

// ---- mixing-line slope G undefined below 0.053 Pa/K (a low-pressure input) ----
{
  // At eff=0.3, solving G(pressureHpa)=0.053 analytically gives pressureHpa
  // ~= 7.93hPa — well below that (5hPa) should hit the "formula undefined"
  // early-return regardless of how favourable temp/RH are.
  const r = Contrail.evaluate({ pressureHpa: 5, temperatureC: -70, relativeHumidityPct: 90 }, 0.3);
  t.eq(r.forms, false, "G below 0.053 Pa/K -> forms false even at cold/humid conditions");
  t.eq(r.persistent, false, "G below 0.053 Pa/K -> persistent false");
}

// ---- "too warm at any humidity" boundary: temperatureC >= tLM ----
{
  // tLM solved analytically for pressureHpa=238/eff=0.3 (independently, via
  // the same Schumann polynomial fit): approx -42.266C.
  const TLM = -42.26603768048136;
  const atBoundary = Contrail.evaluate({ pressureHpa: 238, temperatureC: TLM, relativeHumidityPct: 100 }, 0.3);
  t.eq(atBoundary.forms, false, "temperatureC exactly at tLM (with >=, not >) never forms");
  const justBelow = Contrail.evaluate({ pressureHpa: 238, temperatureC: TLM - 0.01, relativeHumidityPct: 100 }, 0.3);
  t.eq(justBelow.forms, true, "temperatureC just below tLM, 100% RH, forms");
  t.eq(justBelow.persistent, true, "...and is persistent at 100% RH");
}

// ---- forms boundary: eAmbientHpa vs eCriticalHpa (relational, not exact-equality) ----
{
  // At pressureHpa=238/eff=0.3/temperatureC=-43 (just below tLM), the RH
  // that exactly balances eAmbientHpa against eCriticalHpa was solved
  // analytically to ~99.63%. Checked relationally (a small delta either
  // side), not via exact float equality, since eCriticalHpa/eSatLiquidAmbient
  // aren't round numbers.
  const RH_AT_FORMS_BOUNDARY = 99.63273907493011;
  const below = Contrail.evaluate({ pressureHpa: 238, temperatureC: -43, relativeHumidityPct: RH_AT_FORMS_BOUNDARY - 0.5 }, 0.3);
  t.eq(below.forms, false, "RH just below the forms boundary -> does not form");
  const above = Contrail.evaluate({ pressureHpa: 238, temperatureC: -43, relativeHumidityPct: RH_AT_FORMS_BOUNDARY + 0.5 }, 0.3);
  t.eq(above.forms, true, "RH just above the forms boundary -> forms");
}

// ---- persistence boundary: eAmbientHpa > eSatIceAmbient, strictly '>' not '>=' ----
{
  // At temperatureC=-55, the RH that exactly equals ice saturation (solved
  // analytically from the two Sonntag saturation-pressure formulas) is
  // ~60.644%. This is comfortably above the forms threshold at this cold a
  // temperature (verified separately below), so forms is true throughout —
  // isolating persistence's own strict '>' boundary.
  const RH_AT_ICE_BOUNDARY = 60.643781244909015;
  const atBoundary = Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: RH_AT_ICE_BOUNDARY }, 0.3);
  t.eq(atBoundary.forms, true, "at the exact ice-saturation RH, still forms");
  t.eq(atBoundary.persistent, false, "at the exact ice-saturation RH (strict '>', not '>='), NOT persistent");
  const above = Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: RH_AT_ICE_BOUNDARY + 0.5 }, 0.3);
  t.eq(above.persistent, true, "just above ice-saturation RH -> persistent");
  const below = Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: RH_AT_ICE_BOUNDARY - 0.5 }, 0.3);
  t.eq(below.forms, true, "just below ice-saturation RH -> still forms");
  t.eq(below.persistent, false, "just below ice-saturation RH -> not persistent");
}

// ---- representative real-world-shaped scenarios ----
{
  // Cold, humid cruise altitude (~FL350) -> forms, and persists (spreads to cirrus).
  const coldHumid = Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: 70 }, 0.3);
  t.eq(coldHumid.forms, true, "cold/humid FL350 -> forms");
  t.eq(coldHumid.persistent, true, "cold/humid FL350 -> persistent");

  // Same altitude/temperature, but dry air -> still forms (mixing-line
  // condensation only needs the exhaust plume's own path to cross liquid
  // saturation), but dissipates rather than persisting.
  const coldDry = Contrail.evaluate({ pressureHpa: 238, temperatureC: -55, relativeHumidityPct: 5 }, 0.3);
  t.eq(coldDry.forms, true, "cold/dry FL350 -> still forms");
  t.eq(coldDry.persistent, false, "cold/dry FL350 -> not persistent (dissipates)");

  // A mid-altitude, comparatively warm case (~FL180, -20C) -> genuinely
  // above the threshold temperature at this pressure, never forms
  // regardless of humidity.
  const midAltWarm = Contrail.evaluate({ pressureHpa: 500, temperatureC: -20, relativeHumidityPct: 80 }, 0.3);
  t.eq(midAltWarm.forms, false, "mid-altitude (~FL180, -20C) -> too warm to form");
  t.eq(midAltWarm.persistent, false, "mid-altitude (~FL180, -20C) -> not persistent");
}

// ---- engineEfficiency genuinely changes the mixing-line slope, not a dead parameter ----
{
  // Same ambient conditions, two different efficiencies -> G differs, so
  // the threshold temperature differs, so the same conditions can form at
  // one efficiency and not the other. Picked a temperature/RH pair
  // straddling exactly this.
  const lowEff = Contrail.evaluate({ pressureHpa: 238, temperatureC: -43, relativeHumidityPct: 99.9 }, 0.1);
  const highEff = Contrail.evaluate({ pressureHpa: 238, temperatureC: -43, relativeHumidityPct: 99.9 }, 0.5);
  t.ok(JSON.stringify(lowEff) !== JSON.stringify(highEff),
    "engineEfficiency genuinely changes the result for the same ambient conditions");
}

t.done();
