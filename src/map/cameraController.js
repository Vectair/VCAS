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

  // Viewport Presets Matrix — ids match ViewportDevPanel's preset ids
  // (full/phone-p/phone-l/auto) so setViewportPreset() actually resolves
  // and the same id reaches NavigationCameraEvaluator.VIEWPORT_BIASES.
  const PRESETS = {
    "full":    { id: "full",    pitch: 65, zoom: 15.8, anchorY: 0.76 },
    "phone-p": { id: "phone-p", pitch: 60, zoom: 15.2, anchorY: 0.82 },
    "phone-l": { id: "phone-l", pitch: 58, zoom: 15.5, anchorY: 0.80 },
    "auto":    { id: "auto",    pitch: 60, zoom: 15.5, anchorY: 0.80 },
    "default": { id: "default", pitch: 60, zoom: 15.5, anchorY: 0.80 },
  };

  /**
   * Bind the operational MapLibre instance context to the controller.
   */
  function init(mapInstance) {
    _map = mapInstance;
  }

  // ---- Per-frame anchor-preserving camera animation ----
  //
  // followNav() used to hand center/bearing/pitch/zoom straight to
  // MapLibre's own easeTo(), which tweens each of those independently.
  // That's fine for a camera that's just "moving," but our center isn't
  // the real target — it's a screen-space anchor offset from the user's
  // actual position. Deriving that offset once per call (via project()/
  // unproject() against whatever the camera happened to show at that
  // instant) and then handing MapLibre a single center+bearing to tween
  // toward independently meant the two drifted apart mid-transition —
  // bearing partway rotated, center partway panned, neither matching the
  // assumption the offset was computed under — so the user's marker
  // visibly floated near its anchor point instead of staying pinned to
  // it. Driving the animation ourselves, frame by frame, and re-deriving
  // the anchor-correct camera at each frame from that frame's own
  // already-applied bearing/pitch/zoom (via jumpTo() to center exactly on
  // the target, then panBy() to shift off-center by a plain screen-space
  // pixel amount) keeps "user marker sits exactly at the anchor point"
  // true at every rendered frame, not just at the start/end of a tween —
  // panBy() always operates against whatever transform was just applied,
  // so there's no possibility of a stale-bearing mismatch.
  const ANIM_DURATION_MS = 400;

  let _animFrameHandle = null;
  let _animFrom = null; // { lat, lon, bearing, pitch, zoom, anchorY, startTime }
  let _animTo   = null; // { lat, lon, bearing, pitch, zoom, anchorY }

  function _lerp(a, b, t) { return a + (b - a) * t; }

  // Shortest-path bearing interpolation — a naive lerp breaks at the 0/360 wrap.
  function _lerpBearing(fromDeg, toDeg, t) {
    const delta = ((toDeg - fromDeg + 540) % 360) - 180;
    return fromDeg + delta * t;
  }

  function _currentAnimState(now) {
    if (!_animFrom || !_animTo) return null;
    const t = Math.min(1, (now - _animFrom.startTime) / ANIM_DURATION_MS);
    return {
      lat:     _lerp(_animFrom.lat, _animTo.lat, t),
      lon:     _lerp(_animFrom.lon, _animTo.lon, t),
      bearing: _lerpBearing(_animFrom.bearing, _animTo.bearing, t),
      pitch:   _lerp(_animFrom.pitch, _animTo.pitch, t),
      zoom:    _lerp(_animFrom.zoom, _animTo.zoom, t),
      anchorY: _lerp(_animFrom.anchorY, _animTo.anchorY, t),
      done: t >= 1,
    };
  }

  function _renderAnchoredFrame(state) {
    if (!_map) return;

    // 1. Center exactly on the target coordinate under THIS frame's own
    //    bearing/pitch/zoom — by construction it's dead-center right now.
    _map.jumpTo({
      center: [state.lon, state.lat],
      bearing: state.bearing,
      pitch: state.pitch,
      zoom: state.zoom,
    });

    // 2. Shift it off-center by a plain screen-space pixel pan — computed
    //    against the transform just applied above, so it's always correct
    //    regardless of how bearing/pitch changed to get here.
    //
    //    MapLibre's panBy(offset) negates the offset internally before
    //    applying it (confirmed against the library's own source — it's
    //    implemented as panTo(center, {offset: offset.mult(-1)})), so a
    //    *positive* Y here actually moves the rendered content *up*, not
    //    down. We want anchorY > 0.5 (target pushed toward the bottom of
    //    the screen) to mean the content moves DOWN — hence the negation
    //    below undoes MapLibre's own negation. Without it, anchorY 0.8
    //    was rendering the user's own position in the upper third of the
    //    screen instead of near the bottom.
    //
    //    jumpTo({center}) does NOT put the target at the container's raw
    //    geometric middle when the map has non-zero setPadding() (set by
    //    setViewportPadding() below to clear the top/bottom UI chrome) — it
    //    places it at the *padded*-center instead (verified against a real
    //    MapLibre instance: with a 200px bottom pad on an 800px container,
    //    jumpTo alone put the target at y=300, not y=400). Panning by the
    //    unpadded offset on top of that lands anchorY 0.8 at 67.5% of the
    //    screen instead of 80% — exactly the gap between the range rings
    //    (ui.js, which assumes a plain anchorY*containerHeight) and the
    //    marker's real position that showed up as a Hybrid/RAW mismatch
    //    (RAW carries much less bottom padding than Hybrid's guidance
    //    card + bottom bar, so its error was smaller and easy to miss).
    //    Deriving the pan from the padded-center jumpTo actually produced,
    //    rather than assuming it's the raw center, keeps anchorY*containerHeight
    //    true regardless of how much padding is currently set.
    const containerHeight = _map.getContainer().offsetHeight;
    const pad = _map.getPadding();
    const paddedCenterY = (containerHeight + pad.top - pad.bottom) / 2;
    const offsetY = containerHeight * state.anchorY - paddedCenterY;
    if (offsetY !== 0) {
      _map.panBy([0, -offsetY], { animate: false });
    }
  }

  /**
   * Halt any in-flight anchor-preserving animation immediately.
   *
   * MapLibre's own camera methods (easeTo/flyTo) are auto-cancelled the
   * moment the user starts a manual drag/zoom/rotate/pitch gesture — the
   * library recognizes its own animations and steps aside. Our per-frame
   * jumpTo()+panBy() loop is invisible to MapLibre in exactly that way: it's
   * not "an animation" as far as the library is concerned, just a sequence
   * of instant transform-sets, so it never yields to a gesture on its own.
   * Left unchecked, a followNav() animation still mid-flight when a drag
   * starts keeps calling jumpTo() every rendered frame for the remainder of
   * its ~400ms, silently overwriting the drag delta before it ever paints —
   * net effect: the gesture does nothing. Call this the instant a real user
   * gesture begins (see map.js's dragstart/zoomstart/rotatestart/pitchstart
   * wiring) so the loop stops before it can fight the next input frame.
   */
  function cancelFollow() {
    if (_animFrameHandle != null) {
      cancelAnimationFrame(_animFrameHandle);
      _animFrameHandle = null;
    }
    _animFrom = null;
    _animTo = null;
  }

  function _stepAnimation(now) {
    const state = _currentAnimState(now);
    if (!state) { _animFrameHandle = null; return; }
    _renderAnchoredFrame(state);
    _animFrameHandle = state.done ? null : requestAnimationFrame(_stepAnimation);
  }

  /**
   * Kick off (or smoothly redirect) the anchor-preserving camera animation
   * toward a new target. If a segment is already in flight, resumes from
   * wherever it currently is — not its original start, not its final
   * target — so a new GPS/compass tick arriving mid-glide redirects
   * smoothly instead of snapping back or restarting the clock.
   */
  function _startAnimTo(target) {
    if (!_map) return;
    const now = performance.now();
    const inProgress = _currentAnimState(now);

    let fromState;
    if (inProgress) {
      fromState = inProgress;
    } else {
      // Bootstrap from the map's actual live transform — anchorY 0.5
      // (true center) since a not-yet-anchored map has no prior offset to
      // inherit from.
      const c = _map.getCenter();
      fromState = {
        lat: c.lat, lon: c.lng,
        bearing: _map.getBearing(),
        pitch: _map.getPitch(),
        zoom: _map.getZoom(),
        anchorY: 0.5,
      };
    }

    _animFrom = { ...fromState, startTime: now };
    _animTo = target;

    if (_animFrameHandle == null) {
      _animFrameHandle = requestAnimationFrame(_stepAnimation);
    }
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
      mode: "nav",
      userLat: lat,
      userLon: lon,
      userSpeedMph: speedMph || 0,
      heading: heading || 0,
      routeActive: _routeActive,
      routeGeometry: _routeGeometry,
      viewportPreset: _currentPreset.id,
      navDisplayStyle: (typeof NavDisplayStyle !== "undefined") ? NavDisplayStyle.get() : "hybrid",
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
        maneuver: { exists: false, distanceMeters: 0, bearingDeltaDeg: 0 },
      };
    }

    // Extract calculated, speed-smoothed metrics from the evaluator brain
    const pitch = cameraState.pitch;
    const zoom  = cameraState.zoom;
    const anchorY = cameraState.anchorY;

    // Save evaluation snapshot for downstream data layers (e.g. frozen indicator pipelines)
    _lastEvaluated = {
      pitch: pitch,
      zoom: zoom,
      anchorY: anchorY,
      heading: heading,
      maneuver: cameraState.maneuver,
      timestamp: Date.now()
    };

    // 3. The anchor target is always the user's own true GPS position — never
    // a lookahead-projected point. Both the range rings (ui.js renderRangeRings,
    // drawn purely in screen space assuming ownship sits at the anchor) and the
    // user marker (map.js, placed at the literal lat/lon) treat the anchor as
    // the true position, so the camera has to match that or the two visibly
    // diverge. This used to shift the center ahead by evaluator.lookAheadMeters/
    // routeTarget to "lead" the view, but that broke the anchor guarantee: at
    // RAW's flat pitch/zoomed-out framing the resulting few-pixel offset was
    // invisible, but in Hybrid's pitched, tighter-zoom views the same offset —
    // amplified by ground-plane perspective foreshortening — pushed the real
    // marker well off its anchor point, sometimes off the bottom of the screen
    // entirely. "More room ahead" is already delivered by anchorY alone
    // (pushing the anchor toward the bottom leaves the top of the screen free
    // for what's ahead), so no separate center shift is needed.
    //
    // 4. Hand the true position (not yet anchor-offset — that's done fresh
    // every rendered frame, see _renderAnchoredFrame above) to the
    // frame-driven animator, which smoothly carries the camera there while
    // keeping the user's marker pinned to its anchor point throughout.
    _startAnimTo({
      lat: lat,
      lon: lon,
      bearing: heading,
      pitch: pitch,
      zoom: zoom,
      anchorY: anchorY,
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
    cancelFollow,
    transitionToNav,
    transitionToAir,
    setRouteActive,
    clearRoute,
    getLastEvaluated,
  };
})();

if (typeof module !== "undefined") module.exports = CameraController;