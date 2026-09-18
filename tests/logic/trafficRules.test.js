/**
 * Real-execution checks for src/logic/trafficRules.js (TrafficRulesLogic)
 * — the pure rule-matching engine behind the Traffic Rules feature (user-
 * defined filter/highlight rules by type, category, altitude, military-
 * vs-civil). See CLAUDE.md's "Traffic Rules" entry and its multi-value
 * type-matching follow-up for the full design writeup. No DOM/storage
 * dependency here — src/trafficRules.js (a separate, sibling module) owns
 * the persisted rule list; this file only answers "does this aircraft
 * match this rule's conditions."
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { TrafficRulesLogic } = loadLogic();
const t = createSuite("trafficRules.js");

function aircraft(overrides) {
  return Object.assign({
    hex: "abc123", type: "B738", category: "A3",
    altitudeFt: 30000, military: false,
  }, overrides);
}

function rule(overrides) {
  return Object.assign({
    id: "r1", mode: "filter", enabled: true, color: "#e69f00",
    conditions: {},
  }, overrides);
}

// ---- getCategories(): a fresh, distinct copy each call, real labels present ----
{
  const cats1 = TrafficRulesLogic.getCategories();
  const cats2 = TrafficRulesLogic.getCategories();
  t.ok(cats1 !== cats2, "getCategories() returns a fresh object each call, not the live internal table");
  t.eq(cats1.A3, "Large", "A3 category label is present and correct");
  t.eq(cats1.C1, "Surface — emergency vehicle", "C1 category label is present (included even though normaliseAircraft.js excludes it upstream)");
  cats1.A3 = "tampered";
  const cats3 = TrafficRulesLogic.getCategories();
  t.eq(cats3.A3, "Large", "mutating a returned copy doesn't affect the module's own table");
}

// ---- matchesConditions(): degenerate inputs ----
t.eq(TrafficRulesLogic.matchesConditions(null, {}), false, "null aircraft never matches");
t.eq(TrafficRulesLogic.matchesConditions(aircraft(), null), false, "null conditions never matches");
t.eq(TrafficRulesLogic.matchesConditions(aircraft(), {}), true, "empty conditions match everything (the deliberate base case)");

// ---- typeQuery: single-value substring match, case-insensitive ----
{
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), { typeQuery: "A320" }), true, "exact type match");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), { typeQuery: "a320" }), true, "case-insensitive match");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), { typeQuery: "B738" }), false, "non-matching type excluded");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), { typeQuery: "A32" }), true, "substring match (not full-string equality)");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: null }), { typeQuery: "A320" }), false, "null aircraft type never matches a real typeQuery");
}

// ---- typeQuery: comma-separated OR list (the "Soviet-era" follow-up) ----
{
  const soviet = { typeQuery: "MiG,Su,Tu,An,Il,Yak,Mi,Ka,Be" };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "MIG29" }), soviet), true, "MiG-29 matches the Soviet-type list");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "SU27" }), soviet), true, "Su-27 matches the Soviet-type list");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "F16" }), soviet), false, "F-16 does not match the Soviet-type list");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), soviet), false, "A320 does not match the Soviet-type list");
  // Spaces/trailing comma/blank terms handled: trimmed+uppercased per term, blanks dropped.
  const messy = { typeQuery: " MiG , Su ,, Tu " };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "TU95" }), messy), true, "a spaced/trailing-comma list still matches correctly");
  // A genuine single-value rule (terms.length === 1) still behaves like before the comma-list change.
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ type: "A320" }), { typeQuery: "A320" }), true, "single-term rule still works (regression check)");
}

// ---- category ----
{
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A5" }), { category: "A5" }), true, "matching category");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A3" }), { category: "A5" }), false, "non-matching category excluded");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A3" }), { category: "any" }), true, "category:'any' is a no-op, matches regardless");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: null }), { category: "A5" }), false, "null aircraft category never matches a specific category condition");
}

// ---- altitude: above/below, and the unknown-altitude guard ----
{
  const above10k = { altitude: { enabled: true, direction: "above", ft: 10000 } };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 30000 }), above10k), true, "30000ft is above the 10000ft threshold");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 5000 }), above10k), false, "5000ft is not above the 10000ft threshold");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 10000 }), above10k), false, "exactly at the threshold does not satisfy 'above' (strict >, not >=)");

  const below10k = { altitude: { enabled: true, direction: "below", ft: 10000 } };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 5000 }), below10k), true, "5000ft is below the 10000ft threshold");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 30000 }), below10k), false, "30000ft is not below the 10000ft threshold");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 10000 }), below10k), false, "exactly at the threshold does not satisfy 'below' (strict <, not <=)");

  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: null }), above10k), false, "unknown altitude can't satisfy 'above' either way");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: null }), below10k), false, "unknown altitude can't satisfy 'below' either way");

  const disabledAlt = { altitude: { enabled: false, direction: "above", ft: 10000 } };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ altitudeFt: 100 }), disabledAlt), true, "a disabled altitude condition is a no-op regardless of value");
}

// ---- traffic: military/civil, tri-state 'unknown' never satisfies a specific direction ----
{
  const militaryOnly = { traffic: "military" };
  const civilOnly = { traffic: "civil" };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: true }), militaryOnly), true, "military:true matches a military-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: false }), militaryOnly), false, "military:false does not match a military-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: false }), civilOnly), true, "military:false matches a civil-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: true }), civilOnly), false, "military:true does not match a civil-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: null }), militaryOnly), false, "unknown military status never satisfies a military-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: null }), civilOnly), false, "unknown military status never satisfies a civil-only condition");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ military: null }), { traffic: "any" }), true, "traffic:'any' is a no-op, matches regardless of military status");
}

// ---- conditions AND together, not OR ----
{
  const combo = { category: "A5", traffic: "military" };
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A5", military: true }), combo), true, "both conditions satisfied -> matches");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A5", military: false }), combo), false, "category satisfied, traffic not -> excluded (AND, not OR)");
  t.eq(TrafficRulesLogic.matchesConditions(aircraft({ category: "A3", military: true }), combo), false, "traffic satisfied, category not -> excluded (AND, not OR)");
}

// ---- evaluateFilter(): OR across enabled filter-mode rules, disabled/highlight rules ignored ----
{
  const ac = aircraft({ category: "A5" });
  const rules = [
    rule({ id: "f1", mode: "filter", enabled: true, conditions: { category: "A5" } }),
    rule({ id: "f2", mode: "filter", enabled: true, conditions: { category: "A3" } }),
  ];
  t.eq(TrafficRulesLogic.evaluateFilter(ac, rules), true, "matches the first of two filter rules -> filtered (hidden)");
  t.eq(TrafficRulesLogic.evaluateFilter(aircraft({ category: "B1" }), rules), false, "matches neither filter rule -> not filtered");

  const disabledRule = [rule({ mode: "filter", enabled: false, conditions: { category: "A5" } })];
  t.eq(TrafficRulesLogic.evaluateFilter(ac, disabledRule), false, "a disabled filter rule never hides anything, even if its conditions match");

  const highlightOnly = [rule({ mode: "highlight", enabled: true, conditions: { category: "A5" } })];
  t.eq(TrafficRulesLogic.evaluateFilter(ac, highlightOnly), false, "a highlight-mode rule is never applied by evaluateFilter, only filter-mode rules are");

  t.eq(TrafficRulesLogic.evaluateFilter(ac, null), false, "a non-array rules argument degrades to 'not filtered', not a throw");
  t.eq(TrafficRulesLogic.evaluateFilter(ac, []), false, "an empty rule list filters nothing");
}

// ---- evaluateHighlight(): first-match-wins in list order, filter rules ignored, null when nothing matches ----
{
  const ac = aircraft({ category: "A5", military: true });
  const rules = [
    rule({ id: "h1", mode: "highlight", enabled: true, color: "#111111", conditions: { category: "A5" } }),
    rule({ id: "h2", mode: "highlight", enabled: true, color: "#222222", conditions: { traffic: "military" } }),
  ];
  t.eq(TrafficRulesLogic.evaluateHighlight(ac, rules), "#111111", "the FIRST matching enabled highlight rule wins, not every matching rule layered");

  const reordered = [rules[1], rules[0]];
  t.eq(TrafficRulesLogic.evaluateHighlight(ac, reordered), "#222222", "reordering the same two rules changes which one wins -- genuinely list-order-driven, not id-order or insertion-order");

  t.eq(TrafficRulesLogic.evaluateHighlight(aircraft({ category: "B1", military: false }), rules), null, "no matching highlight rule -> null, not undefined or a thrown error");

  const disabledHighlight = [rule({ mode: "highlight", enabled: false, color: "#333333", conditions: { category: "A5" } })];
  t.eq(TrafficRulesLogic.evaluateHighlight(ac, disabledHighlight), null, "a disabled highlight rule never wins, even if its conditions match");

  const filterOnly = [rule({ mode: "filter", enabled: true, color: "#444444", conditions: { category: "A5" } })];
  t.eq(TrafficRulesLogic.evaluateHighlight(ac, filterOnly), null, "a filter-mode rule is never applied by evaluateHighlight, only highlight-mode rules are");

  t.eq(TrafficRulesLogic.evaluateHighlight(ac, null), null, "a non-array rules argument degrades to 'no highlight', not a throw");
}

t.done();
