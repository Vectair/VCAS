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
   * Project a relative bearing onto the screen edge.
   * Leverages exponential perspective scaling factors to correct for a tilted 3D map horizon.
   */
  function projectToScreenEdge(relativeBearing, viewportWidth, viewportHeight, anchorY = 0.8, cameraPitch = 55, safeInset = 60) {
    const w = viewportWidth;
    const h = viewportHeight;
    const cx = w * 0.5;
    
    // Dynamically lock target Y generation base directly to the evaluated vehicle core axis
    const cy = h * anchorY; 

    const angleRad = toRad(relativeBearing);
    
    // Apply 3D perspective warp compensation
    const perspectiveCompressionFactor = (cameraPitch > 0) ? Math.cos(toRad(cameraPitch)) : 1.0;
    
    const sinA = Math.sin(angleRad);
    
    // Compresses forward vectors to counteract the matrix distortion skew
    const cosA = Math.cos(angleRad) * (1.0 / perspectiveCompressionFactor); 

    // Available edge boundaries respecting UI safety perimeters
    const topY    = safeInset + 20;
    
    // --- FIXED: SCALE BOTTOM LIMIT TO PUSH LABELS ABOVE THE RADIAL SHADOW ---
    // Instead of computing relative to absolute screen floor, lock the bottom boundary
    // closely to your vehicle anchor axis to prevent targets slipping down behind the HUD panels.
    const bottomY = Math.min(h - safeInset - 20, cy + 40); 
    
    const leftX   = safeInset + 20;
    const rightX  = w - safeInset - 20;

    let x, y, side;

    // Scale factors calculating the boundary intercept coordinates
    const scaleX = sinA !== 0 ? (sinA > 0 ? (rightX - cx) : (cx - leftX)) / Math.abs(sinA) : Infinity;
    const scaleY = cosA !== 0 ? (cosA > 0 ? (cy - topY)    : (bottomY - cy)) / Math.abs(cosA) : Infinity;

    const scale = Math.min(scaleX, scaleY);

    x = Math.round(cx + sinA * scale);
    y = Math.round(cy - cosA * scale); // Screen coordinates run inverted

    // Enforce layout edge clamping bounds
    x = Math.max(leftX, Math.min(rightX, x));
    y = Math.max(topY, Math.min(bottomY, y));

    // Refactored context side categorization logic to balance viewport layouts
    if (y <= topY + 5) {
      side = "top";
    } else if (y >= bottomY - 5) {
      side = "bottom";
    } else if (x >= rightX - 5) {
      side = "right";
    } else {
      side = "left";
    }

    return { x, y, side };
  }

  /**
   * Arrow rotation angle (CSS degrees) so ▲ points toward the aircraft.
   */
  function arrowRotation(relativeBearing) {
    return relativeBearing;
  }

  return {
    calculateBearing,
    calculateDistanceMeters,
    calculateDistanceNm,
    calculateRelativeBearing,
    projectToScreenEdge,
    arrowRotation,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;