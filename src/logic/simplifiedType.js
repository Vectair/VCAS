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
 * GROUPING PRINCIPLE, stated explicitly so a future edit doesn't have to
 * reverse-engineer it from the table alone — and because this is a real
 * judgment call, not a solved problem (see ROADMAP.md's own entry for
 * this feature, which flags it as worth the project owner's own
 * confirmation): collapse a family down to whatever name a knowledgeable-
 * but-casual person would actually say out loud, which in practice means
 * always dropping the ENGINE-GENERATION suffix (NG vs MAX, ceo vs neo —
 * visually distinguishable to an expert, not what a casual spotter is
 * asking about), and ADDITIONALLY dropping the LENGTH/SERIES digit only
 * for families where that digit isn't part of common colloquial usage.
 * Concretely:
 *   - Boeing 737/747/757/767/787: casual usage never distinguishes the
 *     length variant ("that's a 737", never "that's a 737-800") — these
 *     collapse fully to the bare model number, matching the tester's own
 *     literal example (B738/B39M/B3XM/B736 -> "737").
 *   - Airbus A318/A319/A320/A321: kept as FOUR DISTINCT buckets, only
 *     folding the neo/ceo engine suffix together (A20N -> "A320", same
 *     bucket as A320). This is a genuine asymmetry with the Boeing
 *     narrowbody treatment above, not an inconsistency slipped in by
 *     accident: unlike a 737-800 vs -900, people who can tell an A320
 *     from an A321 apart generally DO use those specific names in
 *     conversation ("that's an A321", not "that's an A320-family jet") —
 *     the family's own individual member names are already the
 *     colloquial names, where 737's sub-variant numbers aren't. Worth
 *     revisiting directly with the project owner if real usage suggests
 *     otherwise — see ROADMAP.md.
 *   - Airbus widebodies (A330/A340/A350/A380) and turboprops with a
 *     genuinely distinct common name per size (ATR 42 vs ATR 72) are
 *     each kept as their own real name, same reasoning as the A320-
 *     family case — these aren't "sub-variants of one thing" the way
 *     737-600..900 are, they're different aircraft with different names
 *     people actually use.
 *   - Regional jets (CRJ, E-Jet) collapse to family — casual spotters
 *     essentially never distinguish a CRJ700 from a CRJ900, or an E170
 *     from an E190, by sight.
 *   - GA/light aircraft, helicopters, business jets, and military types
 *     are DELIBERATELY NOT covered here — their ICAO codes (C172, PA28,
 *     R44, ...) are already about as simple as a casual reader needs;
 *     adding hundreds of rarely-relevant entries for those would be
 *     real, unnecessary complexity for approximately zero readability
 *     gain. They pass through unchanged via the fallback below, same as
 *     any other unmapped code.
 *
 * COVERAGE, stated honestly rather than implied complete: this is a
 * starter set covering common mainline/regional/turboprop families
 * likely to actually appear in typical VCAS use, not an exhaustive
 * ICAO type-designator reference (there are thousands of real codes).
 * Anything not in this table falls back to the RAW designator unchanged
 * — never worse than today, just not simplified for that one type. The
 * ground-truth observation log (src/dev/observationLogger.js) already
 * records every sighting's real `aircraft.type`, which is a natural,
 * already-existing signal for what's showing up unmapped and worth
 * adding — no new instrumentation needed to find real gaps over time.
 *
 * The actual codes below reflect general aviation-industry knowledge,
 * not a fetch/lookup verified against a live ADS-B feed from this
 * sandbox (this sandbox has no network path to adsb.fi directly — see
 * CLAUDE.md's own "Sandbox environment notes") — flagged the same way
 * every other reference-data table in this codebase is when it wasn't
 * independently re-verified against a live source.
 *
 * LONGER TERM, per the project owner's own framing: "this is where
 * Vectair as a whole starts to come in" — a shared type-to-group mapping
 * belongs in whatever broader aircraft-type reference database Vectair
 * maintains, not hand-typed JS living only in this repo. Deliberately
 * isolated behind this one function so that swap is clean later: every
 * call site only ever calls SimplifiedType.get(type) and has no idea
 * whether the answer came from this static table or a fetched/DB-backed
 * one — see ROADMAP.md's own entry for this feature.
 */
const SimplifiedType = (() => {
  const GROUPS = {
    // Boeing narrowbody — collapses fully, including every length/engine
    // variant (see the grouping-principle comment above for why).
    B731: "737", B732: "737", B733: "737", B734: "737", B735: "737",
    B736: "737", B737: "737", B738: "737", B739: "737",
    B37M: "737", B38M: "737", B39M: "737", B3XM: "737",

    // Boeing 747 — every generation/length variant.
    B741: "747", B742: "747", B743: "747", B744: "747", B748: "747",
    B74S: "747",

    // Boeing 757.
    B752: "757", B753: "757",

    // Boeing 767.
    B762: "767", B763: "767", B764: "767",

    // Boeing 777 (including 777X — not yet common in real feeds, added
    // for completeness once it is).
    B772: "777", B773: "777", B77L: "777", B77W: "777",
    B778: "777", B779: "777",

    // Boeing 787 Dreamliner.
    B788: "787", B789: "787", B78X: "787",

    // Airbus narrowbody — kept distinct by series number; only the
    // engine-generation (neo) suffix folds into its ceo equivalent.
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
   *   code, otherwise rawType UNCHANGED (falsy input — "", null,
   *   undefined — also passes straight through, matching every call
   *   site's own existing "type || fallback" handling).
   */
  function get(rawType) {
    if (!rawType) return rawType;
    const key = String(rawType).trim().toUpperCase();
    return GROUPS[key] || rawType;
  }

  return { get };
})();

if (typeof module !== "undefined") module.exports = SimplifiedType;
