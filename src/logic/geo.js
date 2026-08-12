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
   * The farthest radius (px) plottable at a given relative bearing without
   * running off the safe screen area — traced as a true ELLIPSE (vertical
   * semi-axis rY = full dead-ahead headroom, horizontal semi-axis rX = the
   * narrower sideways room), not a circle and not the boxy min(horizontal,
   * vertical) rectangle-fit shape tried and reverted before this. Both
   * earlier attempts failed the same way for different reasons:
   *   - A plain circle sized to the generous dead-ahead headroom (rY) is
   *     geometrically impossible to honour off-axis on a portrait phone —
   *     rY is typically 4-5x the actual sideways room (rX), so a circle
   *     that size doesn't fit sideways at all. Scaling every off-axis
   *     aircraft down to whatever DOES fit (rX/sin) fixed the physics but
   *     broke the numbers: a 24deg-off aircraft's usable radius fell to
   *     barely half of rY, so it plotted well inside where a plain circular
   *     ring said its own nm value should put it.
   *   - Tracing the ring itself through that same min()-based boundary
   *     "fixed" the mismatch by making the ring non-circular too, but
   *     min() has a sharp kink right at the crossover angle (~13deg on a
   *     typical phone) — everything beyond that angle sits on a flat
   *     vertical line, not a curve, which reads as a rendering glitch more
   *     than a radar ring.
   * An ellipse resolves both: it is *by construction* the largest smooth
   * curve that reaches exactly rY dead ahead, exactly rX at the sides, and
   * never exceeds the safe rectangle at any angle between — so it needs no
   * separate edge clamp, no kink, and (critically) since both
   * projectToPolarPosition() and UI.renderRangeRings() sample the identical
   * formula, an aircraft's plotted radius and its own ring band's radius
   * are mathematically equal at its exact bearing, not just approximately
   * close. Reduces to a circle when rX equals rY.
   */
  function maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY = 0.8, safeInset = 60) {
    const w = viewportWidth;
    const h = viewportHeight;
    const cx = w * 0.5;
    const cy = h * anchorY;

    const topY  = safeInset + 20;
    const leftX = safeInset + 20;
    const rightX = w - safeInset - 20;

    const rY = Math.max(0, cy - topY);              // dead-ahead (vertical) reach
    const rX = Math.max(0, Math.min(cx - leftX, rightX - cx)); // sideways reach

    if (rY === 0 || rX === 0) return 0;

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    // Standard polar form of an ellipse (semi-axes rX horizontal, rY
    // vertical), angle measured from the vertical (dead-ahead) axis.
    return (rX * rY) / Math.sqrt((rY * sinA) ** 2 + (rX * cosA) ** 2);
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
   * The NM-to-pixel scale is maxRadiusForBearing() — the same elliptical
   * boundary UI.renderRangeRings() traces its rings through — so an
   * aircraft's plotted radius and its own ring band's radius are exactly
   * equal at its bearing; see maxRadiusForBearing() for why this needs to
   * be an ellipse rather than a plain circle.
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

    const maxRadiusPx = maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY, safeInset);
    const radiusPx = bandedRadiusFraction(rangeNm, bandsNm) * maxRadiusPx;

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
    bandedRadiusFraction,
    maxRadiusForBearing,
    projectToPolarPosition,
    projectPosition,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;