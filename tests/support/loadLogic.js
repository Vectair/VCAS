/**
 * Loads the real, unmodified src/logic/ modules in plain Node — replicating
 * how index.html loads them as sibling <script> tags sharing one global
 * scope. geo.js/contrail.js are attached to `global` BEFORE visibility.js/
 * relevance.js are require()'d, since those two reference `Geo`/`Contrail`
 * as free (undeclared) identifiers rather than importing them — exactly how
 * a browser resolves an undeclared identifier against `window`, and exactly
 * the loading order every one-off Playwright/Node verification harness in
 * this project's own history has had to replicate for these files.
 *
 * Every module in src/logic/ already carries its own
 * `if (typeof module !== "undefined") module.exports = X;` guard, so no
 * shimming beyond the global assignment is needed.
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
  return { Geo, Contrail, Visibility, Relevance };
}

module.exports = { loadLogic };
