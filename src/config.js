/**
 * Eos — Global Application Configuration
 */

const CONFIG = {
  // ---- API Configurations ----
  // IMPORTANT: Replace with your restricted MapTiler browser token
  MAPTILER_KEY: "PASTE_YOUR_MAPTILER_KEY_HERE",
  
  // ---- Telemetry & Refresh Intervals ----
  REFRESH_INTERVAL_SECONDS: 10,
  REMOVE_THRESHOLD_SECONDS: 30,
  STALE_THRESHOLD_SECONDS: 15,
  
  // ---- Operational Parameters ----
  // NAV indicator count is viewport-tiered (see Indicators.capForViewportWidth),
  // not a fixed constant here.
  DEFAULT_RANGE_NM: 50,
  GPS_HEADING_MIN_SPEED_MPH: 5,
};

if (typeof module !== "undefined") module.exports = CONFIG;