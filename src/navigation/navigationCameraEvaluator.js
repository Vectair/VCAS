/**
 * NavigationCameraEvaluator
 *
 * Evaluates the current driving/navigation context and returns a camera
 * descriptor.  No map references — pure data in, data out.
 *
 * Depends on RouteGeometry (loaded before this module).
 *
 * Camera states:
 *   NAV_IDLE          — nav mode, no active route
 *   URBAN_GUIDANCE    — route active, speed ≤ 50 mph, no imminent turn
 *   HIGHWAY_GUIDANCE  — route active, speed > 50 mph
 *   TURN_APPROACH     — sharp route bend within scan window
 *   AIR               — top-down strategic view
 *
 * Placeholder states (not yet evaluated, reserved):
 *   TURN_EXECUTION | RECENTER | OFF_ROUTE
 */

const NavigationCameraEvaluator = (() => {

  // ---- State presets (baseline camera geometry per state) ---- //

  const STATE_PRESETS = {
    NAV_IDLE:         { pitch: 45, zoom: 17,   anchorY: 0.75, anchorX: 0.5 },
    URBAN_GUIDANCE:   { pitch: 55, zoom: 16.2, anchorY: 0.80, anchorX: 0.5 },
    HIGHWAY_GUIDANCE: { pitch: 60, zoom: 14.2, anchorY: 0.85, anchorX: 0.5 },
    TURN_APPROACH:    { pitch: 35, zoom: 16.8, anchorY: 0.70, anchorX: 0.5 },
    AIR:              { pitch: 0,  zoom: 10,   anchorY: 0.50, anchorX: 0.5 },
  };

  // ---- Lookahead seconds per state ---- //

  const LOOKAHEAD_SECONDS = {
    NAV_IDLE:         4,
    URBAN_GUIDANCE:   5,
    HIGHWAY_GUIDANCE: 11,
    TURN_APPROACH:    3,  // short — frame the bend
    AIR:              0,
  };

  const MIN_LOOKAHEAD_M  = 80;
  const MAX_LOOKAHEAD_M  = 1200;

  // Turn detection: scan this far ahead on the route polyline.
  const TURN_SCAN_M      = 300;
  // Bearing change between successive segments that triggers TURN_APPROACH.
  const TURN_THRESH_DEG  = 28;
  // Highway speed threshold
  const HIGHWAY_MPH      = 50;

  // ---- Viewport biases ---- //
  // Each preset can add a pitch/anchorY bias or clamp pitch via maxPitch.
  // anchorXOverride / anchorYOverride replace the state default entirely.

  const VIEWPORT_BIASES = {
    "full":    { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "phone-p": { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "phone-l": { pitchBias: -5, anchorYBias: -0.05, anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "auto":    { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: 0.37, anchorYOverride: 0.72, maxPitch: 43  },
  };

  // ---- Geometry helpers ---- //

  const _R = 6371000;
  function _toRad(d) { return d * Math.PI / 180; }

  function _dist(a, b) {
    const dLat = _toRad(b[1] - a[1]);
    const dLon = _toRad(b[0] - a[0]);
    const s = Math.sin(dLat / 2), o = Math.sin(dLon / 2);
    const h = s * s + Math.cos(_toRad(a[1])) * Math.cos(_toRad(b[1])) * o * o;
    return 2 * _R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function _segBearing(a, b) {
    const dLon = _toRad(b[0] - a[0]);
    const lat1 = _toRad(a[1]), lat2 = _toRad(b[1]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /**
   * Returns true if there is a sharp bend within scanMeters ahead on the route.
   * Starts from the vehicle's current nearest point, not from segment zero.
   */
  function _hasTurnAhead(coords, userLon, userLat, scanMeters) {
    if (!coords || coords.length < 2) return false;
    const nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat);
    const { segIdx, t } = nearest;

    // Starting position (interpolated within current segment)
    const a = coords[segIdx];
    const b = coords[Math.min(segIdx + 1, coords.length - 1)];
    const startPt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

    let remaining = scanMeters;
    let prevBearing = null;

    for (let i = segIdx; i < coords.length - 1 && remaining > 0; i++) {
      const from = (i === segIdx) ? startPt : coords[i];
      const to   = coords[i + 1];
      const curBearing = _segBearing(from, to);

      if (prevBearing !== null) {
        let diff = Math.abs(curBearing - prevBearing);
        if (diff > 180) diff = 360 - diff;
        if (diff >= TURN_THRESH_DEG) return true;
      }
      prevBearing = curBearing;
      remaining  -= _dist(from, to);
    }
    return false;
  }

  function _clampLookAhead(m) {
    return Math.max(MIN_LOOKAHEAD_M, Math.min(MAX_LOOKAHEAD_M, m));
  }

  // ---- Public: evaluate ---- //

  /**
   * Evaluate navigation context and return a camera descriptor.
   *
   * @param {{
   *   mode: string,
   *   routeActive: boolean,
   *   routeGeometry: object|null,
   *   userLat: number,
   *   userLon: number,
   *   userHeading: number,
   *   userSpeedMph: number,
   *   viewportPreset: string,
   *   viewportWidth: number,
   *   viewportHeight: number,
   * }} ctx
   *
   * @returns {{
   *   state: string,
   *   pitch: number,
   *   zoom: number,
   *   anchorY: number,
   *   anchorX: number,
   *   lookAheadSeconds: number,
   *   lookAheadMeters: number,
   *   routeTarget: {lat:number,lon:number}|null,
   *   bearingMode: string,
   *   suppressionLevel: number,
   *   transitionProfile: string,
   * }}
   */
  function evaluate(ctx) {
    const {
      mode, routeActive, routeGeometry,
      userLat, userLon, userSpeedMph,
      viewportPreset,
    } = ctx;

    const speedMph = userSpeedMph || 0;
    const speedMs  = speedMph * 0.44704;
    const coords   = routeGeometry && routeGeometry.coordinates;

    // ---- State determination ---- //
    let state;
    if (mode === "air") {
      state = "AIR";
    } else if (!routeActive) {
      state = "NAV_IDLE";
    } else {
      // Urban lookahead for turn scan window
      const scanWindow = _clampLookAhead(speedMs * LOOKAHEAD_SECONDS.URBAN_GUIDANCE);
      const isTurn = coords && coords.length >= 2 &&
        _hasTurnAhead(coords, userLon, userLat, Math.min(scanWindow, TURN_SCAN_M));

      if (isTurn) {
        state = "TURN_APPROACH";
      } else if (speedMph > HIGHWAY_MPH) {
        state = "HIGHWAY_GUIDANCE";
      } else {
        state = "URBAN_GUIDANCE";
      }
    }

    // ---- Lookahead ---- //
    const lookAheadSeconds = LOOKAHEAD_SECONDS[state] || 4;
    const rawLookAhead     = speedMs * lookAheadSeconds;
    const lookAheadMeters  = _clampLookAhead(rawLookAhead || MIN_LOOKAHEAD_M);

    // ---- Route target ---- //
    let routeTarget = null;
    if (routeActive && coords && coords.length >= 2) {
      const nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat);
      const ahead   = RouteGeometry.projectAlong(coords, nearest.segIdx, nearest.t, lookAheadMeters);
      if (ahead) routeTarget = { lat: ahead.lat, lon: ahead.lon };
    }

    // ---- Camera geometry from state preset ---- //
    const preset = STATE_PRESETS[state] || STATE_PRESETS.URBAN_GUIDANCE;
    let { pitch, zoom, anchorY, anchorX } = preset;

    // ---- Viewport biases ---- //
    const vp   = viewportPreset || "full";
    const bias = VIEWPORT_BIASES[vp] || VIEWPORT_BIASES["full"];

    pitch   = pitch + (bias.pitchBias || 0);
    anchorY = (bias.anchorYOverride !== null && bias.anchorYOverride !== undefined)
      ? bias.anchorYOverride
      : anchorY + (bias.anchorYBias || 0);
    if (bias.anchorXOverride !== null && bias.anchorXOverride !== undefined) {
      anchorX = bias.anchorXOverride;
    }
    if (bias.maxPitch !== null && bias.maxPitch !== undefined) {
      pitch = Math.min(pitch, bias.maxPitch);
    }
    pitch = Math.max(0, Math.min(85, pitch));

    // ---- Transition profile ---- //
    let transitionProfile;
    switch (state) {
      case "TURN_APPROACH":    transitionProfile = "TURN_APPROACH";    break;
      case "AIR":              transitionProfile = "SLOW_PITCH";        break;
      case "HIGHWAY_GUIDANCE": transitionProfile = "SNAPPY_ZOOM";       break;
      default:                 transitionProfile = "STANDARD_FOLLOW";   break;
    }

    // ---- Suppression level ---- //
    // 0 = no suppression; higher = more cartography suppression.
    const suppressionLevel =
      (state === "URBAN_GUIDANCE" || state === "TURN_APPROACH") ? 2 :
      (state === "HIGHWAY_GUIDANCE") ? 1 : 0;

    return {
      state,
      pitch,
      zoom,
      anchorY,
      anchorX,
      lookAheadSeconds,
      lookAheadMeters,
      routeTarget,
      bearingMode:      state === "AIR" ? "north" : "heading",
      suppressionLevel,
      transitionProfile,
    };
  }

  return { evaluate, STATE_PRESETS };
})();

if (typeof module !== "undefined") module.exports = NavigationCameraEvaluator;
