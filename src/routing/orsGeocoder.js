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

  // 2026-09-21: `focus.point` ALONE only biases ranking, it never excludes a
  // far-away match — confirmed directly from Pelias's own real docs (ORS's
  // geocode/search endpoint is a hosted Pelias instance, same param names,
  // confirmed against GIScience/openrouteservice-py's own official client
  // source): "unlike a boundary.circle query, important results far from
  // the given coordinate may still be returned... a query for 'Paris' with
  // a focus.point in Texas [can] return both Paris, TX and Paris, France."
  // Reported directly: searching a real, nearby named business (a chain
  // daycare centre in the user's own home town) surfaced results in
  // completely different countries. Pelias's own docs recommend combining
  // focus.point with boundary.circle.* for exactly this "nearest X within
  // N km" case — CONFINE_RADIUS_KM is a reasonable starting guess for a
  // driving-nav app's realistic day-trip range (generous enough not to
  // exclude a legitimately-searched-for city a few hours away), not tuned
  // against real field data yet, same honest provenance this codebase
  // already carries for its other tuned constants (e.g. visibility.js's
  // CONTRAIL_* thresholds).
  const CONFINE_RADIUS_KM = 200;

  /**
   * 2026-09-21, same day: `boundary.circle` genuinely EXCLUDES anything
   * outside CONFINE_RADIUS_KM, not just deprioritises it — a real, direct
   * consequence of the fix above, reported immediately: "what happens if
   * I'm navigating somewhere further than 200nm away?" A destination
   * beyond ~108nm/200km would have silently returned zero results from
   * this confined query, with nothing upstream (ActiveGeocoder, TomTom's
   * own identical-radius confinement) able to recover it. Fixed by
   * retrying WITHOUT boundary.circle (focus.point bias only, the original
   * pre-fix behaviour) the moment a confined search comes back empty —
   * confined-first still solves the reported "wrong country" bug for any
   * search that has a real nearby match, and only falls back to the wider,
   * less-safe unconfined search for the genuinely rarer case where nothing
   * local exists at all, so a long-distance destination still resolves.
   */
  async function search(text, focus) {
    const query = (text || "").trim();
    if (query.length < MIN_CHARS) return [];

    const apiKey = CONFIG.ORS_API_KEY;
    if (!apiKey) {
      console.warn("OrsGeocoder: CONFIG.ORS_API_KEY not set — see config.js");
      return [];
    }

    if (focus) {
      const confined = await _fetch(query, apiKey, focus, true);
      if (confined.length > 0) return confined;
      return _fetch(query, apiKey, focus, false);
    }
    return _fetch(query, apiKey, null, false);
  }

  async function _fetch(query, apiKey, focus, confine) {
    const params = new URLSearchParams({
      api_key: apiKey,
      text: query,
      size: "6",
    });
    if (focus) {
      params.set("focus.point.lon", focus.lon);
      params.set("focus.point.lat", focus.lat);
      if (confine) {
        params.set("boundary.circle.lon", focus.lon);
        params.set("boundary.circle.lat", focus.lat);
        params.set("boundary.circle.radius", String(CONFINE_RADIUS_KM));
      }
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
