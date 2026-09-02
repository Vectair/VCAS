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
  let _airMarkers            = new Map(); // hex -> {marker, el}
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
        if (_lastRingPosition) updateRangeRings(_lastRingPosition.lat, _lastRingPosition.lon, _lastRingPosition.bandsNm, _lastRingPosition.labelBearingDeg, _lastRingPosition.fovHalfAngleDeg);
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
  // green sampled directly from the real ND reference photo (pixel-sampled:
  // the route line's brightest pixels measured ~(0-20, 210-225, 10-30) — a
  // clean, almost pure green with next to no red/blue) — real flight-deck
  // displays conventionally draw the active flight plan/route in green, and
  // RAW is specifically trying to match that reference as closely as
  // practical.
  const ROUTE_COLORS = {
    themed: { glow: "#1A73E8", line: "#4285F4", highlight: "#ADCCFF" },
    raw:    { glow: "#006600", line: "#00c800", highlight: "#b3ffb3" },
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
  // raw: near-white, pixel-sampled from the reference photo's own dashed
  // range rings (~(248,248,248) — the same near-white used throughout its
  // display for ticks/labels/non-threat traffic), not the muted blue-grey
  // this used to be.
  const RING_COLOR = { raw: "#f0f0f0", day: "#636366", night: "#8b949e" };
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
   *
   * @param {number} [labelBearingDeg=0]  True bearing each ring's nm label
   *   is placed along. AIR is always north-up (map bearing 0), so true
   *   north — the default — always lands at the top of the screen, which is
   *   correct there. RAW is heading-up (the map itself rotates to the
   *   user's current heading), so a label fixed at true north drifts to
   *   whatever screen angle "north" currently happens to be — at anything
   *   but a heading very close to 0/360 it swings the label for a big-radius
   *   ring hundreds of pixels sideways, often clean off the edge of the
   *   screen (confirmed via a real MapLibre simulation: at a 30° heading
   *   the 5/10/15nm labels all projected off-screen, only 2nm stayed
   *   visible). Callers in RAW mode must pass the user's current heading so
   *   the label sits along dead-ahead (always "up" on a heading-up display)
   *   instead, matching how a real heading-up ND places range labels.
   * @param {number} [fovHalfAngleDeg]  When set, draws each ring as an arc
   *   (Geo.arcCoordinates) spanning `labelBearingDeg ± fovHalfAngleDeg`
   *   instead of a full circle — matching a real TCAS/ND reference photo,
   *   which only ever shows a forward field of view. Omit (the default) for
   *   a full circle, used by AIR (no single "forward" direction makes sense
   *   in a north-up strategic view).
   */
  function updateRangeRings(lat, lon, bandsNm, labelBearingDeg = 0, fovHalfAngleDeg = null) {
    if (!_map || !_map.getSource("range-rings")) return;
    _lastRingPosition = { lat, lon, bandsNm, labelBearingDeg, fovHalfAngleDeg };

    const ringFeatures = bandsNm.map(nm => ({
      type:       "Feature",
      properties: { nm },
      geometry:   {
        type:        "LineString",
        coordinates: fovHalfAngleDeg != null
          ? Geo.arcCoordinates(lat, lon, nm * NM_TO_M, labelBearingDeg, fovHalfAngleDeg)
          : Geo.circleCoordinates(lat, lon, nm * NM_TO_M),
      },
    }));
    _map.getSource("range-rings").setData({ type: "FeatureCollection", features: ringFeatures });

    const labelFeatures = bandsNm.map(nm => {
      const pt = Geo.destinationPoint(lat, lon, labelBearingDeg, nm * NM_TO_M);
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
  // Diffs by hex rather than tearing every marker down and rebuilding it —
  // this is called on every extrapolation render tick (much more often than
  // the underlying data actually changes, see app.js's render-tick timer),
  // so recreating each maplibregl.Marker/DOM node every call would mean
  // constant element churn (and click-listener rebinding) for markers whose
  // position mostly just needs a small setLngLat() nudge.
  function renderAirMarkers(trackedList, onClickFn) {
    const seenHexes = new Set();

    trackedList.forEach(item => {
      const a = item.aircraft;
      seenHexes.add(a.hex);
      const existing = _airMarkers.get(a.hex);

      if (existing) {
        existing.el.innerHTML = _airMarkerHtml(a, item.vis);
        existing.marker.setLngLat([a.lon, a.lat]);
        existing.onClickFn = onClickFn;
        existing.item = item;
      } else {
        const el = document.createElement("div");
        el.className = "air-marker";
        el.innerHTML = _airMarkerHtml(a, item.vis);
        const entry = { el, item, onClickFn };
        el.addEventListener("click", () => entry.onClickFn(entry.item));

        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([a.lon, a.lat])
          .addTo(_map);
        entry.marker = marker;
        _airMarkers.set(a.hex, entry);
      }
    });

    for (const [hex, entry] of _airMarkers) {
      if (!seenHexes.has(hex)) {
        entry.marker.remove();
        _airMarkers.delete(hex);
      }
    }
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
    const altitudeLabel = aircraft.altitudeFt != null ? `${Math.round(aircraft.altitudeFt).toLocaleString()}ft` : "";
    return `
      <div class="air-marker-inner">
        <div class="air-icon">${arrowSvg}${shapeSvg}</div>
        <div class="air-label-box">
          <div class="callsign" style="color:${displayColor}">${callsign}</div>
          ${type ? `<div class="actype">${type}</div>` : ""}
          ${altitudeLabel ? `<div class="indicator-altitude">${altitudeLabel}</div>` : ""}
        </div>
      </div>`;
  }

  function clearAirMarkers() {
    _airMarkers.forEach(entry => entry.marker.remove());
    _airMarkers.clear();
  }

  function flyTo(lat, lon, zoom) {
    if (_map) _map.easeTo({ center: [lon, lat], zoom, duration: 800 });
  }

  // ---- Local obstruction density (2026-09-02) ----

  // Wooded/forest landcover class filter — same exact classes as the real
  // "landcover-forest" layer in navStyle.js, already proven against this
  // tile source, not re-guessed from generic OpenMapTiles docs. Kept as
  // its own constant here rather than importing navStyle's internals,
  // since navStyle.js exposes no public accessor for it — if that filter
  // ever changes there, this needs updating by hand (flagged so it isn't
  // missed).
  const WOODED_LANDCOVER_CLASSES = ["wood", "forest"];

  /**
   * Planar polygon area in square metres, via the shoelace formula on a
   * simple flat equirectangular projection centred on `originLat` — a
   * deliberate simplification, not spherical geometry: at the ~250-750m
   * radius this is used for, the flat-earth approximation error is
   * negligible, and this project's own convention (see geo.js) already
   * reserves real spherical math for genuinely long-range calculations.
   * Handles a single ring (no holes) — MultiPolygon/Polygon-with-holes
   * geometry types are summed/reduced to their outer ring(s) by the caller.
   */
  function _ringAreaM2(ring, originLat, originLon) {
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(originLat * Math.PI / 180);
    const pts = ring.map(([lon, lat]) => [
      (lon - originLon) * metersPerDegLon,
      (lat - originLat) * metersPerDegLat,
    ]);
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  /** Centroid of a polygon's outer ring, plain average of its vertices —
   * sufficient for the coarse "is this polygon within the search radius"
   * inclusion test this is used for, not meant to be a true area-weighted
   * centroid. */
  function _ringCentroid(ring) {
    let lonSum = 0, latSum = 0;
    for (const [lon, lat] of ring) { lonSum += lon; latSum += lat; }
    return [lonSum / ring.length, latSum / ring.length];
  }

  /**
   * Sums the area (m²) of every polygon in `features` whose centroid falls
   * within `radiusM` of (lat, lon) — v1 deliberately skips true circle-
   * clipping (see CLAUDE.md/the design plan this was built from): a
   * centroid-in-radius test gives one clean in/out decision per polygon,
   * which is enough for a *relative* density signal, not a claim about
   * exact covered square metres.
   */
  function _sumAreaWithinRadius(features, lat, lon, radiusM) {
    let total = 0;
    for (const f of features) {
      const geom = f.geometry;
      if (!geom) continue;
      const polygons = geom.type === "Polygon" ? [geom.coordinates]
        : geom.type === "MultiPolygon" ? geom.coordinates
        : null;
      if (!polygons) continue;
      for (const rings of polygons) {
        const outer = rings[0]; // ignore holes — coarse signal, not exact coverage
        if (!outer || outer.length < 3) continue;
        const [cLon, cLat] = _ringCentroid(outer);
        if (Geo.calculateDistanceMeters(lat, lon, cLat, cLon) > radiusM) continue;
        total += _ringAreaM2(outer, lat, lon);
      }
    }
    return total;
  }

  /**
   * Queries the RAW-style's own invisible building+landcover-forest
   * layers (added in navStyle.js specifically so their tiles get loaded —
   * see that file's own comment on why `fill-opacity: 0`, not
   * `visibility: "none"`, was required, confirmed via a real MapLibre
   * harness) for a coarse local-obstruction density around (lat, lon).
   *
   * Returns `null` if the map/source isn't ready — callers (LocalObstruction)
   * must treat that as "no data," never as "confirmed open terrain."
   *
   * @returns {{buildingDensity:number, vegetationDensity:number, combinedDensity:number, radiusM:number, buildingFeatureCount:number, vegetationFeatureCount:number}|null}
   */
  function queryLocalDensity(lat, lon, radiusM) {
    if (!_map || !_mapLoaded) return null;

    let buildingFeatures, vegetationFeatures;
    try {
      buildingFeatures = _map.querySourceFeatures(NavStyle.SOURCE_ID, { sourceLayer: "building" });
      vegetationFeatures = _map.querySourceFeatures(NavStyle.SOURCE_ID, {
        sourceLayer: "landcover",
        filter: ["in", ["get", "class"], ["literal", WOODED_LANDCOVER_CLASSES]],
      });
    } catch (e) {
      return null; // source not registered yet, style mid-transition, etc.
    }
    if (!buildingFeatures || !vegetationFeatures) return null;

    const sampleAreaM2 = Math.PI * radiusM * radiusM;
    const buildingAreaM2 = _sumAreaWithinRadius(buildingFeatures, lat, lon, radiusM);
    const vegetationAreaM2 = _sumAreaWithinRadius(vegetationFeatures, lat, lon, radiusM);

    const buildingDensity = Math.min(1, buildingAreaM2 / sampleAreaM2);
    const vegetationDensity = Math.min(1, vegetationAreaM2 / sampleAreaM2);
    // Overlap-safe combine — a naive sum could exceed 1 where a wooded
    // area contains buildings (or vice versa).
    const combinedDensity = 1 - (1 - buildingDensity) * (1 - vegetationDensity);

    return {
      buildingDensity,
      vegetationDensity,
      combinedDensity,
      radiusM,
      buildingFeatureCount: buildingFeatures.length,
      vegetationFeatureCount: vegetationFeatures.length,
    };
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
    queryLocalDensity,
  };
})();

if (typeof module !== "undefined") module.exports = EosMap;
