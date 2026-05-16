/**
 * MapLibre GL JS map wrapper.
 *
 * Public interface is unchanged from the Leaflet version so app.js
 * requires only minimal edits.  Adds setTheme(theme) for day/night switching.
 */

const EosMap = (() => {
  let _map        = null;
  let _userMarker = null;
  let _airMarkers = [];
  let _mode       = "nav";
  let _heading    = 0;
  let _mapLoaded  = false;
  let _pendingTheme = null;

  // CARTO raster tile URLs — no API key required.
  const TILES = {
    night: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    day: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    ],
  };

  const ATTRIBUTION = '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>';

  // Build the initial MapLibre style with both tile sources.
  // The correct layer starts visible; the other starts hidden.
  // Toggling is done later via setLayoutProperty (no re-init required).
  function _buildStyle(initialTheme) {
    const nightVis = initialTheme === "night" ? "visible" : "none";
    const dayVis   = initialTheme === "day"   ? "visible" : "none";
    return {
      version: 8,
      sources: {
        "carto-night": {
          type: "raster",
          tiles: TILES.night,
          tileSize: 512,
          maxzoom: 19,
          attribution: ATTRIBUTION,
        },
        "carto-day": {
          type: "raster",
          tiles: TILES.day,
          tileSize: 512,
          maxzoom: 19,
          attribution: ATTRIBUTION,
        },
      },
      layers: [
        {
          id: "carto-night-layer",
          type: "raster",
          source: "carto-night",
          minzoom: 0,
          maxzoom: 20,
          layout: { visibility: nightVis },
        },
        {
          id: "carto-day-layer",
          type: "raster",
          source: "carto-day",
          minzoom: 0,
          maxzoom: 20,
          layout: { visibility: dayVis },
        },
      ],
    };
  }

  // ---- Init ----

  function init(containerId, lat, lon) {
    const initialTheme = (typeof ThemeController !== "undefined")
      ? ThemeController.getEffectiveTheme()
      : "night";

    _map = new maplibregl.Map({
      container:          containerId,
      style:              _buildStyle(initialTheme),
      center:             [lon, lat],
      zoom:               16,
      pitch:              60,
      bearing:            0,
      attributionControl: false,
      pitchWithRotate:    true,
      touchPitch:         false,
    });

    _map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    _map.on("load", () => {
      _mapLoaded = true;
      CameraController.init(_map);
      CameraController.followNav(lat, lon, 0);
      if (_pendingTheme) {
        _applyThemeToMap(_pendingTheme);
        _pendingTheme = null;
      }
    });

    // Temporary diagnostic logging — remove once tiles are confirmed rendering.
    _map.on("error", e => console.error("[MapLibre error]", e.error || e));

    // Apply initial sky colour (visible above horizon at pitch 60°)
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
    // is pitched 60°.  Sync it to the map palette so the sky matches the land.
    const el = document.getElementById("map-container");
    if (el) el.style.background = NavStyle.skyColor(theme);
  }

  // ---- Route layer ----

  function _initRouteLayer() {
    _map.addSource("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // White casing — drawn first, wider, gives the blue line a clean border.
    _map.addLayer({
      id:     "route-casing",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  { "line-color": "#ffffff", "line-width": 13, "line-opacity": 0.92 },
    });

    // Navigation blue — Google Maps #1a73e8, dominant above road texture.
    _map.addLayer({
      id:     "route-line",
      type:   "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint:  { "line-color": "#1a73e8", "line-width": 8, "line-opacity": 1 },
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
    if (!_mapLoaded) { _pendingRoute = geometry; return; }
    if (!_map.getSource("route")) _initRouteLayer();
    _applyRoute(geometry);
  }

  function clearRoute() {
    _currentRouteGeometry = null;
    _pendingRoute         = null;
    if (!_mapLoaded || !_map.getSource("route")) return;
    _map.getSource("route").setData({ type: "FeatureCollection", features: [] });
  }

  // ---- User marker ----

  function _createUserMarker(lat, lon) {
    const el = document.createElement("div");
    el.className = "user-marker";
    // fill="currentColor" inherits from .user-marker-nav { color: var(--accent) }
    el.innerHTML = `
      <div class="user-marker-halo"></div>
      <svg class="user-marker-nav" viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 1 L19 27 L10 21 L1 27 Z"
              fill="currentColor" stroke="#ffffff" stroke-width="1.5"
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
    svg.style.transform = mode === "air"
      ? `rotate(${heading}deg)`
      : "rotate(0deg)";
  }

  // ---- Theme ----

  function _applyThemeToMap(theme) {
    _map.setLayoutProperty("carto-night-layer", "visibility", theme === "night" ? "visible" : "none");
    _map.setLayoutProperty("carto-day-layer",   "visibility", theme === "day"   ? "visible" : "none");
  }

  function setTheme(theme) {
    if (!_mapLoaded) {
      _pendingTheme = theme;
      return;
    }
    _applyThemeToMap(theme);
  }

  // ---- Public API ----

  function updateUserPosition(lat, lon, heading) {
    if (!_map) return;
    _heading = heading ?? _heading;
    _userMarker.setLngLat([lon, lat]);
    _updateArrow(_mode, _heading);
    if (_mode === "nav") CameraController.followNav(lat, lon, _heading);
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

  // ---- AIR mode aircraft markers ----

  function renderAirMarkers(aircraftList, userLat, userLon, onClickFn) {
    clearAirMarkers();
    aircraftList.forEach(a => {
      const vis = Visibility.estimate(userLat, userLon, a);
      const el  = document.createElement("div");
      el.className = "air-marker";
      el.innerHTML = _airMarkerHtml(a, vis);
      el.addEventListener("click", () => onClickFn(a, vis));

      const m = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([a.lon, a.lat])
        .addTo(_map);
      _airMarkers.push(m);
    });
  }

  function _airMarkerHtml(aircraft, vis) {
    const callsign = aircraft.callsign || aircraft.hex;
    const type     = aircraft.type || "";
    const rot      = aircraft.trackDeg != null ? aircraft.trackDeg : 0;
    return `
      <div class="air-marker-inner">
        <div class="air-icon" style="color:${vis.color};transform:rotate(${rot}deg)">✈</div>
        <div class="air-label-box">
          <div class="callsign" style="color:${vis.color}">${callsign}</div>
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

  return { init, updateUserPosition, setMode, setTheme, getMap, renderAirMarkers, clearAirMarkers, flyTo };
})();

if (typeof module !== "undefined") module.exports = EosMap;
