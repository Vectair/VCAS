/**
 * State for ground/low-altitude clutter suppression — previously only
 * adjustable by editing CONFIG.SUPPRESS_LOW_ALTITUDE_ENABLED /
 * CONFIG.SUPPRESS_LOW_ALTITUDE_FT directly in config.js and redeploying.
 * State persists across reloads.
 *
 * Pure state module — the actual controls live in the settings screen
 * (src/app.js's _renderSettingsScreen and friends), not here. This module
 * used to also own a floating ALT button + menu; that UI was retired once
 * the settings screen existed, since the user classified this as a
 * "configure occasionally" preference, not a primary-screen control.
 *
 * Reminder (see the caveat already in config.js): the threshold is
 * barometric altitude (MSL), not height above you, so its effectiveness
 * varies with local terrain/airport elevation — that's exactly why this
 * needed to be adjustable without a redeploy.
 */
const AltitudeSuppressPanel = (() => {
  const STORAGE_KEY        = "vcas-altitude-suppress-ft";
  const GROUND_STORAGE_KEY = "vcas-hide-ground-aircraft";
  const PRESETS_FT         = [200, 500, 1000, 2000, 3000];

  let _enabled   = CONFIG.SUPPRESS_LOW_ALTITUDE_ENABLED;
  let _thresholdFt = CONFIG.SUPPRESS_LOW_ALTITUDE_FT;
  // Separate from the altitude threshold — an aircraft reported as on the
  // ground usually has no usable altitude at all (see normaliseAircraft.js),
  // so a numeric threshold alone can't catch it. Defaults on: the whole
  // point of this control existing is that ground clutter near an airport
  // was the reported problem.
  let _hideGround = true;
  let _onChange  = null;

  // ---- Public API ----

  function init({ onChange } = {}) {
    _onChange = onChange || null;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      if (stored === "off") {
        _enabled = false;
      } else {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0) {
          _enabled = true;
          _thresholdFt = parsed;
        }
      }
    }

    const storedGround = localStorage.getItem(GROUND_STORAGE_KEY);
    if (storedGround !== null) _hideGround = storedGround !== "0";
  }

  function isEnabled()      { return _enabled; }
  function getThresholdFt() { return _thresholdFt; }
  function isGroundHidden() { return _hideGround; }

  /** @param {boolean} enabled  @param {number} ft  Ignored when enabled is false. */
  function setThreshold(enabled, ft) {
    _enabled     = enabled;
    _thresholdFt = enabled ? ft : _thresholdFt;
    localStorage.setItem(STORAGE_KEY, enabled ? String(_thresholdFt) : "off");
    if (_onChange) _onChange();
  }

  function setGroundHidden(hidden) {
    _hideGround = hidden;
    localStorage.setItem(GROUND_STORAGE_KEY, hidden ? "1" : "0");
    if (_onChange) _onChange();
  }

  return { init, isEnabled, getThresholdFt, isGroundHidden, setThreshold, setGroundHidden, PRESETS_FT };
})();
