/**
 * Aircraft data adapter — supports multiple ADS-B providers.
 * All HTTP calls and provider-specific logic live here.
 * The rest of the app only sees normalised aircraft objects.
 *
 * Providers:
 *   "airplanes_live"  — Airplanes.live free REST API (no key required)
 *   "adsb_exchange"   — ADS-B Exchange v2 API (requires ADSB_API_KEY)
 *
 * Select via CONFIG.DATA_PROVIDER.
 */

const AdsbExchangeClient = (() => {
  let _config = null;

  const PROVIDERS = {
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

  function _provider() {
    return _config?.DATA_PROVIDER || "airplanes_live";
  }

  function init(config) {
    _config = config;
  }

  function isConfigured() {
    if (!_config) return false;
    const p = PROVIDERS[_provider()];
    if (!p) return false;
    if (p.requiresKey) return !!((_config.ADSB_API_KEY && _config.ADSB_API_HOST));
    return true;
  }

  async function fetchNearby(lat, lon, rangeNm) {
    if (!isConfigured()) {
      return { aircraft: [], error: "not_configured" };
    }

    const p = PROVIDERS[_provider()];
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

  return { init, fetchNearby, isConfigured };
})();

if (typeof module !== "undefined") module.exports = AdsbExchangeClient;
