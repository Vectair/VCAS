/**
 * AircraftSymbol — TCAS-style shape+colour icon factory, shared between the
 * NAV edge/polar indicators (ui.js) and the AIR mode plan-view markers
 * (map.js).
 *
 * Shape + fill together are the PRIMARY encoding, following TCAS's own
 * hollow-diamond -> filled-diamond -> circle -> square progression — driven
 * by Visibility.estimate()'s shape/fillOpacity/color fields, reinterpreted
 * for sightability rather than TCAS's collision-risk meaning.
 *
 * Relevance reason ("predicted-entry" / "overhead") is a SECONDARY modifier
 * layered on top via `opts`: predicted-entry dashes the stroke (still
 * arriving, not yet current); overhead swaps in a distinct upward-chevron
 * shape regardless of sightability tier, since "look up, it's basically
 * overhead" is urgent independent of fine-grained tier.
 *
 * Symbols are deliberately not rotated to indicate bearing or aircraft
 * heading — position already carries that, and a separate direction-of-
 * travel indicator carries track — matching how TCAS's own plan-position
 * display never rotates its diamond/circle/square symbols either.
 */
const AircraftSymbol = (() => {

  const SHAPES = {
    diamond: (color, op, stroke) => `<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="${color}" fill-opacity="${op}" ${stroke}/>`,
    circle:  (color, op, stroke) => `<circle cx="12" cy="12" r="9" fill="${color}" fill-opacity="${op}" ${stroke}/>`,
    square:  (color, op, stroke) => `<rect x="4" y="4" width="16" height="16" fill="${color}" fill-opacity="${op}" ${stroke}/>`,
    // Overhead-override — elevation high enough that bearing doesn't apply.
    // Upward-pointing on purpose: it's a "look up" cue, not a bearing cue.
    overhead: (color, op, stroke) => `<path d="M12 3 L21 19 L3 19 Z" fill="${color}" fill-opacity="${op}" ${stroke}/>`,
  };

  /**
   * @param {string} tcasShape  Visibility.estimate().shape ("diamond" |
   *   "circle" | "square"). Ignored (overridden) when opts.overhead is true.
   * @param {string} color      Visibility category colour (vis.color/
   *   colorDay/colorblindSafe(Day) — this module doesn't care which).
   * @param {number} [size]         Rendered width/height in px. Default 20.
   * @param {number} [fillOpacity]  0-1. Default 1. Pass vis.fillOpacity for
   *   the tier-appropriate fixed fill step (always 1 for circle/square,
   *   matching real TCAS's always-solid TA/RA symbols).
   * @param {object} [opts]
   * @param {boolean} [opts.predicted]  Predicted to converge into view
   *   within the lookahead window — not yet current, so the stroke is
   *   dashed instead of solid.
   * @param {boolean} [opts.overhead]   Elevation-override case — replaces
   *   the tier shape with the upward chevron entirely.
   */
  function svg(tcasShape, color, size, fillOpacity, opts) {
    const s  = size || 20;
    const op = fillOpacity == null ? 1 : fillOpacity;
    const o  = opts || {};

    // The stroke uses the category's own colour (not a fixed dark rgba) —
    // critical for the hollow diamond (fillOpacity 0), where a near-black
    // stroke would be nearly invisible against the night theme's dark map.
    // Edge definition against light day-theme backgrounds instead comes
    // from the CSS drop-shadow already applied to .indicator-shape/.air-icon.
    const dash = o.predicted ? ' stroke-dasharray="3,2"' : "";
    const stroke = `stroke="${color}" stroke-width="1.5" stroke-linejoin="round"${dash}`;

    const shapeKey = o.overhead ? "overhead" : (SHAPES[tcasShape] ? tcasShape : "diamond");
    const inner = SHAPES[shapeKey](color, op, stroke);
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  }

  return { svg };
})();

if (typeof module !== "undefined") module.exports = AircraftSymbol;
