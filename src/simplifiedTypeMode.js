/**
 * SimplifiedTypeMode — tracks whether the "Simplify aircraft types"
 * setting is active. A simple persisted boolean, same exact shape as
 * ColorblindMode (src/colorblindMode.js) — read directly by ui.js/map.js
 * wherever they already read the aircraft's raw `.type` field for
 * display, right alongside the colourblind-palette check both already
 * make at render time for the same aircraft. See src/logic/
 * simplifiedType.js for the actual type -> group lookup this setting
 * gates.
 */
const SimplifiedTypeMode = (() => {
  const STORAGE_KEY = "vcas-simplify-types";
  let _enabled = false;

  function init() {
    _enabled = localStorage.getItem(STORAGE_KEY) === "1";
    return _enabled;
  }

  function isEnabled() { return _enabled; }

  function toggle() {
    _enabled = !_enabled;
    localStorage.setItem(STORAGE_KEY, _enabled ? "1" : "0");
    return _enabled;
  }

  return { init, isEnabled, toggle };
})();

if (typeof module !== "undefined") module.exports = SimplifiedTypeMode;
