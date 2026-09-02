/**
 * Deterministic visibility estimator.
 *
 * Assumptions for V1: flat terrain, no buildings, no cloud/haze/rain, daylight,
 * user at ground level.
 */

const Visibility = (() => {
  // Wingspan/span lookup in metres (approximate)
  const AIRCRAFT_SIZE_METRES = {
    A388: 80, A389: 80,
    B748: 76, B744: 68, B743: 68,
    A359: 67, A35K: 67,
    B772: 64, B773: 64, B77L: 64, B77W: 64,
    A333: 60, A332: 60, A339: 60,
    B763: 53, B762: 53,
    A321: 36, A320: 36, A319: 36, A318: 36,
    B738: 36, B737: 36, B739: 36,
    B752: 38, B753: 38,
    E195: 31, E190: 29, E75L: 26, E75S: 26, E170: 26,
    CRJ9: 24, CRJ7: 21, CRJ2: 21,
    AT75: 27, AT72: 27, AT45: 25,
    DH8D: 28, DH8C: 27, DH8B: 26,
    C172: 11, C182: 11, C208: 15, C25B: 17, C25A: 16,
    P28A: 11, PA28: 11,
    PC12: 16,
    SF50: 12,
    EC45: 11, EC35: 10, H145: 11, H135: 10, H125: 10,
    AS50: 10, R44:   9, R22:   7,
    B06:   9, B407: 10, B412: 14,
    GLF6: 29, GLF5: 29, F900: 19, F7X:  19, C56X: 15, C68A: 18,
    B58:  11,
  };

  const FALLBACK_SIZES = {
    HEAVY_JET:    60,
    MEDIUM_JET:   35,
    LIGHT_JET:    17,
    LIGHT_AIRCRAFT: 12,
    HELICOPTER:   11,
    UNKNOWN:      25,
  };

  // Shape + colour follow TCAS's own symbology (hollow diamond -> filled
  // diamond -> amber/yellow circle -> red square), reinterpreted for VCAS's
  // rules of outright *sightability* rather than TCAS's rules of collision
  // risk: a red square means "you should certainly be able to see this,"
  // not "resolve an RA." Four tiers, not five — collapsed from an earlier
  // five-step version down to exactly the states real TCAS uses. fillOpacity
  // is a fixed, hardcoded step per tier (not a continuous formula) —
  // matching real TCAS, where every symbol is either fully hollow or fully
  // solid, nothing in between.
  //
  // minAngle dividers are the apparent (angular) size of the aircraft's
  // wingspan as seen from the observer — literal cutoffs applied to every
  // aircraft, not illustrative examples. They're anchored to real numbers
  // where they exist:
  //  - 0.5° (30 arcmin) for "certainly visible" is the Moon/Sun's own
  //    apparent diameter as seen from Earth (~29-33 arcmin, averaging ~31) —
  //    a well-known, independently verifiable reference size for "you could
  //    not miss this if you looked."
  //  - 1 arcminute (0.0167°) is the standard 20/20 visual-acuity resolving
  //    power (Snellen). The two lower dividers are built as small multiples
  //    of that: ~3 arcmin (0.05°) for "large enough to be a noticeable
  //    contrasty shape once you're looking at the right bearing" (possibly
  //    visible), ~10 arcmin (0.167°) for "large enough to actually resolve
  //    as a recognisable aircraft shape, not just a mark" (likely visible).
  //    These two multiples are a principled optics/vision-science estimate,
  //    not a single peer-reviewed figure — the most directly relevant paper
  //    (Watson & Ramirez, "Predicting Visibility of Aircraft," PLOS ONE
  //    2009) models exactly this problem via contrast + angular size, but
  //    its full text wasn't reachable to pull an exact number from here.
  //
  // color: chosen to echo real TCAS traffic-display colours as closely as
  // the app's own day/night theme allows — cyan/turquoise for the diamond
  // ("other"/"proximate" traffic) family, amber/yellow for the circle (TA)
  // family, red for the square (RA) family, all standard across TCAS-
  // equipped flight decks. colorDay is a darker, more saturated variant of
  // the same hue for the day theme's light background — the night values
  // (especially the vivid cyan and yellow) would be unreadably pale there.
  //
  // colorRaw: RAW display style is meant to be as close a match to a real
  // TCAS/ND instrument screen as practical (Settings -> NAV display style),
  // so rather than approximate further, these are pixel-sampled directly
  // from a real ND reference photo (red square peak (251,0,10), amber
  // circle peak (255,155,20), white diamond peak ~(248,248,248)) — not
  // darkened/adapted at all, since RAW's basemap is always the same black
  // regardless of Day/Night/Auto. (The literal colorRaw values below had
  // drifted slightly off this comment's own stated sample — realigned.)
  // Overridden by colorblindSafe when the colour-blind toggle is on, same
  // as every other style — accessibility wins over reference-fidelity.
  //
  // colorblindSafe/colorblindSafeDay: NOT trying to match real TCAS colour
  // — a separate palette built purely for hue-separation, reusing the exact
  // Okabe-Ito hues (Okabe & Ito, "Color Universal Design", 2008) already
  // validated earlier for this app: blue for the diamond family, yellow for
  // the circle family (Okabe-Ito's own "yellow," now free to use here since
  // the main palette's circle moved off orange), reddish-purple for the
  // square family — chosen for maximum pairwise separation under
  // protanopia/deuteranopia (the common red-green deficiencies, ~8% of
  // men). One toggle, not several per-deficiency-type modes. Rarer types
  // (tritanopia, full achromatopsia) are covered by the hue-independent
  // shape+fillOpacity channel, so the tier is legible from outline/fill
  // alone even with zero colour perception.
  const CATEGORIES = [
    { label: "Certainly visible",         minAngle: 0.5,   shape: "square",  fillOpacity: 1, color: "#e53935", colorDay: "#a3221d", colorRaw: "#fb000a", colorblindSafe: "#cc79a7", colorblindSafeDay: "#7e4b67", score: 100 },
    { label: "Likely visible",            minAngle: 0.167, shape: "circle",  fillOpacity: 1, color: "#ffd400", colorDay: "#8a6d00", colorRaw: "#ff9b14", colorblindSafe: "#f0e442", colorblindSafeDay: "#948d28", score: 66 },
    { label: "Possibly visible",          minAngle: 0.05,  shape: "diamond", fillOpacity: 1, color: "#2dd4bf", colorDay: "#0e6a7d", colorRaw: "#ffffff", colorblindSafe: "#0072b2", colorblindSafeDay: "#00466e", score: 33 },
    { label: "Very unlikely/not visible", minAngle: 0,     shape: "diamond", fillOpacity: 0, color: "#2dd4bf", colorDay: "#0e6a7d", colorRaw: "#ffffff", colorblindSafe: "#0072b2", colorblindSafeDay: "#00466e", score: 10 },
  ];

  const NM_TO_M = 1852;
  const NM_PER_SM = 0.868976;

  // A high-flying jet's angular size alone often underrates it — the
  // airframe itself may be a barely-resolvable dot, but its contrail is a
  // bright, obvious streak. Neither figure is derived from any formal
  // model (no upper-air temperature/humidity data source exists in VCAS,
  // and adding one would be exactly the kind of weather-display scope this
  // project has explicitly rejected — see CLAUDE.md) — both are the
  // project owner's own field experience, same as pinchExponent/
  // overheadElevationDeg in relevance.js are tuned constants, not
  // physically derived ones. CONTRAIL_MIN_ALTITUDE_FT (26,000ft) is a
  // round, defensible floor for where contrails typically start forming in
  // temperate climates. CONTRAIL_MAX_RANGE_NM (50nm) is specifically an
  // *identification* range, not a raw-visibility one — the owner's own
  // words: "beyond that they can still be seen but I couldn't definitively
  // say they were from a certain aircraft." Matches (and replaces) the
  // 40nm range extension cap Relevance used pending this real number —
  // see relevance.js's rangeExtensionCapNm.
  const CONTRAIL_MIN_ALTITUDE_FT = 26000;
  const CONTRAIL_MAX_RANGE_NM = 50;

  // Local obstruction (buildings/wooded landcover, 2026-09-02) — see
  // _applyLocalObstructionAdjustment()'s own comment for the full
  // reasoning. Both field-tuned guesses, same honesty-about-provenance as
  // the contrail constants above: not derived from anything, a starting
  // point pending real-world calibration once LocalObstruction has
  // accumulated real density data across known open/suburban/urban/
  // wooded reference locations (see CLAUDE.md).
  const LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG = 12;
  const LOCAL_OBSTRUCTION_DENSE_THRESHOLD = 0.45;

  function _sizeForType(typeCode) {
    if (!typeCode) return FALLBACK_SIZES.UNKNOWN;
    const key = typeCode.toUpperCase().trim();
    if (AIRCRAFT_SIZE_METRES[key]) return AIRCRAFT_SIZE_METRES[key];

    // Category fallback based on ADS-B category code (A1–A7, B1–B7)
    return FALLBACK_SIZES.UNKNOWN;
  }

  function _categoryFallbackFromLabel(category) {
    if (!category) return FALLBACK_SIZES.UNKNOWN;
    const c = category.toUpperCase();
    if (c.includes("HEAVY")) return FALLBACK_SIZES.HEAVY_JET;
    if (c.includes("LARGE")) return FALLBACK_SIZES.MEDIUM_JET;
    if (c.includes("SMALL")) return FALLBACK_SIZES.LIGHT_AIRCRAFT;
    if (c.includes("HELIC") || c.includes("ROTOR")) return FALLBACK_SIZES.HELICOPTER;
    return FALLBACK_SIZES.UNKNOWN;
  }

  /**
   * The lowest cloud layer that could actually occlude an aircraft at
   * `altitudeFt` — only BKN/OVC/VV layers whose base sits below it (see
   * MetarProvider, which drops FEW/SCT before this ever runs, since a
   * mostly-clear sky barely matters). Only the LOWEST such layer matters:
   * once line of sight hits a broken/overcast/obscured layer, whatever's
   * above it is moot regardless of how many more layers are reported
   * higher up.
   *
   * Compares against `layer.baseMslFt` (2026-09-02 fix), not the raw
   * `baseFt` — METAR cloud bases are reported AGL relative to the
   * reporting STATION, while `altitudeFt` (ADS-B) is MSL-referenced.
   * Comparing the two directly (the original bug) could misjudge whether
   * a layer is actually below the aircraft, especially at an elevated
   * station. `baseMslFt` is computed once in metarProvider.js, where
   * station elevation is known; see that file's own comment for the real
   * example that confirmed this. Falls back to `baseFt` if `baseMslFt`
   * somehow isn't set (defensive only — metarProvider.js always sets it
   * once baseFt itself is non-null).
   */
  function _lowestOccludingLayer(clouds, altitudeFt) {
    if (!Array.isArray(clouds) || altitudeFt == null) return null;
    let lowest = null;
    let lowestBase = null;
    for (const layer of clouds) {
      const base = layer.baseMslFt != null ? layer.baseMslFt : layer.baseFt;
      if (base == null || base >= altitudeFt) continue;
      if (!lowest || base < lowestBase) { lowest = layer; lowestBase = base; }
    }
    return lowest;
  }

  /**
   * Caps a category at "Possibly visible" — used for both partial cloud
   * occlusion (BKN) and reduced reported ground visibility, neither of
   * which should ever make an already-worse tier (e.g. a stale-degraded
   * one) read as better.
   */
  function _capAtPossiblyVisible(cat) {
    const possiblyIdx = CATEGORIES.findIndex(c => c.label === "Possibly visible");
    const curIdx = CATEGORIES.indexOf(cat);
    return CATEGORIES[Math.max(curIdx, possiblyIdx)];
  }

  /**
   * Adjusts a base angular-size category using current METAR conditions —
   * strictly a scoring input (see MetarProvider's own docstring for why:
   * this app's two principles are navigation and identification, not a
   * weather display). Two independent mechanisms:
   *
   *  1. Cloud occlusion (vertical): an OVC/VV layer below the aircraft is
   *     treated as a near-total block on line of sight — not a dimmer, a
   *     wall — dropping straight to the bottom tier regardless of how
   *     large/close the aircraft would otherwise read. BKN (broken, real
   *     gaps but contested LOS) gets a partial cap instead of a full drop.
   *  2. Reported prevailing visibility (horizontal haze): replaces the
   *     generic, always-on 40NM cap in the base estimate with the day's
   *     actual reported figure, but only when it's meaningfully below
   *     "good" (<10SM) — many stations cap their reportable value at
   *     10SM even on much clearer days, so treating that as a real limit
   *     would make ordinary good-visibility days needlessly pessimistic.
   *     Compared against `horizNm` (2026-09-02 fix), not slant range —
   *     prevailing/surface visibility is a horizontal atmospheric-path
   *     measurement, not a spherical radius around the station. Using
   *     slant range (the original bug) could wrongly penalize a high,
   *     near-overhead aircraft purely for its vertical distance, which
   *     the METAR gives no actual basis for judging.
   *
   * No-ops entirely (returns `cat` unchanged) when `metar` is null/absent,
   * so this is fully opt-in from the caller's side.
   *
   * KNOWN GAP, not fixed here (2026-09-02): when no BKN/OVC/VV layer is
   * reported at all, `_lowestOccludingLayer` returns null and this
   * function's cloud check silently no-ops — but METAR/CAVOK only
   * actually characterizes the surface-to-~5,000ft column and prevailing
   * visibility; it says nothing about an unreported mid/upper-level layer
   * (e.g. a jet at FL320 could be sitting above a real but unreported
   * OVC deck at FL180-230). "No cloud reported" is being read as
   * "confirmed clear to the aircraft's altitude," which isn't actually
   * what METAR promises. Fixing this properly needs an upper-air data
   * source METAR itself can't provide (a global model like ECMWF/GFS —
   * scoped separately, not built yet) — deliberately NOT patching this
   * with an interim confidence cap here, since without real upper-air
   * data any such cap would be an uncalibrated guess that risks fighting
   * the contrail-rescue logic above. See CLAUDE.md for the full writeup.
   */
  function _applyMetarAdjustment(cat, altitudeFt, horizNm, metar) {
    if (!metar) return cat;

    const occluding = _lowestOccludingLayer(metar.clouds, altitudeFt);
    if (occluding) {
      if (occluding.cover === "OVC" || occluding.cover === "VV") {
        return CATEGORIES[CATEGORIES.length - 1]; // "Very unlikely/not visible"
      }
      if (occluding.cover === "BKN") {
        cat = _capAtPossiblyVisible(cat);
      }
    }
    // else: no occluding layer reported — see the KNOWN GAP note above.

    if (metar.visibilitySm != null && metar.visibilitySm < 10) {
      const visNm = metar.visibilitySm * NM_PER_SM;
      if (horizNm > visNm) {
        cat = _capAtPossiblyVisible(cat);
      }
    }

    return cat;
  }

  /**
   * Adjusts for the observer's immediate physical surroundings — a coarse,
   * non-directional prior from LocalObstruction.getCached() (see that
   * module and EosMap.queryLocalDensity(), src/map.js): the fraction of
   * building/wooded-landcover area within a fixed radius of the observer.
   *
   * This deliberately does NOT claim "a specific building blocks this
   * specific bearing" — it answers a narrower, honest question: "is the
   * observer's immediate area generally hostile to spotting low-angle
   * traffic?" Gated on TWO conditions together, not either alone — dense
   * surroundings shouldn't penalize a high aircraft (nothing at ground
   * level is between you and it), and a low aircraft over open terrain
   * shouldn't be penalized just because the elevation happens to be low:
   *
   *   local density × low elevation angle, not either alone.
   *
   * Same downward-only, cap-not-raise discipline as _applyMetarAdjustment
   * — reuses _capAtPossiblyVisible. Binary for v1 (dense-enough or not),
   * not a continuous response curve — the density threshold itself is a
   * genuine field-tuned guess (see LOCAL_OBSTRUCTION_DENSE_THRESHOLD's own
   * comment), not something to refine here without real calibration data.
   *
   * `veryClose` (the existing <1nm && <500ft override, which forces
   * "Certainly visible" upstream in estimate()) is explicitly exempted —
   * a coarse, non-directional density prior shouldn't be allowed to
   * override a rule that's already effectively a high-confidence,
   * close-range claim.
   *
   * No-ops entirely when `localObstruction` is null/absent (no map query
   * has ever succeeded, or the data is genuinely unavailable) — absence
   * of this data must never itself reduce a score, same discipline
   * LocalObstruction.refresh() itself already guarantees on its own side.
   */
  function _applyLocalObstructionAdjustment(cat, elevationDeg, localObstruction, veryClose) {
    if (!localObstruction || veryClose) return cat;
    if (elevationDeg > LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG) return cat;
    if (localObstruction.combinedDensity < LOCAL_OBSTRUCTION_DENSE_THRESHOLD) return cat;
    return _capAtPossiblyVisible(cat);
  }

  /**
   * Estimate visual detectability of an aircraft.
   *
   * @param {object} [metar]  Current METAR context from MetarProvider.getCached()
   *   — { clouds: [{cover, baseFt, baseMslFt}], visibilitySm, elevationFt }.
   *   Omit/null for no adjustment (matches all prior behaviour exactly).
   * @param {object} [localObstruction]  Current LocalObstruction.getCached()
   *   snapshot — { buildingDensity, vegetationDensity, combinedDensity,
   *   radiusM }. Omit/null for no adjustment.
   *
   * Returns: { label, color, colorRaw, shape, fillOpacity, score, angularSizeDeg, elevationDeg, slantRangeNm, isOverhead }
   */
  function estimate(userLat, userLon, aircraft, metar, localObstruction) {
    const { lat, lon, altitudeFt, type, category, lastSeenSeconds } = aircraft;

    const horizNm = Geo.calculateDistanceNm(userLat, userLon, lat, lon);
    const altM = (altitudeFt != null ? altitudeFt : 0) * 0.3048;
    const horizM = horizNm * NM_TO_M;

    const slantM = Math.sqrt(horizM * horizM + altM * altM);
    const slantNm = slantM / NM_TO_M;

    const elevationDeg = altM > 0 && horizM > 0
      ? Math.atan2(altM, horizM) * (180 / Math.PI)
      : 0;

    const isOverhead = elevationDeg > 70;

    const sizem = _sizeForType(type) || _categoryFallbackFromLabel(category) || FALLBACK_SIZES.UNKNOWN;
    const angularSizeDeg = slantM > 0 ? (57.3 * sizem / slantM) : 0;

    // Very close and low aircraft
    const veryClose = horizNm < 1 && altitudeFt != null && altitudeFt < 500;

    let cat;

    if (veryClose) {
      cat = CATEGORIES[0]; // Certainly visible
    } else if (
      altitudeFt != null && altitudeFt >= CONTRAIL_MIN_ALTITUDE_FT && slantNm <= CONTRAIL_MAX_RANGE_NM
    ) {
      // High and close enough to plausibly be identifiable by contrail —
      // never worse than "Possibly visible" even when angular size alone
      // would rate it lower, but never overrides a BETTER angular-size
      // result either (a big, close-enough-to-clearly-see jet stays at
      // whatever its own size already earned it).
      const angularCat = CATEGORIES.find(c => angularSizeDeg >= c.minAngle) || CATEGORIES[CATEGORIES.length - 1];
      const possiblyIdx = CATEGORIES.findIndex(c => c.label === "Possibly visible");
      cat = CATEGORIES[Math.min(CATEGORIES.indexOf(angularCat), possiblyIdx)];
    } else if (slantNm > 40) {
      // Beyond 40 NM: cap at Possibly visible, even if angular size (e.g. a
      // very large aircraft) would otherwise put it higher — haze/curvature
      // at that range isn't modelled, so don't overstate confidence. The
      // contrail case above is deliberately checked first and can reach
      // out to 50nm — this is the fallback for anything too low to
      // plausibly contrail but somehow still this far out (predicted-entry
      // lookahead, mostly).
      cat = CATEGORIES.find(c => c.label === "Possibly visible") || CATEGORIES[2];
    } else {
      cat = CATEGORIES.find(c => angularSizeDeg >= c.minAngle) || CATEGORIES[CATEGORIES.length - 1];
    }

    // Stale data degrades the category
    if (lastSeenSeconds > 20 && cat.score > 10) {
      const idx = CATEGORIES.indexOf(cat);
      cat = CATEGORIES[Math.min(idx + 1, CATEGORIES.length - 1)];
    }

    cat = _applyMetarAdjustment(cat, altitudeFt, horizNm, metar);
    cat = _applyLocalObstructionAdjustment(cat, elevationDeg, localObstruction, veryClose);

    return {
      label: cat.label,
      color: cat.color,
      colorDay: cat.colorDay,
      colorRaw: cat.colorRaw,
      colorblindSafe: cat.colorblindSafe,
      colorblindSafeDay: cat.colorblindSafeDay,
      shape: cat.shape,
      fillOpacity: cat.fillOpacity,
      score: cat.score,
      angularSizeDeg,
      elevationDeg,
      slantRangeNm: slantNm,
      isOverhead,
    };
  }

  /**
   * Read-only access to the 4 sightability tiers, for display purposes
   * (the onboarding legend) rather than scoring — a shallow copy per call
   * so a caller can't mutate the real CATEGORIES table.
   */
  function getCategories() {
    return CATEGORIES.map((c) => ({ ...c }));
  }

  return { estimate, getCategories };
})();

if (typeof module !== "undefined") module.exports = Visibility;
