package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real unit tests for the geo.js -> Geo.kt port — this project's established
 * discipline (see CLAUDE.md throughout) is to verify math against known
 * values or provable invariants, not just assume a port is correct because
 * it compiles. Two kinds of assertion are used deliberately:
 *
 * 1. Analytically-derivable exact values (cardinal bearings, equatorial/
 *    meridian distances, band-boundary fractions, square-layout arithmetic)
 *    — safe to assert as precise expected numbers.
 * 2. Relational/invariant checks for the harder trig (maxRadiusForBearing,
 *    circularPlotRadius, projectToPolarPosition) — properties that must
 *    hold for ANY correct implementation of this design (e.g. the FOV edge
 *    radius can never exceed dead-ahead's on a narrow viewport,
 *    circularPlotRadius is exactly the min of the two, out-of-FOV bearings
 *    return null) rather than hand-computed trig literals, which would risk
 *    baking in a manual arithmetic slip as a false "expected" value.
 */
class GeoTest {

    private val EPS = 1e-6

    // ---- calculateBearing ----

    @Test
    fun bearing_dueEast_isNinety() {
        assertEquals(90.0, Geo.calculateBearing(0.0, 0.0, 0.0, 1.0), 1e-3)
    }

    @Test
    fun bearing_dueNorth_isZero() {
        assertEquals(0.0, Geo.calculateBearing(0.0, 0.0, 1.0, 0.0), 1e-3)
    }

    @Test
    fun bearing_dueSouth_is180() {
        assertEquals(180.0, Geo.calculateBearing(0.0, 0.0, -1.0, 0.0), 1e-3)
    }

    @Test
    fun bearing_dueWest_is270() {
        assertEquals(270.0, Geo.calculateBearing(0.0, 0.0, 0.0, -1.0), 1e-3)
    }

    // ---- calculateDistanceMeters / calculateDistanceNm ----

    @Test
    fun distanceMeters_oneDegreeAlongEquator_matchesGreatCircleArc() {
        // The equator is itself a great circle, so 1 degree of longitude at
        // lat=0 is exactly R_M * toRad(1) metres — no haversine approximation
        // error at this specific geometry.
        val expected = 6371000.0 * Math.toRadians(1.0)
        assertEquals(expected, Geo.calculateDistanceMeters(0.0, 0.0, 0.0, 1.0), 1.0)
    }

    @Test
    fun distanceMeters_oneDegreeAlongMeridian_matchesGreatCircleArc() {
        // Meridians are great circles too, so this is exactly the same
        // formula as the equatorial case above, just north-south.
        val expected = 6371000.0 * Math.toRadians(1.0)
        assertEquals(expected, Geo.calculateDistanceMeters(0.0, 0.0, 1.0, 0.0), 1.0)
    }

    @Test
    fun distanceNm_oneDegree_isApproximatelySixtyNm() {
        // The nautical mile's own historical definition is "1 minute of
        // latitude" -- 60nm per degree is the whole point of the unit, so
        // this is a real sanity check, not an arbitrary number.
        assertEquals(60.0, Geo.calculateDistanceNm(0.0, 0.0, 1.0, 0.0), 0.1)
    }

    @Test
    fun distance_samePoint_isZero() {
        assertEquals(0.0, Geo.calculateDistanceMeters(51.5, -0.1, 51.5, -0.1), EPS)
        assertEquals(0.0, Geo.calculateDistanceNm(51.5, -0.1, 51.5, -0.1), EPS)
    }

    // ---- calculateRelativeBearing ----

    @Test
    fun relativeBearing_rightOfHeading_isPositive() {
        assertEquals(90.0, Geo.calculateRelativeBearing(90.0, 0.0), EPS)
    }

    @Test
    fun relativeBearing_leftOfHeading_isNegative() {
        assertEquals(-90.0, Geo.calculateRelativeBearing(0.0, 90.0), EPS)
    }

