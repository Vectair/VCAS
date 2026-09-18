/**
 * Real-execution checks for src/logic/indicators.js — the orchestration
 * layer over Geo/Visibility/Relevance/AircraftExtrapolation that decides
 * what's shown on the plot and in what order. See CLAUDE.md's "Range
 * rings"/"RAW-mode redesign" entries for why the plot-region overrides
 * (plotWidth/plotHeight/plotOffsetX/plotOffsetY/plotSafeInset/plotBandsNm)
 * exist and why they must stay in sync with the real camera anchor.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo, Visibility, Indicators } = loadLogic();
const t = createSuite("indicators.js");

const USER_LAT = 51.5, USER_LON = -0.12;
const STALE_THRESHOLD = 15;

function plainUserState(overrides) {
  // Deliberately omits metar/localObstruction/upperAir/anchorY/
  // fovHalfAngleDeg/plot*/safeInset entirely (not set to null) — matches
  // how Hybrid's own userState never sets them (see indicators.js's own
  // doc comment: "Hybrid... is completely unaffected"), so undefined
  // default parameters resolve the same way they do in production.
  return Object.assign({
    lat: USER_LAT, lon: USER_LON, heading: 0, speedMph: 0,
    viewportWidth: 400, viewportHeight: 800,
  }, overrides);
}

function aircraftAt(bearingDeg, distNm, altitudeFt, overrides) {
  const dest = Geo.destinationPoint(USER_LAT, USER_LON, bearingDeg, distNm * 1852);
  return Object.assign({
    hex: "hex" + Math.random().toString(36).slice(2, 8),
    lat: dest.lat, lon: dest.lon, altitudeFt,
    type: "C172", category: null, lastSeenSeconds: 1,
    trackDeg: null, groundSpeedKt: null,
  }, overrides);
}

// ---- capForViewportWidth ----
t.eq(Indicators.capForViewportWidth(499), 5, "width just below 500 is the small cap (5)");
t.eq(Indicators.capForViewportWidth(500), 7, "width exactly 500 is the medium cap (7, not small)");
t.eq(Indicators.capForViewportWidth(900), 7, "width exactly 900 is still the medium cap (inclusive)");
t.eq(Indicators.capForViewportWidth(901), 10, "width just above 900 is the large cap (10)");

// ---- build(): relevance filter excludes a dead-behind, non-converging aircraft ----
{
  const behind = aircraftAt(180, 5, 3000, { hex: "behind1" });
  const result = Indicators.build([behind], plainUserState(), STALE_THRESHOLD);
  t.eq(result.length, 0, "build() excludes an aircraft dead behind the user with no convergence data");
}

// ---- build(): suppression filter excludes regardless of relevance ----
{
  const relevant = aircraftAt(0, 5, 3000, { hex: "sup1", type: "B738" });
  const suppressed = new Set(["sup1"]);
  const result = Indicators.build([relevant], plainUserState(), STALE_THRESHOLD, suppressed);
  t.eq(result.length, 0, "build() excludes a suppressed hex even though it's otherwise relevant");
  const resultUnsuppressed = Indicators.build([relevant], plainUserState(), STALE_THRESHOLD, new Set());
  t.eq(resultUnsuppressed.length, 1, "the same aircraft IS included when not suppressed (sanity check)");
}

