/**
 * Geodesic utilities used throughout Eos.
 * All angle inputs/outputs in degrees unless stated.
 */

const Geo = (() => {
  const R_NM = 3440.065; // Earth radius in nautical miles
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
   * Great-circle distance in nautical miles.
   */
  function calculateDistanceNm(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Relative bearing: bearing to aircraft minus user's heading, normalised to [-180, 180].
   * Positive = right of heading, negative = left.
   */
  function calculateRelativeBearing(aircraftBearing, userHeading) {
    let rel = ((aircraftBearing - userHeading) % 360 + 360) % 360;
    if (rel > 180) rel -= 360;
    return rel;
  }

  /**
   * Project a relative bearing onto the screen edge.
   * Returns { x, y } in pixels from top-left, and { side } ('top'|'right'|'bottom'|'left'|'overhead').
   *
   * relativeBearing: degrees, [-180,180], 0 = straight ahead.
   * viewportWidth, viewportHeight: pixels.
   * safeInset: pixels reserved at each edge for UI chrome.
   */
  function projectToScreenEdge(relativeBearing, viewportWidth, viewportHeight, safeInset = 60) {
    const w = viewportWidth;
    const h = viewportHeight;
    const cx = w / 2;
    const cy = h * 0.65; // user icon sits ~65% down

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad); // positive = towards top (ahead)

    // Available edge bounds respecting safe zones
    const topY    = safeInset + 20;
    const bottomY = h - safeInset - 20;
    const leftX   = safeInset + 20;
    const rightX  = w - safeInset - 20;

    let x, y, side;

    // Scale factor to reach nearest edge
    const scaleX = sinA !== 0 ? (sinA > 0 ? (rightX - cx) : (cx - leftX)) / Math.abs(sinA) : Infinity;
    const scaleY = cosA !== 0 ? (cosA > 0 ? (cy - topY)    : (bottomY - cy)) / Math.abs(cosA) : Infinity;

    const scale = Math.min(scaleX, scaleY);

    x = Math.round(cx + sinA * scale);
    y = Math.round(cy - cosA * scale); // screen y is inverted

    // Clamp
    x = Math.max(leftX, Math.min(rightX, x));
    y = Math.max(topY, Math.min(bottomY, y));

    // Determine side label
    const absRel = Math.abs(relativeBearing);
    if (absRel <= 30) side = "top";
    else if (absRel >= 150) side = "bottom";
    else if (relativeBearing > 0) side = "right";
    else side = "left";

    return { x, y, side };
  }

  /**
   * Arrow rotation angle (CSS degrees) so ▲ points toward the aircraft.
   * relativeBearing 0 = ahead = arrow points up (0°).
   */
  function arrowRotation(relativeBearing) {
    return relativeBearing;
  }

  return {
    calculateBearing,
    calculateDistanceNm,
    calculateRelativeBearing,
    projectToScreenEdge,
    arrowRotation,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;
