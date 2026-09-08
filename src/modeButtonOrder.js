/**
 * ModeButtonOrder — persists a custom RAW/AIR/HYBRID button order for the
 * bottom-bar mode toggle. Direct instruction (2026-09-08, round 9): the
 * design draft this round matches shows HYBRID/RAW/AIR, but VCAS's own
 * deliberate default is RAW/AIR/HYBRID (see CLAUDE.md's "LOG button
 * overlap + top-of-screen consolidation, RAW as default" entry) — rather
 * than pick one, the default stays RAW/AIR/HYBRID exactly as it is, and
 * this module gives the user a way to reorder it themselves in Settings
 * if they'd prefer the draft's own order (or any other).
 *
 * A plain persisted array, same pattern as ColorblindMode/
 * AirRangeRingsOption — read directly by app.js wherever it needs "what
 * order do the three mode buttons go in", not by ui.js/map.js (this has
 * nothing to do with rendering, only with DOM order of three already-
 * existing buttons).
 */
const ModeButtonOrder = (() => {
  const STORAGE_KEY = "vcas-mode-button-order-v1";
  const DEFAULT_ORDER = ["raw", "air", "hybrid"];
  const VALID_IDS = new Set(DEFAULT_ORDER);
  let _order = DEFAULT_ORDER.slice();

  function _isValidOrder(arr) {
    return Array.isArray(arr) && arr.length === DEFAULT_ORDER.length &&
      new Set(arr).size === DEFAULT_ORDER.length &&
      arr.every(id => VALID_IDS.has(id));
  }

  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (_isValidOrder(parsed)) _order = parsed;
      }
    } catch (e) {
      // Malformed/corrupted storage — keep the default rather than throw.
    }
    return _order.slice();
  }

  function get() { return _order.slice(); }

  function _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_order)); }
    catch (e) { /* private-browsing/quota — order just won't survive a reload */ }
  }

  /** Swaps the mode currently at `index` with its neighbour at
   * `index + direction` (direction: -1 = move earlier, +1 = move later).
   * No-op past either end. Returns the new order. */
  function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= _order.length) return _order.slice();
    const next = _order.slice();
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    _order = next;
    _persist();
    return _order.slice();
  }

  function reset() {
    _order = DEFAULT_ORDER.slice();
    _persist();
    return _order.slice();
  }

  return { init, get, move, reset, DEFAULT_ORDER };
})();

if (typeof module !== "undefined") module.exports = ModeButtonOrder;
