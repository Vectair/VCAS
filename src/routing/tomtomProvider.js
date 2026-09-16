/**
 * TomTom routing provider — optional, experimental second RoutingProvider
 * implementation alongside orsProvider.js. See src/routing/
 * activeRoutingProvider.js for how/when this actually gets used (a hidden
 * dev-mode toggle; ORS is the default and the fallback on any failure).
 *
 * Uses TomTom's classic Routing API v1 (`/routing/1/calculateRoute/...`),
 * not the newer "Orbis"-branded product line — confirmed 2026-09-16 via a
 * real device curl (this sandbox's own network policy blocks
 * api.tomtom.com, so it couldn't be tested directly from here) that this
 * exact endpoint returns a working route AND a real
 * `access-control-allow-origin` header reflecting the requesting origin —
 * meaning a direct browser fetch() works with no CORS relay needed. Orbis
 * Routing wasn't independently verified and may have different CORS
 * behaviour; picked the classic endpoint because it's the one actually
 * proven to work, not because Orbis was ruled out on its merits.
 *
 * KNOWN GAP, deliberate for this first pass: `steps` is always returned
 * empty. TomTom's `guidance.instructions[]` (requested via
 * `instructionsType=text`) could supply real turn-by-turn data the same
 * way ORS's `properties.segments[].steps[]` does, but its exact field
 * names/maneuver-code vocabulary was never checked against a live
 * response with guidance actually requested — this project's own
 * discipline is to verify a schema against real execution before shipping
 * code that parses it, not reconstruct one from memory/guesswork (see
 * CLAUDE.md's relay-debugging history for exactly what happens when that
 * discipline is skipped). ManeuverTracker.nextManeuver() already degrades
 * cleanly to `{exists:false}` for an empty steps array — the guidance
 * card falls back to the camera's own geometric turn detection, the same
 * documented path ORS itself uses if its response shape is ever
 * unexpected. The point of this provider is real-time-traffic-aware
 * ETAs/route geometry, not turn-by-turn text; adding real guidance
 * parsing is a genuine, separately-scoped follow-up once a live
 * `instructionsType=text` response has actually been inspected.
 */
const TomTomProvider = (() => {
  const BASE_URL   = "https://api.tomtom.com/routing/1/calculateRoute";
  const TIMEOUT_MS = 12000;

  // TomTom's own travelMode values — https://developer.tomtom.com/routing-api/documentation/routing/calculate-route
  const TRAVEL_MODES = {
    driving: "car",
    cycling: "bicycle",
    walking: "pedestrian",
  };

  /**
   * @param {{lat: number, lon: number}} start
   * @param {{lat: number, lon: number}} end
   * @param {"driving"|"cycling"|"walking"} [mode="driving"]
   * @returns {Promise<{geometry: object, distanceMeters: number, durationSeconds: number, steps: Array}|null>}
   */
  async function getRoute(start, end, mode) {
    const apiKey = CONFIG.TOMTOM_API_KEY;
    if (!apiKey) {
      console.warn("TomTomProvider: CONFIG.TOMTOM_API_KEY not set — see config.js");
      return null;
    }

    const travelMode = TRAVEL_MODES[mode] || TRAVEL_MODES.driving;
    const url =
      `${BASE_URL}/${start.lat},${start.lon}:${end.lat},${end.lon}/json` +
      `?key=${encodeURIComponent(apiKey)}&travelMode=${travelMode}&traffic=true`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data  = await res.json();
      const route = data.routes && data.routes[0];
      if (!route || !route.summary) return null;

      // Flatten every leg's points into one [lon,lat][] array — matches
      // Geo.kt/geo.js's own [lon,lat] convention already used for route
      // geometry elsewhere in this app (RouteGeometry.nearestOnLine() etc.
      // expect coordinates in this order). A simple start/end request with
      // no intermediate waypoints always comes back as a single leg, but
      // this handles a multi-leg response correctly too rather than
      // assuming legs[0] alone.
      const coordinates = [];
      (route.legs || []).forEach(leg => {
        (leg.points || []).forEach(p => {
          if (typeof p.longitude === "number" && typeof p.latitude === "number") {
            coordinates.push([p.longitude, p.latitude]);
          }
        });
      });
      if (coordinates.length < 2) return null;

      return {
        geometry:        { type: "LineString", coordinates },
        distanceMeters:  route.summary.lengthInMeters,
        durationSeconds: route.summary.travelTimeInSeconds,
        // See this file's own header comment — deliberately empty for now.
        steps: [],
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("TomTomProvider: route request failed —", err.message);
      return null;
    }
  }

  return { getRoute };
})();

if (typeof module !== "undefined") module.exports = TomTomProvider;
