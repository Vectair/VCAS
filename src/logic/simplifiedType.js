/**
 * SimplifiedType — maps a raw ICAO aircraft type designator (what ADS-B
 * actually reports, e.g. "B39M", "A21N", "AT76") to a coarser, layperson-
 * recognisable family/model label ("737", "A321", "ATR 72"), for the
 * "Simplify aircraft types" setting (see src/simplifiedTypeMode.js).
 *
 * 2026-09-21: direct tester feedback, relayed by the project owner (who
 * agrees): a casual spotter doesn't know or care that B738/B39M/B3XM/B736
 * are all "a 737" — the exact sub-variant designator is more precision
 * than most people want, and actively makes the app harder to read for
 * its actual audience. This is a pure, side-effect-free lookup — nothing
 * about relevance/visibility/filtering changes, only what TEXT gets
 * displayed once the setting is on (see every ui.js/map.js call site that
 * now reads `SimplifiedTypeMode.isEnabled() ? SimplifiedType.get(type) :
 * type` instead of the raw type directly).
 *
 * GROUPING PRINCIPLE, restated 2026-09-22 per direct project-owner
 * confirmation of the rule of thumb: align a variant with its ROOT,
 * regardless of whatever comes after — e.g. every real B737- variant
 * collapses to "737" no matter what follows the dash. The one thing
 * worth being explicit about (still a real judgment call, not a solved
 * problem — see ROADMAP.md's own entry for this feature) is that "root"
 * means something different depending on the family:
 *   - Boeing 737/747/757/767/787: the ROOT IS the bare model number —
 *     casual usage never distinguishes the length or engine-generation
 *     variant ("that's a 737", never "that's a 737-800" or "that's a
 *     737 MAX"), so EVERYTHING after the model number collapses,
 *     matching the tester's own literal example.
 *   - Airbus A318/A319/A320/A321: the ROOT IS the specific series
 *     number — each is kept as its OWN distinct bucket, only folding the
 *     neo/ceo engine-generation suffix together (A20N -> "A320", same
 *     bucket as A320). This is a genuine asymmetry with the Boeing
 *     narrowbody treatment above, not an inconsistency: unlike a
 *     737-800 vs -900, people who can tell an A320 from an A321 apart
 *     generally DO use those specific names in conversation ("that's an
 *     A321", not "that's an A320-family jet") — the family's own
 *     individual member numbers are already the colloquial names, where
 *     737's length-variant digit never became one.
 *   - Airbus widebodies (A330/A340/A350/A380) and turboprops with a
 *     genuinely distinct common name per size (ATR 42 vs ATR 72) follow
 *     the same "root = the specific model number" rule as Airbus
 *     narrowbody — these aren't "sub-variants of one thing" the way
 *     737-600..900 are, they're different aircraft with different names
 *     people actually use.
 *   - Regional jets (CRJ, E-Jet) collapse to bare family — casual
 *     spotters essentially never distinguish a CRJ700 from a CRJ900, or
 *     an E170 from an E190, by sight.
 *   - GA/light aircraft, helicopters, business jets, and military types
 *     are DELIBERATELY NOT covered here — their ICAO codes (C172, PA28,
 *     R44, ...) are already about as simple as a casual reader needs;
 *     adding hundreds of rarely-relevant entries for those would be
 *     real, unnecessary complexity for approximately zero readability
 *     gain. They pass through unchanged via the fallback below, same as
 *     any other unmapped code.
 *
 * TWO-TIER LOOKUP, added 2026-09-22 to actually implement "regardless of
 * what comes after the -" literally rather than by exhaustively listing
 * every currently-known variant code by hand (the original 2026-09-21
 * version's real limitation — a genuine, not-yet-seen 737 variant code
 * simply wouldn't have matched, silently falling back to the raw
 * designator instead of "737"):
 *   1. FAMILY_ROOT_PATTERNS — a small set of regexes for exactly the
 *      families where the whole point is "collapse regardless of
 *      suffix" (737/747/757/767/777/787). A NEW Boeing 737/747/757/767/
 *      777/787 variant code ICAO hasn't assigned yet will still collapse
 *      correctly the moment it starts appearing in real ADS-B data, with
 *      no table edit needed — this is the actual "root, not an
 *      enumerated list" behaviour.
 *   2. EXACT_GROUPS — a flat table for every other family, where "root"
 *      means "the specific model number" rather than "the family name
 *      alone" (Airbus narrowbody/widebody, regional jets, turboprops) —
 *      pattern-matching doesn't help here since the whole point is
 *      keeping specific numbers apart, not collapsing across them, and
 *      Airbus's actual type-code space is small and closed enough that
 *      hand-enumerating it carries little of the same risk.
 * Checked in that order — an exact match always wins over a pattern, so
 * a future one-off exception (an oddball code that happens to fit a
 * Boeing pattern's shape but genuinely isn't that family) has a clean
 * override point without touching the pattern itself.
 *
 * COVERAGE, stated honestly rather than implied complete: EXACT_GROUPS
 * is a starter set covering common regional/turboprop/widebody families
 * likely to actually appear in typical VCAS use, not an exhaustive ICAO
 * type-designator reference (there are thousands of real codes across
 * GA/military/etc that this deliberately doesn't attempt). Anything not
 * matched by either tier falls back to the RAW designator unchanged —
 * never worse than today, just not simplified for that one type. The
 * ground-truth observation log (src/dev/observationLogger.js) already
 * records every sighting's real `aircraft.type`, which is a natural,
 * already-existing signal for what's showing up unmapped and worth
 * adding — no new instrumentation needed to find real gaps over time.
 *
 * The actual codes/patterns below reflect general aviation-industry
 * knowledge, not a fetch/lookup verified against a live ADS-B feed from
 * this sandbox (this sandbox has no network path to adsb.fi directly —
 * see CLAUDE.md's own "Sandbox environment notes") — flagged the same
 * way every other reference-data table in this codebase is when it
 * wasn't independently re-verified against a live source.
 *
 * LONGER TERM, per the project owner's own framing: "this is where
 * Vectair as a whole starts to come in" — a shared type-to-group mapping
 * belongs in whatever broader aircraft-type reference database Vectair
 * maintains, not hand-typed JS living only in this repo. Deliberately
 * isolated behind this one function so that swap is clean later: every
 * call site only ever calls SimplifiedType.get(type) and has no idea
 * whether the answer came from this static table/pattern set or a
 * fetched/DB-backed one — see ROADMAP.md's own entry for this feature.
 */
