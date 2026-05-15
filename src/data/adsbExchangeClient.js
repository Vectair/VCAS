/**
 * ADS-B Exchange data adapter.
 * All HTTP calls and API-specific logic live here.
 * The rest of the app only sees normalised aircraft objects.
 */

const AdsbExchangeClient = (() => {
  let _config = null;

  function init(config) {
    _config = config;
  }

  function isConfigured() {
    return _config && _config.ADSB_API_KEY && _config.ADSB_API_HOST;
  }

  async function fetchNearby(lat, lon, rangeNm) {
    if (!isConfigured()) {
      return { aircraft: [], error: "not_configured" };
    }

    // ADS-B Exchange v2 radius endpoint
    const rangeKm = Math.round(rangeNm * 1.852);
    const url = `https://${_config.ADSB_API_HOST}/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${rangeKm}/`;

    try {
      const response = await fetch(url, {
        headers: {
          "api-auth": _config.ADSB_API_KEY,
          "Accept": "application/json",
        },
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
