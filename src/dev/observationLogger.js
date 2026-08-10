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

  return { record, fallbackCount, exportFallback };
})();

if (typeof module !== "undefined") module.exports = ObservationLogger;
