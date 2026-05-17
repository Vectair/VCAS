/**
 * Navigation camera controller.
 *
 * Consumes descriptors from NavigationCameraEvaluator and drives the MapLibre
 * camera.  Owns: bearing smoothing, state hysteresis, transition animation,
 * heading-based fallback projection, and dev-override layering.
 *
 * Camera states (set on document.body.dataset.navState):
 *   nav_idle | urban_guidance | highway_guidance | turn_approach | air
 */

const CameraController = (() => {
  let _map            = null;
  let _currentBearing = 0;        // smoothed bearing, degrees
  let _routeCoords    = null;     // [lon,lat][] from active route geometry
  let _mode           = "nav";    // "nav" | "air"
  let _viewportPreset = "full";   // matches ViewportDevPanel preset IDs

  // State hysteresis — minimum ms between camera-state changes.
  const STATE_DWELL_MS  = 4500;
  let _currentNavState  = "NAV_IDLE";
  let _lastStateChange  = 0;

  // Bearing smoothing: low-pass alpha.  Lower = smoother / laggier.
  const SMOOTH_ALPHA = 0.13;

  // Last evaluated descriptor — exposed for CAM panel.
  let _lastEvaluated = null;

  // Dev overrides: keyed by descriptor field name (pitch, zoom, anchorY, anchorX).
  let _devOverrides = {};

  // ---- Init ---- //

  function init(map) {
    _map = map;
  }

  // ---- Route / mode state ---- //

  function setRouteActive(geometry) {
    _routeCoords = (geometry && geometry.coordinates) ? geometry.coordinates : null;
  }

  function clearRoute() {
    _routeCoords = null;
  }

  function setViewportPreset(presetId) {
    _viewportPreset = presetId || "full";
  }

  // ---- Dev config API ---- //

  function getNavCameraDefaults() {
    return { pitch: 55, zoom: 16.2, anchorY: 0.80, anchorX: 0.5 };
  }

  function getNavCameraConfig() {
    const base = (_lastEvaluated)
      ? { pitch: _lastEvaluated.pitch, zoom: _lastEvaluated.zoom,
          anchorY: _lastEvaluated.anchorY, anchorX: _lastEvaluated.anchorX }
      : getNavCameraDefaults();
    return Object.assign({}, base, _devOverrides);
  }

  function setNavCameraConfig(partial) {
    Object.assign(_devOverrides, partial);
  }

  function resetNavCameraConfig() {
    _devOverrides = {};
  }

  function getLastEvaluated() {
    return _lastEvaluated ? Object.assign({}, _lastEvaluated) : null;
  }

  function getNavCameraState() {
    return _currentNavState;
  }

  // ---- Internal helpers ---- //

  function _containerH() { return _map ? _map.getContainer().clientHeight : 600; }
  function _containerW() { return _map ? _map.getContainer().clientWidth  : 390; }

  // Circular first-order low-pass — handles 0/360 wrap correctly.
  function _smoothBearing(target) {
    let delta = target - _currentBearing;
    if (delta >  180) delta -= 360;
    if (delta < -180) delta += 360;
    _currentBearing = (_currentBearing + SMOOTH_ALPHA * delta + 360) % 360;
    return _currentBearing;
  }

  // MapLibre padding derived from anchorY (fraction from top) and anchorX.
  // anchorY = 0.75 → user marker sits ~75 % from top.
  // Uses symmetric formula: topPad = H * (2*anchorY - 1), clamped to ≥0.
  // anchorX < 0.5 → right padding shifts camera left; anchorX > 0.5 → left padding.
  function _buildPadding(anchorY, anchorX) {
    const H = _containerH();
    const W = _containerW();
    const topPad = Math.round(Math.max(0, H * (2 * anchorY - 1)));
    let left = 0, right = 0;
    if (anchorX < 0.5 - 0.01) {
      right = Math.round(W * (1 - 2 * anchorX));
    } else if (anchorX > 0.5 + 0.01) {
      left  = Math.round(W * (2 * anchorX - 1));
    }
    return { top: topPad, bottom: 0, left, right };
  }

  // Heading-based point projection — fallback when no route.
  function _projectAhead(lat, lon, heading, meters) {
    if (!meters) return { lat, lon };
    const d  = meters / 6371000;
    const θ  = (heading * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: φ2 * 180 / Math.PI, lon: λ2 * 180 / Math.PI };
  }

  // Run evaluator, apply state hysteresis, apply dev overrides.
  function _evaluate(lat, lon, speedMph) {
    const ctx = {
      mode:           _mode,
      routeActive:    !!_routeCoords,
      routeGeometry:  _routeCoords ? { type: "LineString", coordinates: _routeCoords } : null,
      userLat:        lat,
      userLon:        lon,
      userHeading:    _currentBearing,
      userSpeedMph:   speedMph,
      viewportPreset: _viewportPreset,
      viewportWidth:  _containerW(),
      viewportHeight: _containerH(),
    };

    const desc = NavigationCameraEvaluator.evaluate(ctx);

    // Hysteresis: hold the current state for at least STATE_DWELL_MS.
    // Mode transitions (AIR ↔ NAV) bypass hysteresis.
    const now = Date.now();
    if (desc.state !== _currentNavState) {
      const isModeBoundary =
        (desc.state === "AIR" && _currentNavState !== "AIR") ||
        (desc.state !== "AIR" && _currentNavState === "AIR");

      if (isModeBoundary || (now - _lastStateChange) >= STATE_DWELL_MS) {
        _currentNavState = desc.state;
        _lastStateChange = now;
        _applyNavStateToBody(desc.state);
      } else {
        // Hold old state: restore visual values from that state's preset.
        const held = NavigationCameraEvaluator.STATE_PRESETS[_currentNavState];
        if (held) {
          desc.state         = _currentNavState;
          desc.pitch         = held.pitch;
          desc.zoom          = held.zoom;
          desc.anchorY       = held.anchorY;
          desc.anchorX       = held.anchorX;
        }
      }
    }

    // Layer dev overrides on top (pitch, zoom, anchorY, anchorX).
    Object.assign(desc, _devOverrides);
    _lastEvaluated = Object.assign({}, desc);
    return desc;
  }

  function _applyNavStateToBody(state) {
    // e.g. "URBAN_GUIDANCE" → data-nav-state="urban_guidance"
    document.body.dataset.navState = state.toLowerCase();
  }

  // Easing functions
  function _easeOut(t)   { return 1 - Math.pow(1 - t, 3); }
  function _easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---- Public camera API ---- //

  /**
   * Smooth continuous follow called on each GPS position update in NAV mode.
   */
  function followNav(lat, lon, heading, speedMph) {
    if (!_map) return;
    _mode = "nav";
    const bear = _smoothBearing(heading);
    const desc = _evaluate(lat, lon, speedMph);

    const target = desc.routeTarget
      ? desc.routeTarget
      : _projectAhead(lat, lon, bear, desc.lookAheadMeters);

    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  bear,
      pitch:    desc.pitch,
      zoom:     desc.zoom,
      padding:  _buildPadding(desc.anchorY, desc.anchorX),
      duration: 300,
      easing:   _easeOut,
    });
  }

  /**
   * Animated transition INTO NAV mode (e.g. from AIR).
   */
  function transitionToNav(lat, lon, heading) {
    if (!_map) return;
    _mode = "nav";
    _currentBearing = heading;
    const desc = _evaluate(lat, lon, 0);

    const target = desc.routeTarget
      ? desc.routeTarget
      : _projectAhead(lat, lon, heading, desc.lookAheadMeters);

    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  heading,
      pitch:    desc.pitch,
      zoom:     desc.zoom,
      padding:  _buildPadding(desc.anchorY, desc.anchorX),
      duration: 900,
      easing:   _easeInOut,
    });
  }

  /**
   * Animated transition INTO AIR mode.
   */
  function transitionToAir(lat, lon) {
    if (!_map) return;
    _mode           = "air";
    _currentNavState = "AIR";
    _lastStateChange = Date.now();
    _applyNavStateToBody("AIR");

    _map.easeTo({
      center:   [lon, lat],
      bearing:  0,
      pitch:    0,
      zoom:     10,
      padding:  { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 900,
      easing:   _easeInOut,
    });
  }

  /**
   * Immediately re-apply camera at current position (used by dev panel sliders).
   */
  function refreshNavCamera(lat, lon, heading, duration) {
    if (!_map) return;
    const bear = _currentBearing;
    const desc = _evaluate(lat, lon, 0);

    const target = desc.routeTarget
      ? desc.routeTarget
      : _projectAhead(lat, lon, heading || bear, desc.lookAheadMeters);

    _map.easeTo({
      center:   [target.lon, target.lat],
      bearing:  bear,
      pitch:    desc.pitch,
      zoom:     desc.zoom,
      padding:  _buildPadding(desc.anchorY, desc.anchorX),
      duration: duration !== undefined ? duration : 0,
    });
  }

  return {
    init,
    followNav,
    transitionToNav,
    transitionToAir,
    setRouteActive,
    clearRoute,
    setViewportPreset,
    getNavCameraState,
    getNavCameraDefaults,
    getNavCameraConfig,
    setNavCameraConfig,
    resetNavCameraConfig,
    refreshNavCamera,
    getLastEvaluated,
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;
