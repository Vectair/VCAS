/**
 * WakeLock — keeps the screen from dimming/locking while NAV mode (Hybrid
 * or Raw — anything except AIR) is active, the same way any real
 * navigation app stays on screen. Wraps the Screen Wake Lock API
 * (navigator.wakeLock), which:
 *   - isn't supported everywhere (older/other browsers) — isSupported()
 *     lets callers no-op gracefully rather than throw.
 *   - auto-releases whenever the tab/app is backgrounded (spec behaviour,
 *     not a bug) — re-acquired on the next "visibilitychange" back to
 *     visible, but only if the caller still wants it held (enable() was
 *     called more recently than disable()).
 */
const WakeLock = (() => {
  let _sentinel = null;
  let _desired  = false;

  function isSupported() {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  async function _requestLock() {
    if (!isSupported() || _sentinel) return;
    try {
      _sentinel = await navigator.wakeLock.request("screen");
      _sentinel.addEventListener("release", () => { _sentinel = null; });
    } catch (err) {
      // Common, non-fatal causes: tab not visible yet, battery saver, or
      // the request racing a visibility change — just leave it unheld;
      // the next visibilitychange (or a later enable()) will retry.
      console.warn("[WakeLock] request failed:", err.message);
      _sentinel = null;
    }
  }

  async function enable() {
    _desired = true;
    await _requestLock();
  }

  async function disable() {
    _desired = false;
    if (_sentinel) {
      const s = _sentinel;
      _sentinel = null;
      await s.release();
    }
  }

  function _onVisibilityChange() {
    if (_desired && document.visibilityState === "visible" && !_sentinel) {
      _requestLock();
    }
  }

  function init() {
    if (!isSupported()) return;
    document.addEventListener("visibilitychange", _onVisibilityChange);
  }

  return { init, enable, disable, isSupported };
})();

if (typeof module !== "undefined") module.exports = WakeLock;
