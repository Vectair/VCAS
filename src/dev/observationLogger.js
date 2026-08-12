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
  // by the same four buttons embedded directly in the NAV/AIR popups.
  const OUTCOMES = [
    { code: "visible_airframe",        label: "✈",  title: "Visible — airframe" },
    { code: "visible_contrail",        label: "〜", title: "Visible — contrail only" },
    { code: "not_visible_obstruction", label: "▨",  title: "Not visible — obstruction" },
    { code: "not_visible_missed",      label: "✕",  title: "Not visible — just not seen" },
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
