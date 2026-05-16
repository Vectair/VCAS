/**
 * Navigation camera controller.
 *
 * Owns all camera state: pitch, bearing, zoom, padding, and easing.
 * app.js and map.js call into this; nothing outside reads camera state directly.
 *
 * NAV mode: low forward-looking driving perspective (Google Maps reference).
 *   User arrow anchors near the bottom of the screen (~78 % from top).
 *   Most useful screen space is the road ahead, not the area behind.
 * AIR mode: top-down north-up strategic overview.
 */

const CameraController = (() => {
  let _map = null;
  let _currentBearing = 0; // smoothed bearing, degrees

  // ---- Camera presets ----

  const NAV = {
    pitch:           63,   // stronger forward lean than 60° — reduces "drone" feel
    zoom:            17,   // tighter zoom, road detail clearly visible
    transitionMs:    900,
    followMs:        400,  // snappier continuous follow
    // Top-padding as fraction of container height.
    // User renders at: 0.5 + topPaddingFraction/2 from top.
    // 0.55 → ~77.5 % from top — lower-centre driving anchor.
    topPaddingFraction: 0.55,
    smoothAlpha:     0.12, // slightly smoother bearing; lower = smoother/laggier
  };

  const AIR = {
    pitch:        0,
    zoom:         10,
    transitionMs: 900,
  };

  // ---- Init ----

  function init(map) {
    _map = map;
  }

  // ---- Internal helpers ----

  function _containerH() {
    return _map ? _map.getContainer().clientHeight : 600;
  }

  function _navPadding() {
    return {
      top:    Math.round(_containerH() * NAV.topPaddingFraction),
      bottom: 0,
      left:   0,
      right:  0,
    };
  }

  // Circular first-order low-pass — handles 0 / 360 wrap correctly.
  function _smoothBearing(target) {
    let delta = target - _currentBearing;
    if (delta >  180) delta -= 360;
    if (delta < -180) delta += 360;
    _currentBearing = (_currentBearing + NAV.smoothAlpha * delta + 360) % 360;
    return _currentBearing;
  }

  // Cubic ease-out — fast start, gentle arrival. Good for continuous following.
  function _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // Cubic ease-in-out — smooth mode transitions.
  function _easeInOut(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ---- Public API ----

  /**
   * Smooth camera follow called on each GPS position update in NAV mode.
   * Applies heading smoothing to suppress GPS bearing jitter.
   */
  function followNav(lat, lon, heading) {
    if (!_map) return;
    _map.easeTo({
      center:   [lon, lat],
      bearing:  _smoothBearing(heading),
      pitch:    NAV.pitch,
      zoom:     NAV.zoom,
      padding:  _navPadding(),
      duration: NAV.followMs,
      easing:   _easeOut,
    });
  }

  /**
   * Animated transition INTO NAV mode (e.g. from AIR).
   * Resets bearing smoothing to avoid a spin from the last smoothed value.
   */
  function transitionToNav(lat, lon, heading) {
    if (!_map) return;
    _currentBearing = heading; // reset — don't interpolate from stale smoothed value
    _map.easeTo({
      center:   [lon, lat],
      bearing:  heading,
      pitch:    NAV.pitch,
      zoom:     NAV.zoom,
      padding:  _navPadding(),
      duration: NAV.transitionMs,
      easing:   _easeInOut,
    });
  }

  /**
   * Animated transition INTO AIR mode (e.g. from NAV).
   * Resets to north-up, top-down, wider zoom.
   */
  function transitionToAir(lat, lon) {
    if (!_map) return;
    _map.easeTo({
      center:   [lon, lat],
      bearing:  0,
      pitch:    AIR.pitch,
      zoom:     AIR.zoom,
      padding:  { top: 0, bottom: 0, left: 0, right: 0 },
      duration: AIR.transitionMs,
      easing:   _easeInOut,
    });
  }

  return { init, followNav, transitionToNav, transitionToAir };
})();

if (typeof module !== "undefined") module.exports = CameraController;
