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

  const MIN_LOOKAHEAD_M  = 80;
  const MAX_LOOKAHEAD_M  = 1200;

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
      return { exists: false, distance: 0 };
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
          return { exists: true, distance: totalDistanceAccumulator };
        }
      }
      prevBearing = curBearing;
      totalDistanceAccumulator += _dist(from, to);
    }
    return { exists: false, distance: 0 };
  }

  // ---- Public Interface Module Engine ---- //
  return {
    STATE_PRESETS,
    
    evaluate: (ctx) => {
      const {
        mode, routeActive, routeGeometry,
        userLat, userLon, userSpeedMph,
        viewportPreset,
      } = ctx;

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

      // 4. Enforce State Dwell Lock timers
      if (targetState !== lastEvaluatedState) {
        if ((currentTimeMs - stateDwellTimestamp) > MIN_STATE_DWELL_MS) {
          lastEvaluatedState = targetState;
          stateDwellTimestamp = currentTimeMs;
        } else {
          targetState = lastEvaluatedState; // Clamp execution state to cache memory
        }
      }

      // 5. Compute Logarithmic Lookahead Target Vector Bounds
      let lookAheadMeters = MIN_LOOKAHEAD_M;
      if (targetState !== "AIR" && speedMs > 1.0) {
        const scalingExponent = (targetState === "HIGHWAY_GUIDANCE") ? 1.6 : 1.1;
        const computedMeters = speedMs * 4.0 * Math.log10(speedMs * scalingExponent);
        lookAheadMeters = Math.max(MIN_LOOKAHEAD_M, Math.min(MAX_LOOKAHEAD_M, computedMeters));
      }

      if (targetState === "TURN_APPROACH") {
        // Force lookahead vector mapping to focus directly on upcoming vertex nodes
        lookAheadMeters = Math.max(MIN_LOOKAHEAD_M, turnMetrics.distance);
      }

      // 6. Trace coordinates down active line path
      let routeTarget = null;
      if (routeActive && coords && coords.length >= 2) {
        const nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat);
        const ahead   = RouteGeometry.projectAlong(coords, nearest.segIdx, nearest.t, lookAheadMeters);
        if (ahead) routeTarget = { lat: ahead.lat, lon: ahead.lon };
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
        lookAheadMeters,
        routeTarget,
        suppressionLevel,
        transitionProfile,
        bearingMode: (targetState === "TURN_APPROACH") ? "DECOUPLED_MANEUVER" : "VEHICLE_TRACKING"
      };
    }
  };
})();

if (typeof module !== "undefined") module.exports = NavigationCameraEvaluator;
