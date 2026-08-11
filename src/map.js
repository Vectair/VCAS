/**
 * MapLibre GL JS map — navigation vector basemap.
 *
 * Tile source: MapTiler v3 (OpenMapTiles schema) via NavStyle.getStyle().
 * Theme switching calls map.setStyle(style, {diff:true}) which reuses
 * cached tiles (same source URL) and only re-renders paint properties.
 * maplibregl.Marker objects are DOM elements and survive setStyle unchanged.
 */

const EosMap = (() => {
  let _map                   = null;
  let _userMarker            = null;
  let _airMarkers            = [];
  let _mode                  = "nav";
  let _heading               = 0;
  let _speedMph              = 0;
  let _mapLoaded             = false;
  let _pendingRoute          = null;  // geometry queued before first map load
  let _currentRouteGeometry  = null;  // retained so theme changes can re-apply it
  let _clickHandler          = null;  // set via onMapClick(); read lazily by the map's own click listener
  let _interactionHandler    = null;  // set via onUserInteraction(); fires on real drag/zoom/rotate, not programmatic camera moves

  // ---- Init ----

  /**
   * @param {string} containerId  DOM id of the map div.
   * @param {number} lat          Initial latitude.
   * @param {number} lon          Initial longitude.
   * @param {string} [theme]      "day" | "night" — resolved by ThemeManager.
   */
  function init(containerId, lat, lon, theme) {
    const initialTheme = theme || "night";

    _map = new maplibregl.Map({
      container:        containerId,
      style:            NavStyle.getStyle(initialTheme),
      center:           [lon, lat],
      zoom:             17,   // NAV_IDLE default
      pitch:            45,   // NAV_IDLE default
      bearing:          0,
      attributionControl: false,
      pitchWithRotate:  true,
      touchPitch:       false,
    });

    _map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    _map.on("load", () => {
      _mapLoaded = true;
      CameraController.init(_map);
      CameraController.followNav(lat, lon, 0, 0);
      _initRouteLayer();
      if (_pendingRoute) {
        _applyRoute(_pendingRoute);
        _pendingRoute = null;
      }
    });

    _map.on("error", e => console.error("[MapLibre error]", e.error || e));

    // Fires on both touch tap and mouse click, so destination-picking works
    // identically on a phone and on a laptop with a mouse.
    _map.on("click", e => {
      if (_clickHandler) _clickHandler(e.lngLat.lat, e.lngLat.lng);
    });

    // e.originalEvent is only set when a *start event came from a real user
    // gesture (mouse/touch) — MapLibre leaves it undefined for camera moves
    // we trigger ourselves via jumpTo/easeTo/flyTo (CameraController.followNav
    // runs on every GPS tick), so this only fires for an actual manual pan/
    // zoom/rotate, which is exactly when a "recenter" affordance is needed.
    ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(evt => {
      _map.on(evt, e => {
        if (e.originalEvent && _interactionHandler) _interactionHandler();
      });
    });

    _applySkyCss(initialTheme);

    _userMarker = _createUserMarker(lat, lon);
    return _map;
  }

  // ---- Theme ----

  /**
   * Switch the map basemap theme.  Safe to call at any time after init().
   * The Markers (user arrow, aircraft) are DOM elements and are unaffected
   * by setStyle; camera state is also preserved.
   *
   * @param {"day"|"night"} theme
   */
  function setTheme(theme) {
    if (!_map) return;
    _map.setStyle(NavStyle.getStyle(theme), { diff: true });
    _applySkyCss(theme);
    // setStyle({diff:true}) only patches layers/sources present in the style JSON;
    // dynamically added route layers survive in practice, but guard anyway.
    _map.once("styledata", () => {
      if (!_map.getSource("route")) {
        _initRouteLayer();
        if (_currentRouteGeometry) _applyRoute(_currentRouteGeometry);
      }
    });
  }

  function _applySkyCss(theme) {
    // The #map-container background is visible above the horizon when the map
    // is pitched — sync it to the map palette so the sky matches.
    const el = document.getElementById("map-container");
    if (el) el.style.background = NavStyle.skyColor(theme);
  }

  // ---- Route layer ----

  function _initRouteLayer() {
    _map.addSource("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Layer 1 — translucent outer glow (widest, drawn first).
    _map.addLayer({
      id:     "route-glow",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  {
        "line-color":   "#1A73E8",
        "line-width":   ["interpolate", ["linear"], ["zoom"], 12, 18, 16, 30, 20, 44],
        "line-opacity": 0.32,
        "line-blur":    5,
      },
    });

    // Layer 2 — main navigation blue.
    _map.addLayer({
      id:     "route-line",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  {
        "line-color":   "#4285F4",
        "line-width":   ["interpolate", ["linear"], ["zoom"], 12, 8, 16, 14, 20, 20],
        "line-opacity": 1,
      },
    });

    // Layer 3 — inner highlight (narrowest, drawn last / on top).
    _map.addLayer({
      id:     "route-highlight",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  {
        "line-color":   "#ADCCFF",
        "line-width":   ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 5, 20, 8],
        "line-opacity": 0.60,
      },
    });
  }

  function _applyRoute(geometry) {
    _map.getSource("route")?.setData({
      type:       "Feature",
      geometry:   geometry,
      properties: {},
    });
  }

  function showRoute(geometry) {
    _currentRouteGeometry = geometry;
    CameraController.setRouteActive(geometry);
    if (!_mapLoaded) { _pendingRoute = geometry; return; }
    if (!_map.getSource("route")) _initRouteLayer();
    _applyRoute(geometry);
  }

  function clearRoute() {
    _currentRouteGeometry = null;
    _pendingRoute         = null;
    CameraController.clearRoute();
    if (!_mapLoaded || !_map.getSource("route")) return;
    _map.getSource("route").setData({ type: "FeatureCollection", features: [] });
  }

  // ---- User marker ----

  function _createUserMarker(lat, lon) {
    const el = document.createElement("div");
    el.className = "user-marker";
    el.innerHTML = `
      <div class="user-marker-halo"></div>
      <svg class="user-marker-nav" viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 1 L19 27 L10 21 L1 27 Z"
              fill="var(--accent-user)" stroke="#ffffff" stroke-width="1.5"
              stroke-linejoin="round"/>
      </svg>`;

    return new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([lon, lat])
      .addTo(_map);
  }

  function _updateArrow(mode, heading) {
    const el  = _userMarker?.getElement();
    const svg = el?.querySelector(".user-marker-nav");
    if (!svg) return;
    // NAV: map rotates to match heading; arrow always points "up" = ahead.
    // AIR: map is north-up; rotate arrow to show heading relative to north.
    svg.style.transform = mode === "air"
      ? `rotate(${heading}deg)`
      : "rotate(0deg)";
  }

  // ---- Public API ----

  // Note: this only updates marker rendering — it deliberately does not call
  // CameraController.followNav(). app.js:onGpsSuccess already does that once
  // per GPS tick when in nav mode; calling it here too double-applies the
  // evaluator's speed smoothing and state-dwell timers on every position update.
  function updateUserPosition(lat, lon, heading, speedMph) {
    if (!_map) return;
    _heading  = heading ?? _heading;
    _speedMph = speedMph ?? _speedMph;
    _userMarker.setLngLat([lon, lat]);
    _updateArrow(_mode, _heading);
  }

  function setMode(mode, lat, lon, heading) {
    _mode    = mode;
    _heading = heading ?? _heading;
    _updateArrow(_mode, _heading);

    if (mode === "nav") {
      if (lat != null) CameraController.transitionToNav(lat, lon, _heading);
    } else {
      if (lat != null) CameraController.transitionToAir(lat, lon);
    }
  }

  function getMap() { return _map; }

  /** @param {function(number,number)} handler  Called with (lat, lon) on every map click/tap. */
  function onMapClick(handler) { _clickHandler = handler; }

  /** @param {function()} handler  Called whenever the user manually drags/zooms/rotates the map. */
  function onUserInteraction(handler) { _interactionHandler = handler; }

  function setPickingCursor(active) {
    if (_map) _map.getCanvas().style.cursor = active ? "crosshair" : "";
  }

  // ---- AIR mode aircraft markers ----

  /**
   * @param {Array} trackedList  Indicators.buildAll() output — same computed
   *   shape (aircraft/vis/relevance/distanceNm/relativeBearing) NAV indicators
   *   use, so AIR-mode-triggered log observations carry the same complete data
   *   (including relevance.reason — useful precisely because AIR mode never
   *   filters by it, so it's a live check on whether the filter agrees).
   * @param {function} onClickFn  Called with the clicked item.
   */
  function renderAirMarkers(trackedList, onClickFn) {
    clearAirMarkers();
    trackedList.forEach(item => {
      const a = item.aircraft;
      const el = document.createElement("div");
      el.className = "air-marker";
      el.innerHTML = _airMarkerHtml(a, item.vis);
      el.addEventListener("click", () => onClickFn(item));

      const m = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([a.lon, a.lat])
        .addTo(_map);
      _airMarkers.push(m);
    });
  }

  // Same reasoning as UI._displayColor() — the category colors are tuned for
  // the night theme's dark background; day theme needs the darker variant
  // for legible text/shape-fill. When the colorblind toggle is on, swaps to
  // the Okabe-Ito-based colorblindSafe/colorblindSafeDay pair instead — see
  // visibility.js for why.
  function _displayColor(vis) {
    const day = ThemeManager.getResolved() === "day";
    if (ColorblindMode.isEnabled()) {
      return (day ? vis.colorblindSafeDay : vis.colorblindSafe) || vis.color;
    }
    return (day ? vis.colorDay : null) || vis.color;
  }

  function _airMarkerHtml(aircraft, vis) {
    const callsign = aircraft.callsign || aircraft.hex;
    const type     = aircraft.type || "";
    const displayColor = _displayColor(vis);
    // AIR mode shows every aircraft unconditionally (no relevance filtering),
    // so the shape doesn't encode a relevance reason here — every marker is
    // a plain diamond, colour still carries the visibility category.
    const shapeSvg = AircraftSymbol.svg("in-view", displayColor, 18, AircraftSymbol.opacityForScore(vis.score));
    return `
      <div class="air-marker-inner">
        <div class="air-icon">${shapeSvg}</div>
        <div class="air-label-box">
          <div class="callsign" style="color:${displayColor}">${callsign}</div>
          ${type ? `<div class="actype">${type}</div>` : ""}
        </div>
      </div>`;
  }

  function clearAirMarkers() {
    _airMarkers.forEach(m => m.remove());
    _airMarkers = [];
  }

  function flyTo(lat, lon, zoom) {
    if (_map) _map.easeTo({ center: [lon, lat], zoom, duration: 800 });
  }

  return {
    init,
    setTheme,
    updateUserPosition,
    setMode,
    getMap,
    onMapClick,
    onUserInteraction,
    setPickingCursor,
    renderAirMarkers,
    clearAirMarkers,
    flyTo,
    showRoute,
    clearRoute,
  };
})();

if (typeof module !== "undefined") module.exports = EosMap;
