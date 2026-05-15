/**
 * Leaflet map initialisation and management.
 */

const EosMap = (() => {
  let _map = null;
  let _userMarker = null;
  let _airMarkers = [];
  let _mode = "nav"; // "nav" | "air"

  // Dark CartoDB tile layer – Google Maps night mode aesthetic
  const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const TILE_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  function init(containerId, lat, lon) {
    _map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: false,
      scrollWheelZoom: true,
    }).setView([lat, lon], CONFIG.DEFAULT_ZOOM_DRIVING);

    L.tileLayer(TILE_DARK, {
      maxZoom: 19,
      attribution: TILE_ATTR,
      subdomains: "abcd",
    }).addTo(_map);

    // Suppress attribution to keep UI clean on small screens
    _map.attributionControl.setPrefix("");

    _userMarker = _createUserMarker(lat, lon);
    return _map;
  }

  function _createUserMarker(lat, lon) {
    const icon = L.divIcon({
      className: "",
      html: `<div style="
        width:20px;height:20px;
        background:#58a6ff;
        border:3px solid #fff;
        border-radius:50%;
        box-shadow:0 0 10px rgba(88,166,255,.7);
      "></div>`,
      iconAnchor: [10, 10],
    });
    return L.marker([lat, lon], { icon, interactive: false }).addTo(_map);
  }

  function updateUserPosition(lat, lon) {
    if (!_map) return;
    _userMarker.setLatLng([lat, lon]);
    if (_mode === "nav") {
      _map.setView([lat, lon], _map.getZoom(), { animate: true, duration: 1 });
    }
  }

  function setMode(mode) {
    _mode = mode;
  }

  function getMap() { return _map; }

  /** Render aircraft markers in Air mode */
  function renderAirMarkers(aircraftList, userLat, userLon, onClickFn) {
    clearAirMarkers();
    aircraftList.forEach(a => {
      const vis = Visibility.estimate(userLat, userLon, a);
      const icon = L.divIcon({
        className: "air-marker",
        html: _airMarkerHtml(a, vis),
        iconAnchor: [30, 20],
      });
      const m = L.marker([a.lat, a.lon], { icon })
        .addTo(_map)
        .on("click", () => onClickFn(a, vis));
      _airMarkers.push(m);
    });
  }

  function _airMarkerHtml(aircraft, vis) {
    const callsign = aircraft.callsign || aircraft.hex;
    const type = aircraft.type || "";
    const rot = aircraft.trackDeg != null ? aircraft.trackDeg : 0;
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
    _airMarkers.forEach(m => _map.removeLayer(m));
    _airMarkers = [];
  }

  function flyTo(lat, lon, zoom) {
    if (_map) _map.flyTo([lat, lon], zoom, { duration: .8 });
  }

  return { init, updateUserPosition, setMode, getMap, renderAirMarkers, clearAirMarkers, flyTo };
})();

if (typeof module !== "undefined") module.exports = EosMap;
