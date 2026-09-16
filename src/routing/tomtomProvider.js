/**
 * TomTom routing provider — optional, experimental second RoutingProvider
 * implementation alongside orsProvider.js. See src/routing/
 * activeRoutingProvider.js for how/when this actually gets used (a hidden
 * dev-mode toggle; ORS is the permanent default, and the fallback for
 * every mode this provider can't or doesn't handle).
 *
 * Uses TomTom's Orbis Routing API v2 (`/maps/orbis/routing/calculateRoute/
 * ...?apiVersion=2`), NOT the classic v1 endpoint this file originally
 * targeted. Switched 2026-09-16 once the project owner shared the real
 * Orbis Routing docs directly (not a WebFetch/WebSearch summary — the
 * actual page text) — two things settled from that real source, not
 * guessed:
 *   1. CORS: the documented response headers table states
 *      `Access-Control-Allow-Origin: *` (a wildcard) — even more
 *      permissive than classic v1's origin-reflection behaviour confirmed
 *      earlier via a live curl. No relay needed here either.
 *   2. Pricing/quota: TomTom's own pricing table lists "Routing API" as
 *      ONE line item covering both "TomTom Maps" (classic v1) and
 *      "TomTom Orbis Maps" (v2) — same free tier (20,000 requests/month),
 *      same paid tiers. No separate cost/policy for choosing Orbis.
 *
 * DELIBERATE, DOCUMENTED LIMITATION driving this file's whole design:
 * Orbis v2's own `travelMode` parameter is explicitly documented as
 * "Default value and only allowed value: car" — Orbis Routing currently
 * supports driving only, a real regression vs. classic v1 (which this app
 * confirmed supports car/bicycle/pedestrian). Per direct instruction,
 * this provider is therefore DRIVING-ONLY — getRoute() returns null
 * immediately for any other mode rather than attempting a request Orbis
 * can't fulfil; ActiveRoutingProvider never even calls this file for
 * cycling/walking, so ORS is the sole provider for those modes, not just
 * the fallback. See that file's own header comment for the full dispatch
 * logic.
 *
 * Also still explicitly in "public preview" per Orbis's own docs — a
 * real maturity/stability caveat distinct from pricing, part of why this
 * stays behind a hidden dev-mode toggle rather than becoming the default.
 *
 * KNOWN GAP, unchanged from the classic-v1 version of this file: `steps`
 * is always returned empty. Nothing in the Orbis Routing response
 * structure read so far documents a turn-by-turn guidance/instructions
 * field (the doc covering this was read through its full response-
 * structure section, which lists summary/legs/points/sections but no
 * guidance array) — this project's own discipline is to verify a schema
 * against real execution/documentation before shipping code that parses
 * it, not reconstruct one from guesswork (see CLAUDE.md's relay-debugging
 * history for exactly what happens when that discipline is skipped).
 * ManeuverTracker.nextManeuver() already degrades cleanly to
 * `{exists:false}` for an empty steps array — the guidance card falls
 * back to the camera's own geometric turn detection, the same documented
 * path ORS itself uses if its response shape is ever unexpected. The
 * point of this provider is real-time-traffic-aware ETAs/route geometry
 * for driving, not turn-by-turn text.
 */
const TomTomProvider = (() => {
  const BASE_URL   = "https://api.tomtom.com/maps/orbis/routing/calculateRoute";
  const TIMEOUT_MS = 12000;
  const API_VERSION = 2;

  /**
   * @param {{lat: number, lon: number}} start
   * @param {{lat: number, lon: number}} end
   * @param {"driving"|"cycling"|"walking"} [mode="driving"]
   * @returns {Promise<{geometry: object, distanceMeters: number, durationSeconds: number, steps: Array}|null>}
   */
  async function getRoute(start, end, mode) {
    // Orbis Routing v2 only supports travelMode=car — see this file's own
    // header comment. Any other mode is a hard "not this provider," not a
    // best-effort attempt; ActiveRoutingProvider is expected to route
    // cycling/walking straight to ORS without ever calling this function,
    // but this guard makes that contract explicit and safe even if it's
    // ever called directly.
    const effectiveMode = mode || "driving";
    if (effectiveMode !== "driving") return null;

    const apiKey = CONFIG.TOMTOM_API_KEY;
    if (!apiKey) {
      console.warn("TomTomProvider: CONFIG.TOMTOM_API_KEY not set — see config.js");
      return null;
    }

    const url =
      `${BASE_URL}/${start.lat},${start.lon}:${end.lat},${end.lon}/json` +
      `?key=${encodeURIComponent(apiKey)}&apiVersion=${API_VERSION}` +
      `&travelMode=car&traffic=live`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data  = await res.json();
      const route = data.routes && data.routes[0];
      if (!route || !route.summary) return null;

      // Flatten every leg's points into one [lon,lat][] array — matches
      // Geo.kt/geo.js's own [lon,lat] convention already used for route
      // geometry elsewhere in this app (RouteGeometry.nearestOnLine() etc.
      // expect coordinates in this order). A simple start/end request with
      // no intermediate waypoints always comes back as a single leg, but
      // this handles a multi-leg response correctly too rather than
      // assuming legs[0] alone. Field names (legs[].points[].latitude/
      // longitude, summary.lengthInMeters/travelTimeInSeconds) are
      // unchanged from classic v1's response shape, per the real Orbis
      // docs' own JSON field tables.
      const coordinates = [];
      (route.legs || []).forEach(leg => {
        (leg.points || []).forEach(p => {
          if (typeof p.longitude === "number" && typeof p.latitude === "number") {
            coordinates.push([p.longitude, p.latitude]);
          }
        });
      });
      if (coordinates.length < 2) return null;

      return {
        geometry:        { type: "LineString", coordinates },
        distanceMeters:  route.summary.lengthInMeters,
        durationSeconds: route.summary.travelTimeInSeconds,
        // See this file's own header comment — deliberately empty for now.
        steps: [],
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("TomTomProvider: route request failed —", err.message);
      return null;
    }
  }

  return { getRoute };
})();

if (typeof module !== "undefined") module.exports = TomTomProvider;
