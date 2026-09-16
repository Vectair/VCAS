/**
 * View3DClouds — tracks whether the drifting cloud layer is enabled in 3D
 * View's world-building backdrop (2026-09-09 follow-up: "add an option to
 * turn off the clouds in settings if the user feels it's overly affecting
 * battery"). A simple persisted boolean, same shape as ColorblindMode —
 * the clouds are the one piece of 3D View's world-building set (horizon
 * silhouette, haze band, ground texture, clouds, compass ticks) with any
 * ongoing per-frame cost (a continuous, GPU-composited CSS transform
 * animation while the overlay is open) rather than a static, compute-once
 * layer, so it's the one given its own off switch.
 */
const View3DClouds = (() => {
  const STORAGE_KEY = "vcas-3d-clouds";
  let _enabled = true; // on by default — a real visual improvement, not a hidden feature someone has to discover

  function init() {
    const stored = localStorage.getItem(STORAGE_KEY);
    _enabled = stored === null ? true : stored === "1";
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

if (typeof module !== "undefined") module.exports = View3DClouds;
