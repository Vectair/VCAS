/**
 * Loads the real, unmodified src/logic/ modules in plain Node — replicating
 * how index.html loads them as sibling <script> tags sharing one global
 * scope. Dependencies are attached to `global` BEFORE the modules that
 * reference them are require()'d, since those reference `Geo`/`Contrail`/
 * `Visibility`/`Relevance` as free (undeclared) identifiers rather than
 * importing them — exactly how a browser resolves an undeclared identifier
 * against `window`, and exactly the loading order every one-off Playwright/
 * Node verification harness in this project's own history has had to
 * replicate for these files. Load order mirrors index.html's real
 * <script> order: geo -> contrail -> visibility -> relevance ->
 * aircraftExtrapolation -> indicators (indicators.js reads Relevance.
 * DEFAULTS/Visibility.estimate/Geo.* as free globals too).
 *
 * Every module in src/logic/ already carries its own
 * `if (typeof module !== "undefined") module.exports = X;` guard, so no
 * shimming beyond the global assignment is needed.
 *
 * trafficRules.js (TrafficRulesLogic) is a genuinely standalone pure
 * module — no dependency on Geo/Visibility/Relevance/etc, and nothing
 * else references it as a free global — so it's simply require()'d
 * directly with no ordering concern, matching where it sits in
 * index.html's own real <script> list (loaded last, after indicators.js).
 */
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "src", "logic");

function loadLogic() {
  const Geo = require(path.join(ROOT, "geo.js"));
  const Contrail = require(path.join(ROOT, "contrail.js"));
  global.Geo = Geo;
  global.Contrail = Contrail;
  const Visibility = require(path.join(ROOT, "visibility.js"));
  const Relevance = require(path.join(ROOT, "relevance.js"));
  global.Visibility = Visibility;
  global.Relevance = Relevance;
  const AircraftExtrapolation = require(path.join(ROOT, "aircraftExtrapolation.js"));
  const Indicators = require(path.join(ROOT, "indicators.js"));
  const TrafficRulesLogic = require(path.join(ROOT, "trafficRules.js"));
  return { Geo, Contrail, Visibility, Relevance, AircraftExtrapolation, Indicators, TrafficRulesLogic };
}

module.exports = { loadLogic };