    @Test
    fun relativeBearing_wrapsAcrossZero_shortWayLeft() {
        // Aircraft at 350 deg, heading 10 deg -- the short way there is 20
        // deg to the left (-20), not 340 deg to the right.
        assertEquals(-20.0, Geo.calculateRelativeBearing(350.0, 10.0), EPS)
    }

    @Test
    fun relativeBearing_wrapsAcrossZero_shortWayRight() {
        assertEquals(20.0, Geo.calculateRelativeBearing(10.0, 350.0), EPS)
    }

    // ---- bandedRadiusFraction ----

    @Test
    fun bandedFraction_atRangeZero_isZero() {
        assertEquals(0.0, Geo.bandedRadiusFraction(0.0, listOf(2.0, 5.0, 10.0, 15.0, 50.0)), EPS)
    }

    @Test
    fun bandedFraction_atFirstBandBoundary_isOneOverN() {
        // 5 bands -> the first band's own boundary (2nm) is exactly 1/5.
        assertEquals(0.2, Geo.bandedRadiusFraction(2.0, listOf(2.0, 5.0, 10.0, 15.0, 50.0)), EPS)
    }

    @Test
    fun bandedFraction_midThirdBand_matchesHandDerivedValue() {
        // Real documented case from CLAUDE.md's own RAW-scale investigation:
        // 8nm against a [2,5,10] scale (3 bands) lands in band index 2
        // (5-10nm), 3/5 of the way through it -> (2 + 0.6) / 3.
        assertEquals(2.6 / 3.0, Geo.bandedRadiusFraction(8.0, listOf(2.0, 5.0, 10.0)), EPS)
    }

    @Test
    fun bandedFraction_beyondLastBand_clampsToOne() {
        // "Anything at or beyond the last band plots at the outer edge" --
        // this is the exact mechanism the suppressed-edge-dot feature
        // depends on (see CLAUDE.md's "RAW ND-style range selector" note).
        assertEquals(1.0, Geo.bandedRadiusFraction(100.0, listOf(2.0, 5.0, 10.0, 15.0, 50.0)), EPS)
    }

    @Test
    fun bandedFraction_singleBand_halfwayIsHalf() {
        assertEquals(0.5, Geo.bandedRadiusFraction(5.0, listOf(10.0)), EPS)
    }

    @Test
    fun bandedFraction_emptyBands_isZero() {
        assertEquals(0.0, Geo.bandedRadiusFraction(5.0, emptyList()), EPS)
    }

    // ---- destinationPoint ----

    @Test
    fun destinationPoint_dueNorth_landsOneDegreeNorth() {
        val distanceMeters = 6371000.0 * Math.toRadians(1.0)
        val result = Geo.destinationPoint(0.0, 0.0, 0.0, distanceMeters)
        assertEquals(1.0, result.lat, 1e-6)
        assertEquals(0.0, result.lon, 1e-6)
    }

    @Test
    fun destinationPoint_dueEast_landsOneDegreeEast() {
        val distanceMeters = 6371000.0 * Math.toRadians(1.0)
        val result = Geo.destinationPoint(0.0, 0.0, 90.0, distanceMeters)
        assertEquals(0.0, result.lat, 1e-6)
        assertEquals(1.0, result.lon, 1e-6)
    }

    @Test
    fun destinationPoint_zeroDistance_isSamePoint() {
        val result = Geo.destinationPoint(51.5, -0.1, 123.0, 0.0)
        assertEquals(51.5, result.lat, 1e-9)
        assertEquals(-0.1, result.lon, 1e-9)
    }

    // ---- circleCoordinates / arcCoordinates ----

    @Test
    fun circleCoordinates_firstAndLastPointCoincide() {
        val coords = Geo.circleCoordinates(51.5, -0.1, 5000.0, numPoints = 36)
        assertEquals(37, coords.size) // numPoints + 1
        assertEquals(coords.first()[0], coords.last()[0], 1e-9)
        assertEquals(coords.first()[1], coords.last()[1], 1e-9)
    }

