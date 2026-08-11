/**
 * DevMode — hides the VIEW/SPD developer testing tools (viewport emulation,
 * GPS speed override) from normal use. These aren't end-user features, just
 * scaffolding for verifying speed/viewport-gated behavior without a real
 * moving device — the user asked for them off the primary screen AND out
 * of the real settings screen, so they're reachable only via the same kind
 * of hidden unlock Android itself uses for its own developer options: tap
 * the brand mark 7 times.
 */
const DevMode = (() => {
  const STORAGE_KEY = "vcas-dev-mode";
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
