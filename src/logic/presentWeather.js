/**
 * PresentWeather — turns a METAR present-weather group (e.g. "-RA BR",
 * "+TSRA", "VCSH", "MIFG") into numbers the visibility model can use
 * (2026-10-11, direct design discussion with the project owner: the reported
 * visibility and cloud are the direct result of the weather, but KNOWING the
 * weather helps the estimate — showers/rain/snow cut slant and vertical
 * visibility even when prevailing visibility looks fine, fog is shallow and
 * leaves the sky above it clear, and transient weather is patchy and short
 * lived).
 *
 * Pure: no DOM, no network. Output per station (analyse):
 *   impliedVisSm  - a visibility CEILING implied by precipitation / thunder /
 *                   blowing weather (null = none). Applies at any height.
 *   impliedVisFogSm - the same for fog/mist/haze/smoke/dust, which are
 *                   shallow: the caller applies it only to aircraft low
 *                   enough to be inside the layer (see visCeilingFor).
 *                   Both are applied as min(reported, implied), so a station
 *                   already reporting 800m fog is not penalised twice.
 *   fogAdd        - extra severity for aircraft LOW above the station (fog is
 *                   shallow; fades out between FOG_FULL_AGL_FT and FOG_ZERO_AGL_FT).
 *   precipAdd     - extra severity for slant/vertical visibility through
 *                   precipitation / thunderstorm / blowing weather (fades out
 *                   between PRECIP_FULL_AGL_FT and PRECIP_ZERO_AGL_FT).
 *   summary       - short human text for the dashboard / trace note.
 * severityAdd(wx, aglFt) combines them, capped at MAX_ADD so present weather
 * alone can lower a tier by roughly one step but never to the worst tier —
 * "informing, not dictating".
 *
 * Intermittent weather (SH, VC, TS, precipitation) is damped by a patchiness
 * multiplier and decays with observation age; fog/haze/mist persist and do not.
 *
 * All numbers are tuned guesses to be validated against the ground-truth log
 * (not_visible_weather entries), same provenance as the other constants.
 */