    @Test
    fun arcCoordinates_endpointsAtCenterBearingPlusMinusHalfAngle() {
        val lat = 51.5
        val lon = -0.1
        val radiusMeters = 5000.0
        val coords = Geo.arcCoordinates(lat, lon, radiusMeters, centerBearingDeg = 90.0, halfAngleDeg = 75.0, numPoints = 48)
        assertEquals(49, coords.size)
        val expectedStart = Geo.destinationPoint(lat, lon, 15.0, radiusMeters) // 90 - 75
        val expectedEnd = Geo.destinationPoint(lat, lon, 165.0, radiusMeters)  // 90 + 75
        assertEquals(expectedStart.lon, coords.first()[0], 1e-9)
        assertEquals(expectedStart.lat, coords.first()[1], 1e-9)
        assertEquals(expectedEnd.lon, coords.last()[0], 1e-9)
        assertEquals(expectedEnd.lat, coords.last()[1], 1e-9)
    }

    // ---- maxRadiusForBearing / circularPlotRadius (invariant-based) ----

    @Test
    fun maxRadiusForBearing_deadAhead_equalsAvailableVerticalHeadroom() {
        // At bearing 0, sinA=0 so the X constraint is infinite -- the result
        // must be exactly the Y headroom: cy - topY.
        val w = 400.0; val h = 800.0; val anchorY = 0.8; val safeInset = 60.0
        val cy = h * anchorY
        val topY = safeInset + 20
        val expected = cy - topY
        assertEquals(expected, Geo.maxRadiusForBearing(0.0, w, h, anchorY, safeInset), 1e-6)
    }

    @Test
    fun maxRadiusForBearing_narrowViewport_edgeIsTighterThanDeadAhead() {
        // On a phone-width viewport, the FOV's outer edge (mostly
        // horizontal) should be more constrained than dead-ahead (all
        // vertical headroom) -- this is the exact property
        // circularPlotRadius() relies on (see its own doc comment).
        val w = 400.0; val h = 800.0; val anchorY = 0.8; val safeInset = 60.0
        val deadAhead = Geo.maxRadiusForBearing(0.0, w, h, anchorY, safeInset)
        val edge = Geo.maxRadiusForBearing(75.0, w, h, anchorY, safeInset)
        assertTrue("edge ($edge) should be less than deadAhead ($deadAhead) on a narrow viewport", edge < deadAhead)
    }

    @Test
    fun circularPlotRadius_isExactlyMinOfDeadAheadAndEdge() {
        val w = 400.0; val h = 800.0; val anchorY = 0.8; val safeInset = 60.0; val fov = 75.0
        val deadAhead = Geo.maxRadiusForBearing(0.0, w, h, anchorY, safeInset)
        val edge = Geo.maxRadiusForBearing(fov, w, h, anchorY, safeInset)
        val result = Geo.circularPlotRadius(w, h, anchorY, safeInset, fov)
        assertEquals(minOf(deadAhead, edge), result, EPS)
    }

    // ---- projectToPolarPosition ----

    @Test
    fun projectToPolarPosition_outsideFov_returnsNull() {
        val result = Geo.projectToPolarPosition(
            relativeBearing = 100.0, rangeNm = 5.0,
            viewportWidth = 400.0, viewportHeight = 800.0,
            bandsNm = listOf(2.0, 5.0, 10.0),
            fovHalfAngleDeg = 75.0
        )
        assertNull(result)
    }

    @Test
    fun projectToPolarPosition_atFovEdge_returnsNonNull() {
        val result = Geo.projectToPolarPosition(
            relativeBearing = 75.0, rangeNm = 5.0,
            viewportWidth = 400.0, viewportHeight = 800.0,
            bandsNm = listOf(2.0, 5.0, 10.0),
            fovHalfAngleDeg = 75.0
        )
        assertTrue(result != null)
    }

