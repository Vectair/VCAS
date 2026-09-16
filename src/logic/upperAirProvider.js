/**
 * UpperAirProvider — fetches Open-Meteo's forecast-model cloud-cover-by-
 * altitude-band data (free, no key) for the user's own position, feeding
 * Visibility.estimate()'s optional `upperAir` parameter. Exists to close
 * a real, previously-documented gap in the METAR-based adjustment (see
 * visibility.js's `_applyMetarAdjustment()` — "KNOWN GAP" comment, and
 * CLAUDE.md's own "Visibility model calibration pass #2" writeup): METAR
 * only actually characterizes the surface-to-~5,000ft column, so "no
 * cloud reported" was silently being read as "confirmed clear to the
 * aircraft's altitude" even for a jet at FL320 that could be sitting
 * above a real but unreported mid/upper-level deck. This module answers
 * a coarser, honest question instead: "how cloudy is the regional
 * forecast model's own low/mid/high altitude band, right here" — nothing
 * more; no display surface, no forecast UI, same "scoring input only"
 * discipline MetarProvider/LocalObstruction already establish.
 *
 * Unlike aviationweather.gov (METAR) and adsb.fi, Open-Meteo's own server
 * genuinely sends `Access-Control-Allow-Origin: *` — confirmed directly
 * from their real, current server source (open-meteo/open-meteo,
 * Sources/App/configure.swift: `CORSMiddleware.Configuration(allowedOrigin:
 * .all, ...)`), not assumed or taken from a secondhand summary the way
 * this was first flagged in CLAUDE.md. This means, uniquely among every
 * external data source this app uses, NO CORS relay is needed at all —
 * fetch() calls it directly from the browser.
 *
 * Refreshed on the same slow timer METAR already uses (regional forecast-
 * model cloud data doesn't meaningfully change faster than that either) —
 * refresh() is cheap to call every poll tick since it internally no-ops
 * until the interval elapses, matching MetarProvider's own contract.
 *
 * Band split (UPPER_AIR_LOW_BAND_MAX_AGL_FT / UPPER_AIR_MID_BAND_MAX_AGL_FT
 * in visibility.js) is the standard WMO-style low/mid/high cloud
 * classification (~2km / ~7km) — a real industry convention, but not
 * verified against the exact pressure-level cutoff whichever specific
 * model backs a given Open-Meteo response actually uses (their `best_match`
 * selection can pick different regional models depending on location) —
 * treat as a reasonable approximation, not an exact figure, same honesty-
 * about-provenance this file's own tuned constants already carry.
 *
 * CAVEAT, same as MetarProvider's own: built in a sandbox with no network
 * path to api.open-meteo.com, so parsing follows their real, current
 * OpenAPI spec (open-meteo/open-meteo repo, openapi/forecast.yml — cloned
 * and read directly, not guessed) but could not be checked against a live
 * response. Every field is read defensively — missing/unexpected shapes
 * degrade to "no upper-air data available" (Visibility.estimate() then
 * applies no adjustment at all), never a crash or a silently wrong number.
 */
