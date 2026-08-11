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

  // A fixed dark stroke around every shape — the fill color alone (especially
  // pale/bright hues against a light day-theme map) had no crisp edge, only
  // a soft drop-shadow from CSS, which read as blurry rather than defined.
  // Inert-but-harmless on the night theme's dark background, where the
  // bright fills already had good contrast on their own. Stays at full
  // opacity regardless of fillOpacity below, so the shape stays identifiable
  // even for a barely-filled "Unlikely" contact.
  const STROKE = 'stroke="rgba(0,0,0,.45)" stroke-width="1.5" stroke-linejoin="round"';

  const SHAPES = {
    // Currently within the relevance teardrop — steady default case.
    "in-view": (color, op) => `<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="${color}" fill-opacity="${op}" ${STROKE}/>`,
    // Predicted to converge into view within the lookahead window.
    "predicted-entry": (color, op) => `<circle cx="12" cy="12" r="9" fill="${color}" fill-opacity="${op}" ${STROKE}/>`,
    // Overhead-override — elevation high enough that bearing doesn't apply.
    // Upward-pointing on purpose: it's a "look up" cue, not a bearing cue.
    "overhead": (color, op) => `<path d="M12 3 L21 19 L3 19 Z" fill="${color}" fill-opacity="${op}" ${STROKE}/>`,
  };

  /**
   * Redundant, hue-independent encoding of visibility confidence (score
   * 100-10) as fill density — a fully-solid shape reads as "confident,"
   * a mostly-hollow one reads as "marginal," regardless of color
   * perception. Covers color-vision cases the colorblind-safe palette
   * alone doesn't (tritanopia, full achromatopsia), and helps everyone in
   * bright glare where hue discrimination itself degrades.
   * @param {number} score  Visibility.estimate().score (10-100).
   */
  function opacityForScore(score) {
    return Math.max(0.2, Math.min(1, 0.2 + (score / 100) * 0.8));
  }

  /**
   * @param {string} reason  A Relevance.evaluate() reason ("in-view" |
   *   "predicted-entry" | "overhead"), or anything else to fall back to
   *   the default diamond (e.g. AIR mode, which doesn't compute relevance).
   * @param {string} color   Visibility category colour (vis.color or a
   *   colorblind-safe variant — this module doesn't care which).
   * @param {number} [size]  Rendered width/height in px. Default 20.
   * @param {number} [fillOpacity]  0-1. Default 1 (fully solid) — pass
   *   opacityForScore(vis.score) for the redundant confidence encoding.
   */
  function svg(reason, color, size, fillOpacity) {
    const s  = size || 20;
    const op = fillOpacity == null ? 1 : fillOpacity;
    const inner = (SHAPES[reason] || SHAPES["in-view"])(color, op);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  }

  return { svg, opacityForScore };
})();

if (typeof module !== "undefined") module.exports = AircraftSymbol;
