/**
 * Real-execution checks for src/logic/relevance.js — the teardrop
 * relevance filter deciding which aircraft are worth showing at all,
 * independent of how visible they'd be once looked at. See CLAUDE.md's
 * "Contrail visibility — Relevance range + Visibility score" entry for the
 * real field-confirmed gap (a fixed 15nm cap excluding a genuinely
 * identifiable high-altitude jet) that motivated the high-altitude range
 * extension tested below.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo, Relevance } = loadLogic();
const t = createSuite("relevance.js");

const BASE_USER_STATE = { lat: 0, lon: 0, heading: 0, speedMph: 0 };

function vis(slantRangeNm, elevationDeg) {
  return { slantRangeNm, elevationDeg };
}

function aircraft(overrides) {
  return Object.assign({ lat: 0, lon: 0, altitudeFt: 5000, trackDeg: null, groundSpeedKt: null }, overrides);
}

// ---- overhead override ----
{
  const r = Relevance.evaluate(BASE_USER_STATE, aircraft(), 170, vis(999, 75));
  t.eq(r.relevant, true, "elevation > 70deg is relevant regardless of bearing/range");
  t.eq(r.reason, "overhead", "the overhead reason is reported");
  t.eq(r.enterInSeconds, 0, "overhead is immediate (enterInSeconds 0)");

  const rBoundary = Relevance.evaluate(BASE_USER_STATE, aircraft(), 0, vis(3, 70));
  t.ok(rBoundary.reason !== "overhead", "elevation exactly 70deg is NOT overhead (strictly '> 70', not '>= 70')");
}

// ---- teardrop shape: exact closed-form values at default opts ----
{
  // Dead ahead (0deg): boundary is exactly rMaxNm (15).
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 0, vis(15, 0)).relevant, true,
    "dead-ahead range exactly at rMaxNm (15nm) is relevant (inclusive boundary)");
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 0, vis(15.5, 0)).relevant, false,
    "dead-ahead range just beyond rMaxNm is not relevant (no track data, so no predicted-entry rescue either)");

  // Dead behind (180deg): boundary is exactly rMinNm (3).
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 180, vis(3, 0)).relevant, true,
    "dead-behind range exactly at rMinNm (3nm) is relevant");
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 180, vis(3.5, 0)).relevant, false,
    "dead-behind range just beyond rMinNm is not relevant");

  // 60deg, pinchExponent=2: documented exact value from CLAUDE.md's own
  // Kotlin-port test suite writeup — teardropRangeNm(60) == 9.75 exactly.
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 60, vis(9.75, 0)).relevant, true,
    "60deg boundary matches the documented exact teardrop value (9.75nm)");
  t.eq(Relevance.evaluate(BASE_USER_STATE, aircraft(), 60, vis(9.76, 0)).relevant, false,
    "just beyond the 60deg boundary is not relevant");
}

// ---- high-altitude range extension ----
{
  const highAlt = aircraft({ altitudeFt: 30000 }); // >= contrailMinAltitudeFt (26000)
  const lowAlt = aircraft({ altitudeFt: 5000 });    // below the threshold

  const rExtended = Relevance.evaluate(BASE_USER_STATE, highAlt, 0, vis(40, 0));
  t.eq(rExtended.relevant, true, "a 30000ft aircraft at 40nm dead-ahead IS relevant (extended teardrop, cap 50)");

  const rNotExtended = Relevance.evaluate(BASE_USER_STATE, lowAlt, 0, vis(40, 0));
  t.eq(rNotExtended.relevant, false,
    "the SAME 40nm dead-ahead range is NOT relevant at 5000ft (base rMaxNm=15, no extension) — proves the extension is genuinely conditional on altitude");

  // Altitude eligibility boundary: exactly at vs just below contrailMinAltitudeFt.
  const rAtThreshold = Relevance.evaluate(BASE_USER_STATE, aircraft({ altitudeFt: 26000 }), 0, vis(40, 0));
  const rBelowThreshold = Relevance.evaluate(BASE_USER_STATE, aircraft({ altitudeFt: 25999 }), 0, vis(40, 0));
  t.eq(rAtThreshold.relevant, true, "altitude exactly at the 26000ft threshold IS extended (inclusive '>=')");
  t.eq(rBelowThreshold.relevant, false, "altitude 1ft below the threshold is NOT extended");

  // A custom rMaxNm larger than the extension cap survives unshrunk.
  const rCustomCap = Relevance.evaluate(BASE_USER_STATE, highAlt, 0, vis(58, 0), { rMaxNm: 60 });
  t.eq(rCustomCap.relevant, true,
    "a custom rMaxNm (60) larger than rangeExtensionCapNm (50) is not clamped down to 50 (max(rMaxNm, cap))");
}

// ---- predicted-entry: cross-checked against an independent reimplementation ----
// Deliberately NOT copied from relevance.js's own _predictedEntrySeconds —
// freshly written against the documented algorithm using only Geo's own
// already-verified public functions, so this proves the real
// implementation's specific sampling behaviour (step size, sample count,
// early-return-on-first-match) against independently-derived ground truth,
// not against itself. Mirrors this project's own established pattern for
// this exact function (see CLAUDE.md's Kotlin RelevanceTest writeup).
function independentEntrySeconds(userState, ac, opts) {
  const stepSeconds = opts.lookaheadSeconds / opts.lookaheadSamples;
  const userIsMoving = (userState.speedMph || 0) >= opts.stationarySpeedMph;
  for (let i = 1; i <= opts.lookaheadSamples; i++) {
    const tSec = stepSeconds * i;
    const acSpeedMps = ac.groundSpeedKt * 0.514444;
    const acPos = Geo.projectPosition(ac.lat, ac.lon, ac.trackDeg, acSpeedMps * tSec);
    const userPos = userIsMoving
      ? Geo.projectPosition(userState.lat, userState.lon, userState.heading, (userState.speedMph || 0) * 0.44704 * tSec)
      : { lat: userState.lat, lon: userState.lon };
    const bearing = Geo.calculateBearing(userPos.lat, userPos.lon, acPos.lat, acPos.lon);
    const relBearing = Geo.calculateRelativeBearing(bearing, userState.heading);
    const rangeNm = Geo.calculateDistanceNm(userPos.lat, userPos.lon, acPos.lat, acPos.lon);
    const rad = (relBearing * Math.PI) / 180;
    const f = Math.pow((1 + Math.cos(rad)) / 2, opts.pinchExponent);
    const teardropRangeNm = opts.rMinNm + (opts.rMaxNm - opts.rMinNm) * f;
    if (rangeNm <= teardropRangeNm) return tSec;
  }
  return null;
}

{
  const opts = Relevance.DEFAULTS;

  // A converging, stationary-observer scenario: aircraft starts just
  // outside the teardrop, heading toward the observer.
  const start = Geo.destinationPoint(0, 0, 0, 16 * 1852); // 16nm dead north, just beyond rMaxNm=15
  const convergingAc = aircraft({ lat: start.lat, lon: start.lon, trackDeg: 180, groundSpeedKt: 300 });
  const rConverging = Relevance.evaluate(BASE_USER_STATE, convergingAc, 0, vis(16, 0), opts);
  const expectedConverging = independentEntrySeconds(BASE_USER_STATE, convergingAc, opts);
  t.ok(expectedConverging !== null, "sanity check: the independent reimplementation itself finds a convergence sample");
  t.eq(rConverging.relevant, true, "a converging aircraft is correctly found relevant via predicted-entry");
  t.eq(rConverging.reason, "predicted-entry", "the predicted-entry reason is reported");
  t.eq(rConverging.enterInSeconds, expectedConverging,
    "enterInSeconds exactly matches an independent reimplementation of the same sampling algorithm");

  // A moving-user scenario, exercising the userIsMoving branch.
  const movingUserState = { lat: 0, lon: 0, heading: 0, speedMph: 40 };
  const rConvergingMoving = Relevance.evaluate(movingUserState, convergingAc, 0, vis(16, 0), opts);
  const expectedMoving = independentEntrySeconds(movingUserState, convergingAc, opts);
  t.eq(rConvergingMoving.enterInSeconds, expectedMoving,
    "the userIsMoving branch also exactly matches the independent reimplementation");

  // A diverging aircraft (flying away) never converges within the window.
  const divergingAc = aircraft({ lat: start.lat, lon: start.lon, trackDeg: 0, groundSpeedKt: 300 });
  const rDiverging = Relevance.evaluate(BASE_USER_STATE, divergingAc, 0, vis(16, 0), opts);
  t.eq(rDiverging.relevant, false, "a diverging aircraft is correctly found NOT relevant");
  t.eq(rDiverging.reason, null, "a not-relevant result carries a null reason");
  t.eq(rDiverging.enterInSeconds, null, "a not-relevant result carries a null enterInSeconds");

  // Missing track/speed data short-circuits predicted-entry to null.
  const noTrackAc = aircraft({ lat: start.lat, lon: start.lon, trackDeg: null, groundSpeedKt: 300 });
  t.eq(Relevance.evaluate(BASE_USER_STATE, noTrackAc, 0, vis(16, 0), opts).relevant, false,
    "missing trackDeg short-circuits predicted-entry (never relevant via that path)");
  const noSpeedAc = aircraft({ lat: start.lat, lon: start.lon, trackDeg: 180, groundSpeedKt: null });
  t.eq(Relevance.evaluate(BASE_USER_STATE, noSpeedAc, 0, vis(16, 0), opts).relevant, false,
    "missing groundSpeedKt short-circuits predicted-entry (never relevant via that path)");
}

// ---- options override merges with DEFAULTS, doesn't wipe them ----
{
  const r = Relevance.evaluate(BASE_USER_STATE, aircraft(), 0, vis(5, 0), { rMaxNm: 5 });
  t.eq(r.relevant, true, "a custom rMaxNm (5) is honoured at dead-ahead range 5nm");
  const rBehind = Relevance.evaluate(BASE_USER_STATE, aircraft(), 180, vis(3, 0), { rMaxNm: 5 });
  t.eq(rBehind.relevant, true,
    "overriding only rMaxNm leaves rMinNm (3) at its DEFAULTS value, not wiped out by Object.assign");
}

t.done();
