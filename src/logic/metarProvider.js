/**
 * MetarProvider — fetches the nearest current METAR (aviationweather.gov,
 * free, no key) and caches it. Feeds two consumers now, deliberately kept
 * separate:
 *   1. Visibility.estimate()'s `metar` parameter (cloud-layer occlusion via
 *      the `clouds` field, reported prevailing visibility via
 *      `visibilitySm`) — the original, still-untouched purpose.
 *   2. The Weather screen (2026-09-23, see CLAUDE.md's dated entry and
 *      src/logic/metarWx.js) — a standalone cloud/visibility/present-
 *      weather report, reachable from its own top-bar icon, deliberately
 *      kept OUT of the principal RAW/Hybrid/AIR views. Reads `allClouds`
 *      (every reported layer, not just the occluding ones),
 *      `wxString` (present weather — rain/fog/snow/etc, WMO-coded), and
 *      `rawOb` (the raw METAR text, shown as-is for anyone who already
 *      reads METAR notation). No TAF, no forecast, no temp/dewpoint/
 *      pressure/wind — none of that was asked for; kept narrow on
 *      purpose, matching this project's own "don't build beyond what's
 *      asked" convention.
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
  const M_TO_FT = 3.28084;

  let _cached = null; // { stationId, visibilitySm, clouds, allClouds, wxString, rawOb, obsTime, distanceNm, elevationFt }
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
   *
   * 2026-09-02: also computes baseMslFt alongside the original baseFt
   * (kept, AGL, for backward compatibility) — METAR cloud bases are
   * reported AGL relative to the REPORTING STATION, not MSL, but aircraft
   * ADS-B altitude is MSL-referenced. Comparing them directly (what
   * visibility.js used to do) can misjudge whether a layer is actually
   * below the aircraft, especially at an elevated station. Confirmed via
   * a real documented METAR JSON example (KORD/O'Hare): `elev: 202`
   * (matches O'Hare's real ~205m/672ft elevation — 202ft would be wrong
   * for that airport, so the field is metres) and `clouds[].base: 11000`
   * matching the raw METAR text's own `BKN110` (11,000ft AGL). When
   * `elevationFt` isn't available, baseMslFt just falls back to the raw
   * AGL value — degrades gracefully rather than dropping the whole layer.
   *
   * This is Visibility.estimate()'s own OCCLUSION-only input — kept
   * exactly as-is (never touched by the 2026-09-23 weather-screen work
   * below) so that already-verified pathway can't regress. The weather
   * screen's own "every layer, for display" needs are served by
   * `_parseAllClouds` instead, a separate function reusing the same
   * per-layer math.
   */
  function _parseClouds(raw, elevationFt) {
    return _parseAllClouds(raw, elevationFt)
      .filter(l => OCCLUDING_COVERS.includes(l.cover) && l.baseFt != null);
  }

  /**
   * Every reported layer, unfiltered — including CLR/SKC/NSC/NCD/FEW/SCT,
   * which `_parseClouds` above deliberately drops since they can't occlude
   * an aircraft. Added 2026-09-23 for the Weather screen (see
   * CLAUDE.md/metarWx.js): a human-facing weather report needs to show
   * "Scattered at 3,000ft" or "Sky clear," not just whatever's relevant to
   * the sightability model. `baseFt` is `null` for the clear-sky covers
   * (CLR/SKC/NSC/NCD never report a base) — kept in the array rather than
   * dropped, since "reported clear" is itself real, displayable
   * information, unlike the occlusion path where a missing base is simply
   * unusable.
   */
  function _parseAllClouds(raw, elevationFt) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(l => l && typeof l.cover === "string")
      .map(l => {
        const baseFt = typeof l.base === "number" && Number.isFinite(l.base) ? l.base : null;
        return {
          cover: l.cover.toUpperCase(),
          baseFt,
          baseMslFt: baseFt == null ? null : baseFt + (elevationFt != null ? elevationFt : 0),
        };
      });
  }

  async function _fetchNearest(lat, lon) {
    const bbox = [
      (lat - SEARCH_RADIUS_DEG).toFixed(4),
      (lon - SEARCH_RADIUS_DEG).toFixed(4),
      (lat + SEARCH_RADIUS_DEG).toFixed(4),
      (lon + SEARCH_RADIUS_DEG).toFixed(4),
    ].join(",");

    // aviationweather.gov's API sends no Access-Control-Allow-Origin
    // header, so a browser fetch() can't read the response — the exact
    // same failure class already hit and fixed for adsb.fi (see
    // adsbExchangeClient.js / CLAUDE.md's "ADS-B data source" section).
    // Confirmed via real ground-truth log data (2026-09-01): every single
    // real "not_visible_weather" observation showed this module's
    // adjustment never having fired. Routes through CONFIG.METAR_RELAY_URL
    // when set — same shared-secret-header pattern as ADSB_RELAY_URL —
    // falling back to calling aviationweather.gov directly when it isn't
    // (works outside a browser, e.g. curl/Node, but not in the deployed
    // app until the relay is configured).
    const relayUrl = (typeof CONFIG !== "undefined" && CONFIG.METAR_RELAY_URL) ? CONFIG.METAR_RELAY_URL : "";
    const relayKey = (typeof CONFIG !== "undefined" && CONFIG.METAR_RELAY_KEY) ? CONFIG.METAR_RELAY_KEY : "";
    const url = relayUrl
      ? `${relayUrl}?bbox=${bbox}`
      : `${BASE_URL}?bbox=${bbox}&format=json`;
    const headers = relayUrl ? { "X-VCAS-Key": relayKey } : {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
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

      // aviationweather.gov reports station elevation in METRES (confirmed
      // via a real documented example — see _parseClouds's own comment).
      const elevationFt = typeof best.elev === "number" && Number.isFinite(best.elev)
        ? best.elev * M_TO_FT
        : null;

      return {
        stationId: best.icaoId || null,
        visibilitySm: _parseVisibilitySm(best.visib),
        clouds: _parseClouds(best.clouds, elevationFt),
        allClouds: _parseAllClouds(best.clouds, elevationFt),
        wxString: typeof best.wxString === "string" && best.wxString.trim() ? best.wxString.trim() : null,
        rawOb: typeof best.rawOb === "string" && best.rawOb.trim() ? best.rawOb.trim() : null,
        obsTime: best.obsTime || null,
        distanceNm: bestDistNm,
        elevationFt,
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
