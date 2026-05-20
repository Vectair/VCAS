/**
 * CameraController (Production Certified Specification)
 *
 * Drives the MapLibre viewport. Manages an isolated tracking frame loop, 
 * smoothly interpolating positions and resolving layout obstruction bounds dynamically.
 */

const CameraController = (() => {
  let _map            = null;
  let _routeCoords    = null;
  let _mode           = "nav";
  let _viewportPreset = "full";

  // ---- Smooth Interpolation State Buffers ---- //
  let cLat = 0.0, cLng = 0.0, cBearing = 0.0;
  let cZoom = 15.0, cPitch = 0.0;
  let cAnchorX = 0.5, cAnchorY = 0.5;

  const K_CHASSIS_POSITION = 0.09;
  const K_CHASSIS_BEARING  = 0.06;
  const K_MANEUVER_BEARING = 0.12;
  const K_MATRIX_PERSPECT  = 0.04;

  let _animationFrameId = null;
  let _isFirstFrame = true;
  let _isTrackingActive = false;
  let _lastTelemetryCache = null;
  let _devOverrides = {};
  let _lastEvaluated = null;

  function init(map) {
    _map = map;
    _isFirstFrame = true;
    _isTrackingActive = false;
  }

  function setRouteActive(geometry) {
    _routeCoords = (geometry && geometry.coordinates) ? geometry.coordinates : null;
  }

  function clearRoute() { _routeCoords = null; }
  function setViewportPreset(presetId) { _viewportPreset = presetId || "full"; }
  function getNavCameraDefaults() { return { pitch: 55, zoom: 16.2, anchorY: 0.80, anchorX: 0.5 }; }

  function getNavCameraConfig() {
    const base = (_lastEvaluated)
      ? { pitch: _lastEvaluated.pitch, zoom: _lastEvaluated.zoom,
          anchorY: _lastEvaluated.anchorY, anchorX: _lastEvaluated.anchorX }
      : getNavCameraDefaults();
    return Object.assign({}, base, _devOverrides);
  }

  function setNavCameraConfig(partial) {
    Object.assign(_devOverrides, partial);
    if (!_isTrackingActive && _lastTelemetryCache) _executeSingleCameraFrameUpdate();
  }

  function resetNavCameraConfig() { _devOverrides = {}; }
  function getLastEvaluated() { return _lastEvaluated ? Object.assign({}, _lastEvaluated) : null; }
  function getNavCameraState() { return _lastEvaluated ? _lastEvaluated.state : "NAV_IDLE"; }
  function _containerH() { return _map ? _map.getContainer().clientHeight : 600; }
  function _containerW() { return _map ? _map.getContainer().clientWidth  : 390; }

  function _interpolateAngle(current, target, stepFactor) {
    let delta = target - current;
    while (delta < -180) delta += 360;
    while (delta > 180)  delta -= 360;
    return current + (delta * stepFactor);
  }

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

  /**
   * Evaluates dynamic layout chrome offsets directly from the active DOM wrappers.
   * Eliminates hardcoded heights to ensure layouts fit varied devices or split screens perfectly.
   */
  function _getDynamicBottomSafeAreaHeight() {
    let heightAccumulator = 0;
    
    const routeCard = document.getElementById("route-card");
    if (routeCard && !routeCard.classList.contains("hidden")) {
      heightAccumulator += routeCard.offsetHeight;
    }
    
    const bottomBar = document.getElementById("bottom-bar");
    if (bottomBar && !bottomBar.classList.contains("hidden")) {
      heightAccumulator += bottomBar.offsetHeight;
    }

    return heightAccumulator > 0 ? heightAccumulator : 60;
  }

  /**
   * The Single Master Animation Frame Entry Loop Node
   */
  function _renderTick() {
    if (!_map || _mode !== "nav" || !_isTrackingActive || !_lastTelemetryCache) return;
    _executeSingleCameraFrameUpdate();
    _animationFrameId = requestAnimationFrame(_renderTick);
  }

  function _executeSingleCameraFrameUpdate() {
    const { lat, lon, heading, speedMph } = _lastTelemetryCache;

    const ctx = {
      mode:           _mode,
      routeActive:    !!_routeCoords,
      routeGeometry:  _routeCoords ? { type: "LineString", coordinates: _routeCoords } : null,
      userLat:        lat,
      userLon:        lon,
      userHeading:    cBearing, 
      userSpeedMph:   speedMph,
      viewportPreset: _viewportPreset,
      viewportWidth:  _containerW(),
      viewportHeight: _containerH(),
    };

    // 1. Evaluate baseline profiles from state machine rules
    const desc = NavigationCameraEvaluator.evaluate(ctx);
    
    // 2. Safely merge developer slider overrides (pitch, zoom, anchorY)
    Object.assign(desc, _devOverrides);
    _lastEvaluated = Object.assign({}, desc);

    document.body.dataset.navState = desc.state.toLowerCase();

    let targetBearing = heading;
    let trackingSpeedK = K_CHASSIS_BEARING;

    let centerTarget = desc.routeTarget 
      ? [desc.routeTarget.lon, desc.routeTarget.lat]
      : null;

    if (desc.bearingMode === "DECOUPLED_MANEUVER" && desc.routeTarget) {
      targetBearing = Geo.calculateBearing(lat, lon, desc.routeTarget.lat, desc.routeTarget.lon);
      trackingSpeedK = K_MANEUVER_BEARING;
    }

    if (!centerTarget) {
      const projected = _projectAhead(lat, lon, cBearing, desc.lookAheadMeters);
      centerTarget = [projected.lon, projected.lat];
    }

    // 3. Low-pass filter interpolation math
    if (_isFirstFrame) {
      cLat = centerTarget[1]; cLng = centerTarget[0]; cBearing = targetBearing;
      cZoom = desc.zoom; cPitch = desc.pitch;
      cAnchorX = desc.anchorX; cAnchorY = desc.anchorY;
      _isFirstFrame = false;
    } else {
      cLat += (centerTarget[1] - cLat) * K_CHASSIS_POSITION;
      cLng += (centerTarget[0] - cLng) * K_CHASSIS_POSITION;
      cBearing = _interpolateAngle(cBearing, targetBearing, trackingSpeedK);
      cZoom += (desc.zoom - cZoom) * K_MATRIX_PERSPECT;
      cPitch += (desc.pitch - cPitch) * K_MATRIX_PERSPECT;
      cAnchorX += (desc.anchorX - cAnchorX) * K_MATRIX_PERSPECT;
      cAnchorY += (desc.anchorY - cAnchorY) * K_MATRIX_PERSPECT;
    }

    // 4. Transform focal points into camera margins
    const mapH = _containerH();
    const mapW = _containerW();
    const dynamicBottomHeight = _getDynamicBottomSafeAreaHeight();
    
    // Convert abstract decimal boundaries directly into explicit pixel fields
    const targetPuckPixelY = mapH * cAnchorY;
    const targetPuckPixelX = mapW * cAnchorX;
    
    // Balance focal tracking matrix across dynamic limits
    const computedBottomPadding = mapH - targetPuckPixelY;
    const computedLeftPadding = targetPuckPixelX - (mapW * 0.5);

    // 5. Execute native viewport adjustments
    _map.jumpTo({
      center:  [cLng, cLat],
      zoom:    cZoom,
      pitch:   cPitch,
      bearing: cBearing,
      padding: { 
        top: 0, 
        bottom: Math.max(Math.round(dynamicBottomHeight), Math.round(computedBottomPadding)), 
        left: computedLeftPadding > 0 ? Math.round(computedLeftPadding) : 0, 
        right: computedLeftPadding < 0 ? Math.round(Math.abs(computedLeftPadding)) : 0 
      }
    });
  }

  return {
    init, 
    setRouteActive, 
    clearRoute, 
    setViewportPreset,
    getNavCameraDefaults, 
    getNavCameraConfig, 
    setNavCameraConfig,
    resetNavCameraConfig, 
    getLastEvaluated, 
    getNavCameraState,

    followNav: (lat, lon, heading, speedMph) => {
      _mode = "nav";
      _lastTelemetryCache = { lat, lon, heading, speedMph };
      
      if (!_isTrackingActive) {
        _isTrackingActive = true;
        _isFirstFrame = true;
        _renderTick();
      }
    },

    pauseTrackingForInteraction: () => {
      _isTrackingActive = false;
      if (_animationFrameId) {
        cancelAnimationFrame(_animationFrameId);
        _animationFrameId = null;
      }
    },

    resumeTracking: () => {
      if (!_isTrackingActive && _mode === "nav" && _lastTelemetryCache) {
        _isTrackingActive = true;
        _renderTick();
      }
    },

    transitionToNav: (lat, lon, heading) => {
      _mode = "nav";
      _isFirstFrame = true;
      _isTrackingActive = true;
      _lastTelemetryCache = { lat, lon, heading, speedMph: 0 };
      if (_animationFrameId) cancelAnimationFrame(_animationFrameId);
      _renderTick();
    },

    transitionToAir: (lat, lon) => {
      _mode = "air";
      _isTrackingActive = false;
      if (_animationFrameId) {
        cancelAnimationFrame(_animationFrameId);
        _animationFrameId = null;
      }
      document.body.dataset.navState = "air";
      _map.easeTo({
        center:   [lon, lat],
        bearing:  0,
        pitch:    0,
        zoom:     10,
        padding:  { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 900
      });
    },

    refreshNavCamera: (lat, lon) => {
      if (_lastTelemetryCache) {
        _lastTelemetryCache.lat = lat;
        _lastTelemetryCache.lon = lon;
        if (!_isTrackingActive) _executeSingleCameraFrameUpdate();
      }
    }
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;