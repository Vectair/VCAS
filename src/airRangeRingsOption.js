/**
 * AirRangeRingsOption — tracks whether range rings should also draw in AIR
 * mode. Off by default: in AIR they're true 1:1 map-scale nm circles (see
 * EosMap.updateRangeRings), a legitimate distance reference at that real
 * map view, but still an extra layer over an already map-native display
 * some people won't want on by default.
 */
const AirRangeRingsOption = (() => {
  const STORAGE_KEY = "vcas-air-range-rings";
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

if (typeof module !== "undefined") module.exports = AirRangeRingsOption;
