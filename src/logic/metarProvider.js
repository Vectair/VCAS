/**
 * MetarProvider — fetches the nearest current METAR (aviationweather.gov,
 * free, no key) and caches it, feeding Visibility.estimate()'s optional
 * `metar` parameter: cloud-layer occlusion and reported prevailing
 * visibility, nothing else. No display surface, no TAF, no other METAR
 * fields — this exists purely to inform the existing sightability score
 * (which then drives symbology and screen priority through the pipeline
 * that already exists), per the app's own navigation+identification focus.
 *
 * Refreshed on a slow timer (METARs update roughly hourly, occasional
 * SPECI between) — refresh() is cheap to call every poll tick since it
 * internally no-ops until the interval elapses, so app.js just calls it
 * alongside the existing aircraft poll rather than needing its own timer.
 *
 * CAVEAT: this was built in a sandbox with no network path to
 * aviationweather.gov, so the parsing follows their documented JSON API
 * shape but could not be checked against a live response. Every field is
 * read defensively — missing/unexpected shapes degrade to "no METAR
 * available" (Visibility.estimate() then applies no adjustment at all),
 * never a crash or a silently wrong number — but the exact visibility
 * string format and cloud `base` units are worth confirming against a
 * real fetch once deployed.
 */
const MetarProvider = (() => {
  const BASE_URL = "https://aviationweather.gov/api/data/metar";
  const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // generous headroom under hourly METAR updates
  const SEARCH_RADIUS_DEG = 0.75; // ~45nm bbox half-width at mid-latitudes — a generous catchment for "nearest station"
  const TIMEOUT_MS = 10000;
  const OCCLUDING_COVERS = ["BKN", "OVC", "VV"];

  let _cached = null; // { stationId, visibilitySm, clouds, obsTime, distanceNm }
  let _lastFetchAt = 0;
  let _inFlight = null;

  /**
   * ORS-style defensive numeric parsing for aviationweather.gov's `visib`
   * field, which (per their docs/historical API versions) can show up as a
   * plain number, a numeric string, "10+" (at-least, many stations cap
   * their reportable value here), or a fraction/mixed-number string like
   * "1/2" or "2 1/2" for sub-mile visibility.
   */
  function _parseVisibilitySm(raw) {
    if (raw == null) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

    const s = String(raw).trim();
    if (s === "") return null;

    const plusMatch = s.match(/^(\d+(?:\.\d+)?)\+$/);
    if (plusMatch) return parseFloat(plusMatch[1]);

    const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixedMatch) {
      const whole = parseInt(mixedMatch[1], 10);
      const num = parseInt(mixedMatch[2], 10);
      const den = parseInt(mixedMatch[3], 10);
      return den !== 0 ? whole + num / den : null;
    }

    const fracMatch = s.match(/^(\d+)\/(\d+)$/);
    if (fracMatch) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      return den !== 0 ? num / den : null;
    }

    const num = parseFloat(s);
    return Number.isFinite(num) ? num : null;
  }

  /**
   * Keeps only the layer types that can meaningfully occlude — CLR/SKC
   * (no layer) and FEW/SCT (mostly-clear, per the visibility-model design
   * discussion) are dropped here rather than carried around unused.
   */
  function _parseClouds(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(l => l && typeof l.cover === "string")
      .map(l => ({
        cover: l.cover.toUpperCase(),
        baseFt: typeof l.base === "number" && Number.isFinite(l.base) ? l.base : null,
      }))
      .filter(l => OCCLUDING_COVERS.includes(l.cover) && l.baseFt != null);
  }

  async function _fetchNearest(lat, lon) {
    const bbox = [
      (lat - SEARCH_RADIUS_DEG).toFixed(4),
      (lon - SEARCH_RADIUS_DEG).toFixed(4),
      (lat + SEARCH_RADIUS_DEG).toFixed(4),
      (lon + SEARCH_RADIUS_DEG).toFixed(4),
    ].join(",");

    const url = `${BASE_URL}?bbox=${bbox}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const stations = await res.json();
      if (!Array.isArray(stations) || stations.length === 0) return null;

      let best = null, bestDistNm = Infinity;
      for (const s of stations) {
        if (typeof s.lat !== "number" || typeof s.lon !== "number") continue;
        const d = Geo.calculateDistanceNm(lat, lon, s.lat, s.lon);
        if (d < bestDistNm) { bestDistNm = d; best = s; }
      }
      if (!best) return null;

      return {
        stationId: best.icaoId || null,
        visibilitySm: _parseVisibilitySm(best.visib),
        clouds: _parseClouds(best.clouds),
        obsTime: best.obsTime || null,
        distanceNm: bestDistNm,
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("MetarProvider: fetch failed —", err.message);
      return null;
    }
  }

  /**
   * Refreshes the cache if it's stale/absent; safe to call on every poll
   * tick regardless — no-ops (returns the existing cache) well inside the
   * refresh interval, and coalesces concurrent calls onto one in-flight
   * request rather than firing duplicates.
   */
  async function refresh(lat, lon) {
    const now = Date.now();
    if (_inFlight) return _inFlight;
    if (_cached && (now - _lastFetchAt) < REFRESH_INTERVAL_MS) return _cached;
    if (lat == null || lon == null) return _cached;

    _inFlight = _fetchNearest(lat, lon).then(result => {
      _inFlight = null;
      _lastFetchAt = Date.now();
      if (result) _cached = result;
      return _cached;
    });
    return _inFlight;
  }

  /** Synchronous read of whatever's currently cached — null until the first successful refresh(). */
  function getCached() { return _cached; }

  return { refresh, getCached };
})();

if (typeof module !== "undefined") module.exports = MetarProvider;
