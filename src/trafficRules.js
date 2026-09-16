/**
 * TrafficRules — persisted state for user-defined traffic rules (CRUD +
 * localStorage), the sibling state module to the pure evaluator in
 * src/logic/trafficRules.js (TrafficRulesLogic) — same split this project
 * already uses for MetarProvider/LocalObstruction vs. visibility.js. The
 * actual settings-screen UI lives in app.js's `_renderTrafficRulesList()`/
 * `_renderTrafficRuleForm()`, matching how AltitudeSuppressPanel/
 * ModeButtonOrder own state only and app.js owns their controls.
 *
 * Rule shape:
 *   {
 *     id: string,                 // "rule_<timestamp>_<random>"
 *     mode: "filter" | "highlight",
 *     enabled: boolean,
 *     conditions: {
 *       typeQuery: string,        // "" = unset; free-text substring match against aircraft.type
 *       category: string,         // "any" = unset; one of TrafficRulesLogic.getCategories()'s keys
 *       altitude: { enabled: boolean, direction: "above"|"below", ft: number },
 *       traffic: "any" | "military" | "civil",
 *     },
 *     color: string,              // highlight ring colour, hex — only meaningful when mode === "highlight"
 *   }
 */
const TrafficRules = (() => {
  const STORAGE_KEY = "vcas-traffic-rules-v1";
  const DEFAULT_HIGHLIGHT_COLOR = "#ffcc00";

  let _rules = [];

  function _defaultConditions() {
    return {
      typeQuery: "",
      category: "any",
      altitude: { enabled: false, direction: "above", ft: 10000 },
      traffic: "any",
    };
  }

  function _isValidRule(r) {
    return r && typeof r === "object"
      && typeof r.id === "string"
      && (r.mode === "filter" || r.mode === "highlight")
      && typeof r.enabled === "boolean"
      && r.conditions && typeof r.conditions === "object";
  }

  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) _rules = parsed.filter(_isValidRule);
      }
    } catch (e) {
      // Malformed/corrupted storage — start with no rules rather than throw.
    }
    return _rules.slice();
  }

  function _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_rules)); }
    catch (e) { /* private-browsing/quota — rules just won't survive a reload */ }
  }

  function list() { return _rules.slice(); }

  function _newId() {
    return "rule_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  /** Adds a new rule with the given mode, default (all-unset) conditions,
   * and (for highlight rules) a default colour — returns the new rule so
   * the caller can immediately open it in the edit form.
   *
   * Starts DISABLED, deliberately — all-unset conditions match every
   * aircraft (see TrafficRulesLogic.matchesConditions's own "empty
   * conditions match everything" contract), so a brand-new filter rule
   * would instantly hide the entire aircraft list the moment it's created,
   * before the user has configured a single condition. The settings-screen
   * form is expected to explicitly enable the rule on Save (once real
   * conditions are set) and delete it outright on Cancel if it was never
   * saved — see app.js's own `_pendingNewRuleId` handling. */
  function add(mode) {
    const rule = {
      id: _newId(),
      mode: mode === "highlight" ? "highlight" : "filter",
      enabled: false,
      conditions: _defaultConditions(),
      color: DEFAULT_HIGHLIGHT_COLOR,
    };
    _rules.push(rule);
    _persist();
    return rule;
  }

  /** Shallow-merges `patch` into the rule with the given id (conditions
   * replaced wholesale when present in patch, not deep-merged — the
   * settings form always writes a complete conditions object). */
  function update(id, patch) {
    const idx = _rules.findIndex(r => r.id === id);
    if (idx === -1) return null;
    _rules[idx] = { ..._rules[idx], ...patch };
    _persist();
    return _rules[idx];
  }

  function remove(id) {
    _rules = _rules.filter(r => r.id !== id);
    _persist();
  }

  function toggleEnabled(id) {
    const rule = _rules.find(r => r.id === id);
    if (!rule) return;
    rule.enabled = !rule.enabled;
    _persist();
  }

  return { init, list, add, update, remove, toggleEnabled, DEFAULT_HIGHLIGHT_COLOR };
})();

if (typeof module !== "undefined") module.exports = TrafficRules;
