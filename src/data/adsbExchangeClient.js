/**
 * Aircraft data adapter — supports multiple ADS-B providers, round-robined
 * across whichever ones are configured (CONFIG.DATA_PROVIDERS, an array —
 * see config.js). All HTTP calls and provider-specific logic live here.
 * The rest of the app only sees normalised aircraft objects.
 *
 * Providers:
 *   "adsb_fi"         — adsb.fi free open-data API (no key required)
 *   "adsb_lol"        — ADSB.lol free open-data API (no key required —
 *                        their own docs note a future feeder-gated API key
 *                        requirement, so this may not stay true forever)
 *   "airplanes_live"  — Airplanes.live free REST API — withdrawn Aug 2026
 *                        (see git history) due to hosting costs; left wired
 *                        up in case free anonymous access ever returns, but
 *                        not in the default rotation.
 *   "adsb_exchange"   — ADS-B Exchange v2 API (requires ADSB_API_KEY)
 *
 * Splitting requests across multiple free community services (rather than
 * pointing the app's whole request volume at just one) is a deliberate
 * choice, not just redundancy — these are volunteer-funded services with
 * finite hosting budgets, and concentrating load on a single one is
 * exactly the pattern that got Airplanes.live's free tier pulled.
 */

const AdsbExchangeClient = (() => {
  let _config = null;
  let _rotationIndex = 0;

  const PROVIDERS = {
    adsb_fi: {
      // Free, no authentication. v3 endpoint, radius already in nautical
      // miles, capped at 250 (their own documented max).
      buildUrl: (lat, lon, rangeNm) =>
        `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${Math.min(rangeNm, 250)}`,
      headers: () => ({}),
      requiresKey: false,
    },
    adsb_lol: {
      // Free, no authentication (for now). v2 endpoint, radius already in
      // nautical miles, capped at 250.
      buildUrl: (lat, lon, rangeNm) =>
        `https://api.adsb.lol/v2/point/${lat}/${lon}/${Math.min(rangeNm, 250)}`,
      headers: () => ({}),
      requiresKey: false,
    },
    airplanes_live: {
      // Free, no authentication. Radius parameter is already in nautical miles.
      buildUrl: (lat, lon, rangeNm) =>
        `https://api.airplanes.live/v2/point/${lat}/${lon}/${Math.min(rangeNm, 250)}`,
      headers: () => ({}),
      requiresKey: false,
    },
    adsb_exchange: {
      buildUrl: (lat, lon, rangeNm, cfg) => {
        const rangeKm = Math.round(rangeNm * 1.852);
        return `https://${cfg.ADSB_API_HOST}/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${rangeKm}/`;
      },
      headers: (cfg) => ({ "api-auth": cfg.ADSB_API_KEY }),
      requiresKey: true,
    },
  };

  function _providerReady(id) {
    const p = PROVIDERS[id];
    if (!p) return false;
    if (p.requiresKey) return !!(_config.ADSB_API_KEY && _config.ADSB_API_HOST);
    return true;
  }

  /** Configured rotation list, filtered to known/ready provider ids. Falls
   * back to the legacy single-provider CONFIG.DATA_PROVIDER (or adsb_fi)
   * if CONFIG.DATA_PROVIDERS isn't set, so older config shapes still work. */
  function _providerList() {
    if (!_config) return [];
    // Distinguish "DATA_PROVIDERS not set at all" (fall back to the legacy
    // single-provider shape) from "set to an explicitly empty array" (means
    // no providers, on purpose) — both are falsy under a plain length check.
    const list = Array.isArray(_config.DATA_PROVIDERS)
      ? _config.DATA_PROVIDERS
      : [_config.DATA_PROVIDER || "adsb_fi"];
    return list.filter(id => PROVIDERS[id] && _providerReady(id));
  }

  function init(config) {
    _config = config;
  }

  function isConfigured() {
    return _providerList().length > 0;
  }

  async function _fetchFromProvider(id, lat, lon, rangeNm) {
    const p = PROVIDERS[id];
    const url = p.buildUrl(lat, lon, rangeNm, _config);
    const headers = p.headers(_config);

    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json", ...headers },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          return { aircraft: [], error: "auth_failed" };
        }
        return { aircraft: [], error: `http_${status}` };
      }

      const data = await response.json();
      const rawList = data.ac || data.aircraft || [];

      const aircraft = rawList
        .map(normaliseAircraft)
        .filter(Boolean);

      return { aircraft, error: null };
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return { aircraft: [], error: "timeout" };
      }
      return { aircraft: [], error: "network" };
    }
  }

  async function fetchNearby(lat, lon, rangeNm) {
    const list = _providerList();
    if (list.length === 0) {
      return { aircraft: [], error: "not_configured" };
    }

    // Round-robin: each poll tick starts with the NEXT provider in the
    // list, advancing the pointer exactly once per call regardless of how
    // many fallback attempts happen below — so a single provider having a
    // bad moment doesn't skew the long-run split away from even.
    const startIdx = _rotationIndex % list.length;
    _rotationIndex = (_rotationIndex + 1) % list.length;

    // Same-tick fallback: if this tick's provider errors, try the rest of
    // the list before giving up, so a transient failure on one doesn't
    // cost the user data for that tick.
    let lastResult = null;
    for (let i = 0; i < list.length; i++) {
      const id = list[(startIdx + i) % list.length];
      const result = await _fetchFromProvider(id, lat, lon, rangeNm);
      if (!result.error) return result;
      lastResult = result;
    }
    return lastResult;
  }

  return { init, fetchNearby, isConfigured };
})();

if (typeof module !== "undefined") module.exports = AdsbExchangeClient;
