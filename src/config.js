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
  // How long a manually-suppressed aircraft (via the popup's Suppress button)
  // stays hidden from NAV indicators before becoming eligible again.
  SUPPRESS_DURATION_SECONDS: 180,

  // ---- Ground/Low-Altitude Clutter Suppression ----
  // Similar to a TCAS altitude filter — hides aircraft below a fixed height
  // so busy airports don't flood the display with taxiing/ground traffic.
  // IMPORTANT CAVEAT: aircraft altitude from ADS-B is barometric (above sea
  // level), not height above YOUR position. There's no terrain/elevation
  // data source in this app, so this is a sea-level-referenced cutoff, not
  // true "above ground" — near a high-elevation airport it may under- or
  // over-suppress. Adjust SUPPRESS_LOW_ALTITUDE_FT for your region if
  // needed, or set SUPPRESS_LOW_ALTITUDE_ENABLED to false to see everything.
  SUPPRESS_LOW_ALTITUDE_ENABLED: true,
  SUPPRESS_LOW_ALTITUDE_FT: 500,
};

if (typeof module !== "undefined") module.exports = CONFIG;