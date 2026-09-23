/**
 * Userep — user-submitted local weather reports ("USEREP", mirroring a
 * pilot's own PIREP but ground-observer-sourced and self-reported rather
 * than radioed to ATC — see CLAUDE.md's dated entry for the full design
 * history). Direct instruction: "a simple method of the user reporting
 * met conditions from their present position to help inform the
 * visibility likelihood... mirroring the principles of a metar but
 * informing rather than dictating." Plain-language categories, not METAR
 * codes — "users may not have much in the way of meteorological
 * knowledge."
 *
 * Pure logic only — no DOM, no fetch (see userepProvider.js for the relay
 * client/cache this module feeds, and app.js for the submission form UI).
 * The four option vocabularies below are the ONE shared source for: the
 * submission form's own button labels (app.js), the relay's server-side
 * validation (userep-relay/relay.php, not committed to this repo — same
 * handoff pattern as every other relay in this project), and
 * Visibility.estimate()'s own _applyUserepAdjustment() — same "one shared
 * source, not several independently-typed lists that could drift"
 * discipline this codebase already applies to Visibility.getCategories()
 * for the sightability legend.
 *
 * RADIUS_MILES/MAX_AGE_MINUTES mirror the exact window the relay itself
 * enforces server-side (a client-side copy for display/documentation
 * purposes only — the relay's own GET query is the real filter, this
 * never re-filters anything client-side).
 */
const Userep = (() => {
  const RADIUS_MILES = 5;
  const MAX_AGE_MINUTES = 30;

  const SKY_OPTIONS = [
    { value: "clear", label: "Clear" },
    { value: "few", label: "A few clouds" },
    { value: "scattered", label: "Some clouds" },
    { value: "broken", label: "Mostly cloudy" },
    { value: "overcast", label: "Overcast" },
  ];

  // Only meaningful (and only ever submitted/shown) when sky !== "clear" —
  // display-only in v1, NOT read by _applyUserepAdjustment()'s own scoring
  // logic (see that function's own comment for why) — kept in the
  // submission form anyway for content parity with what was actually
  // asked for ("the two principle items we're interested in are cloud
  // amount AND height") and because it's real, useful information for
  // the OTHER nearby users this report is shared with, even where it
  // doesn't yet feed the score.
  const CLOUD_HEIGHT_OPTIONS = [
    { value: "low", label: "Low (below ~1,000ft)" },
    { value: "medium", label: "Medium (~1,000–5,000ft)" },
    { value: "high", label: "High (above ~5,000ft)" },
  ];

  const VISIBILITY_OPTIONS = [
    { value: "excellent", label: "Excellent — miles and miles" },
    { value: "good", label: "Good — a few miles" },
    { value: "moderate", label: "Moderate — a mile or two" },
    { value: "poor", label: "Poor — hazy/murky, under a mile" },
  ];

  const PHENOMENA_OPTIONS = [
    { value: "rain", label: "Rain" },
    { value: "snow", label: "Snow" },
    { value: "fog", label: "Fog / mist" },
    { value: "haze", label: "Haze" },
    { value: "thunderstorm", label: "Thunderstorm" },
  ];

  function _labelFor(options, value) {
    const found = options.find((o) => o.value === value);
    return found ? found.label : "";
  }

  /**
   * Picks the single most recently-submitted report from an array
   * (already filtered to RADIUS_MILES/MAX_AGE_MINUTES of the CURRENT
   * user position by the relay's own GET query — see userepProvider.js) —
   * "most recent wins," not a computed blend of several, possibly-
   * conflicting reports. Simpler, and easier for a user to trust, than an
   * averaged/weighted score would be — matches the "informing not
   * dictating" framing directly: one clear, current voice, not a
   * committee vote.
   *
   * @returns {object|null}
   */
  function pickFreshest(reports) {
    if (!Array.isArray(reports) || reports.length === 0) return null;
    let best = null;
    for (const r of reports) {
      if (!r || typeof r.submittedAt !== "number") continue;
      if (!best || r.submittedAt > best.submittedAt) best = r;
    }
    return best;
  }

  /**
   * Age in whole minutes since a report was submitted. `submittedAt` is
   * epoch SECONDS (the relay stamps it server-side with PHP's time()),
   * matching MetarProvider's own obsTime convention — kept consistent on
   * purpose rather than picking a different unit for a second weather
   * source in the same app.
   */
  function ageMinutes(report, nowMs) {
    if (!report || typeof report.submittedAt !== "number") return null;
    const now = nowMs != null ? nowMs : Date.now();
    return Math.max(0, Math.round((now - report.submittedAt * 1000) / 60000));
  }

  /** Distance in miles from a given position to where a report was submitted — reuses Geo's own already-verified distance primitive, not a second implementation. */
  function distanceMiles(lat, lon, report) {
    if (!report || typeof report.lat !== "number" || typeof report.lon !== "number") return null;
    return Geo.calculateDistanceMeters(lat, lon, report.lat, report.lon) * 0.000621371;
  }

  /**
   * Plain one-line summary for display, e.g. "Overcast (low clouds) ·
   * Poor visibility · Rain, fog / mist" — reused both for the submission
   * screen's own confirmation line and for showing an already-cached
   * nearby report inside the Weather screen (app.js).
   */
  function summarize(report) {
    if (!report) return "";
    const parts = [];

    const skyLabel = _labelFor(SKY_OPTIONS, report.sky);
    if (skyLabel) {
      if (report.sky !== "clear" && report.cloudHeight) {
        const heightWord =
          report.cloudHeight === "low" ? "low" : report.cloudHeight === "medium" ? "medium" : "high";
        parts.push(`${skyLabel} (${heightWord} clouds)`);
      } else {
        parts.push(skyLabel);
      }
    }

    const visLabel = _labelFor(VISIBILITY_OPTIONS, report.visibility);
    // Every VISIBILITY_OPTIONS label's first word is its own plain
    // descriptor ("Excellent", "Good", "Moderate", "Poor") — splitting on
    // a literal space rather than the em dash keeps this robust to that
    // exact punctuation character without needing a second short-label
    // table just for this.
    if (visLabel) parts.push(`${visLabel.split(" ")[0]} visibility`);

    if (Array.isArray(report.phenomena) && report.phenomena.length > 0) {
      const labels = report.phenomena.map((p) => _labelFor(PHENOMENA_OPTIONS, p)).filter(Boolean);
      if (labels.length > 0) parts.push(labels.join(", "));
    }

    return parts.join(" · ");
  }

  return {
    RADIUS_MILES,
    MAX_AGE_MINUTES,
    SKY_OPTIONS,
    CLOUD_HEIGHT_OPTIONS,
    VISIBILITY_OPTIONS,
    PHENOMENA_OPTIONS,
    pickFreshest,
    ageMinutes,
    distanceMiles,
    summarize,
  };
})();

if (typeof module !== "undefined") module.exports = Userep;
