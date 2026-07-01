/**
 * Dev-only viewport emulator.
 *
 * Renders a VIEW button that lets developers test VCAS in realistic
 * target display dimensions (phone portrait/landscape, Android Auto)
 * without deploying to a real device.
 *
 * Works by applying a CSS transform to #viewport-dev-frame, which
 * makes position:fixed children scope to the frame instead of the
 * actual browser viewport.
 */

const ViewportDevPanel = (() => {
  const STORAGE_KEY = "VCAS-dev-viewport";

  const PRESETS = [
    { id: "full",    label: "Full",    width: null, height: null },
    { id: "phone-p", label: "Phone P", width: 390,  height: 844  },
    { id: "phone-l", label: "Phone L", width: 844,  height: 390  },
    { id: "auto",    label: "Auto",    width: 1280, height: 720  },
  ];

  let _onViewportChanged = null;
  let _currentId = "full";
  let _menuOpen  = false;

  // ---- Public API ----

  function init({ onViewportChanged }) {
    _onViewportChanged = onViewportChanged;
    _currentId = localStorage.getItem(STORAGE_KEY) || "full";
    _buildPanel();
    _applyPreset(_currentId, false);
    window.addEventListener("resize", _onWindowResize);
  }

  /**
   * Returns the logical viewport dimensions the app should use for layout
   * calculations (e.g. indicator edge positions).  In emulated modes this
   * returns the preset dimensions, not the real browser window size.
   */
  function getViewportDimensions() {
    if (_currentId !== "full") {
      const preset = PRESETS.find(p => p.id === _currentId);
      if (preset && preset.width) {
        return { width: preset.width, height: preset.height };
      }
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  // ---- Panel construction ----

  function _buildPanel() {
    const panel = document.createElement("div");
    panel.id = "viewport-dev-panel";

    const toggle = document.createElement("button");
    toggle.id = "vdp-toggle";
    toggle.textContent = "VIEW";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      _menuOpen ? _closeMenu() : _openMenu();
    });

    const menu = document.createElement("div");
    menu.id = "vdp-menu";
    menu.className = "hidden";

    PRESETS.forEach(preset => {
      const btn = document.createElement("button");
      btn.className = "vdp-preset" + (preset.id === _currentId ? " active" : "");
      btn.dataset.preset = preset.id;
      btn.textContent = preset.label;
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _applyPreset(preset.id, true);
        _closeMenu();
      });
      menu.appendChild(btn);
    });

    panel.appendChild(toggle);
    panel.appendChild(menu);
    document.body.appendChild(panel);

    document.addEventListener("click", () => { if (_menuOpen) _closeMenu(); });
  }

  function _openMenu() {
    _menuOpen = true;
    document.getElementById("vdp-menu").classList.remove("hidden");
  }

  function _closeMenu() {
    _menuOpen = false;
    const menu = document.getElementById("vdp-menu");
    if (menu) menu.classList.add("hidden");
  }

  // ---- Preset application ----

  function _onWindowResize() {
    if (_currentId !== "full") _applyPreset(_currentId, false);
  }

  function _applyPreset(id, persist) {
    const preset = PRESETS.find(p => p.id === id) || PRESETS[0];
    _currentId = preset.id;

    if (persist) localStorage.setItem(STORAGE_KEY, preset.id);

    const shell = document.getElementById("viewport-dev-shell");
    const frame = document.getElementById("viewport-dev-frame");
    if (!shell || !frame) return;

    if (preset.width === null) {
      // Full browser — remove all emulator styling
      frame.style.cssText = "";
      shell.classList.remove("vdp-emulated");
    } else {
      // Emulated — constrain frame and scale to fit browser window
      const availW = window.innerWidth  - 40;
      const availH = window.innerHeight - 40;
      const scale  = Math.min(1, availW / preset.width, availH / preset.height);
      // translateZ(0) creates a new containing block so position:fixed children
      // scope to the frame instead of the browser viewport.
      const transform = scale < 1
        ? `translateZ(0) scale(${scale.toFixed(4)})`
        : "translateZ(0)";

      frame.style.width     = preset.width  + "px";
      frame.style.height    = preset.height + "px";
      frame.style.transform = transform;
      shell.classList.add("vdp-emulated");
    }

    // Sync active state on preset buttons
    document.querySelectorAll(".vdp-preset").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.preset === preset.id);
    });

    // Notify app after layout settles so map resize reads correct dimensions
    if (_onViewportChanged) setTimeout(_onViewportChanged, 60);
  }

  function getCurrentPresetId() { return _currentId; }

  return { init, getViewportDimensions, getCurrentPresetId };
})();
