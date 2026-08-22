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
 * than GPS course — leaned heavily toward stability over responsiveness
 * (see SMOOTH_FACTOR's own comment) since this module is only ever
 * consulted while stationary/slow in the first place.
 *
 * 2026-08-22: a "won't settle, or settles wrong" report while stationary
 * prompted two changes: (1) _extractHeadingDeg() now requires
 * event.absolute === true before trusting a generic alpha reading as a
 * compass heading at all — a non-absolute deviceorientation event's alpha
 * can be relative to an arbitrary reference with no fixed relationship to
 * north, which would explain "wrong direction" specifically; (2)
 * SMOOTH_FACTOR lowered for heavier noise damping, addressing "won't
 * settle." The base 360-alpha conversion itself was independently
 * re-derived against the DeviceOrientation spec's coordinate frame and
 * confirmed correct — only the screen-rotation correction two lines below
 * remains genuinely unverified against real hardware.
 */
const CompassHeading = (() => {
  // Lower than a first instinct might pick (was 0.25) — deliberately, since
  // this module is ONLY ever consulted while stationary/slow (app.js only
  // calls into it below CONFIG.GPS_HEADING_MIN_SPEED_MPH; GPS course takes
  // over entirely once actually moving). There's no competing "must track a
  // fast real turn" responsiveness need the way GPS heading smoothing has,
  // so it's safe to lean hard toward stability — real magnetometer noise
  // (interference from nearby metal/electronics, common exactly in the
  // stationary-testing scenario this was reported against) is the dominant
  // source of visible "won't settle" jitter, not anything this smoothing
  // pass can't outweigh by just being heavier. Needs field re-verification
  // against the reported symptom, not just asserted to be enough.
  const SMOOTH_FACTOR          = 0.1;
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
      return event.webkitCompassHeading; // inherently earth-referenced (magnetic north) on iOS — no absolute check needed
    }
    // event.absolute === true is required before trusting alpha as a
    // compass heading at all — per spec, a NON-absolute deviceorientation
    // event's alpha can be relative to an arbitrary reference (e.g.
    // wherever the device happened to be pointing when listening started),
    // with no fixed relationship to true/magnetic north whatsoever. The
    // dedicated "deviceorientationabsolute" event (start()'s preferred
    // event name below) always fires with absolute:true by construction,
    // so this only ever actually filters anything out on the fallback
    // path (plain "deviceorientation", used when the browser doesn't
    // support the dedicated absolute event at all) — exactly the case
    // where silently trusting a non-earth-referenced alpha as if it were
    // a real compass heading would produce a heading that's consistently,
    // but essentially arbitrarily, wrong. A real, documented gotcha with
    // this API, and the leading suspect for a reported "settles in the
    // wrong direction" symptom on a device that falls back to this path.
    if (event.absolute === true && typeof event.alpha === "number" && !isNaN(event.alpha)) {
      // Verified against the DeviceOrientation spec's own coordinate frame
      // definition, not just carried over from a prior version unchecked:
      // alpha is a rotation of the device frame around Z (right-hand rule,
      // Z pointing up out of the screen) relative to Earth's frame, where
      // alpha=0 means the device's own "up" edge points at north. A
      // positive (increasing) alpha rotation is counter-clockwise as seen
      // from above — i.e. alpha INCREASES as the device's facing turns
      // toward west — while compass heading increases turning the OTHER
      // way (toward east). "360 - alpha" is exactly the flip needed to
      // convert one sense of rotation to the other while keeping the same
      // zero-point; confirmed correct independent of any specific device,
      // not something that needed a real phone to check.
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