    @Test
    fun projectToPolarPosition_deadAhead_xEqualsCenterX() {
        // At bearing 0, sinA=0, so x must land exactly on the anchor's own
        // center X regardless of range or offset.
        val result = Geo.projectToPolarPosition(
            relativeBearing = 0.0, rangeNm = 5.0,
            viewportWidth = 400.0, viewportHeight = 800.0,
            bandsNm = listOf(2.0, 5.0, 10.0)
        )
        assertEquals(200, result!!.x) // viewportWidth * 0.5
    }

    @Test
    fun projectToPolarPosition_greaterRange_isFartherFromAnchor_withinSameBand() {
        val near = Geo.projectToPolarPosition(
            relativeBearing = 0.0, rangeNm = 1.0,
            viewportWidth = 400.0, viewportHeight = 800.0,
            bandsNm = listOf(2.0, 5.0, 10.0)
        )!!
        val far = Geo.projectToPolarPosition(
            relativeBearing = 0.0, rangeNm = 1.9,
            viewportWidth = 400.0, viewportHeight = 800.0,
            bandsNm = listOf(2.0, 5.0, 10.0)
        )!!
        // Screen Y is inverted (up = smaller y), and dead-ahead means moving
        // away from the anchor is moving UP the screen -- so farther range
        // must produce a smaller y, not a larger one.
        assertTrue("farther range should be closer to the top of the screen", far.y < near.y)
    }

    // ---- computePlotLayout ----
    //
    // Ported from geo.js's real computePlotLayout() (2026-09-08's "plot box
    // no longer forces a literal square" rework, see CLAUDE.md's own RAW-mode
    // redesign round 7 entry) — replaces the old literal-square
    // computeSquarePlotLayout(). The primary axis (width in portrait, height
    // in landscape) still uses the full available content dimension; the
    // secondary axis is now solved to just fit the plot's own true radius
    // plus a small marker margin, with anchorY returned as a DERIVED value
    // rather than assumed a flat constant.

