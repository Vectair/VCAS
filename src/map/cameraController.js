/**
 * Eos — Camera Controller Matrix.
 * Centralized Viewport Tracking & Camera Position Control.
 */

const CameraController = (() => {
  "use strict";

  // ---- Private State Tracking ----
  let _map = null;
  let _lastEvaluated = null;
  let _routeActive = false;
  let _routeGeometry = null;

  // Active runtime preset dimensions
  let _currentPreset = {
    id: "default",
    pitch: 60,
    zoom: 15.5,
    anchorY: 0.8, // Default driving mode horizon focus target balance
  };

  // Viewport Presets Matrix (Maps UI scaling directly to camera horizons)
  const PRESETS = {
    "desktop-1080p":  { pitch: 65, zoom: 15.8, anchorY: 0.76 },
    "iphone-14-pro": { pitch: 60, zoom: 15.2, anchorY: 0.82 },
    "ipad-mini":     { pitch: 58, zoom: 15.5, anchorY: 0.80 },
    "default":       { pitch: 60, zoom: 15.5, anchorY: 0.80 },
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
      _currentPreset = { id: presetId, ...PRESETS[presetId] };
    } else {
      _currentPreset = { id: "default", ...PRESETS["default"] };
    }
  }

  /**
   * Centralized Viewport Padding Pipeline Manager
   * Architectural Fix: The camera controller completely owns map structural insets,
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
   */
  function followNav(lat, lon, heading, speedMph) {
    if (!_map) return;

    const pitch = _currentPreset.pitch;
    const zoom  = _currentPreset.zoom;
    const anchorY = _currentPreset.anchorY;

    // Save evaluated framing metrics for downstream geodesic reflection math
    _lastEvaluated = {
      pitch: pitch,
      zoom: zoom,
      anchorY: anchorY,
      heading: heading,
      timestamp: Date.now()
    };

    // Transform geographic coordinates to map display pixels
    const centerPoint = _map.project([lon, lat]);
    const containerHeight = _map.getContainer().offsetHeight;

    // Calculate vertical offset relative to the current layout's anchor focus axis
    const desiredY = containerHeight * anchorY;
    const offsetY = desiredY - (containerHeight / 2);

    // Apply the tracking adjustment relative to your current camera heading matrix
    const headingRad = (heading * Math.PI) / 180;
    const targetPoint = [
      centerPoint.x + offsetY * Math.sin(headingRad),
      centerPoint.y - offsetY * Math.cos(headingRad)
    ];

    const targetCoords = _map.unproject(targetPoint);

    // Render smooth framing transformations onto the active canvas
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
   * Hard transition initialization into Airspace Overview View.
   */
  function transitionToAir(lat, lon) {
    if (!_map) return;

    _lastEvaluated = null; // Purge localized driving matrices

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
   * Route state attachment hooks.
   */
  function setRouteActive(geometry) {
    _routeActive = true;
    _routeGeometry = geometry;
  }

  /**
   * Route tracking removal hooks.
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

  // ---- Public Interface Interface Bridge ----
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