const UpperAirProvider = (() => {
  const BASE_URL = "https://api.open-meteo.com/v1/forecast";
  const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // same cadence as MetarProvider — see its own comment
  const TIMEOUT_MS = 10000;
  const M_TO_FT = 3.28084;

  let _cached = null; // { cloudCoverLowPct, cloudCoverMidPct, cloudCoverHighPct, elevationFt, obsTime }
  let _lastFetchAt = 0;
  let _inFlight = null;
  let _lastFetchOk = null; // null = never attempted; true/false = outcome of the most recent attempt

  /**
   * The real `current` query parameter's own enum (confirmed directly
   * against the live OpenAPI spec) does NOT include cloud_cover_low/mid/
   * high — only the single combined `cloud_cover` figure. Those three
   * band-specific fields only exist in the `hourly` response, so this
   * requests a small window around "now" (one hour back, one forward)
   * and picks whichever entry's own timestamp is closest to the current
   * time, rather than assuming a fixed array index lines up with "now" —
   * robust to whatever exact hour-boundary convention the API uses,
   * which this sandbox has no way to confirm against a live response.
   */
  function _requestUrl(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: "cloud_cover_low,cloud_cover_mid,cloud_cover_high",
      past_hours: "1",
      forecast_hours: "2",
      timezone: "UTC",
      timeformat: "unixtime",
    });
    return `${BASE_URL}?${params.toString()}`;
  }

  function _closestHourIndex(times, nowSec) {
    if (!Array.isArray(times) || times.length === 0) return -1;
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (typeof t !== "number") continue;
      const diff = Math.abs(t - nowSec);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return bestIdx;
  }

  async function _fetchForLocation(lat, lon) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(_requestUrl(lat, lon), { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const body = await res.json();
      const hourly = body && body.hourly;
      if (!hourly || !Array.isArray(hourly.time)) return null;

      const idx = _closestHourIndex(hourly.time, Math.floor(Date.now() / 1000));
      if (idx < 0) return null;

      const low = Array.isArray(hourly.cloud_cover_low) ? hourly.cloud_cover_low[idx] : null;
      const mid = Array.isArray(hourly.cloud_cover_mid) ? hourly.cloud_cover_mid[idx] : null;
      const high = Array.isArray(hourly.cloud_cover_high) ? hourly.cloud_cover_high[idx] : null;

      // Open-Meteo reports elevation in METRES (confirmed via the real
      // OpenAPI spec's own response schema — `elevation` is a plain
      // top-level field, same unit convention aviationweather.gov's METAR
      // API uses for station elevation, per metarProvider.js's own
      // real-example confirmation).
      const elevationFt = typeof body.elevation === "number" && Number.isFinite(body.elevation)
        ? body.elevation * M_TO_FT
        : null;

      return {
        cloudCoverLowPct: typeof low === "number" && Number.isFinite(low) ? low : null,
        cloudCoverMidPct: typeof mid === "number" && Number.isFinite(mid) ? mid : null,
        cloudCoverHighPct: typeof high === "number" && Number.isFinite(high) ? high : null,
        elevationFt,
        obsTime: hourly.time[idx],
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("UpperAirProvider: fetch failed —", err.message);
      return null;
    }
  }

  /**
   * Refreshes the cache if it's stale/absent; safe to call on every poll
   * tick regardless — no-ops (returns the existing cache) well inside the
   * refresh interval, and coalesces concurrent calls onto one in-flight
   * request rather than firing duplicates. Same shape as MetarProvider's
   * own refresh().
   */
  async function refresh(lat, lon) {
    const now = Date.now();
    if (_inFlight) return _inFlight;
    if (_cached && (now - _lastFetchAt) < REFRESH_INTERVAL_MS) return _cached;
    if (lat == null || lon == null) return _cached;

    _inFlight = _fetchForLocation(lat, lon).then(result => {
      _inFlight = null;
      _lastFetchAt = Date.now();
      _lastFetchOk = !!result;
      if (result) _cached = result;
      return _cached;
    });
    return _inFlight;
  }

  /** Synchronous read of whatever's currently cached — null until the first successful refresh(). */
  function getCached() { return _cached; }

  /**
   * "active" if the most recent real fetch attempt succeeded, "stale"
   * otherwise (never attempted, or that attempt failed — even if an older
   * cached value is still being served, per refresh()'s own "a failed
   * fetch doesn't clear the cache" behaviour). Same two-state vocabulary
   * UI.setAdsbStatus()'s dot already uses — drives #upper-air-status the
   * same way (this module's own real status pill; MetarProvider's
   * equivalent method/pill were both removed 2026-09-08 once this pill
   * took over as the app's weather-status indicator).
   */
  function getStatus() {
    return _lastFetchOk ? "active" : "stale";
  }

  return { refresh, getCached, getStatus };
})();

if (typeof module !== "undefined") module.exports = UpperAirProvider;
