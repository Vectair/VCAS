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
 *   "adsb_exchange"   — ADS-B Exchange v2 API (requires ADSB_API_KEY)
 *
 * PERMANENTLY EXCLUDED, by explicit project-owner directive: do not add a
 * provider entry for Airplanes.live / api.airplanes.live under any
 * circumstances, even if their free tier is ever reinstated. See CLAUDE.md's
 * "ADS-B data source" section for the full history — VCAS is boycotting them
 * as an organization, not just avoiding a withdrawn free tier.
 *
 * Splitting requests across multiple free community services (rather than
 * pointing the app's whole request volume at just one) is available via
 * CONFIG.DATA_PROVIDERS but not the current default — see config.js.
 */

const AdsbExchangeClient = (() => {
  let _config = null;
  let _rotationIndex = 0;

  const PROVIDERS = {
    adsb_fi: {
      // Free, no authentication. v3 endpoint, radius already in nautical
      // miles, capped at 250 (their own documented max).
      //
      // adsb.fi's API doesn't send a CORS header, so a browser can't read
      // the response of a direct call — confirmed via a real device test
      // (the same URL works fine typed straight into a browser; only
      // VCAS's own in-page fetch() fails) and independently corroborated
      // by a Windy.com plugin-dev thread hitting the identical wall.
      // Routes through CONFIG.ADSB_RELAY_URL when set (see config.js's own
      // comment for what that is and why); falls back to calling adsb.fi
      // directly when it isn't, which still works outside a browser.
      buildUrl: (lat, lon, rangeNm, cfg) => {
        const dist = Math.min(rangeNm, 250);
        if (cfg.ADSB_RELAY_URL) {
          return `${cfg.ADSB_RELAY_URL}?lat=${lat}&lon=${lon}&dist=${dist}`;
        }
        return `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${dist}`;
      },
      headers: (cfg) => cfg.ADSB_RELAY_URL ? { "X-VCAS-Key": cfg.ADSB_RELAY_KEY } : {},
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
    const baseUrl = p.buildUrl(lat, lon, rangeNm, _config);
    const headers = p.headers(_config);

    // Cache-busting nonce (2026-09-01) — a real, reported bug: aircraft
    // plots got stuck replaying a handful of stale states, traced first to
    // sw.js's own service worker treating this cross-origin call like a
    // cacheable static CDN asset (see CLAUDE.md's "app-shell service
    // worker was silently serving stale ADS-B data" entry — fixed there),
    // but the symptom persisted for at least one tester afterward, meaning
    // some OTHER URL-keyed cache (the plain browser HTTP cache honoring
    // whatever/no Cache-Control relay.php sends, or a CDN/proxy sitting in
    // front of vectair.org's Bluehost hosting — neither controllable from
    // this repo) is very likely also caching responses by exact URL. Since
    // lat/lon repeat easily (a near-stationary phone, or watchPosition's
    // own maximumAge reusing a fix), the URL itself repeats too, and any
    // such cache would serve its old body regardless of headers or SW
    // logic on this end. Appending a per-request nonce makes the URL
    // itself always unique, which defeats any cache keyed on URL — the one
    // thing every caching layer, known or not, has in common. Does NOT
    // affect relay.php's own intentional short-lived (3s) per-location
    // cache, since that's keyed server-side off the parsed lat/lon/dist
    // values, not the raw query string.
    const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "_=" + Date.now();

    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json", ...headers },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
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
