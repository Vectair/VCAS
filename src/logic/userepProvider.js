/**
 * UserepProvider — the relay client/cache for USEREP (user-submitted local
 * weather reports, see CLAUDE.md's dated entry and src/logic/userep.js for
 * the shared vocab/pure helpers). Two jobs:
 *
 *   1. refresh(lat, lon) — queries the relay for every active report within
 *      Userep.RADIUS_MILES/MAX_AGE_MINUTES of the CURRENT position, caches
 *      the single most recent one (Userep.pickFreshest()) via
 *      Visibility.estimate()'s own downstream `userep` parameter.
 *   2. submit(lat, lon, sky, cloudHeight, visibility, phenomena) — POSTs a
 *      new report, so OTHER nearby VCAS users can see it too (direct
 *      instruction: "Shared with nearby users now," not local-device-only)
 *      — and optimistically updates the local cache immediately on success,
 *      so the submitting user's own model reflects it right away rather
 *      than waiting for the next scheduled refresh().
 *
 * Refresh is BOTH movement- and time-triggered — mirrors LocalObstruction's
 * own "re-query once moved far enough, or stale enough to distrust"
 * pattern (a 5-mile query radius is a real, meaningfully large area to
 * outrun by driving, unlike a fixed weather station's own catchment), with
 * a MetarProvider-style time fallback on top since — unlike local building/
 * vegetation density — OTHER users can add a new nearby report at any
 * moment even while this device stays perfectly still.
 *
 * Same "no CORS header, needs a relay" situation as adsb.fi/
 * aviationweather.gov (see ADSB_RELAY_URL/METAR_RELAY_URL in config.js) —
 * this relay (userep-relay/relay.php, not committed to this repo, same
 * handoff pattern as every other relay in this project) is a genuinely NEW
 * piece of infrastructure though, not a pass-through proxy: it's the first
 * relay in this project that both STORES data (a flat-file report store,
 * pruned lazily on every request since there's no cron on this shared
 * hosting) and answers a location-based QUERY ("what's within 5 miles/30
 * minutes of here"), not just a single upstream pass-through with a short
 * local cache. See the relay's own header comment for the CORS-preflight
 * discipline (this project has hit that exact bug three separate times
 * already, per CLAUDE.md's "Relay ledger update follow-up" entries — built
 * correctly from the start here).
 */
const UserepProvider = (() => {
  const REFRESH_INTERVAL_MS = 60 * 1000; // real reports from other users can appear anytime — more responsive than METAR's own 15min interval
  const MOVEMENT_REFRESH_THRESHOLD_M = 1609; // ~1 mile — re-query once moved far enough that the 5-mile catchment has meaningfully shifted
  const TIMEOUT_MS = 10000;

  let _cached = null; // { id, lat, lon, sky, cloudHeight, visibility, phenomena, submittedAt } | null
  let _lastQueryLat = null;
  let _lastQueryLon = null;
  let _lastQueryAt = 0;
  let _inFlight = null;

  function _relayConfig() {
    const url = (typeof CONFIG !== "undefined" && CONFIG.USEREP_RELAY_URL) ? CONFIG.USEREP_RELAY_URL : "";
    const key = (typeof CONFIG !== "undefined" && CONFIG.USEREP_RELAY_KEY) ? CONFIG.USEREP_RELAY_KEY : "";
    return { url, key };
  }

  function _shouldRefresh(lat, lon) {
    const now = Date.now();
    if (_lastQueryLat == null) return true; // never queried yet
    if (now - _lastQueryAt >= REFRESH_INTERVAL_MS) return true;
    const movedM = Geo.calculateDistanceMeters(_lastQueryLat, _lastQueryLon, lat, lon);
    return movedM >= MOVEMENT_REFRESH_THRESHOLD_M;
  }

  async function _query(lat, lon) {
    const { url, key } = _relayConfig();
    if (!url) return null; // not configured — no fallback direct call: this store only exists on the relay, there's nothing to call directly

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${url}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
        headers: { "X-VCAS-Key": key },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || body.ok !== true || !Array.isArray(body.reports)) return null;
      return body.reports;
    } catch (err) {
      clearTimeout(timer);
      console.warn("UserepProvider: query failed —", err.message);
      return null;
    }
  }

  /**
   * Re-queries the relay if the observer has moved far enough (or the
   * cached result is stale enough) since the last query — safe to call on
   * every poll tick regardless, same contract MetarProvider/
   * LocalObstruction's own refresh() already establish.
   */
  async function refresh(lat, lon) {
    if (lat == null || lon == null) return getCached();
    if (_inFlight) return _inFlight;
    if (!_shouldRefresh(lat, lon)) return getCached();

    _inFlight = _query(lat, lon).then((reports) => {
      _inFlight = null;
      _lastQueryLat = lat;
      _lastQueryLon = lon;
      _lastQueryAt = Date.now();
      // A failed query leaves the existing cache untouched (never a
      // default/fallback value) — same "absence of data must never itself
      // change a score" discipline LocalObstruction already establishes.
      // A SUCCESSFUL query with zero nearby reports is real information
      // though (genuinely nothing active nearby right now), so it
      // correctly clears any previously-cached report.
      if (reports !== null) {
        _cached = Userep.pickFreshest(reports);
      }
      return getCached();
    });
    return _inFlight;
  }

  /**
   * Synchronous read of whatever's currently cached — re-validates its own
   * age against Userep.MAX_AGE_MINUTES on every call (not just at fetch
   * time), so a report that's crossed the 30-minute mark since the last
   * successful refresh() is never handed to Visibility.estimate() even if
   * the next scheduled refresh (every REFRESH_INTERVAL_MS) hasn't run yet
   * — a cheap, no-network safety net against briefly serving an expired
   * report, not a correctness requirement the relay's own query filter
   * doesn't already enforce for anything freshly fetched.
   */
  function getCached() {
    if (!_cached) return null;
    if (Userep.ageMinutes(_cached) > Userep.MAX_AGE_MINUTES) {
      _cached = null;
      return null;
    }
    return _cached;
  }

  /**
   * Submits a new report — the actual USEREP write path. Returns the
   * server's own stored report object on success (server-stamped
   * submittedAt, server-assigned id) or null on any failure (network,
   * validation, timeout) — the caller (app.js's submission form) is
   * responsible for showing the user whichever outcome this resolves to,
   * this function itself never throws.
   *
   * Optimistically updates the local cache to the just-submitted report
   * immediately on success — the SAME report this device would otherwise
   * only see on its own NEXT scheduled refresh() — so the submitting
   * user's own visibility model reflects their own report right away.
   * (It's always at least as fresh as anything else that could currently
   * be cached, being brand new, so this can never regress an already-
   * fresher cached report from another nearby user.)
   */
  async function submit(lat, lon, sky, cloudHeight, visibility, phenomena) {
    const { url, key } = _relayConfig();
    if (!url) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "X-VCAS-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, sky, cloudHeight, visibility, phenomena }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || body.ok !== true || !body.report) return null;
      _cached = body.report;
      return body.report;
    } catch (err) {
      clearTimeout(timer);
      console.warn("UserepProvider: submit failed —", err.message);
      return null;
    }
  }

  return { refresh, getCached, submit };
})();

if (typeof module !== "undefined") module.exports = UserepProvider;
