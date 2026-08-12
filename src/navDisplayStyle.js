/**
 * NavDisplayStyle — which camera/basemap presentation NAV mode uses:
 *
 *   - "Hybrid" (default): the original tilted 3rd-person follow camera,
 *     with the polar-plotted TCAS-style traffic overlay combined on top of
 *     the normal themed road map — a hybrid of the two.
 *   - "Raw": a selectable top-down, heading-up plan-position display
 *     stripped down to look as close as practical to a real TCAS/ND
 *     instrument screen — flat camera, no road map underneath at all, just
 *     the raw traffic picture.
 *
 * A simple persisted preference, read by CameraController/app.js when
 * evaluating the camera and basemap each frame — it doesn't change what's
 * shown (the relevance-filtered, polar-plotted traffic and route are
 * identical either way), only how they're framed and what's underneath.
 */
const NavDisplayStyle = (() => {
  const STORAGE_KEY = "vcas-nav-display-style";
  const HYBRID = "hybrid";
  const RAW = "raw";

  let _style = HYBRID;
  let _onChange = null;

  function init({ onChange } = {}) {
    _onChange = onChange || null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === HYBRID || stored === RAW) _style = stored;
  }

  function get() { return _style; }
  function isRaw() { return _style === RAW; }

  function set(style) {
    if (style !== HYBRID && style !== RAW) return;
    if (style === _style) return;
    _style = style;
    localStorage.setItem(STORAGE_KEY, style);
    if (_onChange) _onChange(style);
  }

  return { init, get, set, isRaw, HYBRID, RAW };
})();

if (typeof module !== "undefined") module.exports = NavDisplayStyle;
