/**
 * TomTom geocoding (search-by-name/address) — optional, supplementary
 * second geocoder alongside orsGeocoder.js. See src/routing/
 * activeGeocoder.js for how/when this actually gets used — unlike
 * TomTomProvider (routing), this is NOT hidden behind a dev-mode toggle:
 * it's a real, always-on fix for a real reported bug (see CLAUDE.md,
 * "Destination search misses legitimate named businesses"), not an
 * experimental swap-the-provider feature.
 *
 * Uses TomTom's Orbis Search API (`/maps/orbis/places/search/{query}.json`
 * — fuzzy search), the same Orbis product family TomTomProvider already
 * uses for routing. The exact request/response shape below was NOT
 * guessed or reconstructed from a WebFetch/WebSearch summary — this
 * sandbox can't reach developer.tomtom.com/docs.tomtom.com at all (same
 * block TomTomProvider's own header comment already documents). Instead
 * it was read directly out of TomTom's own official, npm-published
 * `@tomtom-org/maps-sdk` package (`services` sub-package — real
 * TypeScript type declarations AND the real (minified but unobfuscated
 * logic) request-building/response-parsing source, both pulled from a
 * real npm tarball, `registry.npmjs.org` being reachable even though
 * TomTom's own domains aren't). This is this project's own established
 * "verify against a real primary source, not a guess" discipline,
 * applied to a case where the usual "ask the project owner to run a real
 * curl" route (how TomTomProvider's own Orbis Routing CORS question was
 * settled) wasn't needed first, since the SDK's real source already
 * answered both the request shape AND the CORS question:
 *
 *   - Request: `GET https://api.tomtom.com/maps/orbis/places/search/
 *     {encodeURIComponent(query)}.json?apiVersion=1&key=...&limit=...
 *     &lat=...&lon=...` — confirmed directly from the SDK's own
 *     `buildRequest`/param-serialization functions, not assumed to match
 *     classic v1's `?query=`+`?lat,lon` shape (it doesn't — Orbis takes
 *     the query as a URL PATH segment, and position bias as two separate
 *     `lat`/`lon` params, not one combined string).
 *   - Response: `{ summary: {...}, results: [{ id, type, score, dist?,
 *     position: {lat, lon}, address: { freeformAddress, municipality,
 *     country, countryCode, postalCode, streetName, streetNumber, ... },
 *     poi?: { name, categories, brands, phone, url, openingHours }, ... }] }`
 *     — confirmed directly from the SDK's real `CommonSearchPlaceResultAPI`/
 *     `AddressProperties`/`SearchPlaceProps`/POI type declarations and the
 *     real result-to-GeoJSON-Feature mapping function.
 *   - CORS: the SDK's own `services` sub-package README states it's
 *     usable directly from "browser + Node.js + React Native", and its
 *     real `sendRequest` implementation for this exact endpoint is a
 *     plain `fetch(url, options)` with no CORS-proxy/backend requirement
 *     of any kind — strong, but not 100% ironclad, evidence this endpoint
 *     sends real CORS headers, the same conclusion already independently
 *     confirmed for the sibling Orbis Routing endpoint via a live device
 *     curl. Unlike that routing check, no live response headers have
 *     actually been observed for THIS endpoint yet — worth a real device
 *     test once a key is filled in, same as every other unverified fetch
 *     in this codebase; if it turns out CORS is missing here specifically,
 *     TomTom results would simply degrade to "always empty" (this file's
 *     own try/catch already treats any fetch failure that way), not break
 *     ORS's own results.
 */