const PresentWeather = (() => {
  const MAX_ADD = 0.5;
  const FOG_FULL_AGL_FT = 1500, FOG_ZERO_AGL_FT = 3000;
  const PRECIP_FULL_AGL_FT = 5000, PRECIP_ZERO_AGL_FT = 10000;
  const SH_MULT = 0.6;       // showers are patchy
  const VC_MULT = 0.4;       // in the vicinity: not at the station itself
  const TRANSIENT_FULL_MIN = 20, TRANSIENT_ZERO_MIN = 100; // decay window (to a 0.5 floor)

  const DESCRIPTORS = ["MI", "PR", "BC", "DR", "BL", "SH", "TS", "FZ"];
  const PHENOMENA = ["DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP", "BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY", "PO", "SQ", "FC", "SS", "DS"];
  const TOKEN_RE = new RegExp(`^([-+]|VC)?((?:${DESCRIPTORS.join("|")}){0,2})((?:${PHENOMENA.join("|")}){0,2})$`);

  // [none, light, moderate, heavy]
  const PRECIP = {
    RA: { vis: [null, 7, 5, 2], add: [0, 0.1, 0.25, 0.5] },
    DZ: { vis: [null, 6, 4, 2], add: [0, 0.1, 0.2, 0.4] },
    SN: { vis: [null, 4, 3, 1], add: [0, 0.15, 0.3, 0.5] },
    SG: { vis: [null, 4, 3, 1], add: [0, 0.15, 0.3, 0.5] },
    PL: { vis: [null, 5, 4, 2], add: [0, 0.15, 0.3, 0.5] },
    UP: { vis: [null, 6, 5, 3], add: [0, 0.1, 0.2, 0.4] },
    GR: { vis: [null, 3, 3, 2], add: [0, 0.4, 0.4, 0.5] },
    GS: { vis: [null, 4, 4, 3], add: [0, 0.3, 0.3, 0.4] },
    IC: { vis: [null, 6, 6, 5], add: [0, 0.05, 0.05, 0.1] },
  };
  // vis ceiling (sm), fog-type add, applies-to-height group
  const OBSCURATION = {
    FG: { vis: 0.6, add: 0.6 },
    BR: { vis: 3, add: 0.2 },
    HZ: { vis: 4, add: 0.1 },
    FU: { vis: 4, add: 0.1 },
    DU: { vis: 4, add: 0.15 },
    SA: { vis: 4, add: 0.15 },
    VA: { vis: 2, add: 0.3 },
    SS: { vis: 1, add: 0.4 },
    DS: { vis: 1, add: 0.4 },
  };

  function _pairs(s) { const o = []; for (let i = 0; i < s.length; i += 2) o.push(s.slice(i, i + 2)); return o; }

  function _transientFactor(ageMin) {
    if (ageMin == null || ageMin <= TRANSIENT_FULL_MIN) return 1;
    return 1 - 0.5 * Math.min(1, (ageMin - TRANSIENT_FULL_MIN) / (TRANSIENT_ZERO_MIN - TRANSIENT_FULL_MIN));
  }

  /** @returns {{present:boolean, impliedVisSm:number|null, fogAdd:number, precipAdd:number, fogLike:boolean, summary:string}} */
  function analyse(wxString, ageMin) {
    const out = { present: false, impliedVisSm: null, impliedVisFogSm: null, fogAdd: 0, precipAdd: 0, fogLike: false, summary: "" };
    if (typeof wxString !== "string" || !wxString.trim()) return out;
    const tf = _transientFactor(ageMin);
    const notes = [];
    for (const raw of wxString.trim().toUpperCase().split(/\s+/)) {
      const m = raw.match(TOKEN_RE);
      if (!m || (!m[2] && !m[3])) continue;
      const prefix = m[1] || "";
      const descs = _pairs(m[2] || "");
      const phens = _pairs(m[3] || "");
      const level = prefix === "-" ? 1 : prefix === "+" ? 3 : 2;
      const vicinity = prefix === "VC";
      const shower = descs.includes("SH");
      const ts = descs.includes("TS");
      const shallow = descs.some(d => d === "MI" || d === "BC" || d === "PR");
      const blowing = descs.includes("BL");
      let mult = 1;
      if (vicinity) mult *= VC_MULT;
      if (shower) mult *= SH_MULT;
      let tokVis = null, tokFogVis = null, tokFog = 0, tokPrecip = 0, transient = false;

      for (const p of phens) {
        if (PRECIP[p]) {
          const v = PRECIP[p].vis[level], a = PRECIP[p].add[level];
          if (v != null && !vicinity) tokVis = tokVis == null ? v : Math.min(tokVis, v);
          tokPrecip = Math.max(tokPrecip, a * mult);
          transient = true;
        } else if (OBSCURATION[p]) {
          if (p === "FG" && shallow) { out.fogLike = true; continue; } // shallow fog: sky above stays clear
          const o = OBSCURATION[p];
          if (!vicinity) tokFogVis = tokFogVis == null ? o.vis : Math.min(tokFogVis, o.vis);
          tokFog = Math.max(tokFog, o.add * (vicinity ? VC_MULT : 1));
          out.fogLike = true;
        } else if (p === "SQ" || p === "FC") {
          tokPrecip = Math.max(tokPrecip, 0.4 * mult); transient = true;
        }
      }
      if (ts) { tokPrecip = Math.max(tokPrecip, 0.5 * (vicinity ? VC_MULT : 1)); if (!vicinity) tokVis = tokVis == null ? 3 : Math.min(tokVis, 3); transient = true; }
      if (blowing && !phens.some(p => PRECIP[p])) { tokVis = tokVis == null ? 3 : Math.min(tokVis, 3); tokPrecip = Math.max(tokPrecip, 0.15 * mult); transient = true; }
      if (descs.includes("FZ")) tokPrecip += 0.1 * mult;
      if (shower && tokVis != null) tokVis = Math.max(tokVis, 5); // showers: vis dips are local

      if (transient) tokPrecip *= tf;
      if (tokVis != null) out.impliedVisSm = out.impliedVisSm == null ? tokVis : Math.min(out.impliedVisSm, tokVis);
      if (tokFogVis != null) out.impliedVisFogSm = out.impliedVisFogSm == null ? tokFogVis : Math.min(out.impliedVisFogSm, tokFogVis);
      out.fogAdd = Math.max(out.fogAdd, tokFog);
      out.precipAdd = Math.max(out.precipAdd, tokPrecip);
      out.present = true;
      notes.push(raw);
    }
    out.fogAdd = Math.min(MAX_ADD, out.fogAdd);
    out.precipAdd = Math.min(MAX_ADD, out.precipAdd);
    out.summary = notes.join(" ");
    return out;
  }

  function _ramp(agl, full, zero) {
    if (agl <= full) return 1;
    if (agl >= zero) return 0;
    return (zero - agl) / (zero - full);
  }

  /** Extra severity (0..MAX_ADD) for an aircraft aglFt above the station's ground. */
  function severityAdd(wx, aglFt) {
    if (!wx || !wx.present || aglFt == null) return 0;
    const f = wx.fogAdd * _ramp(aglFt, FOG_FULL_AGL_FT, FOG_ZERO_AGL_FT);
    const p = wx.precipAdd * _ramp(aglFt, PRECIP_FULL_AGL_FT, PRECIP_ZERO_AGL_FT);
    return Math.min(MAX_ADD, Math.max(f, p));
  }

  /** The visibility ceiling (sm) that applies to an aircraft aglFt above the station, or null. */
  function visCeilingFor(wx, aglFt) {
    if (!wx || !wx.present) return null;
    let c = wx.impliedVisSm;
    if (wx.impliedVisFogSm != null && aglFt != null && aglFt < FOG_ZERO_AGL_FT) c = c == null ? wx.impliedVisFogSm : Math.min(c, wx.impliedVisFogSm);
    return c;
  }

  return { analyse, severityAdd, visCeilingFor, MAX_ADD, FOG_FULL_AGL_FT, FOG_ZERO_AGL_FT, PRECIP_FULL_AGL_FT, PRECIP_ZERO_AGL_FT };
})();

if (typeof module !== "undefined") module.exports = PresentWeather;
