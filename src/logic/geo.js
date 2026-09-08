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
   *   computePlotLayout()) by passing that region's own width/height
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
   * RAW's plot region — pinned to the TOP in portrait (full content width,
   * with the aircraft list below) or the LEFT in landscape (full content
   * height, list to the right), matching a real ND's own fixed-aspect
   * traffic display plus whatever data panel fits around it. Originally a
   * literal 1:1 square (both axes always equal) — reworked 2026-09-08,
   * direct report with an annotated screenshot: a real device showed a
   * large, genuinely empty gap between the plot's own box edge and where
   * the rings/dots actually render, persisting no matter where the box
   * itself was positioned on screen.
   *
   * Root cause: the box's "primary" axis (width in portrait — the one that
   * actually determines how far the FOV-restricted circular plot can reach
   * left/right, see maxRadiusForBearing's edge-bearing constraint) was
   * always forced to also equal the "secondary" axis (height), on the
   * assumption a plot needs a literal square to look right. It doesn't —
   * the plot's own true radius ends up capped by the narrower of "how much
   * width is there" and "how much height is there" (circularPlotRadius,
   * the min of the two), and on an ordinary tall phone the width-based cap
   * is reached long before the height-based one would be, leaving most of
   * a matching-height square's own height completely outside the circle's
   * reach — dead space no repositioning of the box could ever close, since
   * it's a property of the box's own internal proportions, not of where
   * the box sits on screen.
   *
   * Fix: keep the primary axis at its full available size (unchanged —
   * this is what maximises the FOV's real reach, still worth preserving),
   * but size the SECONDARY axis to just fit the plot's own true radius
   * (plus a small fixed marker allowance) instead of defaulting to match
   * the primary axis. `desiredAnchorY` (normally NavigationCameraEvaluator.
   * STATE_PRESETS.NAV_RAW.anchorY, 0.80 — "ownship low, priority ahead")
   * is used only to seed that computation and as the exact fallback
   * fraction if there genuinely isn't enough room to trim (contentHeight/
   * contentWidth already tighter than the plot needs) — the REAL anchor
   * fraction in effect is derived here and returned as `anchorY`, not
   * assumed externally by either caller.
   *
   * This return value's `anchorY` is now the single shared source both the
   * real camera's marker anchor (NavigationCameraEvaluator, for NAV_RAW)
   * and the screen-space dots/rings/list (app.js/ui.js) must read from —
   * neither may independently assume 0.80 any more, or they WILL drift
   * apart exactly like the rings-vs-dots coordinate-system mismatch this
   * file's own history already documents at length.
   *
   * @param {number} contentWidth   Full width available (RAW's plot is
   *   never inset from the screen's left/right edges).
   * @param {number} contentTop     Y where usable content starts — real
   *   chrome (top bar, guidance card) PLUS the compass tape's own reserved
   *   height; see app.js's _rawChromeInsets().
   * @param {number} contentHeight  Usable height from contentTop down to
   *   the bottom chrome (bottom bar/route card) — already excludes both.
   * @param {object} [opts]
   * @param {number} [opts.desiredAnchorY=0.8]  Seed/fallback fraction —
   *   see above.
   * @param {number} [opts.safeInset=60]        Same meaning as elsewhere;
   *   passed straight through to maxRadiusForBearing.
   * @param {number} [opts.fovHalfAngleDeg=75]  RAW's FOV half-angle.
   * @param {number} [opts.markerMarginPx=30]   Fixed room left beyond the
   *   anchor point (below it in portrait, right of it in landscape) for
   *   the ownship marker itself to render without clipping against the
   *   plot's own edge.
   */
  function computePlotLayout(contentWidth, contentTop, contentHeight, opts) {
    const {
      desiredAnchorY = 0.8,
      safeInset = 60,
      fovHalfAngleDeg = 75,
      markerMarginPx = 30,
    } = opts || {};

    const portrait = contentWidth <= contentHeight;
    const EXTRA = safeInset + 20; // matches maxRadiusForBearing's own topY = safeInset + 20
    const EDGE_MARGIN_PX = 20;    // matches maxRadiusForBearing's own left/right margin

    let plotLeft, plotTop, plotWidth, plotHeight, anchorY, rows;

    if (portrait) {
      plotWidth = Math.max(0, contentWidth);
      // A large placeholder height so the dead-ahead (vertical) constraint
      // can't be what caps this — we want the TRUE width-bound radius this
      // plot's own width allows on its own, independent of how much
      // vertical room ends up being given to it (which is exactly what
      // we're about to solve for from this value).
      // Clamped to 0: a degenerate/near-zero plotWidth (no real device ever
      // produces this, but the function must still behave sanely rather
      // than propagate a negative radius into neededCy/neededHeight below,
      // which would otherwise pass the `<= contentHeight` check trivially
      // and yield a negative plotHeight.
      const radius = Math.max(0, circularPlotRadius(plotWidth, plotWidth * 10, desiredAnchorY, safeInset, fovHalfAngleDeg));
      const neededCy = radius + EXTRA;               // exactly enough dead-ahead room, no more
      const neededHeight = neededCy + markerMarginPx; // + fixed room below for the marker itself
      if (neededHeight <= contentHeight) {
        plotHeight = neededHeight;
        anchorY = neededCy / plotHeight;
      } else {
        // Not enough room to trim — fall back to the old "use it all" shape;
        // there's no excess to reclaim in this case anyway.
        plotHeight = Math.max(0, contentHeight);
        anchorY = desiredAnchorY;
      }
      plotLeft = 0;
      plotTop = contentTop;
      rows = { left: 0, top: contentTop + plotHeight, width: contentWidth, height: Math.max(0, contentHeight - plotHeight) };
    } else {
      plotHeight = Math.max(0, contentHeight);
      const cyFixed = plotHeight * desiredAnchorY;
      const deadAheadRadius = Math.max(0, cyFixed - EXTRA);
      // Mirror image of the portrait branch: minimal width whose own
      // edge-bearing constraint reaches at least deadAheadRadius — beyond
      // that point, more width buys nothing, since dead-ahead (fixed by
      // the given height) would already be what's capping the circle.
      const sinEdge = Math.sin(fovHalfAngleDeg * Math.PI / 180) || 1;
      const neededWidth = 2 * (deadAheadRadius * sinEdge + EDGE_MARGIN_PX);
      plotWidth = neededWidth <= contentWidth ? neededWidth : Math.max(0, contentWidth);
      anchorY = desiredAnchorY;
      plotLeft = 0;
      plotTop = contentTop;
      rows = { left: plotWidth, top: contentTop, width: Math.max(0, contentWidth - plotWidth), height: contentHeight };
    }

    return {
      orientation: portrait ? "portrait" : "landscape",
      plotLeft, plotTop, plotWidth, plotHeight, anchorY, rows,
    };
  }

  return {
    calculateBearing,
    calculateDistanceMeters,
    calculateDistanceNm,
    calculateRelativeBearing,
    bandedRadiusFraction,
    maxRadiusForBearing,
    circularPlotRadius,
    computePlotLayout,
    projectToPolarPosition,
    projectPosition,
    destinationPoint,
    circleCoordinates,
    arcCoordinates,
  };
})();

if (typeof module !== "undefined") module.exports = Geo;