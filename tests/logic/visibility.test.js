/**
 * Real-execution checks for src/logic/visibility.js — the sightability
 * scoring pipeline (angular size, staleness, METAR/upper-air/local-
 * obstruction adjustments, the Schmidt-Appleman contrail rescue). See
 * CLAUDE.md's "Visibility model calibration pass #1/#2" and "Real
 * Schmidt-Appleman physics" entries for the real bugs (AGL/MSL cloud-base
 * mismatch, slant-vs-horizontal range, a flat 0deg overhead-elevation bug)
 * this file's own history has already caught and fixed.
 *
 * The real (non-guessed) forms/persistent condition combos below were
 * found by directly probing the shipped Contrail.evaluate() at 250hPa
 * before being written into these assertions — not derived from physics
 * reasoning — matching this project's own "verify against real execution,
 * don't assume" discipline.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo, Visibility } = loadLogic();
const t = createSuite("visibility.js");

const USER_LAT = 51.5, USER_LON = -0.12;

function aircraftAt(distNm, altitudeFt, opts) {
  const dest = Geo.destinationPoint(USER_LAT, USER_LON, 0, distNm * 1852);
  return Object.assign({
    lat: dest.lat, lon: dest.lon, altitudeFt,
    type: "C172", category: null, lastSeenSeconds: 1,
  }, opts);
}

// A two-point pressure profile with IDENTICAL temperature/humidity at both
// points but different pressures — _contrailConditionsAt() clamps to
// either end (or interpolates between two equal values) regardless of
// exactly which pressure an aircraft's altitude maps to, so this is a
// deterministic way to feed a known temperature/humidity into the contrail
// check without needing to hand-compute the aircraft's exact ISA pressure.
function flatProfile(temperatureC, relativeHumidityPct) {
  return [
    { pressureHpa: 100, temperatureC, relativeHumidityPct },
    { pressureHpa: 400, temperatureC, relativeHumidityPct },
  ];
}

// ---- very-close override ----
{
  const ac = aircraftAt(0.3, 200);
  const r = Visibility.estimate(USER_LAT, USER_LON, ac);
  t.eq(r.label, "Certainly visible", "very close (<1nm, <500ft) forces Certainly visible");
  t.eq(r.score, 100, "very close override carries the top score");
}

// ---- elevation angle (2026-09-13 review fix) ----
{
  // Dead overhead: same lat/lon as observer, real altitude.
  const overhead = { lat: USER_LAT, lon: USER_LON, altitudeFt: 10000, type: "B738", category: null, lastSeenSeconds: 1 };
  const rOverhead = Visibility.estimate(USER_LAT, USER_LON, overhead);
  t.approx(rOverhead.elevationDeg, 90, 1e-6, "an aircraft with zero horizontal offset reads elevationDeg ~90, not 0");

  // Ground-level target at a real horizontal distance.
  const ground = aircraftAt(5, 0);
  const rGround = Visibility.estimate(USER_LAT, USER_LON, ground);
  t.approx(rGround.elevationDeg, 0, 1e-6, "a ground-level (altitudeFt=0) target at range reads elevationDeg 0");

  // Fully degenerate: same position AND zero altitude — must read a clean
  // 0, not NaN (Math.atan2(0,0) === 0, no guard needed).
  const degenerate = { lat: USER_LAT, lon: USER_LON, altitudeFt: 0, type: "C172", category: null, lastSeenSeconds: 1 };
  const rDegenerate = Visibility.estimate(USER_LAT, USER_LON, degenerate);
  t.eq(rDegenerate.elevationDeg, 0, "same-position + zero-altitude reads elevationDeg exactly 0, never NaN");
  t.ok(Number.isFinite(rDegenerate.angularSizeDeg), "the degenerate case never produces a NaN/Infinity angular size");
}

// ---- staleness degrade ----
{
  const fresh = aircraftAt(2, 5000, { lastSeenSeconds: 20 });
  const stale = aircraftAt(2, 5000, { lastSeenSeconds: 21 });
  const rFresh = Visibility.estimate(USER_LAT, USER_LON, fresh);
  const rStale = Visibility.estimate(USER_LAT, USER_LON, stale);
  t.ok(rStale.score < rFresh.score, "lastSeenSeconds just above 20 degrades the category by one tier");
  t.eq(Visibility.estimate(USER_LAT, USER_LON, aircraftAt(2, 5000, { lastSeenSeconds: 20 })).score, rFresh.score,
    "the staleness boundary is strictly '> 20', not '>= 20'");

  // Never degrades past the worst tier.
  const alreadyWorst = aircraftAt(45, 5000, { lastSeenSeconds: 999 });
  const rWorst = Visibility.estimate(USER_LAT, USER_LON, alreadyWorst);
  t.eq(rWorst.label, "Very unlikely/not visible", "an already-worst-tier aircraft never degrades past the floor");
}

// ---- METAR: cloud occlusion (AGL/MSL-corrected) ----
{
  const ac = aircraftAt(5, 5000);
  const ovc = { clouds: [{ cover: "OVC", baseMslFt: 3000 }] };
  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, ovc).label, "Very unlikely/not visible",
    "an OVC layer below the aircraft's altitude forces the worst tier");

  const bkn = { clouds: [{ cover: "BKN", baseMslFt: 3000 }] };
  const rBkn = Visibility.estimate(USER_LAT, USER_LON, ac, bkn);
  t.ok(rBkn.score <= 33, "a BKN layer below the aircraft caps at Possibly visible, not a full block");

  const cloudAbove = { clouds: [{ cover: "OVC", baseMslFt: 8000 }] }; // above the 5000ft aircraft
  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, cloudAbove).label,
    Visibility.estimate(USER_LAT, USER_LON, ac, null).label,
    "a cloud layer ABOVE the aircraft's own altitude has no effect");

  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, null).label,
    Visibility.estimate(USER_LAT, USER_LON, ac, undefined).label,
    "a null/undefined metar is a full no-op either way");
}

// ---- METAR: horizontal (not slant) range for reported visibility ----
{
  // Near-overhead, high altitude: large SLANT range but small HORIZONTAL
  // offset — must NOT be capped by a low reported visibility figure, since
  // prevailing visibility is a horizontal/surface measurement.
  const nearOverhead = { lat: USER_LAT + 0.005, lon: USER_LON, altitudeFt: 35000, type: "B738", category: null, lastSeenSeconds: 1 };
  const lowVis = { visibilitySm: 2, clouds: [] };
  const rNoMetar = Visibility.estimate(USER_LAT, USER_LON, nearOverhead, null);
  const rNearOverhead = Visibility.estimate(USER_LAT, USER_LON, nearOverhead, lowVis);
  t.eq(rNearOverhead.label, rNoMetar.label,
    "a near-overhead aircraft's large slant range is not wrongly capped by low reported (horizontal) visibility");

  // Genuinely horizontally distant: must be capped.
  const farAway = aircraftAt(30, 20000);
  const rFar = Visibility.estimate(USER_LAT, USER_LON, farAway, lowVis);
  t.ok(rFar.score <= 33, "a genuinely horizontally-distant aircraft IS capped by a low reported visibility figure");

  // 10SM boundary: '< 10', not '<= 10' — 10SM itself must not trigger the cap.
  const exactlyTen = { visibilitySm: 10, clouds: [] };
  const rExactlyTen = Visibility.estimate(USER_LAT, USER_LON, farAway, exactlyTen);
  const rNoMetarFar = Visibility.estimate(USER_LAT, USER_LON, farAway, null);
  t.eq(rExactlyTen.label, rNoMetarFar.label, "exactly 10SM reported visibility does not trigger the cap (< 10, not <= 10)");
}

// ---- Upper-air cloud-band cap ----
{
  const midBandAircraft = aircraftAt(2, 15000); // ~15,000ft AGL sits in the mid band
  const denseMid = { cloudCoverMidPct: 90, cloudCoverHighPct: 0, elevationFt: 0 };
  const rDense = Visibility.estimate(USER_LAT, USER_LON, midBandAircraft, null, null, denseMid);
  t.ok(rDense.score <= 33, "dense mid-band cloud cover caps a mid-altitude aircraft at Possibly visible");

  const lowBandAircraft = aircraftAt(2, 3000); // within the low band, METAR's own domain
  const rLowImmune = Visibility.estimate(USER_LAT, USER_LON, lowBandAircraft, null, null,
    { cloudCoverLowPct: 100, elevationFt: 0 });
  const rLowNoUpperAir = Visibility.estimate(USER_LAT, USER_LON, lowBandAircraft, null, null, null);
  t.eq(rLowImmune.label, rLowNoUpperAir.label,
    "low-band traffic is immune to the upper-air adjustment regardless of cover, even at 100%");
}

// ---- Local obstruction: gated on BOTH density AND low elevation ----
{
  // Low elevation + dense surroundings -> capped.
  const lowElevationAc = aircraftAt(10, 1000); // shallow elevation angle at range
  const dense = { combinedDensity: 0.9 };
  const rDenseLow = Visibility.estimate(USER_LAT, USER_LON, lowElevationAc, null, dense);
  t.ok(rDenseLow.score <= 33, "dense obstruction + low elevation caps at Possibly visible");

  // High elevation + dense surroundings -> NOT capped (nothing overhead blocks it).
  const highElevationAc = { lat: USER_LAT, lon: USER_LON, altitudeFt: 20000, type: "B738", category: null, lastSeenSeconds: 1 };
  const rDenseHigh = Visibility.estimate(USER_LAT, USER_LON, highElevationAc, null, dense);
  const rNoObstructionHigh = Visibility.estimate(USER_LAT, USER_LON, highElevationAc, null, null);
  t.eq(rDenseHigh.label, rNoObstructionHigh.label, "dense obstruction never caps a high-elevation aircraft");

  // veryClose is explicitly exempt from the cap even under dense obstruction.
  const veryCloseAc = aircraftAt(0.3, 200);
  const rVeryCloseDense = Visibility.estimate(USER_LAT, USER_LON, veryCloseAc, null, dense);
  t.eq(rVeryCloseDense.label, "Certainly visible", "the veryClose override survives even under dense local obstruction");
}

// ---- Contrail rescue ----
{
  // Real, probed conditions (see file header) — 250hPa is a plausible
  // pressure near the aircraft altitudes used below.
  const persistentForming = { pressureProfile: flatProfile(-55, 90) };   // forms:true, persistent:true
  const nonPersistentForming = { pressureProfile: flatProfile(-55, 60) }; // forms:true, persistent:false
  const noForm = { pressureProfile: flatProfile(-40, 90) };               // forms:false

  // A small, far (but eligible, <=50nm) aircraft that scores badly on
  // angular size alone (<=40nm keeps it off the unrelated plain >40nm cap).
  const smallFar = (altitudeFt) => aircraftAt(35, altitudeFt);

  const rNoRescueBaseline = Visibility.estimate(USER_LAT, USER_LON, smallFar(5000)); // not eligible (below 26000ft)
  t.eq(rNoRescueBaseline.label, "Very unlikely/not visible",
    "sanity check: a small aircraft at 35nm/5000ft scores the worst tier on angular size alone");

  const rNoUpperAirFloor = Visibility.estimate(USER_LAT, USER_LON, smallFar(30000), null, null, null);
  t.eq(rNoUpperAirFloor.label, "Possibly visible",
    "eligible altitude + no upperAir data floors at the flat Possibly-visible fallback (non-vacuous vs the 5000ft baseline)");

  const rPersistent = Visibility.estimate(USER_LAT, USER_LON, smallFar(30000), null, null, persistentForming);
  t.eq(rPersistent.label, "Likely visible",
    "eligible altitude + real persistent-forming conditions floors at Likely visible");

  const rNonPersistent = Visibility.estimate(USER_LAT, USER_LON, smallFar(30000), null, null, nonPersistentForming);
  t.eq(rNonPersistent.label, "Possibly visible",
    "eligible altitude + real forming-but-not-persistent conditions floors at Possibly visible");

  const rNoForm = Visibility.estimate(USER_LAT, USER_LON, smallFar(30000), null, null, noForm);
  t.eq(rNoForm.label, "Very unlikely/not visible",
    "real conditions that don't support a contrail today give NO rescue at all, unlike the no-data fallback case");

  // Ineligible altitude: even with a persistent-forming profile, no rescue.
  const rIneligibleAltitude = Visibility.estimate(USER_LAT, USER_LON, smallFar(20000), null, null, persistentForming);
  t.eq(rIneligibleAltitude.label, "Very unlikely/not visible",
    "below the altitude eligibility gate, the contrail rescue never applies even with forming conditions available");

  // Beyond the max range: even with a persistent-forming profile, no rescue
  // (falls through to the plain >40nm cap instead).
  const beyondRange = aircraftAt(55, 30000);
  const rBeyondRange = Visibility.estimate(USER_LAT, USER_LON, beyondRange, null, null, persistentForming);
  t.eq(rBeyondRange.label, "Possibly visible",
    "beyond the max contrail range, the plain >40nm cap applies instead of the (stronger) contrail floor");

  // Never downgrades a better angular-size result, even via the real physics
  // path. Altitude pinned at the contrail eligibility floor (26000ft, not a
  // higher cruise altitude) specifically to give angular size real margin
  // above the 0.5deg "Certainly visible" cutoff — a first draft of this
  // check used 30000ft and landed angular size at ~0.501deg, dangerously
  // close to the boundary (caught by actually running this test, not
  // assumed correct); 26000ft's smaller altM leaves comfortable headroom.
  const bigClose = aircraftAt(0.3, 26000, { type: "A388" });
  const rBigClose = Visibility.estimate(USER_LAT, USER_LON, bigClose, null, null, persistentForming);
  t.eq(rBigClose.label, "Certainly visible",
    "a big, close aircraft keeps its angular-size score even under a real persistent-forming contrail profile");
}

// ---- USEREP (2026-09-23): downward cap ----
{
  const ac = aircraftAt(2, 5000);

  const fog = { sky: "clear", visibility: "excellent", phenomena: ["fog"] };
  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, fog).label,
    "Very unlikely/not visible", "a reported fog phenomenon forces the worst tier, regardless of sky/visibility fields");

  const thunder = { sky: "clear", visibility: "excellent", phenomena: ["thunderstorm"] };
  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, thunder).label,
    "Very unlikely/not visible", "a reported thunderstorm phenomenon also forces the worst tier");

  const overcast = { sky: "overcast", cloudHeight: "low", visibility: "good", phenomena: [] };
  const rOvercast = Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, overcast);
  t.ok(rOvercast.score <= 33, "overcast sky caps at Possibly visible even with otherwise-good reported visibility");

  const broken = { sky: "broken", visibility: "good", phenomena: [] };
  const rBroken = Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, broken);
  t.ok(rBroken.score <= 33, "mostly-cloudy (broken) sky also caps at Possibly visible");

  const poorVis = { sky: "clear", visibility: "poor", phenomena: [] };
  t.ok(Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, poorVis).score <= 33,
    "poor reported visibility caps at Possibly visible even under an otherwise-clear sky");

  const rain = { sky: "clear", visibility: "excellent", phenomena: ["rain"] };
  t.ok(Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, rain).score <= 33,
    "a non-severe phenomenon (rain) alone still caps at Possibly visible, not a full drop");

  t.eq(Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, null).label,
    Visibility.estimate(USER_LAT, USER_LON, ac, null, null, null, undefined).label,
    "a null/undefined userep is a full no-op either way");
}

// ---- USEREP: the raise mechanism, and its three bounding guards ----
{
  // Genuinely beyond 40nm, low altitude (never contrail-eligible), fresh —
  // isolates the plain ">40NM: cap at Possibly visible" branch as the
  // reason cat starts at "Possibly visible" before any userep adjustment.
  const farAircraft = (opts) => aircraftAt(45, 5000, opts);

  const rBaseline = Visibility.estimate(USER_LAT, USER_LON, farAircraft());
  t.eq(rBaseline.label, "Possibly visible",
    "sanity check: a low-altitude aircraft beyond 40nm is capped at Possibly visible with no userep at all");

  const excellent = { sky: "clear", visibility: "excellent", phenomena: [] };
  const rRaised = Visibility.estimate(USER_LAT, USER_LON, farAircraft(), null, null, null, excellent);
  t.eq(rRaised.label, "Likely visible",
    "excellent local conditions raise the blanket >40nm Possibly-visible cap to Likely visible");

  // Guard 1: only beyond 40nm — inside it, a no-op (nothing to lift; the
  // aircraft's own tier there comes from angular size, not the blanket cap).
  const nearAircraft = aircraftAt(20, 5000);
  const rNearNoUserep = Visibility.estimate(USER_LAT, USER_LON, nearAircraft);
  const rNearWithUserep = Visibility.estimate(USER_LAT, USER_LON, nearAircraft, null, null, null, excellent);
  t.eq(rNearWithUserep.label, rNearNoUserep.label,
    "excellent conditions have no effect inside 40nm — the raise is scoped to exactly the distance band it exists for");

  // Guard 2: only fires when cat is CURRENTLY exactly "Possibly visible" —
  // never re-raises an already-better tier.
  const veryCloseAc = aircraftAt(0.3, 200);
  const rVeryCloseWithUserep = Visibility.estimate(USER_LAT, USER_LON, veryCloseAc, null, null, null, excellent);
  t.eq(rVeryCloseWithUserep.label, "Certainly visible",
    "excellent conditions never touch an aircraft already better than Possibly visible (the veryClose override here)");

  // Guard 3: never overrides a genuine staleness penalty.
  const staleFar = farAircraft({ lastSeenSeconds: 21 });
  const rStaleFar = Visibility.estimate(USER_LAT, USER_LON, staleFar, null, null, null, excellent);
  t.eq(rStaleFar.label, "Very unlikely/not visible",
    "a stale aircraft's own degrade is never overridden by excellent local conditions, even beyond 40nm");

  // "few"/"scattered" sky also count as excellent-eligible, not just "clear".
  const rFewSky = Visibility.estimate(USER_LAT, USER_LON, farAircraft(),
    null, null, null, { sky: "few", visibility: "excellent", phenomena: [] });
  t.eq(rFewSky.label, "Likely visible", "'few' clouds still qualifies as excellent-eligible sky, same as 'clear'");

  // Good (not excellent) visibility does NOT qualify for the raise.
  const rGoodOnly = Visibility.estimate(USER_LAT, USER_LON, farAircraft(),
    null, null, null, { sky: "clear", visibility: "good", phenomena: [] });
  t.eq(rGoodOnly.label, "Possibly visible", "merely 'good' (not 'excellent') reported visibility does not trigger the raise");
}

// ---- getCategories(): read-only, defensive copy ----
{
  const cats = Visibility.getCategories();
  t.eq(cats.length, 4, "getCategories returns exactly the 4 sightability tiers");
  const original = cats[0].label;
  cats[0].label = "mutated";
  const catsAgain = Visibility.getCategories();
  t.eq(catsAgain[0].label, original, "mutating a returned category array never affects the next call (defensive copy)");
}

t.done();
