/**
 * PassengerMode — lets a non-driving occupant use the ground-truth logging
 * function (the LOG panel and the NAV/AIR popup's log/Suppress buttons)
 * while the vehicle is moving at normal road speed, bypassing the
 * CONFIG.GPS_HEADING_MIN_SPEED_MPH distraction/safety gate those controls
 * otherwise enforce (see logPanel.js's and ui.js's own setSpeedMph()
 * comments for that gate's own reasoning).
 *
 * Direct request (2026-10-03): "a passenger mode... so that I can use the
 * logging function if I'm in a vehicle but not driving." Confirmed shape
 * from that same message: it stays ON through normal driving speed — that
 * IS the point, unlike ManualTilt's own override, which force-disables the
 * instant speed crosses the threshold — and auto-disables itself only once
 * the vehicle has been travelling at or below GPS_HEADING_MIN_SPEED_MPH
 * CONTINUOUSLY for CONFIG.PASSENGER_MODE_DWELL_MINUTES. Once speed goes
 * back above the threshold after that auto-disable, there's no separate
 * "driving mode" to re-enter — this module is just no longer exempting the
 * logging controls from the gate they'd already be under regardless.
 *
 * The multi-minute low-speed dwell (not an instant revert the moment speed
 * drops) is deliberate: a long stop (parked, trip over, possible driver
 * change) is a real reason to require re-confirmation, but a red light or
 * a few seconds of traffic shouldn't silently drop Passenger Mode mid-trip.
 * Mirrors the exact dwell-timer idiom app.js's own _checkOffRoute() already
 * uses for reroute detection: a condition has to hold CONTINUOUSLY for the
 * full delay, reset the instant it's no longer true — never accumulated
 * across on/off blips.
 *
 * Deliberately NOT persisted across a reload — same reasoning, and the
 * same relationship to ManualTilt.js's own init() comment (no build-time
 * link between the two files, mirrored here by hand): real speed isn't
 * known yet at load time, and silently resuming an active passenger-mode
 * exemption from a previous session — possibly a different vehicle, a
 * different person in the seat — is exactly the kind of stale assumption
 * the whole auto-revert mechanism exists to prevent. Every fresh load (and
 * every auto-revert) starts from the same explicit, no-recent-
 * confirmation state; turning it on is always a deliberate, in-session act.
 */
const PassengerMode = (() => {
  let _enabled = false;
  let _belowThresholdSinceMs = null;

  function _dwellMs() {
    return (CONFIG.PASSENGER_MODE_DWELL_MINUTES || 5) * 60 * 1000;
  }

  function init() {
    _enabled = false;
    _belowThresholdSinceMs = null;
  }

  function isEnabled() { return _enabled; }

  /**
   * Manual toggle — always allowed either direction, unlike ManualTilt's
   * own setEnabled() (which refuses to enable above the speed gate): this
   * whole feature exists to be switched on BY a passenger while the
   * vehicle may already be moving at normal road speed.
   */
  function toggle() {
    _enabled = !_enabled;
    _belowThresholdSinceMs = null; // a fresh manual confirmation restarts the dwell clock
    return _enabled;
  }

  /**
   * Called from app.js's applySpeedOverrideIfActive() — the same
   * convergence point LogPanel/UI/ManualTilt's own setSpeedMph() already
   * funnel every effective-speed change (real GPS or the dev SPD override)
   * through, so this can't drift out of sync with whatever those controls
   * are themselves gated on.
   */
  function setSpeedMph(mph) {
    if (!_enabled) { _belowThresholdSinceMs = null; return; }
    if ((mph || 0) <= CONFIG.GPS_HEADING_MIN_SPEED_MPH) {
      if (_belowThresholdSinceMs === null) {
        _belowThresholdSinceMs = Date.now();
      } else if (Date.now() - _belowThresholdSinceMs >= _dwellMs()) {
        _enabled = false;
        _belowThresholdSinceMs = null;
      }
    } else {
      _belowThresholdSinceMs = null;
    }
  }

  return { init, isEnabled, toggle, setSpeedMph };
})();

if (typeof module !== "undefined") module.exports = PassengerMode;
