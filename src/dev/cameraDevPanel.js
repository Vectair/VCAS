const CameraDevPanel = (() => {
  const STORAGE_KEY = 'eos-camera-dev';

  let _visible   = false;
  let _panel     = null;
  let _toggleBtn = null;
  let _getCurrentNavState = null;
  let _refreshTimer = null;

  // Slider fields that override evaluated values.
  const FIELDS = [
    { key: 'pitch',   label: 'Pitch',    min: 0,    max: 75,   step: 1,    dec: 0 },
    { key: 'zoom',    label: 'Zoom',     min: 8,    max: 21,   step: 0.1,  dec: 1 },
    { key: 'anchorY', label: 'Anchor Y', min: 0.50, max: 0.95, step: 0.01, dec: 2 },
    { key: 'anchorX', label: 'Anchor X', min: 0.20, max: 0.80, step: 0.01, dec: 2 },
  ];

  // Default slider positions when no stored override exists.
  const FIELD_DEFAULTS = { pitch: 55, zoom: 16.2, anchorY: 0.80, anchorX: 0.50 };

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function _save(partial) {
    try {
      const existing = _load();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(existing, partial)));
    } catch (e) {}
  }

  function _clearStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ---- Status section (live evaluated state) ---- //

  function _buildStatusSection() {
    const section = document.createElement('div');
    section.className = 'cdp-status';
    section.id = 'cdp-status';

    const rows = [
      { id: 'cdp-s-state',   label: 'State' },
      { id: 'cdp-s-pitch',   label: 'Pitch' },
      { id: 'cdp-s-zoom',    label: 'Zoom' },
      { id: 'cdp-s-anchor',  label: 'Anchor' },
      { id: 'cdp-s-lookahead', label: 'Lookahead' },
    ];

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'cdp-status-row';
      row.innerHTML = `<span class="cdp-status-label">${r.label}</span>`
                    + `<span class="cdp-status-val" id="${r.id}">—</span>`;
      section.appendChild(row);
    });

    return section;
  }

  function _refreshStatus() {
    if (!_panel || !_visible) return;
    const ev = CameraController.getLastEvaluated();
    if (!ev) return;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    set('cdp-s-state',    ev.state || '—');
    set('cdp-s-pitch',    ev.pitch != null   ? ev.pitch.toFixed(0) + '°' : '—');
    set('cdp-s-zoom',     ev.zoom  != null   ? ev.zoom.toFixed(1)         : '—');
    set('cdp-s-anchor',   ev.anchorX != null
      ? 'X ' + ev.anchorX.toFixed(2) + '  Y ' + ev.anchorY.toFixed(2) : '—');
    set('cdp-s-lookahead', ev.lookAheadMeters != null
      ? Math.round(ev.lookAheadMeters) + ' m / ' + ev.lookAheadSeconds + ' s' : '—');
  }

  // ---- Panel construction ---- //

  function _buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'cam-dev-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'cdp-header';
    header.innerHTML = '<span class="cdp-title">CAM — DEV</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cdp-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', hide);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Live status section
    panel.appendChild(_buildStatusSection());

    // Divider label
    const overrideLabel = document.createElement('div');
    overrideLabel.className = 'cdp-section-label';
    overrideLabel.textContent = 'OVERRIDES';
    panel.appendChild(overrideLabel);

    // Slider body
    const body = document.createElement('div');
    body.className = 'cdp-body';
    const saved = _load();

    FIELDS.forEach(f => {
      const initVal = saved[f.key] !== undefined
        ? saved[f.key]
        : FIELD_DEFAULTS[f.key];

      const row = document.createElement('div');
      row.className = 'cdp-row';

      const label = document.createElement('label');
      label.className = 'cdp-label';
      label.textContent = f.label;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'cdp-slider';
      slider.min   = f.min;
      slider.max   = f.max;
      slider.step  = f.step;
      slider.value = initVal;
      slider.dataset.key = f.key;

      const readout = document.createElement('span');
      readout.className = 'cdp-val';
      readout.id = 'cdp-val-' + f.key;
      readout.textContent = Number(initVal).toFixed(f.dec);

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        readout.textContent = val.toFixed(f.dec);
        CameraController.setNavCameraConfig({ [f.key]: val });
        _save({ [f.key]: val });
        _applyIfNav();
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(readout);
      body.appendChild(row);
    });

    panel.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'cdp-footer';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cdp-btn';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      CameraController.resetNavCameraConfig();
      _clearStorage();
      // Restore sliders to current evaluated values (or defaults).
      const ev = CameraController.getLastEvaluated();
      FIELDS.forEach(f => {
        const sl = panel.querySelector('[data-key="' + f.key + '"]');
        const vl = panel.querySelector('#cdp-val-' + f.key);
        const val = (ev && ev[f.key] != null) ? ev[f.key] : FIELD_DEFAULTS[f.key];
        sl.value = val;
        vl.textContent = Number(val).toFixed(f.dec);
      });
      _applyIfNav(80);
    });

    const copyEvalBtn = document.createElement('button');
    copyEvalBtn.className = 'cdp-btn cdp-btn-accent';
    copyEvalBtn.textContent = 'Copy Eval';
    copyEvalBtn.addEventListener('click', () => {
      const ev = CameraController.getLastEvaluated();
      const json = JSON.stringify(ev || {}, null, 2);
      const restore = () => { copyEvalBtn.textContent = 'Copy Eval'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json)
          .then(() => { copyEvalBtn.textContent = 'Copied!'; setTimeout(restore, 1500); })
          .catch(() => { prompt('Evaluated camera config:', json); });
      } else {
        prompt('Evaluated camera config:', json);
      }
    });

    footer.appendChild(resetBtn);
    footer.appendChild(copyEvalBtn);
    panel.appendChild(footer);

    return panel;
  }

  function _applyIfNav(duration) {
    if (!_getCurrentNavState) return;
    const state = _getCurrentNavState();
    if (state.mode !== 'nav' || state.lat === null) return;
    CameraController.refreshNavCamera(state.lat, state.lon, state.heading, duration !== undefined ? duration : 0);
  }

  // ---- Show / hide ---- //

  function show() {
    if (!_panel) {
      _panel = _buildPanel();
      document.body.appendChild(_panel);
    }
    _panel.classList.remove('hidden');
    if (_toggleBtn) _toggleBtn.classList.add('active');
    _visible = true;

    // Restore stored overrides into CameraController.
    const saved = _load();
    if (Object.keys(saved).length > 0) {
      CameraController.setNavCameraConfig(saved);
    }

    // Live status refresh.
    _refreshStatus();
    _refreshTimer = setInterval(_refreshStatus, 500);
  }

  function hide() {
    if (_panel) _panel.classList.add('hidden');
    if (_toggleBtn) _toggleBtn.classList.remove('active');
    _visible = false;
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function toggle() {
    _visible ? hide() : show();
  }

  function init(toggleBtnEl, options) {
    _toggleBtn = toggleBtnEl;
    if (options && typeof options.getCurrentNavState === 'function') {
      _getCurrentNavState = options.getCurrentNavState;
    }
    // Pre-load stored overrides into CameraController even before panel is shown.
    const saved = _load();
    if (Object.keys(saved).length > 0) {
      CameraController.setNavCameraConfig(saved);
    }
    toggleBtnEl.addEventListener('click', toggle);
  }

  return { init, show, hide, toggle };
})();
