/**
 * Eos — Global Application Configuration
 */

const CONFIG = {
  // ---- API Configurations ----
  // IMPORTANT: Replace with your restricted MapTiler browser token
  MAPTILER_KEY: "IIq8EPZSZfg9swGWgqbH",
  // Free OpenRouteService "Standard" API key — https://openrouteservice.org/dev/#/home
  ORS_API_KEY: "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjM1NzZmMDA4Nzc2OTQ3YzdiYjcwZWFjYzIzMDgwYTIwIiwiaCI6Im11cm11cjY0In0=",

  // ---- ADS-B data provider(s) ----
  // Round-robined by src/data/adsbExchangeClient.js — each poll tick uses
  // the next provider in this list, with same-tick fallback to the rest if
  // one errors. Splitting requests across multiple free community services,
  // rather than pointing the app's whole request volume at just one, is
  // deliberate: these are volunteer-funded services with finite hosting
  // budgets, and concentrating load on a single one is exactly what got
  // Airplanes.live's free anonymous API withdrawn (Aug 2026 — see git
  // history/README). "airplanes_live" is left wired up in
  // adsbExchangeClient.js in case free access ever returns, but isn't in
  // this default rotation. See adsbExchangeClient.js's own header comment
  // for what each provider id needs (adsb_exchange requires ADSB_API_KEY/
  // ADSB_API_HOST below; the rest are free/anonymous).
  DATA_PROVIDERS: ["adsb_fi", "adsb_lol"],

  // ---- Telemetry & Refresh Intervals ----
  // adsb.fi and ADSB.lol are each individually rate-limited to ~1 request/
  // second; round-robining the two above already halves what either one
  // sees from this single client (a request every ~6s per provider, not
  // every 3s), well below that ceiling, while still cutting worst-case
  // "aircraft already climbed hundreds of feet before it appears" lag by
  // more than 3x versus the original 10s interval.
  REFRESH_INTERVAL_SECONDS: 3,
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
  // over-suppress.
  // Defaults to OFF (show everything) now that manual control exists — the
  // ALT button (bottom-left, src/altitudeSuppressPanel.js) overrides both
  // live, persisted in localStorage, so day-to-day adjustment doesn't need
  // a config edit/redeploy. A hardcoded-on default turned out to actively
  // hide exactly the close/low traffic (e.g. departures) this app exists to
  // surface; better to let it be an opt-in choice. Change these two only to
  // shift the app's out-of-the-box starting state.
  SUPPRESS_LOW_ALTITUDE_ENABLED: false,
  SUPPRESS_LOW_ALTITUDE_FT: 500,

  // ---- Central Observation Log ----
  // Ground-truth "was this actually visible" log (src/dev/observationLogger.js,
  // logged via the dev LOG panel/popup buttons). Points at a real internet
  // endpoint so every device — phone, PC, whatever — logs to the SAME place
  // automatically, instead of each device only having its own local
  // logServer.py / localStorage fallback. Leave blank ("") to fall back to
  // the old relative "/api/log" behaviour (only works when running
  // logServer.py locally) — useful for local dev without touching this file.
  //
  // LOG_ENDPOINT_KEY is sent as the X-VCAS-Key header on every request. It's
  // NOT a real secret — this is a static site, so anything here ships to
  // every visitor's browser and can be read from the deployed JS. Treat it
  // as a low-effort deterrent against random bots hitting the endpoint
  // blindly, not as actual access control; the endpoint's own server-side
  // logic is what should enforce anything that actually matters.
  LOG_ENDPOINT: "",
  LOG_ENDPOINT_KEY: "",
};

if (typeof module !== "undefined") module.exports = CONFIG;