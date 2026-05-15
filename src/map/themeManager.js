/**
 * ThemeManager — tracks Day/Night/Auto preference and resolves it to a
 * concrete "day" | "night" value that the map and UI can consume.
 *
 * Auto mode resolves by local time of day:
 *   Day   = 07:00 – 19:00 local
 *   Night = 19:00 – 07:00 local
 * A 60-second interval re-checks the clock so the transition fires
 * automatically without a page reload.
 */

const ThemeManager = (() => {

  let _preference = "auto";   // "day" | "night" | "auto"
  let _resolved   = "night";  // "day" | "night"
  let _onChange   = null;
  let _tickTimer  = null;

  function _fromTime() {
    const h = new Date().getHours(); // 0-23 local
    return (h >= 7 && h < 19) ? "day" : "night";
  }

  function _tick() {
    if (_preference !== "auto") return;
    const next = _fromTime();
    if (next !== _resolved) {
      _resolved = next;
      _onChange?.(_resolved);
    }
  }

  /**
   * Call once before any map or UI code runs.
   * @param {function(string):void} onChangeFn  Called with "day"|"night" on theme change.
   * @returns {string} The initial resolved theme ("day"|"night").
   */
  function init(onChangeFn) {
    _onChange = onChangeFn;
    _resolved = (_preference === "auto") ? _fromTime() : _preference;
    _tickTimer = setInterval(_tick, 60_000);
    return _resolved;
  }

  /**
   * Set the user's explicit preference.
   * @param {"day"|"night"|"auto"} pref
   * @returns {string} The newly resolved theme ("day"|"night").
   */
  function setPreference(pref) {
    _preference = pref;
    const next  = (pref === "auto") ? _fromTime() : pref;
    if (next !== _resolved) {
      _resolved = next;
      _onChange?.(_resolved);
    }
    return _resolved;
  }

  function getResolved()   { return _resolved; }
  function getPreference() { return _preference; }

  return { init, setPreference, getResolved, getPreference };
})();

if (typeof module !== "undefined") module.exports = ThemeManager;
