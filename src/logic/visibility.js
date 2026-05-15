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

  const CATEGORIES = [
    { label: "Very likely visible", minAngle: 1.0,  color: "#4caf50", score: 100 },
    { label: "Likely visible",      minAngle: 0.35, color: "#8bc34a", score: 75 },
    { label: "Possible",            minAngle: 0.12, color: "#ffeb3b", score: 50 },
    { label: "Difficult",           minAngle: 0.05, color: "#ff9800", score: 25 },
    { label: "Unlikely",            minAngle: 0,    color: "#9e9e9e", score: 10 },
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
   * Returns: { label, color, score, angularSizeDeg, elevationDeg, slantRangeNm, isOverhead }
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
      cat = CATEGORIES[0]; // Very likely visible
    } else if (slantNm > 40) {
      // Beyond 40 NM: cap at Difficult
      cat = CATEGORIES.find(c => c.label === "Difficult") || CATEGORIES[3];
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
