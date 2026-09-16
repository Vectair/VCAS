/**
 * ManualTilt — Hybrid-only manual camera-pitch override.
 *
 * Direct request (2026-09-09): a small toggle in Hybrid mode that opens a
 * vertical slider letting the user set a fixed camera tilt, instead of the
 * automatic pitch NavigationCameraEvaluator would otherwise pick per
 * driving state (NAV_IDLE/URBAN_GUIDANCE/HIGHWAY_GUIDANCE/TURN_APPROACH).
 * Confirmed via AskUserQuestion: pitch/tilt only (zoom/anchor/bearing stay
 * under the automatic camera's control), and a HARD override — whatever
 * state the evaluator would otherwise pick, this pitch value wins outright
 * — with the explicit caveat the user added themselves: "reverts to the
 * generic driving settings over 5mph." Locked to the exact same
 * CONFIG.GPS_HEADING_MIN_SPEED_MPH gate this app already uses for the LOG
 * button and the popup's log/suppress buttons (a real distraction/safety
 * measure, not a new threshold to keep in sync by hand) — the toggle can't
 * even be switched ON above that speed, and switching it on then
 * accelerating past it force-disables the override automatically.
 *
 * The PITCH VALUE persists across sessions (localStorage) independent of
 * whether the override is currently enabled — turning the toggle back on
 * later resumes wherever the slider was left, per the direct instruction
 * "if the slider is manipulated that position should persist." Whether
 * the override itself is ON does NOT persist across a fresh load — see
 * init()'s own comment for why.
 *
 * `reset()` puts the PITCH back to a single well-defined default
 * (NavigationCameraEvaluator.STATE_PRESETS.NAV_IDLE.pitch, duplicated here
 * as DEFAULT_PITCH_DEG — see that constant's own comment for the "keep in
 * sync by hand" caveat) while leaving the override itself enabled, so the
 * slider handle visibly snaps back to "default" and the user can nudge it
 * again from there — it does not turn the feature off; that is the toggle
 * button's own separate job.
 */
const ManualTilt = (() => {
  const STORAGE_KEY_PITCH = "vcas-manual-tilt-pitch-deg";

  // Mirrors NavigationCameraEvaluator.STATE_PRESETS.NAV_IDLE.pitch — no
  // build-time link between this file and that one, so if NAV_IDLE's own
  // pitch is ever retuned, update this constant by hand to match (same
  // "intentionally duplicated, kept in sync by hand" caveat this codebase
  // already carries for MAPTILER_KEY/LOG_ENDPOINT_KEY and others).
  const DEFAULT_PITCH_DEG = 45;

  // Matches the real ceiling MapLibre GL JS's own Transform class enforces
  // (`maxPitchThreshold = 85`, confirmed by reading the library's actual
  // source) — map.js now passes `maxPitch: 85` explicitly to the
  // maplibregl.Map constructor so the live map can actually reach this,
  // not just NavigationCameraEvaluator's own [0,85] clamp (the map's
  // un-overridden default ceiling is 60, silently swallowing anything
  // above it — a real, previously-unnoticed gap found while building this
  // feature, fixed alongside it; see CLAUDE.md).
  const PITCH_MIN = 0;
  const PITCH_MAX = 85;

  let _enabled = false;
  let _pitchDeg = DEFAULT_PITCH_DEG;
  let _speedMph = 0;

  function _clamp(v) {
    const n = Number(v);
    if (isNaN(n)) return DEFAULT_PITCH_DEG;
    return Math.max(PITCH_MIN, Math.min(PITCH_MAX, n));
  }

  /**
   * Loads the persisted pitch value. Deliberately does NOT persist whether
   * the override was left ON — every fresh load starts with it off, both
   * because the real speed isn't known yet until the first GPS fix (so
   * there's nothing to check the 5mph gate against at load time) and
   * because silently resuming an active camera override from a previous,
   * possibly very different, session reads as more surprising than useful
   * for a control this specialised.
   */
  function init() {
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY_PITCH); } catch (e) { /* private browsing */ }
    _pitchDeg = stored === null ? DEFAULT_PITCH_DEG : _clamp(parseFloat(stored));
    _enabled = false;
    _speedMph = 0;
  }

  function isEnabled() { return _enabled; }
  function getPitchDeg() { return _pitchDeg; }
  function getDefaultPitchDeg() { return DEFAULT_PITCH_DEG; }
  function getPitchRange() { return { min: PITCH_MIN, max: PITCH_MAX }; }

  /**
   * Turn the override on/off. Refused outright (returns false, no state
   * change) if asked to turn ON while already above the speed gate —
   * "the option to enable this will be locked to under 5mph" is a hard
   * refusal to enable, not just a later auto-revert. Turning OFF is
   * always allowed regardless of speed.
   */
  function setEnabled(next) {
    if (next && _speedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) return false;
    _enabled = !!next;
    return true;
  }

  function setPitchDeg(deg) {
    _pitchDeg = _clamp(deg);
    try { localStorage.setItem(STORAGE_KEY_PITCH, String(_pitchDeg)); } catch (e) { /* private browsing/quota */ }
  }

  /** Resets the PITCH VALUE to the default — does not disable the override
   * itself (see this module's own doc comment for why). */
  function reset() {
    setPitchDeg(DEFAULT_PITCH_DEG);
  }

  /**
   * Called from app.js's applySpeedOverrideIfActive() — the single
   * convergence point both the real GPS path and the dev SPD override
   * already funnel every effective-speed change through (see
   * LogPanel.setSpeedMph/UI.setSpeedMph for the established pattern this
   * mirrors exactly). Force-disables an already-active override the
   * instant speed crosses the threshold — the direct instruction that this
   * "will automatically revert to the default position" above 5mph, not
   * merely refuse to newly enable.
   */
  function setSpeedMph(mph) {
    _speedMph = mph || 0;
    if (_enabled && _speedMph > CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      _enabled = false;
    }
  }

  return {
    init, isEnabled, getPitchDeg, getDefaultPitchDeg, getPitchRange,
    setEnabled, setPitchDeg, reset, setSpeedMph,
  };
})();

if (typeof module !== "undefined") module.exports = ManualTilt;
