/**
 * DevicePitch — reads the phone's real front-to-back tilt (the
 * DeviceOrientation event's `beta` value) and converts it into "what
 * elevation angle above/below the horizon is the phone currently pointing
 * at" — the one genuinely NEW sensor axis this project has ever needed, per
 * CLAUDE.md's own "360°/planetarium 'sky compass' view" scoping note.
 * `alpha` (compass heading/azimuth) is already handled by
 * compassHeading.js; this is its vertical-axis sibling, kept as a fully
 * separate module rather than folded into that one — CompassHeading's own
 * start/stop lifecycle is tightly coupled to the main NAV-heading fallback
 * (gated on CONFIG.GPS_HEADING_MIN_SPEED_MPH, see app.js's onGpsSuccess),
 * and Sky View has a different lifecycle entirely (only listens while its
 * own overlay is open, regardless of what CompassHeading is doing) — a
 * second, independent `window.addEventListener` on the same event type is
 * completely fine (multiple listeners can subscribe to one DOM event); this
 * is far lower-risk than reworking CompassHeading's own, already-verified
 * event handling to carry a second payload.
 *
 * The beta→elevation mapping (elevationDeg = beta - 90) is this project's
 * own best-effort derivation, honestly flagged as UNVERIFIED against real
 * hardware — the same category of caveat compassHeading.js's own top
 * comment already carries for its screen-rotation correction. Reasoning:
 * per the W3C DeviceOrientation spec, beta is rotation around the device's
 * own x-axis (side-to-side), 0 when the device lies flat screen-up. Holding
 * a phone vertically upright in front of your face — screen facing you,
 * top edge pointing at the sky, the natural "look through it like a
 * viewfinder" pose a sky-map app is actually used in — is the commonly
 * documented beta≈90° posture; in that pose the phone's back (the
 * direction "pointed at") faces roughly horizontally outward, i.e. the
 * horizon, which is why elevation is defined as beta-90 rather than beta
 * itself. Tilting the top further back (phone screen tilting up toward the
 * sky, beta→180°) points the back of the phone toward the zenith
 * (elevation→90°); tilting the phone flatter (beta→0°, lying screen-up)
 * points it straight down (elevation→-90°). Portrait-orientation only for
 * v1 — no `gamma`/screen-rotation correction attempted, unlike
 * compassHeading.js's own (also still field-unverified) landscape
 * correction; Sky View is a two-handed, look-through-the-phone interaction
 * with no obvious landscape use case the way a dash-mounted nav screen has.
 */
const DevicePitch = (() => {
  // Same reasoning as compassHeading.js's own SMOOTH_FACTOR — a hand
  // scanning the sky is inherently jittery, and this module (like
  // CompassHeading) has no competing "must track something fast"
  // responsiveness need, so it's safe to lean toward stability.
  const SMOOTH_FACTOR          = 0.15;
  const MIN_UPDATE_INTERVAL_MS = 150;

  let _smoothed = null;
  let _lastEmitAt = 0;
  let _listening  = false;
  let _onPitchChange = null;
  let _eventName = null;

  function isSupported() {
    return typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";
  }

  function _extractElevationDeg(event) {
    if (typeof event.beta !== "number" || isNaN(event.beta)) return null;
    let elevation = event.beta - 90;
    if (elevation > 90) elevation = 90;
    if (elevation < -90) elevation = -90;
    return elevation;
  }

  function _handleEvent(event) {
    const raw = _extractElevationDeg(event);
    if (raw == null) return;

    _smoothed = _smoothed == null ? raw : _smoothed + (raw - _smoothed) * SMOOTH_FACTOR;

    const now = Date.now();
    if (now - _lastEmitAt < MIN_UPDATE_INTERVAL_MS) return;
    _lastEmitAt = now;

    if (_onPitchChange) _onPitchChange(_smoothed);
  }

  /**
   * @param {function(number):void} onPitchChange  Called with a smoothed
   *   elevation angle (degrees, -90..90, positive = above horizon) whenever
   *   a usable reading arrives. Assumes DeviceOrientation permission (iOS)
   *   has already been granted — callers must request it (the same static
   *   gate CompassHeading.requestPermission() already uses) before calling
   *   start(), same as CompassHeading itself requires.
   */
  function start(onPitchChange) {
    if (_listening || !isSupported()) return;
    _onPitchChange = onPitchChange;
    _smoothed = null;
    _eventName = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(_eventName, _handleEvent);
    _listening = true;
  }

  function stop() {
    if (!_listening) return;
    window.removeEventListener(_eventName, _handleEvent);
    _listening = false;
    _onPitchChange = null;
  }

  return { isSupported, start, stop };
})();

if (typeof module !== "undefined") module.exports = DevicePitch;
