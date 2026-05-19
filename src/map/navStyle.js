/**
 * NavStyle — MapLibre GL JS vector style factory for Eos navigation.
 *
 * Tile source: MapTiler v3 (OpenMapTiles schema).
 *   Free tier: https://cloud.maptiler.com/auth/widget?mode=add  (no credit card)
 *   Set CONFIG.MAPTILER_KEY to enable tiles.
 *
 * Why not OpenFreeMap: tiles.openfreemap.org enforces a domain allowlist via
 * their CDN (x-deny-reason: host_not_allowed) — localhost is blocked without
 * portal registration.  MapTiler uses the same OpenMapTiles source-layer
 * schema so all 31 layer definitions below are unchanged.
 *
 * Layer order (painter's algorithm, bottom → top):
 *   background → water → waterway → landcover → park → landuse →
 *   buildings → road casings → road fills → boundaries →
 *   road labels → place labels → water labels
 *
 * POI layer intentionally omitted to reduce clutter in driving view.
 */

const NavStyle = (() => {

  const SOURCE_ID = "omvt";

  // Read key once at module init (config.js always loads before navStyle.js).
  function _key() {
    return (typeof CONFIG !== "undefined" && CONFIG.MAPTILER_KEY) || "";
  }

  function _sourceUrl() {
    const k = _key();
    if (!k) {
      console.warn("[NavStyle] CONFIG.MAPTILER_KEY is empty — vector tiles will not load. "
        + "Get a free key at https://cloud.maptiler.com/auth/widget?mode=add");
    }
    return `https://api.maptiler.com/tiles/v3/tiles.json?key=${k}`;
  }

  function _glyphsUrl() {
    return `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${_key()}`;
  }

  const ATTR = '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> '
             + '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a>';

  // ---- Colour palettes -------------------------------------------------- //

  const P = {

    day: {
      // Land & nature
      background:        "#f2efe9",
      water:             "#aadaff",
      waterway:          "#7ec8f0",
      park:              "#d3ead6",
      forest:            "#c2dfc4",
      grass:             "#daeeda",
      sand:              "#f0e0c0",
      residential:       "#ece8e2",
      buildings:         "#ddd8d0",
      buildingOutline:   "#ccc6be",
      // Roads — motorway
      motorway:          "#ffc125",
      motorwayCasing:    "#d99b00",
      // Roads — trunk (A-road / expressway)
      trunk:             "#ffd780",
      trunkCasing:       "#c08010",
      // Roads — primary
      primary:           "#ffffff",
      primaryCasing:     "#bdbdbd",
      // Roads — secondary
      secondary:         "#ffffff",
      secondaryCasing:   "#cccccc",
      // Roads — tertiary
      tertiary:          "#ffffff",
      tertiaryCasing:    "#d8d8d8",
      // Roads — minor / residential / unclassified
      minor:             "#ffffff",
      minorCasing:       "#e0e0e0",
      // Roads — service
      service:           "#f8f8f6",
      serviceCasing:     "#e4e4e0",
      // Labels
      labelPrimary:      "#1a1a1a",
      labelSecondary:    "#555555",
      labelWater:        "#3d78aa",
      labelRoad:         "#444444",
      // Boundaries
      boundary:          "#c0b0a0",
      // Sky (visible above horizon at pitch 60°)
      sky:               "#dce8f2",
    },

    night: {
      // Land & nature
      background:        "#1b1d2a",
      water:             "#0c2847",
      waterway:          "#0a2040",
      park:              "#192c1a",
      forest:            "#142212",
      grass:             "#1c2d1e",
      sand:              "#2c281a",
      residential:       "#23252f",
      buildings:         "#252838",
      buildingOutline:   "#1c1e2e",
      // Roads — motorway
      motorway:          "#c49010",
      motorwayCasing:    "#8a5c00",
      // Roads — trunk
      trunk:             "#a06800",
      trunkCasing:       "#724200",
      // Roads — primary
      primary:           "#3a3d52",
      primaryCasing:     "#272940",
      // Roads — secondary
      secondary:         "#303348",
      secondaryCasing:   "#1f2238",
      // Roads — tertiary
      tertiary:          "#292b3c",
      tertiaryCasing:    "#181a2c",
      // Roads — minor / residential / unclassified
      minor:             "#222430",
      minorCasing:       "#141622",
      // Roads — service
      service:           "#1e2030",
      serviceCasing:     "#131420",
      // Labels
      labelPrimary:      "#dddad6",
      labelSecondary:    "#8a90a0",
      labelWater:        "#5080a8",
      labelRoad:         "#8a90a0",
      // Boundaries
      boundary:          "#38304e",
      // Sky
      sky:               "#0e1117",
    },
  };

  // ---- Helpers ----------------------------------------------------------- //

  function _rampW(z0, w0, z1, w1, z2, w2) {
    return ["interpolate", ["linear"], ["zoom"], z0, w0, z1, w1, z2, w2];
  }

  // ---- Layer builders ---------------------------------------------------- //

  function _layers(theme) {
    const p   = P[theme];
    const src = SOURCE_ID;

    return [

      // ── Background / land ───────────────────────────────────────────────
      {
        id: "background", type: "background",
        paint: { "background-color": p.background },
      },

      // ── Water ────────────────────────────────────────────────────────────
      {
        id: "water-body", type: "fill",
        source: src, "source-layer": "water",
        paint: { "fill-color": p.water, "fill-antialias": true },
      },
      {
        id: "waterway-line", type: "line",
        source: src, "source-layer": "waterway",
        layout: { "line-cap": "round" },
        paint: {
          "line-color": p.waterway,
          "line-width": _rampW(8, 0.4, 14, 1.5, 18, 4),
        },
      },

      // ── Land cover (natural) ─────────────────────────────────────────────
      {
        id: "landcover-park", type: "fill",
        source: src, "source-layer": "landcover",
        filter: ["in", ["get", "class"],
          ["literal", ["park", "national_park", "garden", "grass", "scrub"]]],
        paint: { "fill-color": p.park, "fill-opacity": 0.35 },
      },
      {
        id: "landcover-forest", type: "fill",
        source: src, "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "forest"]]],
        paint: { "fill-color": p.forest, "fill-opacity": 0.40 },
      },
      {
        id: "landcover-grass", type: "fill",
        source: src, "source-layer": "landcover",
        filter: ["==", ["get", "class"], "grass"],
        paint: { "fill-color": p.grass, "fill-opacity": 0.65 },
      },
      {
        id: "landcover-sand", type: "fill",
        source: src, "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["sand", "beach"]]],
        paint: { "fill-color": p.sand, "fill-opacity": 0.80 },
      },
      // Park layer (OpenMapTiles protected-area / park polygons at low zoom)
      {
        id: "park-fill", type: "fill",
        source: src, "source-layer": "park",
        paint: { "fill-color": p.park, "fill-opacity": 0.25 },
      },

      // ── Land use (urban) ─────────────────────────────────────────────────
      {
        id: "landuse-residential", type: "fill",
        source: src, "source-layer": "landuse",
        filter: ["in", ["get", "class"],
          ["literal", ["residential", "suburb", "neighbourhood"]]],
        paint: { "fill-color": p.residential, "fill-opacity": 0 },
      },

      // ── Buildings — hidden; route corridor is the scene ──────────────────
      {
        id: "building-fill", type: "fill",
        source: src, "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-color": p.buildings,
          "fill-antialias": true,
          "fill-opacity": 0,
        },
      },

      // ── Road casings (rendered below fills for clean outlines) ───────────
      {
        id: "road-service-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "service"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.serviceCasing,
          "line-width": _rampW(13, 1.5, 16, 3.5, 19, 8),
          "line-opacity": 0,  // service roads fully suppressed in nav view
        },
      },
      {
        id: "road-minor-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["in", ["get", "class"],
          ["literal", ["minor", "residential", "unclassified", "living_street"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.minorCasing,
          "line-width": _rampW(12, 0.8, 15, 2, 18, 4),
          "line-opacity": 0,  // minor roads fully suppressed — route dominates
        },
      },
      {
        id: "road-tertiary-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "tertiary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.tertiaryCasing,
          "line-width": _rampW(10, 1.5, 14, 5, 18, 12),
        },
      },
      {
        id: "road-secondary-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "secondary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.secondaryCasing,
          "line-width": _rampW(8, 2, 14, 7, 18, 16),
        },
      },
      {
        id: "road-primary-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "primary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.primaryCasing,
          "line-width": _rampW(7, 2.5, 14, 8, 18, 19),
        },
      },
      {
        id: "road-trunk-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "trunk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.trunkCasing,
          "line-width": _rampW(6, 3, 14, 9, 18, 22),
        },
      },
      {
        id: "road-motorway-casing", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.motorwayCasing,
          "line-width": _rampW(5, 3.5, 14, 11, 18, 24),
        },
      },

      // ── Road fills ───────────────────────────────────────────────────────
      {
        id: "road-service-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "service"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.service,
          "line-width": _rampW(13, 0.5, 16, 2.5, 19, 7),
          "line-opacity": 0,  // service roads fully suppressed
        },
      },
      {
        id: "road-minor-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["in", ["get", "class"],
          ["literal", ["minor", "residential", "unclassified", "living_street"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.minor,
          "line-width": _rampW(12, 0.5, 15, 2.5, 18, 8),
          "line-opacity": 0,  // minor roads fully suppressed
        },
      },
      {
        id: "road-tertiary-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "tertiary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.tertiary,
          "line-width": _rampW(10, 0.5, 14, 3.5, 18, 11),
        },
      },
      {
        id: "road-secondary-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "secondary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.secondary,
          "line-width": _rampW(8, 1, 14, 6, 18, 15),
        },
      },
      {
        id: "road-primary-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "primary"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.primary,
          "line-width": _rampW(7, 1.5, 14, 7, 18, 18),
        },
      },
      {
        id: "road-trunk-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "trunk"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.trunk,
          "line-width": _rampW(6, 1.5, 14, 8, 18, 20),
        },
      },
      {
        id: "road-motorway-fill", type: "line",
        source: src, "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": p.motorway,
          "line-width": _rampW(5, 2, 14, 9, 18, 22),
        },
      },

      // ── Administrative boundaries ────────────────────────────────────────
      {
        id: "boundary-country", type: "line",
        source: src, "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 2],
        paint: {
          "line-color": p.boundary,
          "line-width": 1.5,
          "line-dasharray": [4, 2],
        },
      },
      {
        id: "boundary-state", type: "line",
        source: src, "source-layer": "boundary",
        filter: ["all",
          [">=", ["get", "admin_level"], 3],
          ["<=", ["get", "admin_level"], 4]],
        minzoom: 4,
        paint: {
          "line-color": p.boundary,
          "line-width": 1,
          "line-dasharray": [3, 2],
          "line-opacity": 0.7,
        },
      },

      // ── Labels ───────────────────────────────────────────────────────────
      // Road name labels — major roads only; minor street names suppressed.
      {
        id: "road-label", type: "symbol",
        source: src, "source-layer": "transportation_name",
        minzoom: 15,
        filter: ["in", ["get", "class"],
          ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular", "Noto Sans Bold"],
          "symbol-placement": "line",
          "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 17, 12, 19, 13],
          "text-max-angle": 30,
          "text-padding": 40,
          "text-pitch-alignment": "viewport",
          "text-rotation-alignment": "map",
        },
        paint: {
          "text-color": p.labelRoad,
          "text-halo-color": p.background,
          "text-halo-width": 1.5,
        },
      },

      // Major city labels
      {
        id: "place-city", type: "symbol",
        source: src, "source-layer": "place",
        filter: ["==", ["get", "class"], "city"],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Bold", "Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 12, 10, 18, 14, 22],
          "text-max-width": 8,
          "text-padding": 6,
          "text-pitch-alignment": "viewport",
        },
        paint: {
          "text-color": p.labelPrimary,
          "text-halo-color": p.background,
          "text-halo-width": 2,
        },
      },

      // Town labels
      {
        id: "place-town", type: "symbol",
        source: src, "source-layer": "place",
        filter: ["==", ["get", "class"], "town"],
        minzoom: 8,
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular", "Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 15],
          "text-max-width": 8,
          "text-pitch-alignment": "viewport",
        },
        paint: {
          "text-color": p.labelPrimary,
          "text-halo-color": p.background,
          "text-halo-width": 2,
        },
      },

      // Village / suburb / neighbourhood labels — heavily suppressed in nav view.
      {
        id: "place-village", type: "symbol",
        source: src, "source-layer": "place",
        filter: ["in", ["get", "class"],
          ["literal", ["village", "hamlet", "suburb", "quarter", "neighbourhood"]]],
        // minzoom 17 — neighbourhood labels only appear when zoomed very close.
        minzoom: 17,
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular", "Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 17, 9, 19, 11],
          "text-max-width": 7,
          "text-pitch-alignment": "viewport",
        },
        paint: {
          "text-color": p.labelSecondary,
          "text-halo-color": p.background,
          "text-halo-width": 1.5,
          "text-opacity": 0,
        },
      },

      // Water body names
      {
        id: "water-label", type: "symbol",
        source: src, "source-layer": "water_name",
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular", "Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 14],
          "text-pitch-alignment": "viewport",
        },
        paint: {
          "text-color": p.labelWater,
          "text-halo-color": p.water,
          "text-halo-width": 2,
        },
      },

    ]; // end layers
  }

  // ---- Public API -------------------------------------------------------- //

  function getStyle(theme) {
    const t = (theme === "day") ? "day" : "night";
    return {
      version: 8,
      glyphs:  _glyphsUrl(),
      sources: {
        [SOURCE_ID]: {
          type:        "vector",
          url:         _sourceUrl(),
          attribution: ATTR,
        },
      },
      layers: _layers(t),
    };
  }

  /** Resolved sky colour for a theme — used to set #map-container background. */
  function skyColor(theme) {
    return (theme === "day") ? P.day.sky : P.night.sky;
  }

  return { getStyle, skyColor };
})();

if (typeof module !== "undefined") module.exports = NavStyle;
