/**
 * In-app control for ground/low-altitude clutter suppression — previously
 * only adjustable by editing CONFIG.SUPPRESS_LOW_ALTITUDE_ENABLED /
 * CONFIG.SUPPRESS_LOW_ALTITUDE_FT directly in config.js and redeploying.
 * Same preset-menu pattern as SpeedSimPanel; state persists across reloads.
 *
 * Reminder (see the caveat already in config.js): the threshold is
 * barometric altitude (MSL), not height above you, so its effectiveness
 * varies with local terrain/airport elevation — that's exactly why this
 * needed to be adjustable without a redeploy.
 */
const AltitudeSuppressPanel = (() => {
  const STORAGE_KEY  = "vcas-altitude-suppress-ft";
  const PRESETS_FT   = [200, 500, 1000, 2000, 3000];

  let _enabled   = CONFIG.SUPPRESS_LOW_ALTITUDE_ENABLED;
  let _thresholdFt = CONFIG.SUPPRESS_LOW_ALTITUDE_FT;
  let _menuOpen  = false;
  let _onChange  = null;

  // ---- Public API ----

  function init({ onChange } = {}) {
    _onChange = onChange || null;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      if (stored === "off") {
        _enabled = false;
      } else {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0) {
          _enabled = true;
          _thresholdFt = parsed;
        }
      }
    }

    _buildPanel();
  }

  function isEnabled()     { return _enabled; }
  function getThresholdFt() { return _thresholdFt; }

  // ---- Panel construction ----

  function _buildPanel() {
    const panel = document.createElement("div");
    panel.id = "altitude-suppress-panel";

    const toggle = document.createElement("button");
    toggle.id = "asp-toggle";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      _menuOpen ? _closeMenu() : _openMenu();
    });

    const menu = document.createElement("div");
    menu.id = "asp-menu";
    menu.className = "hidden";

    panel.appendChild(toggle);
    panel.appendChild(menu);
    document.body.appendChild(panel);

    document.addEventListener("click", () => { if (_menuOpen) _closeMenu(); });

    _renderMenu();
    _updateToggleLabel();
  }

  function _renderMenu() {
    const menu = document.getElementById("asp-menu");
    if (!menu) return;
    menu.innerHTML = "";

    const offBtn = document.createElement("button");
    offBtn.className = "asp-preset" + (!_enabled ? " active" : "");
    offBtn.textContent = "Off (show everything)";
    offBtn.addEventListener("click", e => {
      e.stopPropagation();
      _setThreshold(false, _thresholdFt);
      _closeMenu();
    });
    menu.appendChild(offBtn);

    PRESETS_FT.forEach(ft => {
      const btn = document.createElement("button");
      btn.className = "asp-preset" + (_enabled && _thresholdFt === ft ? " active" : "");
      btn.textContent = `Below ${ft} ft`;
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _setThreshold(true, ft);
        _closeMenu();
      });
      menu.appendChild(btn);
    });
  }

  function _setThreshold(enabled, ft) {
    _enabled     = enabled;
    _thresholdFt = ft;
    localStorage.setItem(STORAGE_KEY, enabled ? String(ft) : "off");
    _updateToggleLabel();
    _renderMenu();
    if (_onChange) _onChange();
  }

  function _updateToggleLabel() {
    const toggle = document.getElementById("asp-toggle");
    if (!toggle) return;
    toggle.textContent = _enabled ? `ALT <${_thresholdFt}` : "ALT OFF";
    toggle.classList.toggle("active", _enabled);
  }

  function _openMenu() {
    _menuOpen = true;
    document.getElementById("asp-menu")?.classList.remove("hidden");
  }

  function _closeMenu() {
    _menuOpen = false;
    document.getElementById("asp-menu")?.classList.add("hidden");
  }

  return { init, isEnabled, getThresholdFt };
})();
