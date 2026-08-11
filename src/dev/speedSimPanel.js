/**
 * Dev-only speed override.
 *
 * Anything gated on userSpeedMph — turn-by-turn detection (needs >~4.5mph
 * before it even runs), the HIGHWAY_GUIDANCE camera state (needs >53mph
 * sustained), the GPS-vs-compass heading trust threshold — is otherwise
 * untestable from a stationary machine. Real GPS speed is 0 when not
 * moving, and Chrome DevTools' location override never simulates
 * coords.speed even when the overridden point is changed manually, so
 * there's no way to reach any of that behaviour without this.
 *
 * userSpeedMph is a single value threaded through the camera evaluator,
 * relevance system, and guidance card already — overriding it in one
 * place (app.js, right after it's normally computed) is enough to make
 * all of that testable, no other code needs to know this exists.
 */
const SpeedSimPanel = (() => {
  const STORAGE_KEY   = "vcas-speed-sim-mph";
  const PRESETS_MPH   = [0, 20, 40, 60, 80];

  let _active    = false;
  let _speedMph  = 0;
  let _menuOpen  = false;
  let _onChange  = null;

  // ---- Public API ----

  function init({ onChange } = {}) {
    _onChange = onChange || null;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && stored !== "off") {
      const parsed = parseFloat(stored);
      if (!isNaN(parsed) && parsed >= 0) {
        _active   = true;
        _speedMph = parsed;
      }
    }

    _buildPanel();
  }

  function isActive()   { return _active; }
  function getSpeedMph() { return _speedMph; }

  // ---- Panel construction ----

  function _buildPanel() {
    const panel = document.createElement("div");
    panel.id = "speed-sim-panel";

    const toggle = document.createElement("button");
    toggle.id = "ssp-toggle";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      _menuOpen ? _closeMenu() : _openMenu();
    });

    const menu = document.createElement("div");
    menu.id = "ssp-menu";
    menu.className = "hidden";

    panel.appendChild(toggle);
    panel.appendChild(menu);
    document.body.appendChild(panel);

    document.addEventListener("click", () => { if (_menuOpen) _closeMenu(); });

    _renderMenu();
    _updateToggleLabel();
  }

  function _renderMenu() {
    const menu = document.getElementById("ssp-menu");
    if (!menu) return;
    menu.innerHTML = "";

    const offBtn = document.createElement("button");
    offBtn.className = "ssp-preset" + (!_active ? " active" : "");
    offBtn.textContent = "GPS (real)";
    offBtn.addEventListener("click", e => {
      e.stopPropagation();
      _setOverride(false, 0);
      _closeMenu();
    });
    menu.appendChild(offBtn);

    PRESETS_MPH.forEach(mph => {
      const btn = document.createElement("button");
      btn.className = "ssp-preset" + (_active && _speedMph === mph ? " active" : "");
      btn.textContent = `${mph} mph`;
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _setOverride(true, mph);
        _closeMenu();
      });
      menu.appendChild(btn);
    });
  }

  function _setOverride(active, mph) {
    _active   = active;
    _speedMph = mph;
    localStorage.setItem(STORAGE_KEY, active ? String(mph) : "off");
    _updateToggleLabel();
    _renderMenu();
    if (_onChange) _onChange();
  }

  function _updateToggleLabel() {
    const toggle = document.getElementById("ssp-toggle");
    if (!toggle) return;
    toggle.textContent = _active ? `SPD ${_speedMph}` : "SPD";
    toggle.classList.toggle("active", _active);
  }

  function _openMenu() {
    _menuOpen = true;
    document.getElementById("ssp-menu")?.classList.remove("hidden");
  }

  function _closeMenu() {
    _menuOpen = false;
    document.getElementById("ssp-menu")?.classList.add("hidden");
  }

  return { init, isActive, getSpeedMph };
})();
