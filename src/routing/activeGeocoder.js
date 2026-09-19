/**
 * ActiveGeocoder — merges OrsGeocoder (Pelias) with TomTomGeocoder as a
 * supplementary fallback. This is the one place app.js's
 * _searchDestination() calls, instead of a hardcoded OrsGeocoder
 * reference — mirroring the ActiveRoutingProvider dispatcher pattern
 * already established for routing, but a genuinely different shape of
 * problem, not a copy-paste of it:
 *
 * ActiveRoutingProvider SWAPS which provider is primary (a user-selected,
 * dev-mode-gated preference — ORS vs TomTom, mutually exclusive per
 * request). ActiveGeocoder never swaps anything — ORS/Pelias stays the
 * permanent, always-queried primary, and TomTom is purely ADDITIVE: it's
 * only ever consulted to supplement a weak ORS result set, and its
 * results are MERGED with ORS's own rather than replacing them. There is
 * no user-facing toggle and no dev-mode gate — this exists to fix a real,
 * reported usability bug (see CLAUDE.md, "Destination search misses
 * legitimate named businesses" — a real national-chain daycare centre in
 * Formby that ORS's own Pelias geocoder simply had no data for), not to
 * offer an experimental alternative a user might opt into.
 *
 * Real root cause this exists to paper over: ORS's Pelias geocoder is
 * strong for street addresses (OpenAddresses/WhosOnFirst/GeoNames-backed)
 * but comparatively weak for named businesses/POIs, since that data comes
 * from manual OpenStreetMap tagging — patchy, especially for individual
 * branches of national chains. TomTom's own Search index (a licensed
 * commercial POI dataset, not OSM-derived) covers a materially different,
 * often better, set of named businesses — querying it too when ORS comes
 * back thin is a real, direct fix for that specific gap, not a general
 * "more geocoders is better" idea.
 */
const ActiveGeocoder = (() => {
  // "returns nothing (or too little)" per the project owner's own framing
  // when this fix was scoped — fewer than this many ORS results is judged
  // "too little" and TomTom gets consulted too. Not tuned against real
  // field data yet, same honest "reasonable starting guess" provenance
  // this codebase already carries for several of its own tuned constants
  // (e.g. visibility.js's CONTRAIL_* thresholds) — worth revisiting once
  // there's a real sense of how often this actually triggers.
  const MERGE_THRESHOLD = 3;

  // A TomTom result within this real ground distance of an ORS result is
  // treated as the same place and dropped, rather than shown twice.
  const DEDUPE_DISTANCE_M = 120;

  const MAX_MERGED_RESULTS = 8;

  /**
   * @param {string} text
   * @param {{lat: number, lon: number}} [focus]
   * @returns {Promise<Array<{label: string, lat: number, lon: number}>>}
   */
  async function search(text, focus) {
    const orsResults = await OrsGeocoder.search(text, focus);

    const tomtomConfigured = !!(typeof CONFIG !== "undefined" && CONFIG.TOMTOM_API_KEY);
    if (!tomtomConfigured || orsResults.length >= MERGE_THRESHOLD) {
      return orsResults;
    }

    const tomtomResults = await TomTomGeocoder.search(text, focus);
    if (tomtomResults.length === 0) return orsResults;

    const merged = orsResults.slice();
    for (const candidate of tomtomResults) {
      if (!_isDuplicate(candidate, merged)) merged.push(candidate);
    }
    return merged.slice(0, MAX_MERGED_RESULTS);
  }

  function _isDuplicate(candidate, existing) {
    return existing.some(r => {
      // Geo is already loaded (geo.js is one of the first script tags in
      // index.html, well ahead of this file) — same "read a shared global
      // rather than reimplementing distance math a third time" pattern
      // visibility.js/relevance.js already establish for this exact
      // function.
      const distM = Geo.calculateDistanceMeters(r.lat, r.lon, candidate.lat, candidate.lon);
      return distM <= DEDUPE_DISTANCE_M;
    });
  }

  return { search };
})();

if (typeof module !== "undefined") module.exports = ActiveGeocoder;
