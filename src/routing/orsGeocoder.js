/**
 * OpenRouteService geocoding (search-by-name/address) — Pelias-based,
 * https://openrouteservice.org/dev/#/api-docs/geocode/search/get
 *
 * Same CONFIG.ORS_API_KEY already used for routing (src/routing/orsProvider.js)
 * — ORS's free/Standard plan shares one key across Directions, Geocoding,
 * Isochrones, and Matrix under a combined daily quota, so this needed no
 * separate signup/key.
 */
const OrsGeocoder = (() => {
  const BASE_URL   = "https://api.openrouteservice.org/geocode/search";
  const TIMEOUT_MS = 8000;
  const MIN_CHARS  = 3; // shorter queries are mostly noise/wasted quota

  /**
   * @param {string} text  Free-text place/address query.
   * @param {{lat: number, lon: number}} [focus]  Biases ranking toward this
   *   point (does NOT filter results to a radius around it) — pass the
   *   user's own position so "the Anchor" near them outranks a same-named
   *   place on the other side of the country.
   * @returns {Promise<Array<{label: string, lat: number, lon: number}>>}
   */
  async function search(text, focus) {
    const query = (text || "").trim();
    if (query.length < MIN_CHARS) return [];

    const apiKey = CONFIG.ORS_API_KEY;
    if (!apiKey) {
      console.warn("OrsGeocoder: CONFIG.ORS_API_KEY not set — see config.js");
      return [];
    }

    const params = new URLSearchParams({
      api_key: apiKey,
      text: query,
      size: "6",
    });
    if (focus) {
      params.set("focus.point.lon", focus.lon);
      params.set("focus.point.lat", focus.lat);
    }

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE_URL}?${params.toString()}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];

      const data = await res.json();
      return (data.features || [])
        .filter(f => f.geometry && Array.isArray(f.geometry.coordinates))
        .map(f => ({
          label: (f.properties && f.properties.label) || query,
          lon: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        }));
    } catch (err) {
      clearTimeout(timer);
      console.warn("OrsGeocoder: search failed —", err.message);
      return [];
    }
  }

  return { search };
})();

if (typeof module !== "undefined") module.exports = OrsGeocoder;
