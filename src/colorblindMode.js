/**
 * ColorblindMode — tracks whether the colorblind-safe visibility palette is
 * active. A simple persisted boolean, read directly by ui.js/map.js
 * wherever they already read ThemeManager.getResolved() — both are
 * "which palette variant to use" decisions made at render time in the
 * same places, for the same aircraft indicators.
 */
const ColorblindMode = (() => {
  const STORAGE_KEY = "vcas-colorblind-safe";
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

if (typeof module !== "undefined") module.exports = ColorblindMode;
