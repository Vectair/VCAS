/**
 * TrafficRulesLogic — pure evaluation of user-defined "traffic rules"
 * against a single normalised aircraft object (src/data/normaliseAircraft.js's
 * output shape). No DOM, no storage — src/trafficRules.js (the sibling
 * state/persistence module, same split this project already uses for
 * MetarProvider-vs-visibility.js and LocalObstruction-vs-visibility.js)
 * owns the actual rule list; this file only answers "does this aircraft
 * match this rule's conditions."
 *
 * Direct request: "adding a function that allows the user to specify the
 * type of aircraft... either following the system so it only shows certain
 * categories... and a highlight capability where... aircraft with certain
 * traits are simply highlighted... all aircraft remain visible but ones the
 * user has a particular interest in get a highlight." Confirmed via
 * AskUserQuestion: filter (hide) and highlight (mark) share ONE rule
 * engine — each saved rule picks a `mode` of "filter" or "highlight" — not
 * two separately-built condition systems.
 *
 * A rule's conditions are AND'd together (every condition set on the rule
 * must match); an unset condition is ignored, not treated as "must be
 * absent." Which rules apply to a given aircraft:
 * - FILTER: any ENABLED filter-mode rule matching = hidden (OR across
 *   rules — matches "the system so it only shows certain categories," any
 *   one exclusion rule is enough to hide something).
 * - HIGHLIGHT: the FIRST enabled highlight-mode rule (in list order) that
 *   matches wins its colour — deliberately not "layer every matching
 *   rule's colour," since a symbol can only usefully carry one highlight
 *   ring at a time; first-match-wins gives the user control via ordering
 *   without needing a second "priority" field to build UI for.
 */
const TrafficRulesLogic = (() => {
  /**
   * ADS-B DO-260B emitter category table — the same axis
   * `normaliseAircraft.js`'s own `NON_AIRCRAFT_CATEGORIES` (C1-C5) already
   * reads from, exposed here as the single source of category labels for
   * both matching and the settings-screen dropdown (so the two can't drift
   * the way a hand-copied second table would). A0/B0/C0 ("no category
   * info") are intentionally omitted — nothing useful to filter on, and
   * the aircraft's `category` field is simply null/absent for those.
   * C1-C5 (surface vehicles/obstacles) are included even though
   * normaliseAircraft.js already excludes them unconditionally upstream —
   * a rule referencing them can never match live traffic, which is
   * harmless, not worth special-casing out of the dropdown.
   */
  const CATEGORIES = {
    A1: "Light",
    A2: "Small",
    A3: "Large",
    A4: "High vortex large",
    A5: "Heavy",
    A6: "High performance",
    A7: "Rotorcraft",
    B1: "Glider/sailplane",
    B2: "Lighter-than-air",
    B3: "Parachutist/skydiver",
    B4: "Ultralight/hang-glider",
    B6: "Unmanned (UAV)",
    B7: "Space/trans-atmospheric",
    C1: "Surface — emergency vehicle",
    C2: "Surface — service vehicle",
    C3: "Point obstacle",
    C4: "Cluster obstacle",
    C5: "Line obstacle",
  };

  function getCategories() {
    return { ...CATEGORIES };
  }

  /** True if `aircraft` satisfies every condition SET on `conditions`
   * (an unset/default condition never excludes a match). */
  function matchesConditions(aircraft, conditions) {
    if (!aircraft || !conditions) return false;

    if (conditions.typeQuery) {
      const type = (aircraft.type || "").toUpperCase();
      const query = conditions.typeQuery.trim().toUpperCase();
      if (!query) {
        // fall through — blank/whitespace-only query is the same as unset
      } else if (!type.includes(query)) {
        return false;
      }
    }

    if (conditions.category && conditions.category !== "any") {
      if (aircraft.category !== conditions.category) return false;
    }

    if (conditions.altitude && conditions.altitude.enabled) {
      const ft = aircraft.altitudeFt;
      if (ft == null) return false; // unknown altitude can't satisfy an altitude condition either way
      const threshold = conditions.altitude.ft;
      if (conditions.altitude.direction === "above") {
        if (!(ft > threshold)) return false;
      } else {
        if (!(ft < threshold)) return false;
      }
    }

    if (conditions.traffic && conditions.traffic !== "any") {
      // aircraft.military is tri-state (true/false/null="unknown" — see
      // normaliseAircraft.js's own comment on why it's never defaulted).
      // A rule asking specifically for military or civil traffic can't be
      // satisfied by an aircraft whose classification is unknown.
      if (aircraft.military == null) return false;
      if (conditions.traffic === "military" && aircraft.military !== true) return false;
      if (conditions.traffic === "civil" && aircraft.military !== false) return false;
    }

    return true;
  }

  /** True if any ENABLED filter-mode rule matches — this aircraft should
   * be hidden. `rules` is the plain array TrafficRules.list() returns. */
  function evaluateFilter(aircraft, rules) {
    if (!Array.isArray(rules)) return false;
    return rules.some(r => r.enabled && r.mode === "filter" && matchesConditions(aircraft, r.conditions));
  }

  /** The colour of the first ENABLED highlight-mode rule (in list order)
   * that matches, or null if none do. */
  function evaluateHighlight(aircraft, rules) {
    if (!Array.isArray(rules)) return null;
    const match = rules.find(r => r.enabled && r.mode === "highlight" && matchesConditions(aircraft, r.conditions));
    return match ? match.color : null;
  }

  return { getCategories, matchesConditions, evaluateFilter, evaluateHighlight };
})();

if (typeof module !== "undefined") module.exports = TrafficRulesLogic;
