/**
 * AircraftSymbol — TCAS-inspired shape+colour icon factory, shared between
 * the NAV edge indicators (ui.js) and the AIR mode plan-view markers (map.js).
 *
 * Shape encodes *why* an aircraft is being shown (its Relevance reason);
 * colour (passed in by the caller, from Visibility.estimate().color)
 * encodes *how visible* it's likely to be. The two axes are independent,
 * same as real TCAS separating symbol shape from alert colour.
 *
 * Symbols are deliberately not rotated to indicate bearing or aircraft
 * heading — position already carries that (edge placement in NAV, plan
 * position in AIR) — matching how TCAS's own plan-position display never
 * rotates its diamond/circle/square symbols either.
 */
const AircraftSymbol = (() => {

  const SHAPES = {
    // Currently within the relevance teardrop — steady default case.
    "in-view": color => `<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="${color}"/>`,
    // Predicted to converge into view within the lookahead window.
    "predicted-entry": color => `<circle cx="12" cy="12" r="9" fill="${color}"/>`,
    // Overhead-override — elevation high enough that bearing doesn't apply.
    // Upward-pointing on purpose: it's a "look up" cue, not a bearing cue.
    "overhead": color => `<path d="M12 3 L21 19 L3 19 Z" fill="${color}"/>`,
  };

  /**
   * @param {string} reason  A Relevance.evaluate() reason ("in-view" |
   *   "predicted-entry" | "overhead"), or anything else to fall back to
   *   the default diamond (e.g. AIR mode, which doesn't compute relevance).
   * @param {string} color   Visibility category colour (vis.color).
   * @param {number} [size]  Rendered width/height in px. Default 20.
   */
  function svg(reason, color, size) {
    const s = size || 20;
    const inner = (SHAPES[reason] || SHAPES["in-view"])(color);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  }

  return { svg };
})();

if (typeof module !== "undefined") module.exports = AircraftSymbol;
