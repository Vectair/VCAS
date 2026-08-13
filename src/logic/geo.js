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
   * Fraction (0-1) of the available radius a given range should plot at,
   * under a piecewise-banded (non-linear) distance scale: each entry in
   * `bandsNm` is the upper nm boundary of one ring band, and every band —
   * regardless of how many real nm wide it is — gets an equal 1/N slice of
   * the radius. Close bands (a couple of nm wide) get the same visual room
   * as a much wider far band, so the plot stays legible/high-resolution for
   * nearby traffic instead of a single distant aircraft's position being
   * barely distinguishable from one much closer to it, the way a strictly
   * linear scale would render them. Within a band, position is linear.
   *
   * @param {number} rangeNm    Real distance.
   * @param {number[]} bandsNm  Ascending upper boundaries, e.g. [2,5,10,15].
   */
  function bandedRadiusFraction(rangeNm, bandsNm) {
    const n = bandsNm.length;
    if (n === 0) return 0;
    const clamped = Math.max(0, Math.min(rangeNm, bandsNm[n - 1]));
    for (let i = 0; i < n; i++) {
      const bandStart = i === 0 ? 0 : bandsNm[i - 1];
      const bandEnd = bandsNm[i];
      if (clamped <= bandEnd) {
        const withinBandFrac = bandEnd > bandStart ? (clamped - bandStart) / (bandEnd - bandStart) : 0;
        return (i + withinBandFrac) / n;
      }
    }
    return 1;
  }

  /**
   * The dead-ahead radius (px) available above the anchor before the safe
   * screen area runs out — the single, uniform NM-to-pixel scale used at
   * EVERY bearing (see projectToPolarPosition()), matching a plain circular
   * range ring. Two earlier, more "geometrically correct" attempts were
   * both reverted: shrinking this per-bearing to whatever fits sideways
   * kept aircraft on-screen but broke the numbers (a 24deg-off aircraft's
   * radius fell to barely a third of dead-ahead's); tracing an ellipse
   * fixed the numbers exactly but visibly wasn't a circle either. A plain
   * phone is narrower than the anchor's dead-ahead headroom, so a circle
   * this size genuinely cannot fit sideways without SOME compromise —
   * projectToPolarPosition() clamps individual points at the true edge
   * only when they'd actually run off-screen, rather than warping the
   * scale (or the ring) everywhere to avoid that.
   */
  function maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY = 0.8, safeInset = 60) {
    const w = viewportWidth;
    const h = viewportHeight;
    const cx = w * 0.5;
    const cy = h * anchorY;

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    // Available boundaries from the anchor, respecting UI safety perimeters.
    const topY    = safeInset + 20;
    const bottomY = Math.min(h - safeInset - 20, cy + 40);
    const leftX   = safeInset + 20;
    const rightX  = w - safeInset - 20;

    const maxScaleX = sinA !== 0 ? (sinA > 0 ? (rightX - cx) : (cx - leftX)) / Math.abs(sinA) : Infinity;
    const maxScaleY = cosA !== 0 ? (cosA > 0 ? (cy - topY)    : (bottomY - cy)) / Math.abs(cosA) : Infinity;
    return Math.min(maxScaleX, maxScaleY);
  }

  /**
   * True polar plot of a relative bearing + range: angle = bearing, radius =
   * a banded (non-linear) function of distance — see bandedRadiusFraction()
   * — anchored at the same point the 3D camera anchors the user (cx, cy =
   * h*anchorY). Replaces the old edge-only projection (which placed every
   * aircraft at the frame edge regardless of distance) with a genuine
   * bearing-as-angle/distance-as-radius mapping — closer traffic now plots
   * closer to the anchor, not jammed onto the edge alongside everything
   * else.
   *
   * The NM-to-pixel scale is uniform (the dead-ahead radius, same at every
   * bearing), with maxRadiusForBearing() used only as a last-resort clamp so
   * a point doesn't run off-screen at wide angles. This banded screen-space
   * scale is deliberately compressed (see bandedRadiusFraction()) and is
   * independent of the range rings, which are real geo-referenced circles
   * at their literal nm radius (see EosMap.updateRangeRings in map.js) — an
   * aircraft dot at this band's edge is a decluttering aid, not a claim
   * that it sits exactly on that real-world ring.
   *
   * @param {number[]} bandsNm  Ring band boundaries in nm — see
   *   bandedRadiusFraction(). The last entry is the effective max range;
   *   anything at or beyond it plots at the outer edge.
   */
  function projectToPolarPosition(relativeBearing, rangeNm, viewportWidth, viewportHeight, bandsNm, anchorY = 0.8, safeInset = 60) {
    const cx = viewportWidth * 0.5;
    const cy = viewportHeight * anchorY;

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    const deadAheadRadius = maxRadiusForBearing(0, viewportWidth, viewportHeight, anchorY, safeInset);
    const edgeRadius = maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY, safeInset);
    const radiusPx = Math.min(bandedRadiusFraction(rangeNm, bandsNm) * deadAheadRadius, edgeRadius);

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

  /**
   * Project a point from (lat, lon) by `distanceMeters` along a true bearing,
   * using the proper spherical-earth destination formula (not the flat-earth
   * approximation projectPosition() uses) — needed for the range rings' 2 to
   * 15nm (up to ~28km) radii, where flat-earth error starts to matter,
   * unlike projectPosition()'s tens-to-hundreds-of-metres use cases.
   */
  function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
    const δ = distanceMeters / R_M;
    const θ = toRad(bearingDeg);
    const φ1 = toRad(lat), λ1 = toRad(lon);

    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

    return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
  }

  /**
   * Closed ring of [lon, lat] coordinates tracing a true circle of
   * `radiusMeters` around (lat, lon) — GeoJSON LineString-ready (first and
   * last points coincide). Used to draw range rings as real map layers
   * anchored to the user's actual position, rather than a screen-space
   * overlay recomputed only on GPS ticks.
   */
  function circleCoordinates(lat, lon, radiusMeters, numPoints = 72) {
    const coords = [];
    for (let i = 0; i <= numPoints; i++) {
      const bearing = (360 * i) / numPoints;
      const pt = destinationPoint(lat, lon, bearing, radiusMeters);
      coords.push([pt.lon, pt.lat]);
    }
    return coords;
  }

  return {
    calculateBearing,
    calculateDistanceMeters,
    calculateDistanceNm,
    calculateRelativeBearing,
    bandedRadiusFraction,
    maxRadiusForBearing,
    projectToPolarPosition,
    projectPosition,
    destinationPoint,
    circleCoordinates,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;