const SimplifiedType = (() => {
  // Boeing families where the whole model line collapses regardless of
  // length/engine-generation suffix — "root, regardless of what comes
  // after" applied literally as a pattern, not an enumerated list.
  const FAMILY_ROOT_PATTERNS = [
    // 737: Classic/NG length variants (B731..B739) plus the MAX
    // generation, which uses a DIFFERENT suffix shape (B3_M, not B73_) —
    // both patterns are needed to actually cover "737 regardless of
    // suffix," a single prefix rule can't express this family alone.
    { pattern: /^B73[0-9]$/, group: "737" },
    { pattern: /^B3[0-9X]M$/, group: "737" },
    // 747: every length/generation variant (740-749) plus the SP.
    { pattern: /^B74[0-9]$/, group: "747" },
    { pattern: /^B74S$/, group: "747" },
    // 757.
    { pattern: /^B75[0-9]$/, group: "757" },
    // 767.
    { pattern: /^B76[0-9]$/, group: "767" },
    // 777, including the -200LR/-300ER letter-suffix codes and 777X
    // (778/779, already covered by the digit pattern).
    { pattern: /^B77[0-9]$/, group: "777" },
    { pattern: /^B77[LW]$/, group: "777" },
    // 787 Dreamliner, including the -10's letter-suffix code.
    { pattern: /^B78[0-9X]$/, group: "787" },
  ];

  const EXACT_GROUPS = {
    // Airbus narrowbody — kept distinct by series number (the ROOT here
    // IS the specific number); only the engine-generation (neo) suffix
    // folds into its ceo equivalent.
    A318: "A318",
    A319: "A319", A19N: "A319",
    A320: "A320", A20N: "A320",
    A321: "A321", A21N: "A321",

    // Airbus A220 (formerly Bombardier CSeries).
    BCS1: "A220", BCS3: "A220",

    // Airbus widebody — each a genuinely distinct, individually-named
    // aircraft, not sub-variants of one thing.
    A332: "A330", A333: "A330", A339: "A330",
    A342: "A340", A343: "A340", A345: "A340", A346: "A340",
    A359: "A350", A35K: "A350",
    A388: "A380",

    // Regional jets — casual spotters rarely distinguish sub-variants.
    CRJ1: "CRJ", CRJ2: "CRJ", CRJ7: "CRJ", CRJ9: "CRJ", CRJX: "CRJ",
    E135: "ERJ", E145: "ERJ",
    E170: "E-Jet", E75L: "E-Jet", E75S: "E-Jet",
    E190: "E-Jet", E195: "E-Jet", E290: "E-Jet", E295: "E-Jet",

    // Turboprops — ATR42 and ATR72 are visually distinct, different-
    // length aircraft with their own common names, kept separate; the
    // Dash 8 -100/-200/-300 collapse together but the re-engined Q400
    // (visibly/audibly different) stays its own bucket.
    AT43: "ATR 42", AT44: "ATR 42", AT45: "ATR 42", AT46: "ATR 42",
    AT72: "ATR 72", AT73: "ATR 72", AT75: "ATR 72", AT76: "ATR 72",
    DH8A: "Dash 8", DH8B: "Dash 8", DH8C: "Dash 8",
    DH8D: "Q400",
    SB20: "Saab 340",
    J41: "Jetstream 41",
  };

  /**
   * @param {string} rawType  The raw ICAO type designator as ADS-B
   *   reports it (e.g. aircraft.type from normaliseAircraft.js).
   * @returns {string} The simplified group label if one exists for this
   *   code (exact table first, then family-root pattern), otherwise
   *   rawType UNCHANGED (falsy input — "", null, undefined — also passes
   *   straight through, matching every call site's own existing
   *   "type || fallback" handling).
   */
  function get(rawType) {
    if (!rawType) return rawType;
    const key = String(rawType).trim().toUpperCase();
    if (EXACT_GROUPS[key]) return EXACT_GROUPS[key];
    const matched = FAMILY_ROOT_PATTERNS.find(({ pattern }) => pattern.test(key));
    return matched ? matched.group : rawType;
  }

  return { get };
})();

if (typeof module !== "undefined") module.exports = SimplifiedType;
