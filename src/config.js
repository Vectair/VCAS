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
  // Settled decision (2026-08-14): adsb.fi only. DATA_PROVIDERS is still a
  // list — src/data/adsbExchangeClient.js round-robins across whatever's
  // in it, with same-tick fallback to the rest if one errors — so adding a
  // second provider back (e.g. "adsb_lol") is just adding another id here,
  // no code change needed. Deliberately single-provider for now rather than
  // defaulting to spreading load across multiple free services: that was
  // this app's own mitigation while the data-source decision was still
  // open, not a requirement once a specific provider has been chosen.
  // See adsbExchangeClient.js's own header comment for what each provider
  // id needs (adsb_exchange requires ADSB_API_KEY/ADSB_API_HOST below; the
  // rest are free/anonymous).
  //
  // PERMANENTLY EXCLUDED, by explicit project-owner directive: never add
  // Airplanes.live back to this list under any circumstances — VCAS is
  // boycotting them as an organization, not just avoiding a withdrawn free
  // tier. See CLAUDE.md's "ADS-B data source" section for the full history.
  DATA_PROVIDERS: ["adsb_fi"],

  // adsb.fi's API doesn't send the CORS header a browser needs to read its
  // response directly — confirmed via a real device test: the exact same
  // URL works fine typed straight into a browser (proving the API and the
  // data are healthy), but VCAS's own in-page fetch() fails, because that's
  // subject to the browser's cross-origin restriction and plain navigation
  // isn't. Independently corroborated by a Windy.com plugin-dev thread
  // hitting the identical wall with adsb.fi and concluding a browser-side
  // integration wasn't feasible. Routes adsb_fi's requests through a small
  // server-side relay (deploy/adsb-relay.php, not committed to this repo —
  // handed to the project owner directly, same pattern as LOG_ENDPOINT
  // below) when set — the relay does the actual request server-to-server,
  // which isn't subject to the browser restriction, and returns the result
  // with the header VCAS's browser needs. Leave both blank to fall back to
  // calling adsb.fi directly, which still works outside a browser context
  // (e.g. curl/Node) but will fail with a generic "network" error in the
  // deployed app until the relay is set up.
  ADSB_RELAY_URL: "",
  ADSB_RELAY_KEY: "",

  // ---- Telemetry & Refresh Intervals ----
  // adsb.fi's public endpoint is rate-limited to 1 request/second; 3s
  // leaves generous headroom below that ceiling for a single client while
  // cutting worst-case "aircraft already climbed hundreds of feet before it
  // appears" lag by more than 3x versus the original 10s interval.
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