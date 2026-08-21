/**
 * NavigationCameraEvaluator
 *
 * Pure data module that evaluates driving context and returns baseline camera targets.
 * Completely free of DOM/map dependencies to support native cross-platform logic portability.
 */
const NavigationCameraEvaluator = (() => {

  // ---- State presets (baseline camera geometry per state) ---- //
  const STATE_PRESETS = {
    NAV_IDLE:         { pitch: 45, zoom: 17.0, anchorY: 0.75, anchorX: 0.5 },
    URBAN_GUIDANCE:   { pitch: 55, zoom: 16.2, anchorY: 0.80, anchorX: 0.5 },
    HIGHWAY_GUIDANCE: { pitch: 60, zoom: 14.2, anchorY: 0.85, anchorX: 0.5 },
    TURN_APPROACH:    { pitch: 35, zoom: 16.8, anchorY: 0.70, anchorX: 0.5 },
    AIR:              { pitch: 0,  zoom: 10.0, anchorY: 0.50, anchorX: 0.5 },
    // Selectable NAV display style (NavDisplayStyle.RAW) — flat plan-
    // position view, heading-up (bearing still tracks the user, unlike
    // AIR's north-up), anchored low like the tilted views so ownship sits
    // near the bottom with room ahead. zoom 11.2 is sized so the relevance
    // teardrop's own ~15nm dead-ahead range comfortably fits the screen
    // (Web Mercator ground resolution ≈156543*cos(lat)/2^zoom m/px; at
    // ~51°N that puts roughly 15nm across a typical viewport height) —
    // approximate by nature, not tied to a precise on-screen distance.
    NAV_RAW:          { pitch: 0,  zoom: 11.2, anchorY: 0.80, anchorX: 0.5 },
  };

  // ---- PERSISTENT CACHE CORE (Maintains memory state across frames) ---- //
  let lastEvaluatedState = "NAV_IDLE";
  let stateDwellTimestamp = 0;
  let smoothedSpeedMph = 0;

  // ---- Operational Tuning Constants ---- //
  const HIGHWAY_SPEED_ENTER = 53.0; // Hysteresis upper gate limit
  const HIGHWAY_SPEED_EXIT  = 46.0; // Hysteresis lower gate limit
  const MIN_STATE_DWELL_MS  = 3500; // Blocks rapid back-to-back state oscillations
  const SPEED_SMOOTH_FACTOR = 0.08; // Low-pass filter smoothing weight

  // Time Horizon parameters for turn approaches
  const T_IMPACT_APPROACH_S = 18.0; // Start turn transition 18 seconds before arrival
  const TURN_THRESH_DEG     = 25;   // Angular trajectory deviation threshold

  // Viewport structural bias presets
  const VIEWPORT_BIASES = {
    "full":    { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "phone-p": { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "phone-l": { pitchBias: -5, anchorYBias: -0.05, anchorXOverride: null, anchorYOverride: null, maxPitch: null },
    "auto":    { pitchBias: 0,  anchorYBias: 0,     anchorXOverride: 0.35, anchorYOverride: 0.75, maxPitch: 40  },
  };

  // ---- Mathematical Geo Utilities ---- //
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
   * Evaluates Time-To-Impact trajectory profiles against upcoming path arrays.
   */
  function _calculateTimeIndependentManeuver(coords, userLon, userLat, currentSpeedMs) {
    if (!coords || coords.length < 2 || currentSpeedMs < 2.0) {
      return { exists: false, distance: 0, bearingDeltaDeg: 0 };
    }

    const nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat);
    const { segIdx, t } = nearest;

    const a = coords[segIdx];
    const b = coords[Math.min(segIdx + 1, coords.length - 1)];

    // Core Array Fix: Correctly project absolute coordinate positions inside segment limits
    const startPt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];

    const dynamicScanLimitMeters = Math.max(300, currentSpeedMs * T_IMPACT_APPROACH_S);

    let totalDistanceAccumulator = 0;
    let prevBearing = null;

    for (let i = segIdx; i < coords.length - 1 && totalDistanceAccumulator < dynamicScanLimitMeters; i++) {
      const from = (i === segIdx) ? startPt : coords[i];
      const to   = coords[i + 1];
      const curBearing = _segBearing(from, to);

      if (prevBearing !== null) {
        let deltaAngle = Math.abs(curBearing - prevBearing);
        if (deltaAngle > 180) deltaAngle = 360 - deltaAngle;

        if (deltaAngle >= TURN_THRESH_DEG) {
          // Signed turn angle: positive = clockwise = right, negative = left.
          const signedDelta = ((curBearing - prevBearing + 180) % 360 + 360) % 360 - 180;
          return { exists: true, distance: totalDistanceAccumulator, bearingDeltaDeg: signedDelta };
        }
      }
      prevBearing = curBearing;
      totalDistanceAccumulator += _dist(from, to);
    }
    return { exists: false, distance: 0, bearingDeltaDeg: 0 };
  }

  // ---- Public Interface Module Engine ---- //
  return {
    STATE_PRESETS,
    
    evaluate: (ctx) => {
      const {
        mode, routeActive, routeGeometry,
        userLat, userLon, userSpeedMph,
        viewportPreset, navDisplayStyle,
      } = ctx;
      // ctx also optionally carries viewportWidth/viewportHeight/
      // squareContentTop/squareContentHeight — real DOM-measured numbers
      // (not destructured above since only NAV_RAW's square-anchor branch,
      // step 9b below, reads them) used to align this state's anchor with
      // RAW's own screen-space square plot. See that branch for why.

      const currentTimeMs = Date.now();
      const rawSpeedMph   = userSpeedMph || 0;

      // 1. Filter layout input speed transitions via low-pass constants
      smoothedSpeedMph += (rawSpeedMph - smoothedSpeedMph) * SPEED_SMOOTH_FACTOR;
      const speedMs = smoothedSpeedMph * 0.44704;
      const coords  = routeGeometry && routeGeometry.coordinates;

      // 2. Compute Impending Maneuver Horizon State metrics
      const turnMetrics = _calculateTimeIndependentManeuver(coords, userLon, userLat, speedMs);
      
      // 3. Determine target runtime configurations
      let targetState = "URBAN_GUIDANCE";

      if (mode === "air") {
        targetState = "AIR";
      } else if (navDisplayStyle === "raw") {
        // A deliberate, explicit user preference — not a speed-driven
        // automatic state — so it bypasses the urban/highway/turn state
        // machine entirely, including the maneuver-driven TURN_APPROACH
        // framing. Guidance data (maneuver, below) still computes normally;
        // only the camera framing itself goes flat/rudimentary.
        targetState = "NAV_RAW";
      } else if (!routeActive) {
        targetState = "NAV_IDLE";
      } else if (turnMetrics.exists) {
        targetState = "TURN_APPROACH";
      } else {
        // Enforce dual-boundary speed gates to block rapid frame fluctuations
        if (lastEvaluatedState === "HIGHWAY_GUIDANCE") {
          targetState = (smoothedSpeedMph > HIGHWAY_SPEED_EXIT) ? "HIGHWAY_GUIDANCE" : "URBAN_GUIDANCE";
        } else {
          targetState = (smoothedSpeedMph > HIGHWAY_SPEED_ENTER) ? "HIGHWAY_GUIDANCE" : "URBAN_GUIDANCE";
        }
      }

      // 4. Enforce State Dwell Lock timers — except into/out of NAV_RAW,
      // which (like AIR) is a direct user choice that should apply on the
      // very next frame, not smoothed behind the same hysteresis meant for
      // noisy automatic speed-based transitions.
      if (targetState !== lastEvaluatedState) {
        if (targetState === "NAV_RAW" || lastEvaluatedState === "NAV_RAW"
            || (currentTimeMs - stateDwellTimestamp) > MIN_STATE_DWELL_MS) {
          lastEvaluatedState = targetState;
          stateDwellTimestamp = currentTimeMs;
        } else {
          targetState = lastEvaluatedState; // Clamp execution state to cache memory
        }
      }

      // 7. Base Camera Param Extraction
      const basePreset = STATE_PRESETS[targetState] || STATE_PRESETS.URBAN_GUIDANCE;
      let { pitch, zoom, anchorY, anchorX } = basePreset;

      // 8. Apply Velocity-Proportional Scale Delta Scaling
      if (targetState === "URBAN_GUIDANCE" || targetState === "HIGHWAY_GUIDANCE") {
        const dynamicSpeedZoomDelta = (smoothedSpeedMph / 85.0) * 1.8;
        zoom = zoom - dynamicSpeedZoomDelta;
      }

      // 9. Viewport Aspect Custom Adjustments
      const vp   = viewportPreset || "full";
      const bias = VIEWPORT_BIASES[vp] || VIEWPORT_BIASES["full"];

      pitch   = pitch + (bias.pitchBias || 0);
      anchorY = (bias.anchorYOverride !== null && bias.anchorYOverride !== undefined)
        ? bias.anchorYOverride
        : anchorY + (bias.anchorYBias || 0);
      anchorX = (bias.anchorXOverride !== null && bias.anchorXOverride !== undefined)
        ? bias.anchorXOverride
        : anchorX;

      // 9b. NAV_RAW's anchor is a special case, computed AFTER (superseding)
      // the viewport-bias blending above rather than through it. RAW's own
      // screen-space plot (dots/rings/list — see Geo.computeSquarePlotLayout,
      // app.js's refreshIndicators) lives inside a 1:1 square sized to fit
      // the available content area, not the raw full viewport — portrait
      // pins it to the top (full width), landscape pins it to the left
      // (full height). The REAL map camera's anchor (which positions the
      // real user-marker MapLibre layer, map.js's _userMarker) has to land
      // at that SAME point or the marker visibly drifts from the screen-
      // space dots/rings around it — exactly the anchor-mismatch bug class
      // this project has hit more than once (see CLAUDE.md's "Camera
      // anchor math"). ctx.squareContentTop/squareContentHeight are plain
      // numbers the caller (CameraController.followNav) measures from the
      // DOM once per call — passed in rather than measured here so this
      // function stays free of DOM access itself.
      //
      // basePreset.anchorY (0.80) is reused here as the fraction WITHIN the
      // square (not of the full viewport, its usual meaning for every other
      // state) — same "ownship sits low, room ahead" convention, just
      // scoped to the square's own bounds instead of the screen's. The
      // viewport-bias phone-p/phone-l/auto overrides above are deliberately
      // NOT applied to NAV_RAW: they're coarse per-device-class nudges for
      // states whose anchor is otherwise a flat constant, superseded here by
      // a per-frame calculation that already adapts exactly to the real
      // portrait/landscape aspect, not just a device-class guess at it.
      if (targetState === "NAV_RAW" && ctx.viewportWidth && ctx.viewportHeight && ctx.squareContentHeight != null) {
        const square = Geo.computeSquarePlotLayout(ctx.viewportWidth, ctx.squareContentTop || 0, ctx.squareContentHeight);
        const withinSquareAnchorY = STATE_PRESETS.NAV_RAW.anchorY;
        const anchorXPx = square.squareLeft + square.squareSize * 0.5;
        const anchorYPx = square.squareTop + square.squareSize * withinSquareAnchorY;
        anchorX = anchorXPx / ctx.viewportWidth;
        anchorY = anchorYPx / ctx.viewportHeight;
      }

      if (bias.maxPitch !== null && bias.maxPitch !== undefined) {
        pitch = Math.min(pitch, bias.maxPitch);
      }
      pitch = Math.max(0, Math.min(85, pitch));

      // 10. Assign contextual transition easing parameters
      let transitionProfile = "STANDARD_FOLLOW";
      if (targetState === "TURN_APPROACH") transitionProfile = "TURN_APPROACH_CHOREOGRAPHY";
      if (targetState === "HIGHWAY_GUIDANCE") transitionProfile = "HIGHWAY_SMOOTH_PERSPECTIVE";

      // 11. Determine Contextual Cartography Suppression Engine Level
      let suppressionLevel = 1; 
      if (targetState === "HIGHWAY_GUIDANCE") suppressionLevel = 3; 
      if (targetState === "TURN_APPROACH")    suppressionLevel = 2; 

      return {
        state: targetState,
        pitch,
        zoom,
        anchorY,
        anchorX,
        suppressionLevel,
        transitionProfile,
        bearingMode: (targetState === "TURN_APPROACH") ? "DECOUPLED_MANEUVER" : "VEHICLE_TRACKING",
        // Real-time, independent of the state-dwell lock above — guidance
        // text should reflect the actual route ahead immediately, even
        // while the camera itself is still smoothing into TURN_APPROACH.
        maneuver: {
          exists: turnMetrics.exists,
          distanceMeters: turnMetrics.distance,
          bearingDeltaDeg: turnMetrics.bearingDeltaDeg,
        },
      };
    }
  };
})();

if (typeof module !== "undefined") module.exports = NavigationCameraEvaluator;
