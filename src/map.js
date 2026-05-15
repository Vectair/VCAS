/**
 * MapLibre GL JS map — navigation vector basemap.
 *
 * Tile source: MapTiler v3 (OpenMapTiles schema) via NavStyle.getStyle().
 * Theme switching calls map.setStyle(style, {diff:true}) which reuses
 * cached tiles (same source URL) and only re-renders paint properties.
 * maplibregl.Marker objects are DOM elements and survive setStyle unchanged.
 */

const EosMap = (() => {
  let _map        = null;
  let _userMarker = null;
  let _airMarkers = [];
  let _mode       = "nav";
  let _heading    = 0;

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
      zoom:             16,
      pitch:            60,
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
      CameraController.init(_map);
      CameraController.followNav(lat, lon, 0);
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
  }

  function _applySkyCss(theme) {
    // The #map-container background is visible above the horizon when the map
    // is pitched 60°.  Sync it to the map palette so the sky matches the land.
    const el = document.getElementById("map-container");
    if (el) el.style.background = NavStyle.skyColor(theme);
  }

  // ---- User marker ----

  function _createUserMarker(lat, lon) {
    const el = document.createElement("div");
    el.className = "user-marker";
    el.innerHTML = `
      <div class="user-marker-halo"></div>
      <svg class="user-marker-nav" viewBox="0 0 20 28" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 1 L19 27 L10 21 L1 27 Z"
              fill="#58a6ff" stroke="#ffffff" stroke-width="1.5"
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

  return { init, setTheme, updateUserPosition, setMode, getMap, renderAirMarkers, clearAirMarkers, flyTo };
})();

if (typeof module !== "undefined") module.exports = EosMap;
