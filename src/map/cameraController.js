/**
 * Eos — Camera Controller Matrix.
 * Centralized Viewport Tracking & Camera Position Control.
 * Synchronized with NavigationCameraEvaluator for dynamic guidance states.
 */

const CameraController = (() => {
  "use strict";

  // ---- Private State Tracking ----
  let _map = null;
  let _lastEvaluated = null;
  let _routeActive = false;
  let _routeGeometry = null;

  // Active runtime preset dimensions (Fallback configurations)
  let _currentPreset = {
    id: "default",
    pitch: 60,
    zoom: 15.5,
    anchorY: 0.8,
  };

  // Viewport Presets Matrix (Maps UI scaling profiles)
  const PRESETS = {
    "desktop-1080p":  { id: "desktop-1080p",  pitch: 65, zoom: 15.8, anchorY: 0.76 },
    "iphone-14-pro": { id: "iphone-14-pro", pitch: 60, zoom: 15.2, anchorY: 0.82 },
    "ipad-mini":     { id: "ipad-mini",     pitch: 58, zoom: 15.5, anchorY: 0.80 },
    "default":       { id: "default",       pitch: 60, zoom: 15.5, anchorY: 0.80 },
  };

  /**
   * Bind the operational MapLibre instance context to the controller.
   */
  function init(mapInstance) {
    _map = mapInstance;
  }

  /**
   * Set the active viewport emulation configuration profile.
   */
  function setViewportPreset(presetId) {
    if (PRESETS[presetId]) {
      _currentPreset = { ...PRESETS[presetId] };
    } else {
      _currentPreset = { ...PRESETS["default"] };
    }
  }

  /**
   * Centralized Viewport Padding Pipeline Manager
   * The camera controller completely owns map structural insets,
   * preventing race conditions between layout panels and map center updates.
   */
  function setViewportPadding(top, bottom) {
    if (!_map) return;
    _map.setPadding({
      top: top,
      bottom: bottom,
      left: 0,
      right: 0
    });
  }

  /**
   * Process and synchronize active vehicle tracking telemetry frames.
   * Reconnected to NavigationCameraEvaluator for dynamic driving/routing state tracking.
   */
  function followNav(lat, lon, heading, speedMph) {
    if (!_map) return;

    // 1. Package current runtime state telemetry vectors for the evaluator brain
    const evaluatorInput = {
      speedMph: speedMph || 0,
      heading: heading || 0,
      routeActive: _routeActive,
      routeGeometry: _routeGeometry,
      presetId: _currentPreset.id
    };

    // 2. Compute live camera values using NavigationCameraEvaluator state machine
    let cameraState;
    if (typeof NavigationCameraEvaluator !== "undefined") {
      cameraState = NavigationCameraEvaluator.evaluate(evaluatorInput);
    } else {
      // Structural fallback safety baseline if evaluator hasn't fully loaded
      cameraState = {
        pitch: _currentPreset.pitch,
        zoom: _currentPreset.zoom,
        anchorY: _currentPreset.anchorY,
        lookaheadMeters: _routeActive ? 150 : 0
      };
    }

    // Extract calculated, speed-smoothed metrics from the evaluator brain
    const pitch = cameraState.pitch;
    const zoom  = cameraState.zoom;
    const anchorY = cameraState.anchorY;
    const lookaheadMeters = cameraState.lookaheadMeters || 0;

    // Save evaluation snapshot for downstream data layers (e.g. frozen indicator pipelines)
    _lastEvaluated = {
      pitch: pitch,
      zoom: zoom,
      anchorY: anchorY,
      heading: heading,
      timestamp: Date.now()
    };

    // 3. Process dynamic lookahead projection tracking along current vector
    let targetLat = lat;
    let targetLon = lon;

    if (lookaheadMeters > 0) {
      // Simple geodesic approximations for computing projection lookahead coordinate offsets
      const metersPerDegreeLat = 111111;
      const metersPerDegreeLon = 111111 * Math.cos((lat * Math.PI) / 180);
      const headingRad = (heading * Math.PI) / 180;

      targetLat += (lookaheadMeters * Math.cos(headingRad)) / metersPerDegreeLat;
      targetLon += (lookaheadMeters * Math.sin(headingRad)) / metersPerDegreeLon;
    }

    // 4. Map calculated position to screen coordinates and apply structural anchorY offsets
    const centerPoint = _map.project([targetLon, targetLat]);
    const containerHeight = _map.getContainer().offsetHeight;

    // Calculate vertical offset relative to the evaluated horizon focus axis
    const desiredY = containerHeight * anchorY;
    const offsetY = desiredY - (containerHeight / 2);

    const headingRad = (heading * Math.PI) / 180;
    const targetPoint = [
      centerPoint.x + offsetY * Math.sin(headingRad),
      centerPoint.y - offsetY * Math.cos(headingRad)
    ];

    const targetCoords = _map.unproject(targetPoint);

    // 5. Render smooth framing updates onto active map viewport canvas
    _map.jumpTo({
      center: targetCoords,
      zoom: zoom,
      bearing: heading,
      pitch: pitch,
    });
  }

  /**
   * Hard transition initialization into Driving Navigation View.
   */
  function transitionToNav(lat, lon, heading) {
    if (!_map) return;
    followNav(lat, lon, heading, 0);
  }

  /**
   * Hard transition initialization into Airspace Overview View (Strategic North-up).
   */
  function transitionToAir(lat, lon) {
    if (!_map) return;

    _lastEvaluated = null; // Purge localized active driving matrices

    _map.flyTo({
      center: [lon, lat],
      zoom: 10.5,
      bearing: 0,
      pitch: 0,
      duration: 1200,
      essential: true
    });
  }

  /**
   * Route state attachment hooks. Called dynamically when routes calculate.
   */
  function setRouteActive(geometry) {
    _routeActive = true;
    _routeGeometry = geometry;
  }

  /**
   * Route tracking removal hooks. Called when routes clear.
   */
  function clearRoute() {
    _routeActive = false;
    _routeGeometry = null;
  }

  /**
   * Fetch the last processed camera calculation state.
   */
  function getLastEvaluated() {
    return _lastEvaluated;
  }

  // ---- Public Module API ----
  return {
    init,
    setViewportPreset,
    setViewportPadding,
    followNav,
    transitionToNav,
    transitionToAir,
    setRouteActive,
    clearRoute,
    getLastEvaluated,
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;