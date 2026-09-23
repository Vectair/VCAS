/**
 * Real-execution checks for src/logic/userep.js — the shared vocab tables
 * and pure helper functions behind the USEREP feature (see CLAUDE.md's
 * dated entry). Visibility.estimate()'s own _applyUserepAdjustment() —
 * the scoring interpretation of these fields — is tested directly in
 * visibility.test.js instead, since that logic lives inside visibility.js,
 * not here (this file only covers pickFreshest/ageMinutes/distanceMiles/
 * summarize and the vocab tables themselves).
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Userep } = loadLogic();
const t = createSuite("userep.js");

// ---- vocab tables: shape and coverage ----
{
  t.eq(Userep.SKY_OPTIONS.length, 5, "5 sky options");
  t.eq(Userep.CLOUD_HEIGHT_OPTIONS.length, 3, "3 cloud-height options");
  t.eq(Userep.VISIBILITY_OPTIONS.length, 4, "4 visibility options");
  t.eq(Userep.PHENOMENA_OPTIONS.length, 5, "5 phenomena options");

  // Every value/label present, no accidental blanks.
  [Userep.SKY_OPTIONS, Userep.CLOUD_HEIGHT_OPTIONS, Userep.VISIBILITY_OPTIONS, Userep.PHENOMENA_OPTIONS].forEach((list, i) => {
    list.forEach((opt) => {
      t.ok(typeof opt.value === "string" && opt.value.length > 0, `option ${i} has a non-empty value`);
      t.ok(typeof opt.label === "string" && opt.label.length > 0, `option ${i} (${opt.value}) has a non-empty label`);
    });
  });

  // The exact values _applyUserepAdjustment() (visibility.js) switches on —
  // a real cross-check against the other file's own literals, so the two
  // can't silently drift apart.
  const skyValues = Userep.SKY_OPTIONS.map((o) => o.value).join(",");
  t.eq(skyValues, "clear,few,scattered,broken,overcast", "sky option values match what visibility.js's _applyUserepAdjustment() checks");
  const visValues = Userep.VISIBILITY_OPTIONS.map((o) => o.value).join(",");
  t.eq(visValues, "excellent,good,moderate,poor", "visibility option values match what visibility.js checks");
  const phenValues = Userep.PHENOMENA_OPTIONS.map((o) => o.value).join(",");
  t.eq(phenValues, "rain,snow,fog,haze,thunderstorm", "phenomena option values include the two 'severe' ones (fog, thunderstorm) visibility.js checks for");
}

// ---- pickFreshest() ----
{
  t.eq(Userep.pickFreshest([]), null, "an empty array picks nothing");
  t.eq(Userep.pickFreshest(null), null, "a non-array degrades to null rather than throwing");
  t.eq(Userep.pickFreshest(undefined), null, "undefined degrades to null too");

  const reports = [
    { id: "a", submittedAt: 1000 },
    { id: "b", submittedAt: 3000 }, // most recent
    { id: "c", submittedAt: 2000 },
  ];
  t.eq(Userep.pickFreshest(reports).id, "b", "picks the report with the largest submittedAt, not array order");

  const single = [{ id: "only", submittedAt: 500 }];
  t.eq(Userep.pickFreshest(single).id, "only", "a single-element array picks that element");

  // Malformed entries (missing submittedAt) are skipped, not crashed on.
  const withMalformed = [
    { id: "good", submittedAt: 1000 },
    { id: "bad" }, // no submittedAt
    null,
  ];
  t.eq(Userep.pickFreshest(withMalformed).id, "good", "malformed/null entries in the array are skipped, not crashed on");
}

// ---- ageMinutes() ----
{
  const nowMs = 1_000_000_000_000; // arbitrary fixed epoch ms
  const fiveMinAgo = { submittedAt: Math.floor(nowMs / 1000) - 5 * 60 };
  t.eq(Userep.ageMinutes(fiveMinAgo, nowMs), 5, "a report submitted 5 minutes ago reads ageMinutes 5");

  const justNow = { submittedAt: Math.floor(nowMs / 1000) };
  t.eq(Userep.ageMinutes(justNow, nowMs), 0, "a report submitted right now reads ageMinutes 0");

  t.eq(Userep.ageMinutes(null, nowMs), null, "a null report degrades to null, not a crash");
  t.eq(Userep.ageMinutes({}, nowMs), null, "a report with no submittedAt field degrades to null");

  // Never negative even if submittedAt is somehow in the future (clock
  // skew between client and the relay's own server-stamped time).
  const future = { submittedAt: Math.floor(nowMs / 1000) + 999 };
  t.eq(Userep.ageMinutes(future, nowMs), 0, "a submittedAt in the future clamps to 0, never negative");
}

// ---- distanceMiles() ----
{
  const { Geo } = loadLogic();
  const userLat = 51.5, userLon = -0.12;
  const dest = Geo.destinationPoint(userLat, userLon, 90, 5000); // 5000m due east
  const report = { lat: dest.lat, lon: dest.lon };
  const expectedMiles = 5000 * 0.000621371;
  t.approx(Userep.distanceMiles(userLat, userLon, report), expectedMiles, 0.01, "distanceMiles matches an independent metres->miles conversion of Geo's own distance");

  t.eq(Userep.distanceMiles(userLat, userLon, null), null, "a null report degrades to null");
  t.eq(Userep.distanceMiles(userLat, userLon, {}), null, "a report with no lat/lon degrades to null");
}

// ---- summarize() ----
{
  t.eq(Userep.summarize(null), "", "a null report summarizes to an empty string");

  const clear = { sky: "clear", visibility: "excellent", phenomena: [] };
  t.eq(Userep.summarize(clear), "Clear · Excellent visibility", "a clear/excellent report with no phenomena omits the cloud-height clause and the phenomena clause entirely");

  const overcastLow = { sky: "overcast", cloudHeight: "low", visibility: "poor", phenomena: ["fog"] };
  t.eq(Userep.summarize(overcastLow), "Overcast (low clouds) · Poor visibility · Fog / mist",
    "a full report includes the cloud-height clause and every phenomenon label, joined with middle dots");

  const clearWithHeightIgnored = { sky: "clear", cloudHeight: "low", visibility: "good", phenomena: [] };
  t.eq(Userep.summarize(clearWithHeightIgnored), "Clear · Good visibility",
    "cloudHeight is never appended when sky is 'clear', even if a stray value is present");

  const multiPhenomena = { sky: "broken", cloudHeight: "medium", visibility: "moderate", phenomena: ["rain", "haze"] };
  t.eq(Userep.summarize(multiPhenomena), "Mostly cloudy (medium clouds) · Moderate visibility · Rain, Haze",
    "multiple phenomena join with a comma, preserving the array's own order");

  const emptyReport = {};
  t.eq(Userep.summarize(emptyReport), "", "a report with no recognised fields at all summarizes to an empty string, not a broken partial one");
}

t.done();
