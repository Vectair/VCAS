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
    // safeInset is how much room bottom chrome (the bar/ETA card) actually
    // occupies — real and often substantial (~60-100px) — so it's what
    // topY/bottomY use. There's no equivalent chrome on the LEFT/RIGHT
    // edges, just the physical screen edge itself, so those get a small
    // fixed margin instead of reusing safeInset: at bearings near the field-
    // of-view's own edge (see projectToPolarPosition's fovHalfAngleDeg),
    // sin(bearing) is close to 1, meaning the horizontal constraint often
    // ends up the tightest one — reusing the bottom bar's height there was
    // needlessly shrinking the whole circular plot for no real reason.
    const EDGE_MARGIN_PX = 20;
    const topY    = safeInset + 20;
    const bottomY = Math.min(h - safeInset - 20, cy + 40);
    const leftX   = EDGE_MARGIN_PX;
    const rightX  = w - EDGE_MARGIN_PX;

    const maxScaleX = sinA !== 0 ? (sinA > 0 ? (rightX - cx) : (cx - leftX)) / Math.abs(sinA) : Infinity;
    const maxScaleY = cosA !== 0 ? (cosA > 0 ? (cy - topY)    : (bottomY - cy)) / Math.abs(cosA) : Infinity;
    return Math.min(maxScaleX, maxScaleY);
  }

  /**
   * True polar plot of a relative bearing + range: angle = bearing, radius =
   * a banded (non-linear) function of distance — see bandedRadiusFraction()
   * — anchored at the same point the camera anchors the user (cx, cy =
   * h*anchorY; caller must pass the SAME viewportHeight/anchorY the camera
   * actually used, e.g. CameraController.getLastEvaluated().anchorY and the
   * map container's real full height — not a shrunk "usable" height with UI
   * chrome subtracted out, or cy silently stops matching where the user's
   * real position, and therefore the range rings anchored to it, actually
   * render). Replaces the old edge-only projection (which placed every
   * aircraft at the frame edge regardless of distance) with a genuine
   * bearing-as-angle/distance-as-radius mapping — closer traffic now plots
   * closer to the anchor, not jammed onto the edge alongside everything
   * else.
   *
   * The NM-to-pixel scale is deliberately non-linear (see
   * bandedRadiusFraction()) and scaled against each bearing's own available
   * room (maxRadiusForBearing) directly, not against dead-ahead's room with
   * a separate after-the-fact clamp — that used to let the clamp silently
   * override the banded distance encoding at off-centre bearings, making
   * aircraft in very different bands render at nearly the same radius. It's
   * also independent of the range rings, which are real geo-referenced
   * circles at their literal nm radius (see EosMap.updateRangeRings in
   * map.js) — an aircraft dot at this band's edge is a decluttering aid
   * showing roughly how far out it is, not a claim
   * that it sits exactly on that real-world ring.
   *
   * @param {number[]} bandsNm  Ring band boundaries in nm — see
   *   bandedRadiusFraction(). The last entry is the effective max range;
   *   anything at or beyond it plots at the outer edge.
   * @param {number} [fovHalfAngleDeg]  When set, restricts the plot to a
   *   forward field of view (matching a real TCAS/ND reference photo, which
   *   only ever shows a forward arc, not a full 360° sweep) and switches the
   *   scale from the old per-bearing maxRadiusForBearing() to a single,
   *   bearing-independent circularPlotRadius() — see that function's doc
   *   comment for why. Bearings outside ±fovHalfAngleDeg return null instead
   *   of a position; the caller must not render those. Omit (the default)
   *   to keep the old unrestricted, per-bearing behaviour — used by Hybrid's
   *   edge indicators, which have no "round display" real estate to fit
   *   into and cover the full teardrop Relevance itself already computes.
   * @param {number} [offsetX]  Added to the final x, unchanged otherwise —
   *   lets a caller plot within a sub-region of the real viewport (see
   *   computeSquarePlotLayout()) by passing that region's own width/height
   *   as viewportWidth/viewportHeight above and its top-left corner here,
   *   rather than this function needing to know about regions itself.
   * @param {number} [offsetY]  Same, for y.
   */
  function projectToPolarPosition(relativeBearing, rangeNm, viewportWidth, viewportHeight, bandsNm, anchorY = 0.8, safeInset = 60, fovHalfAngleDeg = null, offsetX = 0, offsetY = 0) {
    if (fovHalfAngleDeg != null && Math.abs(relativeBearing) > fovHalfAngleDeg) return null;

    const cx = viewportWidth * 0.5;
    const cy = viewportHeight * anchorY;

    const angleRad = toRad(relativeBearing);
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    let radiusScale;
    if (fovHalfAngleDeg != null) {
      radiusScale = circularPlotRadius(viewportWidth, viewportHeight, anchorY, safeInset, fovHalfAngleDeg);
    } else {
      // Scale directly against THIS bearing's own available room (edgeRadius),
      // not against dead-ahead's with a separate min() clamp bolted on after —
      // the old version computed the banded fraction of deadAheadRadius, then
      // silently substituted edgeRadius whenever that exceeded what was
      // actually available at this bearing. That substitution has nothing to
      // do with which band the aircraft is in, so two aircraft in very
      // different bands (e.g. band 1 vs band 4) could both get clamped down
      // to the same edgeRadius at similar off-centre bearings — collapsing
      // exactly the distance differentiation the banded scale exists to
      // preserve, and reading as aircraft "bunching together" regardless of
      // real distance. Scaling against edgeRadius directly keeps the banded
      // proportion intact at every bearing while still never running
      // off-screen, since it's now built from the room that's actually there.
      radiusScale = maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY, safeInset);
    }
    const radiusPx = bandedRadiusFraction(rangeNm, bandsNm) * radiusScale;

    const x = Math.round(offsetX + cx + sinA * radiusPx);
    const y = Math.round(offsetY + cy - cosA * radiusPx); // screen Y runs inverted

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

  /**
   * Open arc of [lon, lat] coordinates tracing a true circle of
   * `radiusMeters` around (lat, lon), from `centerBearingDeg - halfAngleDeg`
   * to `centerBearingDeg + halfAngleDeg` — GeoJSON LineString-ready, NOT
   * closed (an arc has two distinct ends, unlike circleCoordinates()'s full
   * loop). Used for RAW mode's range rings, which — matching a real TCAS/ND
   * reference photo — only ever show a forward-looking field of view, not a
   * full 360° sweep; a real cockpit ND has no reason to show what's behind
   * the aircraft, and VCAS's RAW mode exists specifically for "what's ahead
   * while driving," same rationale.
   */
  function arcCoordinates(lat, lon, radiusMeters, centerBearingDeg, halfAngleDeg, numPoints = 48) {
    const coords = [];
    for (let i = 0; i <= numPoints; i++) {
      const bearing = centerBearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / numPoints;
      const pt = destinationPoint(lat, lon, bearing, radiusMeters);
      coords.push([pt.lon, pt.lat]);
    }
    return coords;
  }

  /**
   * The single, bearing-independent plot radius (px) for a field-of-view-
   * restricted circular display (RAW mode) — replaces per-bearing
   * maxRadiusForBearing() as the scale reference for anything with a hard
   * fovHalfAngleDeg cutoff. A real TCAS/ND is round: same nm-per-pixel scale
   * in every direction. maxRadiusForBearing()'s per-bearing "how much room
   * is there at this specific angle" varies hugely between dead-ahead (lots
   * of vertical headroom) and the sides (a phone is narrow) — using it
   * directly as the scale (the pre-2026-08-21 approach) meant aircraft off
   * to the side got radius-capped so hard their distance band barely showed
   * at all, reading as "clustering" regardless of real separation. A single
   * fixed radius, sized to whatever the FOV's own edges can actually fit,
   * fixes that by construction: every aircraft at the same real distance
   * plots at the same radius, full stop, matching how a round instrument
   * reads. The binding constraint is always at one of the FOV's two edges —
   * dead-ahead (bearing 0, all vertical headroom) or the outer edge of the
   * arc (bearing ±fovHalfAngleDeg, mostly horizontal headroom) — because
   * maxRadiusForBearing's own min(scaleX,scaleY) is highest in between and
   * lowest at the extremes (verified numerically, not just asserted).
   */
  function circularPlotRadius(viewportWidth, viewportHeight, anchorY, safeInset, fovHalfAngleDeg) {
    const deadAhead = maxRadiusForBearing(0, viewportWidth, viewportHeight, anchorY, safeInset);
    const edge = maxRadiusForBearing(fovHalfAngleDeg, viewportWidth, viewportHeight, anchorY, safeInset);
    return Math.min(deadAhead, edge);
  }

  /**
   * RAW's plot region is a true 1:1 square — "as large as an area as
   * possible" within the available screen content, not an asymmetric shape
   * that just uses whatever headroom a fixed anchorY happens to leave (the
   * pre-2026-08-21 approach, which reliably left near-zero side margin on a
   * plain portrait phone — the actual common case — defeating the whole
   * point of ever having room left for a Stage 3 aircraft list there).
   * Direct instruction, restating an earlier discussion that hadn't been
   * built this way yet: portrait gets the square pinned to the TOP (full
   * content width, matching height) with the list BELOW it; landscape gets
   * it pinned to the LEFT (full content height, matching width) with the
   * list to the RIGHT. Matches how a real ND's own traffic display and its
   * surrounding data fields are laid out — a fixed-aspect instrument plus
   * whatever data panel fits around it, not a shape that stretches to fill
   * an arbitrary rectangle.
   *
   * The ONLY thing that decides plot vs list is which of contentWidth/
   * contentHeight is smaller — there's no separate size negotiation, so
   * this can be (and must be) the single shared source both the real
   * camera's marker anchor (NavigationCameraEvaluator, for NAV_RAW) and the
   * screen-space dots/rings/list (app.js/ui.js) call, or they WILL drift
   * apart exactly like the rings-vs-dots coordinate-system mismatch
   * documented above.
   *
   * @param {number} contentWidth   Full width available (RAW's square is
   *   never inset from the screen's left/right edges).
   * @param {number} contentTop     Y where usable content starts — real
   *   chrome (top bar, guidance card) PLUS the compass tape/info strip's
   *   own reserved height; see app.js's _rawSquareInputs().
   * @param {number} contentHeight  Usable height from contentTop down to
   *   the bottom chrome (bottom bar/route card) — already excludes both.
   */
  function computeSquarePlotLayout(contentWidth, contentTop, contentHeight) {
    const portrait = contentWidth <= contentHeight;
    const squareSize = Math.max(0, portrait ? contentWidth : contentHeight);
    const squareLeft = 0;
    const squareTop = contentTop;
    const rows = portrait
      ? { left: 0, top: contentTop + squareSize, width: contentWidth, height: Math.max(0, contentHeight - squareSize) }
      : { left: squareSize, top: contentTop, width: Math.max(0, contentWidth - squareSize), height: contentHeight };
    return { orientation: portrait ? "portrait" : "landscape", squareLeft, squareTop, squareSize, rows };
  }

  return {
    calculateBearing,
    calculateDistanceMeters,
    calculateDistanceNm,
    calculateRelativeBearing,
    bandedRadiusFraction,
    maxRadiusForBearing,
    circularPlotRadius,
    computeSquarePlotLayout,
    projectToPolarPosition,
    projectPosition,
    destinationPoint,
    circleCoordinates,
    arcCoordinates,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;