const TomTomGeocoder = (() => {
  const BASE_URL     = "https://api.tomtom.com/maps/orbis/places/search";
  const TIMEOUT_MS   = 8000;
  const MIN_CHARS    = 3;
  const API_VERSION  = 1;
  const DEFAULT_LIMIT = 6;

  // 2026-09-21: `lat`/`lon` ALONE only biases ranking, it never excludes a
  // far-away match — confirmed directly from TomTom's own official,
  // npm-published `@tomtom-org/maps-sdk` source (the real request-builder
  // for this exact endpoint): a geo-bias point only confines results once
  // paired with a `radius` (metres) — "without radiusMeters the point
  // biases the ranking without restricting results; with it, results are
  // confined to that circle." Reported directly: searching a real, nearby
  // named business (a chain daycare centre in the user's own home town)
  // surfaced results in South Africa and Sheffield instead. Same fix and
  // same reasoning as OrsGeocoder.search()'s own CONFINE_RADIUS_KM — kept
  // as the identical value (in km there, metres here, per each API's own
  // units) so the two geocoders' actual search areas can't silently drift
  // apart from each other.
  const CONFINE_RADIUS_KM = 200;

  /**
   * 2026-09-21, same day: same real gap OrsGeocoder.search() fixed, for
   * the same reason — `radius` genuinely excludes, so a destination beyond
   * CONFINE_RADIUS_KM would have returned zero TomTom results too, with
   * nothing left to recover it once ORS's own identical exclusion also
   * came back empty. Retries WITHOUT `radius` (lat/lon bias only) the
   * moment a confined search returns nothing.
   *
   * @param {string} text  Free-text place/address/business-name query.
   * @param {{lat: number, lon: number}} [focus]  Both ranks results by
   *   proximity to this point AND, on the first attempt, confines them to
   *   within CONFINE_RADIUS_KM of it — same semantics as
   *   OrsGeocoder.search()'s own `focus` parameter.
   * @param {number} [limit=6]
   * @returns {Promise<Array<{label: string, lat: number, lon: number}>>}
   */
  async function search(text, focus, limit) {
    const query = (text || "").trim();
    if (query.length < MIN_CHARS) return [];

    const apiKey = CONFIG.TOMTOM_API_KEY;
    if (!apiKey) {
      // Not a warning — a blank key here is the normal, expected state
      // until the project owner fills one in (see config.js's own
      // comment); ActiveGeocoder already treats this as "TomTom simply
      // isn't consulted," not an error.
      return [];
    }

    if (focus) {
      const confined = await _fetch(query, apiKey, focus, true, limit);
      if (confined.length > 0) return confined;
      return _fetch(query, apiKey, focus, false, limit);
    }
    return _fetch(query, apiKey, null, false, limit);
  }

  async function _fetch(query, apiKey, focus, confine, limit) {
    const params = new URLSearchParams({
      apiVersion: String(API_VERSION),
      key: apiKey,
      limit: String(limit || DEFAULT_LIMIT),
    });
    if (focus) {
      params.set("lat", focus.lat);
      params.set("lon", focus.lon);
      if (confine) {
        params.set("radius", String(Math.round(CONFINE_RADIUS_KM * 1000)));
      }
    }

    const url = `${BASE_URL}/${encodeURIComponent(query)}.json?${params.toString()}`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];

      const data = await res.json();
      return (data.results || [])
        .filter(r => r.position && typeof r.position.lat === "number" && typeof r.position.lon === "number")
        .map(r => ({
          label: _labelFor(r, query),
          lat: r.position.lat,
          lon: r.position.lon,
        }));
    } catch (err) {
      clearTimeout(timer);
      console.warn("TomTomGeocoder: search failed —", err.message);
      return [];
    }
  }

  /**
   * TomTom splits a business result's own name (`poi.name`) from its
   * street address (`address.freeformAddress`) — neither alone is as
   * useful as ORS's own single combined Pelias `label` for a search
   * dropdown, so combine them the same way when a POI name exists.
   */
  function _labelFor(result, fallbackQuery) {
    const addr = (result.address && result.address.freeformAddress) || "";
    const poiName = result.poi && result.poi.name;
    if (poiName && addr) return `${poiName}, ${addr}`;
    if (poiName) return poiName;
    if (addr) return addr;
    return fallbackQuery;
  }

  return { search };
})();

if (typeof module !== "undefined") module.exports = TomTomGeocoder;
