/**
 * MetarWx — pure decoding helpers for the "Weather" screen (see app.js's
 * openWeatherScreen()/CLAUDE.md's dated entry for this feature): turns the
 * raw METAR fields MetarProvider already fetches (cloud layers, present-
 * weather codes, visibility) into plain-English text. No network, no DOM —
 * every function here is a pure string/array transform, verified the same
 * way every other src/logic/ file in this project is (see
 * tests/logic/metarWx.test.js).
 *
 * SCOPE, stated plainly: this is a standalone weather-REPORTING feature
 * (2026-09-23, direct instruction) — cloud amount/height, visibility, and
 * present weather (rain/fog/snow/etc), reachable from its own top-bar icon,
 * deliberately kept OUT of the principal RAW/Hybrid/AIR views. This is a
 * conscious, explicit exception to this project's own earlier "we don't
 * need to display any additional information beyond what feeds navigation/
 * identification" rule (see CLAUDE.md's "What VCAS is, and isn't" section,
 * which explicitly rejected a full METAR/TAF display) — recorded here so a
 * future reader doesn't read the two as an unnoticed contradiction: the
 * project owner gave a direct, current instruction for exactly this, which
 * supersedes the earlier rejection for this one feature. Kept deliberately
 * narrow regardless (no TAF, no forecast, no temp/dewpoint/pressure/wind —
 * none of that was asked for), matching this project's own "don't build
 * beyond what's asked" convention.
 *
 * Present-weather decoding follows the real WMO METAR present-weather code
 * table (intensity +/-/VC, then 0-2 descriptor codes, then 1-2 phenomenon
 * codes) — a real, standardised aviation encoding, not an app-specific
 * invention. Deliberately NOT an exhaustive implementation of every
 * grammatically-valid combination: an unrecognised token passes through as
 * its own raw code text rather than being dropped or guessed at — matching
 * this project's own "never a crash or a silently wrong value" discipline
 * already established for MetarProvider's own defensive parsing.
 */
