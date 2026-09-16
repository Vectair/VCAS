/**
 * ActiveRoutingProvider — picks which RoutingProvider implementation
 * actually serves a route request, and is the one place both
 * requestRouteTo()/_rerouteFromCurrentPosition() (app.js) call instead of
 * a hardcoded OrsProvider reference.
 *
 * ORS is the permanent default AND the only provider for cycling/walking —
 * not just a fallback for those two modes, never even attempted against
 * TomTom. TomTom (src/routing/tomtomProvider.js, TomTom's Orbis Routing
 * API v2) is an optional, experimental, DRIVING-ONLY alternative —
 * real-time-traffic-aware ETAs, per CLAUDE.md's own TomTom research
 * entries — selectable only via a hidden dev-mode settings row (see
 * app.js's _refreshSettingsScreen()), same "not a real user-facing
 * feature yet" posture as the VIEW/SPD developer panels DevMode already
 * gates. Driving-only because Orbis's own docs state travelMode's "only
 * allowed value" is car — TomTomProvider.getRoute() already refuses any
 * other mode itself, but the mode check here means ORS is used directly
 * for cycling/walking rather than routing through TomTom's own no-op
 * refusal first. If TomTom is selected+configured but a driving request
 * still fails, this falls straight back to ORS for that same request —
 * the user never sees a routing failure just because the experimental
 * provider had a bad moment, matching the "ORS untouched as the default
 * and the fallback" scope this feature was built to.
 *
 * Also keeps a small in-memory request log (provider used, why, latency,
 * success) — not persisted, not a server-side ledger like the ADS-B/METAR
 * relays' own `?stats=1` endpoints, since this is a client-side dev toggle
 * with no shared infrastructure to watch; just enough to see on the
 * Settings screen that a request actually went where it was supposed to.
 */
const ActiveRoutingProvider = (() => {
  const STORAGE_KEY = "vcas-routing-provider";
  const VALID_IDS = ["ors", "tomtom"];
  const MAX_LOG_ENTRIES = 20;

  let _selectedId = "ors";
  const _log = [];

  function init() {
    const stored = localStorage.getItem(STORAGE_KEY);
    _selectedId = VALID_IDS.includes(stored) ? stored : "ors";
    return _selectedId;
  }

  /** The user's persisted PREFERENCE — may be "tomtom" even with a blank
   * key; getRoute() below is what actually falls back safely in that
   * case. Kept separate from "what will actually be used" so the
   * Settings toggle can still show the user's real choice. */
  function getSelectedId() {
    return _selectedId;
  }

  function setSelectedId(id) {
    if (!VALID_IDS.includes(id)) return _selectedId;
    _selectedId = id;
    localStorage.setItem(STORAGE_KEY, id);
    return _selectedId;
  }

  function getLog() {
    return _log.slice(); // shallow copy — callers can't mutate our internal array
  }

  function _record(provider, reason, latencyMs, success) {
    _log.unshift({ ts: Date.now(), provider, reason, latencyMs, success });
    if (_log.length > MAX_LOG_ENTRIES) _log.length = MAX_LOG_ENTRIES;
  }

  /**
   * @param {{lat: number, lon: number}} start
   * @param {{lat: number, lon: number}} end
   * @param {"driving"|"cycling"|"walking"} [mode="driving"]
   * @returns {Promise<{geometry: object, distanceMeters: number, durationSeconds: number, steps: Array}|null>}
   */
  async function getRoute(start, end, mode) {
    const effectiveMode = mode || "driving";
    // TomTom (Orbis) is driving-only — see this file's own header comment
    // and TomTomProvider's own doc comment for why. Cycling/walking go
    // straight to ORS regardless of the toggle, not just on a TomTom
    // failure — there's no "try TomTom first" step for a mode it can
    // never serve.
    const wantTomTom =
      effectiveMode === "driving" &&
      _selectedId === "tomtom" &&
      !!(typeof CONFIG !== "undefined" && CONFIG.TOMTOM_API_KEY);

    if (wantTomTom) {
      const t0 = Date.now();
      const route = await TomTomProvider.getRoute(start, end, effectiveMode);
      _record("tomtom", "primary", Date.now() - t0, !!route);
      if (route) return route;

      const t1 = Date.now();
      const fallback = await OrsProvider.getRoute(start, end, effectiveMode);
      _record("ors", "fallback-after-tomtom-failure", Date.now() - t1, !!fallback);
      return fallback;
    }

    const t0 = Date.now();
    const route = await OrsProvider.getRoute(start, end, effectiveMode);
    _record("ors", "primary", Date.now() - t0, !!route);
    return route;
  }

  return { init, getSelectedId, setSelectedId, getLog, getRoute };
})();

if (typeof module !== "undefined") module.exports = ActiveRoutingProvider;
