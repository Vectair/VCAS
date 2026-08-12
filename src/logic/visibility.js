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
  // so rather than approximate further, these are sampled directly from a
  // real ND reference screenshot (red square ~#fd0000, amber circle
  // ~#fc9800, white diamond) — not darkened/adapted at all, since RAW's
  // basemap is always the same near-black regardless of Day/Night/Auto.
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
    { label: "Certainly visible",         minAngle: 0.5,   shape: "square",  fillOpacity: 1, color: "#e53935", colorDay: "#a3221d", colorRaw: "#ff2020", colorblindSafe: "#cc79a7", colorblindSafeDay: "#7e4b67", score: 100 },
    { label: "Likely visible",            minAngle: 0.167, shape: "circle",  fillOpacity: 1, color: "#ffd400", colorDay: "#8a6d00", colorRaw: "#ff9800", colorblindSafe: "#f0e442", colorblindSafeDay: "#948d28", score: 66 },
    { label: "Possibly visible",          minAngle: 0.05,  shape: "diamond", fillOpacity: 1, color: "#2dd4bf", colorDay: "#0e6a7d", colorRaw: "#ffffff", colorblindSafe: "#0072b2", colorblindSafeDay: "#00466e", score: 33 },
    { label: "Very unlikely/not visible", minAngle: 0,     shape: "diamond", fillOpacity: 0, color: "#2dd4bf", colorDay: "#0e6a7d", colorRaw: "#ffffff", colorblindSafe: "#0072b2", colorblindSafeDay: "#00466e", score: 10 },
  ];

  const NM_TO_M = 1852;

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
   * Estimate visual detectability of an aircraft.
   *
   * Returns: { label, color, colorRaw, shape, fillOpacity, score, angularSizeDeg, elevationDeg, slantRangeNm, isOverhead }
   */
  function estimate(userLat, userLon, aircraft) {
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
    } else if (slantNm > 40) {
      // Beyond 40 NM: cap at Possibly visible, even if angular size (e.g. a
      // very large aircraft) would otherwise put it higher — haze/curvature
      // at that range isn't modelled, so don't overstate confidence.
      cat = CATEGORIES.find(c => c.label === "Possibly visible") || CATEGORIES[2];
    } else {
      cat = CATEGORIES.find(c => angularSizeDeg >= c.minAngle) || CATEGORIES[CATEGORIES.length - 1];
    }

    // Stale data degrades the category
    if (lastSeenSeconds > 20 && cat.score > 10) {
      const idx = CATEGORIES.indexOf(cat);
      cat = CATEGORIES[Math.min(idx + 1, CATEGORIES.length - 1)];
    }

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

  return { estimate };
})();

if (typeof module !== "undefined") module.exports = Visibility;
