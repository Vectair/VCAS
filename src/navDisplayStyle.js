/**
 * NavDisplayStyle — which camera presentation NAV mode uses: the original
 * tilted 3rd-person follow camera, or a selectable top-down, heading-up
 * plan-position display (borrowing the overall look of a TCAS/ND traffic
 * display). A simple persisted preference, read by CameraController when
 * evaluating the camera each frame — it doesn't change what's shown (the
 * relevance-filtered, polar-plotted traffic and route are identical either
 * way), only how the camera frames it.
 */
const NavDisplayStyle = (() => {
  const STORAGE_KEY = "vcas-nav-display-style";
  const THIRD_PERSON = "third-person";
  const TOPDOWN = "topdown";

  let _style = THIRD_PERSON;
  let _onChange = null;

  function init({ onChange } = {}) {
    _onChange = onChange || null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === THIRD_PERSON || stored === TOPDOWN) _style = stored;
  }

  function get() { return _style; }
  function isTopdown() { return _style === TOPDOWN; }

  function set(style) {
    if (style !== THIRD_PERSON && style !== TOPDOWN) return;
    if (style === _style) return;
    _style = style;
    localStorage.setItem(STORAGE_KEY, style);
    if (_onChange) _onChange(style);
  }

  return { init, get, set, isTopdown, THIRD_PERSON, TOPDOWN };
})();

if (typeof module !== "undefined") module.exports = NavDisplayStyle;
