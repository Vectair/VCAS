const ThemeController = (() => {
  "use strict";

  const STORAGE_KEY   = "eos-theme-mode";
  const DAY_START     = 7;
  const DAY_END       = 19;

  let _mode           = "auto";
  let _effectiveTheme = "night";
  let _onChange       = null;

  function _compute(mode) {
    if (mode === "day")   return "day";
    if (mode === "night") return "night";
    const h = new Date().getHours();
    return (h >= DAY_START && h < DAY_END) ? "day" : "night";
  }

  function _apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "day" ? "#f0ede8" : "#0e1117";
  }

  function init(onChangeFn) {
    _onChange = onChangeFn || null;
    _mode     = localStorage.getItem(STORAGE_KEY) || "auto";
    _effectiveTheme = _compute(_mode);
    _apply(_effectiveTheme);

    setInterval(() => {
      if (_mode !== "auto") return;
      const next = _compute("auto");
      if (next !== _effectiveTheme) {
        _effectiveTheme = next;
        _apply(_effectiveTheme);
        if (_onChange) _onChange(_effectiveTheme);
      }
    }, 60_000);

    return _effectiveTheme;
  }

  function setMode(mode) {
    _mode = mode;
    localStorage.setItem(STORAGE_KEY, mode);
    const next = _compute(mode);
    _effectiveTheme = next;
    _apply(_effectiveTheme);
    if (_onChange) _onChange(_effectiveTheme);
  }

  function getMode()           { return _mode; }
  function getEffectiveTheme() { return _effectiveTheme; }

  return { init, setMode, getMode, getEffectiveTheme };
})();
