/**
 * LocalObstruction — coarse "how built-up/wooded is my immediate area"
 * signal, queried from the map's own already-loaded building/landcover
 * vector-tile data (see EosMap.queryLocalDensity(), src/map.js) and fed
 * into Visibility.estimate()'s optional `localObstruction` parameter:
 * low-elevation aircraft score lower when the observer is somewhere dense.
 * No display surface of its own — same "scoring input only" discipline
 * already established for MetarProvider.
 *
 * Deliberately non-directional and coarse — this answers "is the observer's
 * immediate area generally hostile to spotting low-angle traffic," not
 * "is a specific building on this specific bearing." See visibility.js's
 * own comment on _applyLocalObstructionAdjustment() for how the result is
 * actually used.
 *
 * Refresh is movement-triggered, not timer-driven — local building/
 * vegetation density around the observer doesn't change meaningfully
 * while stationary or crawling, so there's no reason to re-query on a
 * fixed interval the way MetarProvider's real weather data needs to.
 * refresh() is cheap to call on every poll tick regardless (mirrors
 * MetarProvider's own "safe to call every tick, internally no-ops"
 * contract) — it only actually re-queries once the observer has moved
 * far enough, or the cached result is old enough to distrust.
 */
const LocalObstruction = (() => {
  const QUERY_RADIUS_M = 500;             // reasonable range 250-750m — see visibility.js's own tuned-constants comment
  const MOVEMENT_REFRESH_THRESHOLD_M = 150; // re-query once moved this far from the last query point
  const MAX_AGE_MS = 60 * 1000;             // time-based fallback, guards a stuck/error state

  let _cached = null;        // { buildingDensity, vegetationDensity, combinedDensity, radiusM, ... } | null
  let _lastQueryLat = null;
  let _lastQueryLon = null;
  let _lastQueryAt = 0;

  function _shouldRefresh(lat, lon) {
    const now = Date.now();
    if (_lastQueryLat == null) return true; // never queried yet
    if (now - _lastQueryAt >= MAX_AGE_MS) return true;
    const movedM = Geo.calculateDistanceMeters(_lastQueryLat, _lastQueryLon, lat, lon);
    return movedM >= MOVEMENT_REFRESH_THRESHOLD_M;
  }

  /**
   * Re-queries local density if the observer has moved far enough (or the
   * cached result is stale) since the last query — safe to call on every
   * poll tick regardless, same contract as MetarProvider.refresh().
   *
   * @param {object} map  EosMap — must expose queryLocalDensity(lat, lon, radiusM).
   *   Unlike MetarProvider (a pure network fetch, no DOM dependency), this
   *   module genuinely needs the live map instance, so it's passed in
   *   rather than imported — matches how app.js already threads EosMap
   *   through everywhere else it's needed.
   */
  function refresh(map, lat, lon) {
    if (lat == null || lon == null || !map) return _cached;
    if (!_shouldRefresh(lat, lon)) return _cached;

    _lastQueryLat = lat;
    _lastQueryLon = lon;
    _lastQueryAt = Date.now();

    // queryLocalDensity() itself is synchronous (it only reads already-
    // loaded tile data via querySourceFeatures(), no network call of its
    // own) — no async/await needed here, unlike MetarProvider's real fetch.
    let result;
    try {
      result = map.queryLocalDensity(lat, lon, QUERY_RADIUS_M);
    } catch (e) {
      result = null;
    }

    // A failed/unavailable query must resolve to "no data," never to a
    // default density value — anything that silently read a failure as
    // "confirmed open terrain" would make traffic look easier to see
    // exactly when this module knows the least, which is backwards. Only
    // overwrite the cache on a genuinely successful result; on failure,
    // simply leave `_cached` untouched — still null if nothing has ever
    // succeeded, or still the last known-good value if one exists (a
    // transient query hiccup shouldn't discard a still-probably-valid
    // recent read). Never assign a default/fallback density here.
    if (result) _cached = result;

    return _cached;
  }

  /** Synchronous read of whatever's currently cached — null until the
   * first successful refresh(), or if every query so far has failed. */
  function getCached() { return _cached; }

  return { refresh, getCached };
})();

if (typeof module !== "undefined") module.exports = LocalObstruction;
