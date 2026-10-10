/**
 * LivePresence — periodically pushes this device's LiveSnapshot to the
 * live-relay (not committed to this repo, handed over like the other
 * relays) so the admin dashboard's Live Pipeline tab can show how the
 * visibility model is working for each connected user right now.
 *
 * Closed-test tooling: the snapshot includes the user's real position,
 * which is fine for a handful of known testers and must NOT be shipped to
 * an open audience. Does nothing at all while CONFIG.LIVE_RELAY_URL is
 * blank, so it is inert until the relay is deployed and configured.
 *
 * Never throws and never blocks the app: a failed push is dropped silently
 * (the next tick sends a fresh snapshot anyway — there is no value in
 * retrying a stale one), and the fetch promise is always .catch()-handled
 * so a failure can't trip the crash reporter's own unhandledrejection
 * listener (see CLAUDE.md's crash-reporter entry for that exact trap).
 */
const LivePresence = (() => {
  const INTERVAL_MS = 5000;
  const TIMEOUT_MS = 6000;
  let _timer = null;
  let _inFlight = false;

  function _url() { return (typeof CONFIG !== "undefined" && CONFIG.LIVE_RELAY_URL) || ""; }
  function _key() { return (typeof CONFIG !== "undefined" && CONFIG.LIVE_RELAY_KEY) || ""; }

  function _push(buildSnapshot) {
    if (_inFlight || !_url()) return;
    let snap;
    try { snap = buildSnapshot(); } catch (e) { return; }
    if (!snap) return;
    _inFlight = true;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
      fetch(_url(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-VCAS-Key": _key() },
        body: JSON.stringify(snap),
        keepalive: true,
        signal: controller ? controller.signal : undefined,
      })
        .catch(() => {})
        .finally(() => { _inFlight = false; if (timer) clearTimeout(timer); });
    } catch (e) {
      _inFlight = false;
      if (timer) clearTimeout(timer);
    }
  }

  /** buildSnapshot: () => LiveSnapshot payload | null (null while there's no GPS fix yet). Idempotent. */
  function start(buildSnapshot) {
    if (_timer || !_url()) return;
    _timer = setInterval(() => _push(buildSnapshot), INTERVAL_MS);
  }

  function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null;
  }

  return { start, stop };
})();