// ---- build(): sort by vis.score desc, then distance asc on ties ----
{
  // acA: veryClose override -> score 100.
  const acA = aircraftAt(0, 0.3, 200, { hex: "acA" });
  // acB: real "Likely visible" (score 66) via angular size at 4nm/3000ft.
  const acB = aircraftAt(0, 4, 3000, { hex: "acB", type: "B738" });
  // acC1/acC2: both real "Possibly visible" (score 33), different distances.
  const acC1 = aircraftAt(0, 6, 2000, { hex: "acC1", type: "C172" });
  const acC2 = aircraftAt(0, 3, 2000, { hex: "acC2", type: "C172" });

  // Sanity-check each aircraft's real, unadjusted category before trusting
  // the sort order below — avoids a vacuous test built on a wrong premise.
  const visA = Visibility.estimate(USER_LAT, USER_LON, acA);
  const visB = Visibility.estimate(USER_LAT, USER_LON, acB);
  const visC1 = Visibility.estimate(USER_LAT, USER_LON, acC1);
  const visC2 = Visibility.estimate(USER_LAT, USER_LON, acC2);
  t.eq(visA.label, "Certainly visible", "sanity check: acA is really the veryClose override");
  t.eq(visB.label, "Likely visible", "sanity check: acB really lands in the Likely-visible tier");
  t.eq(visC1.label, "Possibly visible", "sanity check: acC1 really lands in the Possibly-visible tier");
  t.eq(visC2.label, "Possibly visible", "sanity check: acC2 really lands in the Possibly-visible tier (same tier as acC1, different distance)");

  const result = Indicators.build([acC1, acA, acC2, acB], plainUserState(), STALE_THRESHOLD);
  const order = result.map(r => r.aircraft.hex);
  t.eq(order.length, 4, "all four aircraft are relevant and included");
  t.eq(order[0], "acA", "highest score (Certainly visible) sorts first");
  t.eq(order[1], "acB", "second-highest score (Likely visible) sorts second");
  t.eq(order[2], "acC2", "tied score: the nearer aircraft (3nm) sorts before the farther one");
  t.eq(order[3], "acC1", "tied score: the farther aircraft (6nm) sorts last");
}

// ---- buildAll(): includes an irrelevant aircraft, sorted purely by distance ----
{
  const near = aircraftAt(0, 2, 2000, { hex: "near1", type: "C172" });
  const far = aircraftAt(180, 8, 3000, { hex: "far1" }); // behind, no track -> irrelevant
  const result = Indicators.buildAll([far, near], plainUserState(), STALE_THRESHOLD);
  t.eq(result.length, 2, "buildAll includes both aircraft regardless of relevance");
  t.eq(result[0].aircraft.hex, "near1", "buildAll sorts the nearer aircraft first");
  t.eq(result[1].aircraft.hex, "far1", "buildAll sorts the farther (and irrelevant) aircraft last");
  t.eq(result[1].relevance.relevant, false, "the farther aircraft is genuinely irrelevant, yet buildAll still includes it");
}

// ---- hard staleness cutoff: strictly '< threshold*3', not '<=' ----
{
  const ac = aircraftAt(0, 1, 2000, { hex: "stale1" });
  const atCutoff = Object.assign({}, ac, { lastSeenSeconds: STALE_THRESHOLD * 3 });
  const justUnder = Object.assign({}, ac, { lastSeenSeconds: STALE_THRESHOLD * 3 - 1 });
  t.eq(Indicators.buildAll([atCutoff], plainUserState(), STALE_THRESHOLD).length, 0,
    "an aircraft exactly at the hard staleness cutoff (threshold*3) is excluded entirely");
  t.eq(Indicators.buildAll([justUnder], plainUserState(), STALE_THRESHOLD).length, 1,
    "an aircraft 1 second under the hard cutoff is still included");
}

// ---- isStale flag: its own separate '> threshold' boundary ----
{
  const ac = aircraftAt(0, 1, 2000, { hex: "stale2" });
  const atThreshold = Object.assign({}, ac, { lastSeenSeconds: STALE_THRESHOLD });
  const overThreshold = Object.assign({}, ac, { lastSeenSeconds: STALE_THRESHOLD + 1 });
  const rAt = Indicators.buildAll([atThreshold], plainUserState(), STALE_THRESHOLD)[0];
  const rOver = Indicators.buildAll([overThreshold], plainUserState(), STALE_THRESHOLD)[0];
  t.eq(rAt.isStale, false, "isStale is false exactly at the threshold ('>', not '>=')");
  t.eq(rOver.isStale, true, "isStale is true just past the threshold");
}

// ---- relativeTrackDeg: present/null depending on whether the aircraft transmits a track ----
{
  const withTrack = aircraftAt(0, 2, 2000, { hex: "track1", trackDeg: 45 });
  const noTrack = aircraftAt(0, 2, 2000, { hex: "track2", trackDeg: null });
  const state = plainUserState({ heading: 10 });
  const rWith = Indicators.buildAll([withTrack], state, STALE_THRESHOLD)[0];
  const rWithout = Indicators.buildAll([noTrack], state, STALE_THRESHOLD)[0];
  t.eq(rWith.relativeTrackDeg, Geo.calculateRelativeBearing(45, 10),
    "relativeTrackDeg exactly matches an independent Geo.calculateRelativeBearing call");
  t.eq(rWithout.relativeTrackDeg, null, "relativeTrackDeg is null when the aircraft has no trackDeg");
}

