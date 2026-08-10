/**
 * ObservationLogger — records ground-truth "was this actually visible"
 * observations, logged via the dev log panel (src/dev/logPanel.js).
 *
 * Primary path: POST to the local logging server (logServer.py), which
 * appends each observation as one line to logs/observations.jsonl on disk —
 * a real, inspectable file, not just browser-local state.
 *
 * Fallback: if that POST fails (e.g. the plain `python -m http.server` is
 * running instead of logServer.py, so there's no /api/log endpoint), the
 * observation is kept in localStorage instead of being silently dropped,
 * with an export() to pull it out as a downloadable file later.
 */
const ObservationLogger = (() => {
  const LOG_ENDPOINT      = "/api/log";
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
      const res = await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
