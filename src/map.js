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
  let _currentTheme          = "night"; // last theme passed to init()/setTheme() — "day" | "night" | "raw"

  // ---- Init ----

  /**
   * @param {string} containerId  DOM id of the map div.
   * @param {number} lat          Initial latitude.
   * @param {number} lon          Initial longitude.
   * @param {string} [theme]      "day" | "night" — resolved by ThemeManager.
   */
  function init(containerId, lat, lon, theme) {
    const initialTheme = theme || "night";
    _currentTheme = initialTheme;

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
      _initRangeRingsLayer();
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
        if (!e.originalEvent) return;
        // CameraController's frame-driven follow animation calls jumpTo()
        // on every rendered frame for up to ~400ms after each GPS/heading
        // tick — MapLibre has no idea that's "an animation" (unlike its own
        // easeTo/flyTo, which it auto-cancels on user input), so left alone
        // it keeps overwriting this gesture's delta every frame, making the
        // drag/zoom/rotate effectively do nothing. Stop it the instant a
        // real gesture starts, before the next frame can fight it.
        if (typeof CameraController !== "undefined") CameraController.cancelFollow();
        if (_interactionHandler) _interactionHandler();
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
    _currentTheme = theme;
    _map.setStyle(NavStyle.getStyle(theme), { diff: true });
    _applySkyCss(theme);
    // setStyle({diff:true}) only patches layers/sources present in the style JSON;
    // dynamically added route/range-ring layers survive in practice, but guard anyway.
    _map.once("styledata", () => {
      if (!_map.getSource("route")) {
        _initRouteLayer();
        if (_currentRouteGeometry) _applyRoute(_currentRouteGeometry);
      }
      if (!_map.getSource("range-rings")) {
        _initRangeRingsLayer();
        if (_lastRingPosition) updateRangeRings(_lastRingPosition.lat, _lastRingPosition.lon, _lastRingPosition.bandsNm);
      } else {
        _applyRangeRingColor();
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

  // Standard Google-Maps-style blue everywhere except RAW, which uses the
  // green sampled directly from the real ND reference screenshot — real
  // flight-deck displays conventionally draw the active flight plan/route
  // in green, and RAW is specifically trying to match that reference as
  // closely as practical.
  const ROUTE_COLORS = {
    themed: { glow: "#1A73E8", line: "#4285F4", highlight: "#ADCCFF" },
    raw:    { glow: "#0c7a0c", line: "#2caf2c", highlight: "#a8f0a8" },
  };

  function _effectiveRouteColors() {
    const raw = (typeof NavDisplayStyle !== "undefined") && NavDisplayStyle.isRaw();
    return raw ? ROUTE_COLORS.raw : ROUTE_COLORS.themed;
  }

  function _initRouteLayer() {
    _map.addSource("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    const c = _effectiveRouteColors();

    // Layer 1 — translucent outer glow (widest, drawn first).
    _map.addLayer({
      id:     "route-glow",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  {
        "line-color":   c.glow,
        "line-width":   ["interpolate", ["linear"], ["zoom"], 12, 18, 16, 30, 20, 44],
        "line-opacity": 0.32,
        "line-blur":    5,
      },
    });

    // Layer 2 — main navigation line.
    _map.addLayer({
      id:     "route-line",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  {
        "line-color":   c.line,
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
        "line-color":   c.highlight,
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

  // ---- Range rings ----
  //
  // Drawn as real geo-referenced map layers (true circles around the user's
  // actual lat/lon, dashed like the reference ND/TCAS display) instead of a
  // screen-space SVG overlay recomputed only on GPS ticks — the previous
  // approach visibly detached from the map whenever the user panned/zoomed
  // manually between ticks, since nothing re-rendered it against the new
  // camera transform. As real map content, MapLibre repositions them
  // correctly on every pan/zoom/rotate/tilt for free, the same way it
  // already does for the route line — no per-frame JS needed.
  //
  // Radii are literal real-world nm (matching the reference distances a
  // pilot would actually read them as), not the old screen-space "banded"
  // compression — worth knowing: at Hybrid's typical driving zoom the outer
  // (10/15nm) rings will often extend past the visible screen, same as any
  // other real map feature at that distance would. RAW's zoom is already
  // tuned to keep the full ~15nm span on screen, so it's unaffected.

  const NM_TO_M = 1852;
  const RING_COLOR = { raw: "#8b949e", day: "#636366", night: "#8b949e" };
  let _lastRingPosition = null; // { lat, lon, bandsNm } — reapplied after a setStyle-triggered re-init

  function _effectiveRingColor() {
    // Driven by the same effective theme setTheme() was last called with —
    // callers (app.js's _effectiveMapTheme) already resolve "raw" only for
    // NAV's Raw style specifically, never for AIR, even if Raw happens to be
    // the last-selected NAV preference — checking NavDisplayStyle.isRaw()
    // directly here instead would get that wrong the moment AIR rings ship,
    // since that preference isn't itself mode-scoped.
    return RING_COLOR[_currentTheme] || RING_COLOR.night;
  }

  function _applyRangeRingColor() {
    if (!_map || !_map.getLayer("range-rings-line")) return;
    const color = _effectiveRingColor();
    _map.setPaintProperty("range-rings-line", "line-color", color);
    _map.setPaintProperty("range-rings-labels", "text-color", color);
  }

  function _initRangeRingsLayer() {
    _map.addSource("range-rings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    _map.addSource("range-ring-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    const color = _effectiveRingColor();

    _map.addLayer({
      id:     "range-rings-line",
      type:   "line",
      source: "range-rings",
      layout: { "line-join": "round" },
      paint:  {
        "line-color":     color,
        "line-width":     1.5,
        "line-dasharray": [2, 2.5],
        "line-opacity":   0.55,
      },
    });

    _map.addLayer({
      id:     "range-rings-labels",
      type:   "symbol",
      source: "range-ring-labels",
      layout: {
        "text-field":            ["get", "label"],
        // Matching NavStyle's own basemap label font — the style's `glyphs`
        // URL only serves the font stacks it's asked for, and an unlisted
        // one silently fails to fetch (no text renders, no error thrown).
        "text-font":             ["Noto Sans Regular", "Noto Sans Bold"],
        "text-size":             11,
        "text-offset":           [0, -0.6],
        "text-anchor":           "bottom",
        "text-allow-overlap":    true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color":   color,
        "text-opacity": 0.7,
      },
    });
  }

  /**
   * Redraw the range rings centred on the user's true position. Call on
   * every position update while in NAV mode — cheap (a handful of geodesic
   * point calculations plus a setData()), same as the route line's own
   * per-update cost.
   */
  function updateRangeRings(lat, lon, bandsNm) {
    if (!_map || !_map.getSource("range-rings")) return;
    _lastRingPosition = { lat, lon, bandsNm };

    const ringFeatures = bandsNm.map(nm => ({
      type:       "Feature",
      properties: { nm },
      geometry:   { type: "LineString", coordinates: Geo.circleCoordinates(lat, lon, nm * NM_TO_M) },
    }));
    _map.getSource("range-rings").setData({ type: "FeatureCollection", features: ringFeatures });

    const labelFeatures = bandsNm.map(nm => {
      const pt = Geo.destinationPoint(lat, lon, 0, nm * NM_TO_M); // true-north point on each ring
      return {
        type:       "Feature",
        properties: { label: String(nm) },
        geometry:   { type: "Point", coordinates: [pt.lon, pt.lat] },
      };
    });
    _map.getSource("range-ring-labels").setData({ type: "FeatureCollection", features: labelFeatures });
  }

  function clearRangeRings() {
    _lastRingPosition = null;
    if (!_map) return;
    _map.getSource("range-rings")?.setData({ type: "FeatureCollection", features: [] });
    _map.getSource("range-ring-labels")?.setData({ type: "FeatureCollection", features: [] });
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

  /** Small chevron pointing "up" before rotation — mirrors ui.js's own copy. */
  function _directionArrowSvg(color) {
    return `<svg width="9" height="12" viewBox="0 0 10 14" aria-hidden="true"><path d="M5 0 L10 9 L5 6.5 L0 9 Z" fill="${color}"/></svg>`;
  }

  function _airMarkerHtml(aircraft, vis) {
    const callsign = aircraft.callsign || aircraft.hex;
    const type     = aircraft.type || "";
    const displayColor = _displayColor(vis);
    // AIR mode shows every aircraft unconditionally (no relevance computed),
    // so there's no predicted/overhead modifier here — just the tier's own
    // TCAS shape+fill, same as a NAV indicator's default state.
    const shapeSvg = AircraftSymbol.svg(vis.shape, displayColor, 18, vis.fillOpacity);
    // AIR mode's map is always north-up (see transitionToAir), so the
    // direction-of-travel arrow uses the aircraft's raw track directly —
    // unlike NAV's heading-up indicators, there's no observer heading to
    // subtract first.
    const arrowSvg = aircraft.trackDeg != null
      ? `<div class="direction-arrow" style="transform:translate(-50%,-50%) rotate(${aircraft.trackDeg}deg) translateY(-16px)">${_directionArrowSvg(displayColor)}</div>`
      : "";
    return `
      <div class="air-marker-inner">
        <div class="air-icon">${arrowSvg}${shapeSvg}</div>
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
    updateRangeRings,
    clearRangeRings,
  };
})();

if (typeof module !== "undefined") module.exports = EosMap;
