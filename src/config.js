const CONFIG = {
  // MapTiler vector basemap — required for navigation map rendering
  MAPTILER_KEY: "IIq8EPZSZfg9swGWgqbH",

  // "airplanes_live" (free, no key) | "adsb_exchange" (requires API key)
  DATA_PROVIDER: "airplanes_live",

  // ADS-B Exchange — only needed when DATA_PROVIDER is "adsb_exchange"
  ADSB_API_KEY: "",
  ADSB_API_HOST: "adsbexchange.com",

  DEFAULT_RANGE_NM: 20,
  REFRESH_INTERVAL_SECONDS: 10,
  MAX_AIRCRAFT_SHOWN: 8,
  VISIBILITY_MODE: "clear_flat_day",
  MIN_LABEL_VISIBILITY_SCORE: 30,

  // Data freshness threshold in seconds
  STALE_THRESHOLD_SECONDS: 20,
  REMOVE_THRESHOLD_SECONDS: 60,

  // Minimum speed (mph) before we use GPS heading over compass
  GPS_HEADING_MIN_SPEED_MPH: 5,
};

if (typeof module !== "undefined") module.exports = CONFIG;
