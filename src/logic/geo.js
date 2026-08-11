/**
 * Geodesic utilities used throughout Eos.
 * All angle inputs/outputs in degrees unless stated.
 * Refactored to fully support strict SI metre calculations and 3D frustum perspective offsets.
 */

const Geo = (() => {
  const R_M = 6371000.0; // Earth radius in Metres (Fixed engine scale break)
  const R_NM = 3440.065; // Earth radius in nautical miles (Retained solely for ADS-B compliance)
  const DEG = Math.PI / 180;

  function toRad(d) { return d * DEG; }
  function toDeg(r) { return r / DEG; }

  /**
   * Bearing from point A to point B (degrees true, 0-360).
   */
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /**
   * Great-circle distance in Metres (Required for true 1:1 Vector Tile alignment).
   */
  function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Great-circle distance in nautical miles (Used strictly for aircraft airspeed correlation).
   */
  function calculateDistanceNm(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Relative bearing: bearing to aircraft minus user's heading, normalized to [-180, 180].
   * Positive = right of heading, negative = left.
   */
  function calculateRelativeBearing(aircraftBearing, userHeading) {
    let rel = ((aircraftBearing - userHeading) % 360 + 360) % 360;
    if (rel > 180) rel -= 360;
    return rel;
  }

  /**
   * True polar plot of a relative bearing + range: angle = bearing, radius =
   * distance, anchored at the same point the 3D camera anchors the user
   * (cx, cy = h*anchorY) — matching how the tilted camera already treats
   * "ahead" as most of the screen and "behind" as a small residual band,
   * rather than a classic radar's full symmetric circle. Replaces the old
   * edge-only projection (which placed every aircraft at the frame edge
   * regardless of distance) with a genuine bearing-as-angle/distance-as-
   * radius mapping — closer traffic now plots closer to the anchor, not
   * jammed onto the edge alongside everything else.
   *
   * @param {number} maxRangeNm  Range (nm) that maps to the full available
   *   radius; anything at or beyond it plots at the outer edge. Callers
   *   should pass something meaningful to their own filtering (e.g. the
   *   relevance teardrop's own dead-ahead range), so the plotted scale
   *   actually corresponds to "how close to the edge of relevance is this."
   */
  function projectToPolarPosition(relativeBearing, rangeNm, viewportWidth, viewportHeight, maxRangeNm, anchorY = 0.8, safeInset = 60) {
    const w = viewportWidth;
    const h = viewportHeight;
    const cx = w * 0.5;
    const cy = h * anchorY;

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    // Available boundaries from the anchor, respecting UI safety perimeters —
    // same asymmetric "generous ahead, tight behind" shape as before, since
    // that already matches the relevance teardrop's own asymmetry.
    const topY    = safeInset + 20;
    const bottomY = Math.min(h - safeInset - 20, cy + 40);
    const leftX   = safeInset + 20;
    const rightX  = w - safeInset - 20;

    const maxScaleX = sinA !== 0 ? (sinA > 0 ? (rightX - cx) : (cx - leftX)) / Math.abs(sinA) : Infinity;
    const maxScaleY = cosA !== 0 ? (cosA > 0 ? (cy - topY)    : (bottomY - cy)) / Math.abs(cosA) : Infinity;
    const maxRadiusPx = Math.min(maxScaleX, maxScaleY);

    const clampedNm = Math.max(0, Math.min(rangeNm, maxRangeNm));
    const radiusPx  = maxRangeNm > 0 ? (clampedNm / maxRangeNm) * maxRadiusPx : 0;

    const x = Math.round(cx + sinA * radiusPx);
    const y = Math.round(cy - cosA * radiusPx); // screen Y runs inverted

    return { x, y };
  }

  /**
   * Project a point forward from (lat, lon) by `distanceMeters` along a true
   * heading, using a flat-earth approximation (fine for the short distances
   * — tens to low hundreds of metres — this is used for).
   */
  function projectPosition(lat, lon, headingDeg, distanceMeters) {
    const metersPerDegreeLat = 111111;
    const metersPerDegreeLon = 111111 * Math.cos(toRad(lat));
    const headingRad = toRad(headingDeg);
    return {
      lat: lat + (distanceMeters * Math.cos(headingRad)) / metersPerDegreeLat,
      lon: lon + (distanceMeters * Math.sin(headingRad)) / (metersPerDegreeLon || 1e-9),
    };
  }

  return {
    calculateBearing,
    calculateDistanceMeters,
    calculateDistanceNm,
    calculateRelativeBearing,
    projectToPolarPosition,
    projectPosition,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;