const MetarWx = (() => {
  const COVER_LABELS = {
    SKC: "Sky clear",
    CLR: "Clear",
    NSC: "No significant cloud",
    NCD: "No cloud detected",
    FEW: "Few",
    SCT: "Scattered",
    BKN: "Broken",
    OVC: "Overcast",
    VV: "Sky obscured",
  };
  const CEILING_COVERS = ["BKN", "OVC", "VV"];
  const CLEAR_COVERS = ["SKC", "CLR", "NSC", "NCD"];

  // All lowercase deliberately — these get joined mid-sentence with an
  // intensity word ahead of them ("Heavy thunderstorm with rain"); only the
  // FINAL assembled string gets its first letter capitalised (_capitalize,
  // applied once at the end), not each individual word.
  const INTENSITY_LABELS = { "-": "Light", "+": "Heavy" }; // no prefix = moderate, left unlabelled
  const DESCRIPTOR_LABELS = {
    MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting",
    BL: "blowing", SH: "showers of", TS: "thunderstorm with", FZ: "freezing",
  };
  // Descriptor codes that can also stand alone (no trailing phenomenon code)
  // in real-world METARs, e.g. bare "TS"/"VCTS" — a real grammar quirk
  // worth handling explicitly rather than letting these fall through
  // unrecognised. Also all lowercase, same reasoning.
  const STANDALONE_DESCRIPTOR_LABELS = {
    TS: "thunderstorm", SH: "showers", BL: "blowing", DR: "low drifting", FZ: "freezing conditions",
  };
  const PHENOMENON_LABELS = {
    DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals",
    PL: "ice pellets", GR: "hail", GS: "small hail/snow pellets", UP: "unknown precipitation",
    BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "widespread dust",
    SA: "sand", HZ: "haze", PY: "spray", PO: "dust/sand whirls", SQ: "squalls",
    FC: "funnel cloud", SS: "sandstorm", DS: "duststorm",
  };
  const DESCRIPTOR_CODES = "MI|PR|BC|DR|BL|SH|TS|FZ";
  const PHENOMENON_CODES = "DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS";
  const FULL_TOKEN_RE = new RegExp(
    `^([-+]|VC)?((?:${DESCRIPTOR_CODES}){0,2})((?:${PHENOMENON_CODES}){1,2})$`
  );
  const DESCRIPTOR_ONLY_RE = new RegExp(`^([-+]|VC)?((?:${DESCRIPTOR_CODES}){1,2})$`);

  function _splitPairs(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 2) out.push(str.slice(i, i + 2));
    return out;
  }

  function _capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /** @returns {{code:string, label:string, recognised:boolean}} */
  function decodeToken(rawToken) {
    const code = String(rawToken || "").trim().toUpperCase();
    if (!code) return null;
    if (code === "NSW") return { code, label: "No significant weather", recognised: true };

    let m = FULL_TOKEN_RE.exec(code);
    if (m) {
      const [, intensityRaw, descriptorsRaw, phenomenaRaw] = m;
      const vicinity = intensityRaw === "VC";
      const intensity = !vicinity && intensityRaw ? INTENSITY_LABELS[intensityRaw] : null;
      const descriptors = _splitPairs(descriptorsRaw).map(d => DESCRIPTOR_LABELS[d]).filter(Boolean);
      const phenomena = _splitPairs(phenomenaRaw).map(p => PHENOMENON_LABELS[p]).filter(Boolean);
      const parts = [];
      if (intensity) parts.push(intensity);
      parts.push(...descriptors);
      if (phenomena.length) parts.push(phenomena.join(" and "));
      let label = _capitalize(parts.filter(Boolean).join(" "));
      if (vicinity) label += " in the vicinity";
      return { code, label, recognised: true };
    }

    m = DESCRIPTOR_ONLY_RE.exec(code);
    if (m) {
      const [, intensityRaw, descriptorsRaw] = m;
      const vicinity = intensityRaw === "VC";
      const intensity = !vicinity && intensityRaw ? INTENSITY_LABELS[intensityRaw] : null;
      const words = _splitPairs(descriptorsRaw).map(d => STANDALONE_DESCRIPTOR_LABELS[d]).filter(Boolean);
      if (words.length) {
        const parts = intensity ? [intensity, ...words] : words;
        let label = _capitalize(parts.join(" "));
        if (vicinity) label += " in the vicinity";
        return { code, label, recognised: true };
      }
    }

    // Unrecognised — pass through as its own raw code rather than dropping
    // it or guessing; the caller can still show SOMETHING rather than
    // nothing for an oddball/rare code this table doesn't cover.
    return { code, label: code, recognised: false };
  }

  /**
   * @param {string|null} wxString  METAR's raw present-weather group(s),
   *   space-separated (e.g. "-RA BR", "+TSRA", "VCFG").
   * @returns {Array<{code:string, label:string, recognised:boolean}>}
   *   Empty array for no/blank input — "no weather reported" is the
   *   caller's job to phrase, not this function's.
   */
  function decode(wxString) {
    if (!wxString) return [];
    return String(wxString)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(decodeToken)
      .filter(Boolean);
  }

  /** @param {string} cover  A METAR cloud-cover code (BKN, FEW, SKC, ...). */
  function cloudLabel(cover) {
    const key = String(cover || "").trim().toUpperCase();
    return COVER_LABELS[key] || key;
  }

  /**
   * One-line sky summary for a report header — the lowest CEILING-forming
   * layer (BKN/OVC/VV) if one exists (matching how a real weather briefing
   * would describe it: "the ceiling"), else a plain "Clear"-family label if
   * reported, else the highest FEW/SCT layer if that's all there is.
   * @param {Array<{cover:string, baseFt:number|null}>} clouds
   */
  function summariseSky(clouds) {
    if (!Array.isArray(clouds) || clouds.length === 0) return "No cloud reported";

    const ceilings = clouds
      .filter(l => l && CEILING_COVERS.includes(String(l.cover || "").toUpperCase()) && l.baseFt != null)
      .sort((a, b) => a.baseFt - b.baseFt);
    if (ceilings.length) {
      const c = ceilings[0];
      return `${cloudLabel(c.cover)} at ${Math.round(c.baseFt).toLocaleString()}ft`;
    }

    const clear = clouds.find(l => l && CLEAR_COVERS.includes(String(l.cover || "").toUpperCase()));
    if (clear) return cloudLabel(clear.cover);

    const rest = clouds
      .filter(l => l && l.baseFt != null)
      .sort((a, b) => b.baseFt - a.baseFt);
    if (rest.length) {
      const c = rest[0];
      return `${cloudLabel(c.cover)} at ${Math.round(c.baseFt).toLocaleString()}ft`;
    }

    return "No cloud reported";
  }

  const SM_TO_KM = 1.60934;

  /**
   * @param {number|null} sm  Prevailing visibility in statute miles
   *   (MetarProvider's own visibilitySm field).
   * @returns {{sm:number, km:number, label:string}|null}
   */
  function formatVisibility(sm) {
    if (sm == null || typeof sm !== "number" || !Number.isFinite(sm)) return null;
    const capped = sm >= 10;
    const km = sm * SM_TO_KM;
    const miTxt = capped ? "10+" : String(Math.round(sm * 10) / 10);
    const kmTxt = capped ? Math.round(10 * SM_TO_KM) + "+" : (Math.round(km * 10) / 10).toFixed(1);
    return { sm, km, label: `${miTxt} mi (${kmTxt} km)` };
  }

  return { decode, decodeToken, cloudLabel, summariseSky, formatVisibility };
})();

if (typeof module !== "undefined") module.exports = MetarWx;
