/**
 * OpenRouteService routing provider.
 * https://openrouteservice.org
 *
 * Replaces OsrmProvider — the OSRM public demo server only serves a
 * "driving" profile, whereas ORS's free Standard API key covers driving,
 * cycling, and walking through the same endpoint (just a different profile
 * segment in the URL), which is what a "route on foot at Gatwick" test
 * actually needs.
 */
const OrsProvider = (() => {
  const BASE_URL   = "https://api.openrouteservice.org/v2/directions";
  const TIMEOUT_MS = 12000;

  const PROFILES = {
    driving: "driving-car",
    cycling: "cycling-regular",
    walking: "foot-walking",
  };

  /**
   * @param {{lat: number, lon: number}} start
   * @param {{lat: number, lon: number}} end
   * @param {"driving"|"cycling"|"walking"} [mode="driving"]
   * @returns {Promise<{geometry: object, distanceMeters: number, durationSeconds: number}|null>}
   */
  async function getRoute(start, end, mode) {
    const apiKey = CONFIG.ORS_API_KEY;
    if (!apiKey) {
      console.warn("OrsProvider: CONFIG.ORS_API_KEY not set — see config.js");
      return null;
    }

    const profile = PROFILES[mode] || PROFILES.driving;
    const url =
      `${BASE_URL}/${profile}?api_key=${encodeURIComponent(apiKey)}` +
      `&start=${start.lon},${start.lat}&end=${end.lon},${end.lat}`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data    = await res.json();
      const feature = data.features && data.features[0];
      if (!feature) return null;

      const summary = feature.properties.summary;
      // Turn-by-turn steps, when ORS includes them — properties.segments is
      // one entry per requested leg (always one leg here, a single start/end
      // pair), each with its own .steps[] array. See maneuverTracker.js for
      // how these get turned into the guidance card's live instruction.
      // Defensive: an unexpected/older response shape just yields no steps,
      // not a crash — the guidance card falls back to its own geometry-only
      // detection when that happens.
      const segments = feature.properties.segments;
      const steps = (Array.isArray(segments) && segments[0] && Array.isArray(segments[0].steps))
        ? segments[0].steps
        : [];

      return {
        geometry:        feature.geometry, // GeoJSON LineString
        distanceMeters:  summary.distance,
        durationSeconds: summary.duration,
        steps,
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("OrsProvider: route request failed —", err.message);
      return null;
    }
  }

  return { getRoute };
})();

if (typeof module !== "undefined") module.exports = OrsProvider;
