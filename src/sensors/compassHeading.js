/**
 * CompassHeading — device-orientation-based heading, used as a fallback
 * exactly when GPS course-over-ground is untrusted (below
 * CONFIG.GPS_HEADING_MIN_SPEED_MPH, i.e. stationary/slow). GPS course wins
 * whenever it's trusted — a moving vehicle's own magnetic field makes
 * in-cabin compass readings comparatively unreliable, and GPS course is
 * already the more direct signal for "which way is the car travelling."
 *
 * Fragmented across platforms, handled here so callers don't need to know:
 *   - iOS Safari: DeviceOrientationEvent.requestPermission() must be called
 *     from a user gesture before anything fires; once granted, listens on
 *     "deviceorientation" and reads the non-standard event.webkitCompassHeading
 *     (degrees clockwise from MAGNETIC north — a few degrees off true north
 *     depending on region/declination, and subject to the usual phone
 *     magnetometer calibration quirks).
 *   - Android (Chrome/Edge): no permission needed; listens on
 *     "deviceorientationabsolute" and derives heading from the world-based
 *     alpha value, corrected for screen rotation (screen.orientation.angle)
 *     so a landscape-mounted phone (dash mount) still reads correctly. This
 *     correction is derived from documentation, not confirmed against a
 *     real device yet — needs field verification.
 *   - Anywhere unsupported: isSupported() is false, callers keep their
 *     existing (frozen-while-stationary) behaviour untouched. No regression.
 *
 * Output is smoothed (circularly — naive linear averaging breaks at the
 * 0/360 wrap) rather than fed raw, since magnetometer readings are jumpier
 * than GPS course.
 */
const CompassHeading = (() => {
  const SMOOTH_FACTOR          = 0.25; // higher = more responsive, lower = steadier
  const MIN_UPDATE_INTERVAL_MS = 150;  // throttle — some devices fire orientation events much faster than useful here

  let _smoothedX = null, _smoothedY = null;
  let _lastEmitAt = 0;
  let _listening  = false;
  let _onHeadingChange = null;
  let _eventName = null;

  function isSupported() {
    return typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";
  }

  function needsPermission() {
    return isSupported() && typeof window.DeviceOrientationEvent.requestPermission === "function";
  }

  /** Must be called from within a user gesture handler (a click/tap) — iOS requirement. */
  async function requestPermission() {
    if (!needsPermission()) return true;
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      return result === "granted";
    } catch (err) {
      console.warn("[CompassHeading] permission request failed:", err.message);
      return false;
    }
  }

  function _extractHeadingDeg(event) {
    if (typeof event.webkitCompassHeading === "number" && !isNaN(event.webkitCompassHeading)) {
      return event.webkitCompassHeading; // already degrees clockwise from magnetic north
    }
    if (typeof event.alpha === "number" && !isNaN(event.alpha)) {
      const screenAngle = (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number")
        ? screen.orientation.angle : 0;
      return (360 - event.alpha + screenAngle) % 360;
    }
    return null;
  }

  function _handleEvent(event) {
    const raw = _extractHeadingDeg(event);
    if (raw == null) return;

    const rad = (raw * Math.PI) / 180;
    if (_smoothedX == null) {
      _smoothedX = Math.cos(rad);
      _smoothedY = Math.sin(rad);
    } else {
      _smoothedX += (Math.cos(rad) - _smoothedX) * SMOOTH_FACTOR;
      _smoothedY += (Math.sin(rad) - _smoothedY) * SMOOTH_FACTOR;
    }

    const now = Date.now();
    if (now - _lastEmitAt < MIN_UPDATE_INTERVAL_MS) return;
    _lastEmitAt = now;

    const smoothedDeg = ((Math.atan2(_smoothedY, _smoothedX) * 180) / Math.PI + 360) % 360;
    if (_onHeadingChange) _onHeadingChange(smoothedDeg);
  }

  /**
   * @param {function(number):void} onHeadingChange  Called with a smoothed heading
   *   (degrees, 0-360, clockwise from north) whenever a usable reading arrives.
   */
  function start(onHeadingChange) {
    if (_listening || !isSupported()) return;
    _onHeadingChange = onHeadingChange;
    _smoothedX = _smoothedY = null;
    _eventName = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(_eventName, _handleEvent);
    _listening = true;
  }

  function stop() {
    if (!_listening) return;
    window.removeEventListener(_eventName, _handleEvent);
    _listening = false;
    _onHeadingChange = null;
  }

  return { isSupported, needsPermission, requestPermission, start, stop };
})();

if (typeof module !== "undefined") module.exports = CompassHeading;