// ---- position cross-checks against a direct Geo.projectToPolarPosition call ----

// Plain dead-ahead case: no anchorY/safeInset/plot* overrides set at all,
// proving the 0.8/60 Geo-side defaults resolve correctly end-to-end.
{
  const ac = aircraftAt(0, 5, 3000, { hex: "pos1", type: "B738" });
  const state = plainUserState();
  const result = Indicators.buildAll([ac], state, STALE_THRESHOLD)[0];
  const vis = Visibility.estimate(USER_LAT, USER_LON, ac);
  const expected = Geo.projectToPolarPosition(0, vis.slantRangeNm, 400, 800, Indicators.RING_BANDS_NM,
    undefined, undefined, undefined, 0, 0);
  t.eq(result.x, expected.x, "plain dead-ahead x matches a direct Geo.projectToPolarPosition call using the real Geo defaults");
  t.eq(result.y, expected.y, "plain dead-ahead y matches a direct Geo.projectToPolarPosition call using the real Geo defaults");
}

// Full RAW-style case: every plot-region override set to values deliberately
// different from the plain viewport, confirmed to differ from what the
// plain-viewport values would have produced (proving the override path is
// genuinely used, not coincidentally matching).
{
  const ac = aircraftAt(0, 5, 3000, { hex: "pos2", type: "B738" });
  const rawState = plainUserState({
    plotWidth: 200, plotHeight: 300, plotOffsetX: 50, plotOffsetY: 20,
    plotSafeInset: 10, anchorY: 0.6, fovHalfAngleDeg: 75, plotBandsNm: [2, 5, 10],
  });
  const result = Indicators.buildAll([ac], rawState, STALE_THRESHOLD)[0];
  const vis = Visibility.estimate(USER_LAT, USER_LON, ac);
  const expectedRaw = Geo.projectToPolarPosition(0, vis.slantRangeNm, 200, 300, [2, 5, 10],
    0.6, 10, 75, 50, 20);
  t.eq(result.x, expectedRaw.x, "RAW-style overrides produce exactly the position a direct matching Geo call would");
  t.eq(result.y, expectedRaw.y, "RAW-style overrides produce exactly the position a direct matching Geo call would (y)");

  const plainState = plainUserState();
  const resultPlain = Indicators.buildAll([ac], plainState, STALE_THRESHOLD)[0];
  t.ok(resultPlain.x !== result.x || resultPlain.y !== result.y,
    "the RAW-style overrides genuinely change the plotted position vs. the plain-viewport case (not a coincidental match)");
}

// plotSafeInset=null falls back to safeInset, not straight to Geo's own default.
{
  const ac = aircraftAt(0, 5, 3000, { hex: "pos3", type: "B738" });
  const state = plainUserState({ safeInset: 40, plotSafeInset: null });
  const result = Indicators.buildAll([ac], state, STALE_THRESHOLD)[0];
  const vis = Visibility.estimate(USER_LAT, USER_LON, ac);
  const expected = Geo.projectToPolarPosition(0, vis.slantRangeNm, 400, 800, Indicators.RING_BANDS_NM,
    undefined, 40, undefined, 0, 0);
  t.eq(result.x, expected.x, "plotSafeInset=null falls back to userState.safeInset (40), not Geo's own default (60)");
  t.eq(result.y, expected.y, "plotSafeInset=null falls back to userState.safeInset (40), not Geo's own default (60) (y)");
}

// ---- decoupling: overhead relevance is independent of the FOV restriction ----
{
  // Nearly overhead (steep elevation) but at a relative bearing well
  // outside a 75deg FOV half-angle.
  const overheadFar = aircraftAt(170, 0.5, 20000, { hex: "overhead1" });
  const state = plainUserState({ fovHalfAngleDeg: 75 });
  const result = Indicators.buildAll([overheadFar], state, STALE_THRESHOLD)[0];
  t.eq(result.relevance.relevant, true, "a steeply-overhead aircraft is relevant regardless of its bearing");
  t.eq(result.relevance.reason, "overhead", "the overhead reason is reported even at a bearing outside the FOV");
  t.eq(result.x, null, "x is null for a bearing outside the FOV (Geo's own restriction, independent of relevance)");
  t.eq(result.y, null, "y is null for a bearing outside the FOV (Geo's own restriction, independent of relevance)");
}

t.done();
