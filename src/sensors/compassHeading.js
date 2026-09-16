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
 *
 * 2026-08-24 follow-up: the (1) fix above turned out to be over-strict.
 * Reported symptom — heading "settling on an approximate northerly
 * heading even when facing east/west" — is what EVERY reading being
 * rejected looks like (frozen near userHeading's 0° default), not a
 * biased-but-responsive compass. _extractHeadingDeg() now also trusts the
 * event TYPE itself (deviceorientationabsolute, which per spec always
 * carries absolute:true "by construction") as sufficient evidence,
 * instead of requiring the `absolute` property to independently confirm
 * it — real-world Android implementations have been inconsistent about
 * actually setting that property even on this event. Same category of
 * platform-fragmentation gotcha the rest of this module already works
 * around, not a new kind of bug. Still needs real-device field
 * confirmation — see the module's own reasoning inline for why this is
 * the leading fit for the exact symptom reported, not a guess made from
 * nothing.
 *
 * 2026-09-13 follow-up, two additions for 3D View specifically (that
 * mode's own "extremely jittery" + "compass gets confused finding North
 * while stationary" reports):
 *
 * 1. setSmoothFactor()/resetSmoothFactor() — lets a caller temporarily
 *    swap in a heavier damping constant than SMOOTH_FACTOR's own default
 *    for the DURATION it's actively consuming this module, without
 *    touching the default every other consumer (RAW/nav's own stationary
 *    heading fallback) keeps getting. 3D View's own linear degrees-to-
 *    pixels mapping (view3dLogic.js) visibly amplifies residual noise far
 *    more than RAW's compass tape does, but RAW's own use is a plain,
 *    genuinely-stationary dash-mount reading with no reason to trade away
 *    responsiveness it doesn't need more of — the two consumers warrant
 *    different tradeoffs, and this keeps them independently tunable
 *    without a second copy of this module.
 * 2. calibrateTo()/clearCalibration()/hasCalibration() — a manual
 *    reference-point override: "I am currently pointing at [true heading
 *    X], use that as the new zero instead of whatever the magnetometer
 *    itself currently reads." Directly answers a real, distinct failure
 *    mode from the "won't settle" jitter fixed above: a magnetically
 *    biased ABSOLUTE reading (nearby metal/electronics, common exactly in
 *    the stationary-testing scenarios this module is always used in) can
 *    be perfectly SETTLED and STILL wrong — no amount of additional
 *    smoothing fixes a consistently-biased zero-point, only a real
 *    external reference can. The offset is intentionally NOT persisted to
 *    localStorage — stop() resets it to zero, so a fresh stationary
 *    period (a new location, a new magnetic environment) always starts
 *    from the sensor's own raw reading rather than silently carrying a
 *    stale correction forward from somewhere else.
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
  let _activeSmoothFactor = SMOOTH_FACTOR;
  let _manualOffsetDeg = 0;
  let _calibrated = false;

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
    // Trust alpha as earth-referenced when EITHER the event itself says so
    // (event.absolute === true) OR we're listening via the dedicated
    // "deviceorientationabsolute" event — which per spec always carries
    // absolute:true "by construction", so the event TYPE is itself a valid,
    // independent signal, not just a fallback check on the property.
    //
    // 2026-08-24 follow-up: requiring the PROPERTY specifically (not just
    // the event type) turned out to be over-strict in exactly the way
    // flagged as the leading suspect when this was first fixed — a report
    // of the heading "settling on an approximate northerly heading even
    // when facing east/west" (i.e. frozen near userHeading's initial 0°
    // default, not swinging-but-biased the way a declination or
    // screen-rotation error would look) is the specific symptom of EVERY
    // reading being silently rejected, not just some. Real-world Android
    // implementations have been inconsistent about actually setting
    // `absolute` even on the dedicated deviceorientationabsolute event — a
    // documented category of platform drift this module already works
    // around elsewhere (see the module's own top comment) — so a device
    // that fires that event but leaves the property false/undefined was
    // being starved of every single reading under the old, stricter check.
    const isAbsoluteEvent = event.absolute === true || _eventName === "deviceorientationabsolute";
    if (isAbsoluteEvent && typeof event.alpha === "number" && !isNaN(event.alpha)) {
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
      _smoothedX += (Math.cos(rad) - _smoothedX) * _activeSmoothFactor;
      _smoothedY += (Math.sin(rad) - _smoothedY) * _activeSmoothFactor;
    }

    const now = Date.now();
    if (now - _lastEmitAt < MIN_UPDATE_INTERVAL_MS) return;
    _lastEmitAt = now;

    const smoothedDeg = ((Math.atan2(_smoothedY, _smoothedX) * 180) / Math.PI + 360) % 360;
    // Manual calibration offset (2026-09-13) applied last, right before
    // emission — everything upstream (smoothing, the absolute/screen-
    // rotation correction) still operates on the sensor's own raw zero-
    // point; this only re-anchors the FINAL reported value to whatever
    // true heading calibrateTo() was last told it should read.
    const outputDeg = (smoothedDeg + _manualOffsetDeg + 360) % 360;
    if (_onHeadingChange) _onHeadingChange(outputDeg);
  }

  /** Returns the module's own current smoothed heading (pre-calibration-
   * offset), or null if no reading has arrived yet — the same value
   * _handleEvent's own atan2 line computes, exposed so calibrateTo() can
   * anchor a new offset against it without needing a caller to pass in
   * whatever the last emitted heading happened to be. */
  function _currentSmoothedDeg() {
    if (_smoothedX == null) return null;
    return ((Math.atan2(_smoothedY, _smoothedX) * 180) / Math.PI + 360) % 360;
  }

  /** Overrides the EMA smoothing constant for as long as this consumer is
   * using the module — see the module's own 2026-09-13 header note for
   * why this exists instead of just changing SMOOTH_FACTOR outright. */
  function setSmoothFactor(factor) {
    if (typeof factor === "number" && factor > 0 && factor <= 1) _activeSmoothFactor = factor;
  }

  function resetSmoothFactor() {
    _activeSmoothFactor = SMOOTH_FACTOR;
  }

  /**
   * "I am currently pointing at trueHeadingDeg (real compass bearing) —
   * use that as the new zero instead of whatever the sensor itself
   * currently reads." Returns false (no-op) if no reading has arrived yet
   * — there's nothing to anchor an offset against.
   */
  function calibrateTo(trueHeadingDeg) {
    const current = _currentSmoothedDeg();
    if (current == null) return false;
    _manualOffsetDeg = ((trueHeadingDeg - current) % 360 + 360) % 360;
    _calibrated = true;
    return true;
  }

  function clearCalibration() {
    _manualOffsetDeg = 0;
    _calibrated = false;
  }

  function hasCalibration() {
    return _calibrated;
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
    // A fresh stationary period (new location, new magnetic environment)
    // should never silently inherit a stale manual calibration or a
    // still-active borrowed smoothing profile from whoever used the
    // module last — both reset here, not just when their own consumer
    // explicitly clears them.
    _activeSmoothFactor = SMOOTH_FACTOR;
    _manualOffsetDeg = 0;
    _calibrated = false;
  }

  return {
    isSupported, needsPermission, requestPermission, start, stop,
    setSmoothFactor, resetSmoothFactor, calibrateTo, clearCalibration, hasCalibration,
  };
})();

if (typeof module !== "undefined") module.exports = CompassHeading;
