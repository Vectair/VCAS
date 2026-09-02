/**
 * ObservationLogger — records ground-truth "was this actually visible"
 * observations, logged via the dev log panel (src/dev/logPanel.js).
 *
 * Primary path: POST to CONFIG.LOG_ENDPOINT — a real internet endpoint
 * (see logs/README or the deploy notes for the Bluehost PHP script this
 * points at) so every device logs to the same central place automatically.
 * Falls back to the relative "/api/log" when LOG_ENDPOINT isn't configured,
 * which only resolves to anything when running logServer.py locally — kept
 * for local dev without needing config.js changes.
 *
 * Fallback: if that POST fails (offline, endpoint down, or nothing
 * configured and logServer.py isn't running), the observation is kept in
 * localStorage instead of being silently dropped, with an export() to pull
 * it out as a downloadable file later.
 */
const ObservationLogger = (() => {
  const LOG_ENDPOINT =
    (typeof CONFIG !== "undefined" && CONFIG.LOG_ENDPOINT) ? CONFIG.LOG_ENDPOINT : "/api/log";
  const LOG_ENDPOINT_KEY =
    (typeof CONFIG !== "undefined" && CONFIG.LOG_ENDPOINT_KEY) ? CONFIG.LOG_ENDPOINT_KEY : "";
  const LOCAL_STORAGE_KEY = "vcas-observation-log-fallback";

  // Shared outcome vocabulary — used by the LOG panel's per-row buttons and
  // by the same buttons embedded directly in the NAV/AIR popups.
  //
  // not_visible_weather (2026-08-27) splits "not visible" into a third
  // reason, distinct from both obstruction (a physical object in the way)
  // and missed (no identifiable reason) — cloud cover between the observer
  // and the aircraft, or the aircraft being above an overcast layer, or
  // precipitation heavy enough to obscure it. Direct instruction: this is
  // specifically to build a real dataset correlating logged outcomes
  // against METAR conditions at the time, since Visibility.estimate()'s
  // METAR cloud/visibility adjustment (see README's "Visibility Categories"
  // section) has never been calibrated against real sightings — a
  // not_visible_weather observation is real evidence the model's METAR
  // handling was right (or wrong) for that case, which a not_visible_missed
  // entry (no identifiable reason at all) can't provide, and which an
  // obstruction entry would wrongly attribute to terrain/buildings instead.
  //
  // visible_lights (2026-08-27, same day) — a third "visible" reason,
  // alongside airframe and contrail: the aircraft itself (or its shape)
  // isn't what was actually spotted, its nav/strobe/beacon lights are —
  // specifically a night or low-visibility-weather sighting, per direct
  // instruction. This is the same "distinct sighting mechanism, not just a
  // finer visible/not-visible label" reasoning visible_contrail was already
  // built on: Visibility.estimate()'s own doc comment states its model
  // assumes "daylight" — night-time visibility (where a light source, not
  // angular size/shape, is what's actually being resolved) isn't modelled
  // at all today. Logging a lights-only sighting under the old plain
  // visible_airframe code would have silently overstated how visible the
  // *airframe* itself was in the dark; recording it separately is what
  // would let a future night/lights-aware adjustment be built on real
  // evidence, the same way not_visible_weather now can be for the METAR
  // adjustment.
  const OUTCOMES = [
    { code: "visible_airframe",        label: "✈",  title: "Visible — airframe" },
    { code: "visible_contrail",        label: "〜", title: "Visible — contrail only" },
    { code: "visible_lights",          label: "✦",  title: "Visible — lights only (night/low visibility)" },
    { code: "not_visible_obstruction", label: "▨",  title: "Not visible — obstruction" },
    { code: "not_visible_weather",     label: "☁",  title: "Not visible — weather/cloud" },
    { code: "not_visible_missed",      label: "✕",  title: "Not visible — no other reason" },
  ];

  /**
   * Build the structured observation payload from an Indicators.build()/
   * buildAll() item, current user state, and a chosen outcome code — the
   * one place this schema is defined, so the LOG panel and the popup
   * buttons can't drift apart.
   *
   * @param {object} item        { aircraft, vis, relevance, distanceNm, relativeBearing }
   * @param {object} userState   { lat, lon, heading, speedMph }
   * @param {string} outcomeCode One of OUTCOMES[].code
   */
  function buildObservation(item, userState, outcomeCode) {
    const a = item.aircraft;
    return {
      timestamp: new Date().toISOString(),
      user: {
        lat: userState.lat, lon: userState.lon,
        heading: userState.heading, speedMph: userState.speedMph,
      },
      aircraft: {
        hex: a.hex, callsign: a.callsign, type: a.type,
        lat: a.lat, lon: a.lon, altitudeFt: a.altitudeFt,
        trackDeg: a.trackDeg, groundSpeedKt: a.groundSpeedKt,
        lastSeenSeconds: a.lastSeenSeconds,
      },
      computed: {
        distanceNm: item.distanceNm,
        relativeBearing: item.relativeBearing,
        visibility: {
          label: item.vis.label, score: item.vis.score,
          angularSizeDeg: item.vis.angularSizeDeg, elevationDeg: item.vis.elevationDeg,
          slantRangeNm: item.vis.slantRangeNm,
        },
        relevance: item.relevance,
        // Snapshot of whatever METAR context (if any) was actually applied
        // to this observation's own visibility score — added 2026-09-01
        // after real not_visible_weather log entries turned out impossible
        // to diagnose without this: every one of them showed the model at
        // high/full confidence with no way to tell, after the fact,
        // whether that was because METAR data was unavailable at that
        // moment (fetch failure, no nearby station) or because the METAR
        // that WAS available genuinely didn't report occluding conditions
        // (e.g. isolated cloud a station-based report can't see). Read via
        // MetarProvider.getCached() — a synchronous snapshot of whatever's
        // currently cached, same data _applyMetarAdjustment() itself would
        // have used for this exact observation. Null when no METAR is
        // cached at all (fetch never succeeded, or none nearby).
        metar: (typeof MetarProvider !== "undefined") ? MetarProvider.getCached() : null,
        // Same reasoning as the metar snapshot above, added 2026-09-02
        // alongside the local-obstruction feature itself: without this,
        // a not_visible_obstruction/visible_airframe entry can't be
        // checked against the actual density data that was (or wasn't)
        // applied to it, only the final tier. Deliberately just the raw
        // LocalObstruction.getCached() snapshot, no separately-computed
        // "did the adjustment actually fire" boolean — same pattern the
        // metar field above already established (raw context, not a
        // derived flag); whether it fired is reconstructable from this
        // plus the logged elevationDeg above and visibility.js's own
        // LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG/DENSE_THRESHOLD constants.
        localObstruction: (typeof LocalObstruction !== "undefined") ? LocalObstruction.getCached() : null,
      },
      outcome: outcomeCode,
    };
  }

  function _readFallback() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function _appendFallback(observation) {
    const entries = _readFallback();
    entries.push(observation);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn("[ObservationLogger] localStorage fallback write failed:", e.message);
    }
  }

  /**
   * @param {object} observation  See logPanel.js for the shape being logged.
   * @returns {Promise<{ok: boolean, fallback: boolean}>}
   */
  async function record(observation) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (LOG_ENDPOINT_KEY) headers["X-VCAS-Key"] = LOG_ENDPOINT_KEY;

      const res = await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(observation),
      });
      if (!res.ok) throw new Error("log server responded " + res.status);
      return { ok: true, fallback: false };
    } catch (err) {
      console.warn("[ObservationLogger] /api/log unavailable, buffering locally instead:", err.message);
      _appendFallback(observation);
      return { ok: true, fallback: true };
    }
  }

  function fallbackCount() {
    return _readFallback().length;
  }

  /** Download whatever's been buffered locally as a .jsonl file, then clear it. */
  function exportFallback() {
    const entries = _readFallback();
    if (entries.length === 0) return;

    const text = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
    const blob = new Blob([text], { type: "application/x-ndjson" });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `vcas-observations-fallback-${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  return { OUTCOMES, buildObservation, record, fallbackCount, exportFallback };
})();

if (typeof module !== "undefined") module.exports = ObservationLogger;