    @Test
    fun plotLayout_portrait_usesFullWidthAsPrimaryAxis() {
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 100.0, contentHeight = 800.0)
        assertEquals("portrait", layout.orientation)
        assertEquals(400.0, layout.plotWidth, EPS)
        assertEquals(0.0, layout.plotLeft, EPS)
        assertEquals(100.0, layout.plotTop, EPS)
    }

    @Test
    fun plotLayout_portrait_secondaryAxisIsTighterThanFullWidth() {
        // On an ordinary tall phone, the true circular radius derived from
        // the full width is reached well before a literal square's own full
        // width-as-height would allow -- plotHeight must come out smaller
        // than plotWidth, this round's whole point (the old squareSize
        // forced them equal, wasting real vertical space).
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 100.0, contentHeight = 800.0)
        assertTrue("plotHeight (${layout.plotHeight}) should be less than plotWidth (${layout.plotWidth}) on a tall phone",
            layout.plotHeight < layout.plotWidth)
    }

    @Test
    fun plotLayout_portrait_rowsRegionFillsWhatsLeft() {
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 100.0, contentHeight = 800.0)
        assertEquals(0.0, layout.rows.left, EPS)
        assertEquals(100.0 + layout.plotHeight, layout.rows.top, EPS)
        assertEquals(400.0, layout.rows.width, EPS)
        assertEquals(800.0 - layout.plotHeight, layout.rows.height, EPS)
    }

    @Test
    fun plotLayout_landscape_usesFullHeightAsPrimaryAxis() {
        val layout = Geo.computePlotLayout(contentWidth = 900.0, contentTop = 50.0, contentHeight = 400.0)
        assertEquals("landscape", layout.orientation)
        assertEquals(400.0, layout.plotHeight, EPS)
        assertEquals(50.0, layout.plotTop, EPS)
    }

    @Test
    fun plotLayout_landscape_rowsRegionFillsWhatsLeft() {
        val layout = Geo.computePlotLayout(contentWidth = 900.0, contentTop = 50.0, contentHeight = 400.0)
        assertEquals(layout.plotWidth, layout.rows.left, EPS)
        assertEquals(50.0, layout.rows.top, EPS)
        assertEquals(900.0 - layout.plotWidth, layout.rows.width, EPS)
        assertEquals(400.0, layout.rows.height, EPS)
    }

    @Test
    fun plotLayout_exactSquareContent_choosesPortraitBranch() {
        // contentWidth == contentHeight -- the "portrait" tiebreak
        // (contentWidth <= contentHeight) must resolve to portrait, not
        // landscape, for an exact square.
        val layout = Geo.computePlotLayout(contentWidth = 500.0, contentTop = 0.0, contentHeight = 500.0)
        assertEquals("portrait", layout.orientation)
    }

    @Test
    fun plotLayout_neverProducesNegativeRowDimensions() {
        // A degenerate case (near-zero leftover space) must still clamp to
        // 0, not go negative.
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 0.0, contentHeight = 400.0)
        assertTrue(layout.rows.width >= 0.0)
        assertTrue(layout.rows.height >= 0.0)
    }

    @Test
    fun plotLayout_degenerateZeroContent_producesNoNegativeDimensions() {
        // Real regression test: a first draft of computePlotLayout() could
        // return a NEGATIVE plotHeight for zero/degenerate content
        // dimensions, since a negative computed radius silently satisfied
        // the "<= contentHeight" fallback check. Caught by deliberately
        // testing degenerate inputs, not just realistic ones.
        val layout = Geo.computePlotLayout(contentWidth = 0.0, contentTop = 0.0, contentHeight = 0.0)
        assertTrue(layout.plotWidth >= 0.0)
        assertTrue(layout.plotHeight >= 0.0)
        assertTrue(layout.rows.width >= 0.0)
        assertTrue(layout.rows.height >= 0.0)
    }

    @Test
    fun plotLayout_anchorY_fallsBackToDesiredWhenNoRoomToTrim() {
        // When contentHeight is too small to hold even the trimmed
        // plotHeight, the function must fall back to using the whole
        // contentHeight and the original desiredAnchorY -- not some
        // partially-computed value.
        val opts = Geo.PlotLayoutOpts(desiredAnchorY = 0.8)
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 0.0, contentHeight = 50.0, opts = opts)
        assertEquals(50.0, layout.plotHeight, EPS)
        assertEquals(0.8, layout.anchorY, EPS)
    }

    @Test
    fun plotLayout_portrait_plotHeightMatchesRadiusPlusMarginFormula() {
        // Directly verifies the port reproduces geo.js's own documented
        // formula (radius solved from the full width via a large placeholder
        // height/desiredAnchorY, then plotHeight = radius + safeInset + 20 +
        // markerMarginPx, anchorY derived from that) -- not just that SOME
        // trimmed height came out, but the actual specified one. This is
        // also the concrete form of the "screen-space plot and the real
        // camera anchor can't drift apart" guarantee documented at length in
        // CLAUDE.md's round 7 writeup: both now derive from this one
        // formula instead of two independently-typed constants.
        val opts = Geo.PlotLayoutOpts(desiredAnchorY = 0.8, safeInset = 60.0, fovHalfAngleDeg = 75.0, markerMarginPx = 30.0)
        val layout = Geo.computePlotLayout(contentWidth = 400.0, contentTop = 0.0, contentHeight = 800.0, opts = opts)
        val radius = Geo.circularPlotRadius(layout.plotWidth, layout.plotWidth * 10, opts.desiredAnchorY, opts.safeInset, opts.fovHalfAngleDeg)
        val expectedNeededCy = radius + opts.safeInset + 20.0
        val expectedHeight = expectedNeededCy + opts.markerMarginPx
        assertEquals(expectedHeight, layout.plotHeight, EPS)
        assertEquals(expectedNeededCy / expectedHeight, layout.anchorY, EPS)
    }
}
