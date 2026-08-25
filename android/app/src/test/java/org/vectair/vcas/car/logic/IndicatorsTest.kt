package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the indicators.js -> Indicators.kt port,
 * following this project's established discipline (see CLAUDE.md, the
 * four prior logic ports): run against real execution, not just read
 * for correctness.
 *
 * Since Indicators.kt is the orchestration layer over Geo/Visibility/
 * Relevance (all already independently verified — GeoTest 34/34,
 * VisibilityTest 32/32, RelevanceTest 17/17, AircraftExtrapolationTest
 * 11/11 passing), most tests here either (a) check filtering/sorting
 * behaviour directly, which needs no cross-checking since it's pure
 * boolean/comparator logic, or (b) cross-check a computed x/y position
 * against an INDEPENDENT direct call to Geo.projectToPolarPosition using
 * the same already-verified primitives — proving computeAll()'s plumbing
 * (default fallbacks, plot-region overrides) threads the right values
 * through, not re-testing Geo/Visibility themselves.
 */
class IndicatorsTest {

    private val userLat = 40.0
    private val userLon = -75.0

    private fun aircraft(
        hex: String = "AC0001",
        lat: Double,
        lon: Double,
        altitudeFt: Double? = null,
        type: String? = null,
        lastSeenSeconds: Double = 0.0,
        trackDeg: Double? = null,
        groundSpeedKt: Double? = null
    ) = AircraftExtrapolation.Aircraft(
        lat = lat, lon = lon, hex = hex, altitudeFt = altitudeFt, type = type,
        lastSeenSeconds = lastSeenSeconds, trackDeg = trackDeg, groundSpeedKt = groundSpeedKt
    )

    private fun acAtRangeNm(
        nm: Double,
        bearingDeg: Double = 0.0,
        hex: String = "AC0001",
        altitudeFt: Double? = null,
        type: String? = null,
        lastSeenSeconds: Double = 0.0,
        trackDeg: Double? = null,
        groundSpeedKt: Double? = null
    ): AircraftExtrapolation.Aircraft {
        val pt = Geo.destinationPoint(userLat, userLon, bearingDeg, nm * 1852.0)
        return aircraft(hex, pt.lat, pt.lon, altitudeFt, type, lastSeenSeconds, trackDeg, groundSpeedKt)
    }

    private fun userState(
        heading: Double = 0.0,
        viewportWidth: Double = 400.0,
        viewportHeight: Double = 800.0,
        anchorY: Double? = null,
        fovHalfAngleDeg: Double? = null,
        plotWidth: Double? = null,
        plotHeight: Double? = null,
        plotOffsetX: Double? = null,
        plotOffsetY: Double? = null,
        safeInset: Double? = null,
        plotSafeInset: Double? = null,
        plotBandsNm: List<Double>? = null,
        speedMph: Double? = 0.0
    ) = Indicators.UserState(
        lat = userLat, lon = userLon, heading = heading, speedMph = speedMph,
        viewportWidth = viewportWidth, viewportHeight = viewportHeight,
        anchorY = anchorY, fovHalfAngleDeg = fovHalfAngleDeg,
        plotWidth = plotWidth, plotHeight = plotHeight,
        plotOffsetX = plotOffsetX, plotOffsetY = plotOffsetY,
        safeInset = safeInset, plotSafeInset = plotSafeInset, plotBandsNm = plotBandsNm
    )

    // ---- capForViewportWidth boundaries ----

    @Test
    fun capForViewportWidth_belowSmallMax_isSmall() {
        assertEquals(5, Indicators.capForViewportWidth(499.99))
    }

    @Test
    fun capForViewportWidth_atSmallMax_isMedium() {
        // Condition is strictly `<`, so exactly 500 falls into medium.
        assertEquals(7, Indicators.capForViewportWidth(500.0))
    }

    @Test
    fun capForViewportWidth_atMediumMax_isStillMedium() {
        // Condition is `<=`, so exactly 900 stays medium.
        assertEquals(7, Indicators.capForViewportWidth(900.0))
    }

    @Test
    fun capForViewportWidth_aboveMediumMax_isLarge() {
        assertEquals(10, Indicators.capForViewportWidth(900.01))
    }

    // ---- Constants ----

    @Test
    fun constants_matchDocumentedValues() {
        assertEquals(50.0, Indicators.POLAR_MAX_RANGE_NM, 1e-9)
        assertEquals(Relevance.DEFAULTS.rangeExtensionCapNm, Indicators.POLAR_MAX_RANGE_NM, 1e-9)
        assertEquals(listOf(2.0, 5.0, 10.0, 15.0, 50.0), Indicators.RING_BANDS_NM)
        assertEquals(75.0, Indicators.FOV_HALF_ANGLE_DEG, 1e-9)
    }

    // ---- build(): relevance filtering, suppression, sort order ----

    @Test
    fun build_sortsByVisibilityScoreDescending_thenDistanceAscending() {
        val veryClose = acAtRangeNm(0.3, hex = "CLOSE", altitudeFt = 300.0) // score 100 (veryClose override)
        val medium = acAtRangeNm(5.0, hex = "MEDIUM", altitudeFt = 5000.0, type = "B738") // score 66
        val far = acAtRangeNm(12.0, hex = "FAR", altitudeFt = 5000.0, type = "C172") // score 10, still in-view (<=15)

        val result = Indicators.build(listOf(far, medium, veryClose), userState(), staleThresholdSeconds = 20.0)

        assertEquals(listOf("CLOSE", "MEDIUM", "FAR"), result.map { it.aircraft.hex })
        assertEquals(100, result[0].vis.score)
        assertEquals(66, result[1].vis.score)
        assertEquals(10, result[2].vis.score)
    }

    @Test
    fun build_tiedScore_sortsByDistanceAscending() {
        val near = acAtRangeNm(0.3, hex = "NEAR", altitudeFt = 300.0)
        val farther = acAtRangeNm(0.6, hex = "FARTHER", altitudeFt = 300.0)

        val result = Indicators.build(listOf(farther, near), userState(), staleThresholdSeconds = 20.0)

        assertEquals(100, result[0].vis.score)
        assertEquals(100, result[1].vis.score) // both veryClose -> tied score
        assertEquals(listOf("NEAR", "FARTHER"), result.map { it.aircraft.hex })
    }

    @Test
    fun build_excludesIrrelevantAircraft() {
        // Dead behind (relativeBearing 180), 10nm out — teardropRangeNm(180)
        // is rMinNm (3nm default), so 10nm is well outside it, and with no
        // track/speed data there's no predicted-entry convergence either.
        val behind = acAtRangeNm(10.0, bearingDeg = 180.0, hex = "BEHIND", altitudeFt = 5000.0)
        val ahead = acAtRangeNm(5.0, hex = "AHEAD", altitudeFt = 5000.0, type = "B738")

        val result = Indicators.build(listOf(behind, ahead), userState(), staleThresholdSeconds = 20.0)

        assertEquals(listOf("AHEAD"), result.map { it.aircraft.hex })
    }

    @Test
    fun build_excludesSuppressedHex_evenWhenRelevant() {
        val ahead = acAtRangeNm(5.0, hex = "AHEAD", altitudeFt = 5000.0, type = "B738")
        val resultUnsuppressed = Indicators.build(listOf(ahead), userState(), staleThresholdSeconds = 20.0)
        assertEquals(1, resultUnsuppressed.size)

        val resultSuppressed = Indicators.build(listOf(ahead), userState(), staleThresholdSeconds = 20.0, suppressedHexes = setOf("AHEAD"))
        assertTrue(resultSuppressed.isEmpty())
    }

    // ---- buildAll(): no relevance/suppression filtering, distance-only sort ----

    @Test
    fun buildAll_includesIrrelevantAircraft_sortedByDistanceOnly() {
        val behind = acAtRangeNm(10.0, bearingDeg = 180.0, hex = "BEHIND", altitudeFt = 5000.0) // irrelevant
        val close = acAtRangeNm(0.3, hex = "CLOSE", altitudeFt = 300.0) // score 100, but far in distance terms? no, closest
        val medium = acAtRangeNm(5.0, hex = "MEDIUM", altitudeFt = 5000.0, type = "B738")

        val result = Indicators.buildAll(listOf(behind, medium, close), userState(), staleThresholdSeconds = 20.0)

        // Pure distance order, irrelevant "BEHIND" included despite being
        // the farthest and having the worst relevance status.
        assertEquals(listOf("CLOSE", "MEDIUM", "BEHIND"), result.map { it.aircraft.hex })
    }

    // ---- Staleness: hard cutoff vs isStale flag ----

    @Test
    fun staleness_hardCutoff_excludesAircraftAtOrBeyondTripleThreshold() {
        val fresh = acAtRangeNm(1.0, hex = "FRESH", altitudeFt = 300.0, lastSeenSeconds = 59.9)
        val tooStale = acAtRangeNm(1.0, hex = "STALE", altitudeFt = 300.0, lastSeenSeconds = 60.0)

        // staleThresholdSeconds=20 -> hard cutoff is 20*3=60; condition is
        // strictly `<`, so exactly 60.0 must be excluded entirely.
        val result = Indicators.buildAll(listOf(fresh, tooStale), userState(), staleThresholdSeconds = 20.0)

        assertEquals(listOf("FRESH"), result.map { it.aircraft.hex })
    }

    @Test
    fun isStale_exactBoundary_strictlyGreaterThan() {
        val atThreshold = acAtRangeNm(1.0, hex = "AT20", altitudeFt = 300.0, lastSeenSeconds = 20.0)
        val justOver = acAtRangeNm(1.0, hex = "OVER20", altitudeFt = 300.0, lastSeenSeconds = 20.01)

        val result = Indicators.buildAll(listOf(atThreshold, justOver), userState(), staleThresholdSeconds = 20.0)

        assertEquals(false, result.first { it.aircraft.hex == "AT20" }.isStale)
        assertEquals(true, result.first { it.aircraft.hex == "OVER20" }.isStale)
    }

    // ---- FOV restriction is independent of relevance (overhead case) ----

    @Test
    fun overhead_relevantButOutsideFov_yieldsNullPosition() {
        // Nearly overhead (steep elevation) but at a relative bearing of
        // 170deg, well outside a 75deg-half-angle FOV. Relevance's
        // "overhead" rule bypasses the teardrop/FOV entirely, so this
        // aircraft is still relevant -- but Geo.projectToPolarPosition
        // must still return null for a bearing outside the FOV, since
        // that's a separate, purely geometric restriction.
        val ac = acAtRangeNm(0.05, bearingDeg = 170.0, hex = "OVERHEAD", altitudeFt = 5000.0)

        val result = Indicators.build(listOf(ac), userState(fovHalfAngleDeg = 75.0), staleThresholdSeconds = 20.0)

        assertEquals(1, result.size)
        assertEquals(true, result[0].relevance.relevant)
        assertEquals("overhead", result[0].relevance.reason)
        assertNull(result[0].x)
        assertNull(result[0].y)
    }

    // ---- Position: cross-checked against an independent direct Geo call ----

    @Test
    fun deadAhead_inFov_positionMatchesDirectGeoCall_andDefaultsFallBack() {
        // anchorY/safeInset left null in userState() -> must fall back to
        // Geo.kt's own projectToPolarPosition defaults (0.8 / 60.0), the
        // same values used explicitly in the independent call below.
        val ac = acAtRangeNm(5.0, hex = "AHEAD", altitudeFt = 5000.0, type = "B738")
        val us = userState() // viewportWidth=400, viewportHeight=800, no plot overrides

        val result = Indicators.build(listOf(ac), us, staleThresholdSeconds = 20.0)
        val item = result.single()

        val bearing = Geo.calculateBearing(userLat, userLon, ac.lat, ac.lon)
        val relBearing = Geo.calculateRelativeBearing(bearing, us.heading)
        val vis = Visibility.estimate(userLat, userLon, Visibility.AircraftInput(ac.lat, ac.lon, ac.altitudeFt, ac.type, lastSeenSeconds = ac.lastSeenSeconds))
        val expected = Geo.projectToPolarPosition(
            relBearing, vis.slantRangeNm, us.viewportWidth, us.viewportHeight, Indicators.RING_BANDS_NM,
            anchorY = 0.8, safeInset = 60.0
        )!!

        assertEquals(expected.x, item.x)
        assertEquals(expected.y, item.y)
    }

    @Test
    fun plotRegionOverrides_matchDirectGeoCallWithPlotParams() {
        // plotWidth/plotHeight/plotOffsetX/plotOffsetY/plotSafeInset/
        // plotBandsNm all set to values DIFFERENT from the plain
        // viewport/safeInset/RING_BANDS_NM defaults, proving the RAW
        // square-plot override path is actually used, not silently
        // falling back to the full-viewport values.
        val ac = acAtRangeNm(4.0, hex = "AHEAD", altitudeFt = 0.0)
        val us = userState(
            viewportWidth = 400.0, viewportHeight = 800.0,
            plotWidth = 300.0, plotHeight = 300.0,
            plotOffsetX = 50.0, plotOffsetY = 20.0,
            fovHalfAngleDeg = 75.0,
            anchorY = 0.8,
            safeInset = 60.0, plotSafeInset = 10.0, // plotSafeInset must win over safeInset
            plotBandsNm = listOf(2.0, 5.0, 10.0)
        )

        val result = Indicators.build(listOf(ac), us, staleThresholdSeconds = 20.0)
        val item = result.single()

        val bearing = Geo.calculateBearing(userLat, userLon, ac.lat, ac.lon)
        val relBearing = Geo.calculateRelativeBearing(bearing, us.heading)
        val vis = Visibility.estimate(userLat, userLon, Visibility.AircraftInput(ac.lat, ac.lon, ac.altitudeFt, lastSeenSeconds = ac.lastSeenSeconds))
        val expected = Geo.projectToPolarPosition(
            relBearing, vis.slantRangeNm, 300.0, 300.0, listOf(2.0, 5.0, 10.0),
            anchorY = 0.8, safeInset = 10.0, fovHalfAngleDeg = 75.0, offsetX = 50.0, offsetY = 20.0
        )!!

        assertEquals(expected.x, item.x)
        assertEquals(expected.y, item.y)

        // And confirm it does NOT match what the plain-viewport values
        // would have produced -- proves the override genuinely changed
        // the outcome, not a coincidental match.
        val wouldBeWithViewport = Geo.projectToPolarPosition(
            relBearing, vis.slantRangeNm, us.viewportWidth, us.viewportHeight, Indicators.RING_BANDS_NM,
            anchorY = 0.8, safeInset = 60.0
        )!!
        assertTrue(wouldBeWithViewport.x != item.x || wouldBeWithViewport.y != item.y)
    }

    @Test
    fun plotSafeInset_null_fallsBackToSafeInset() {
        val ac = acAtRangeNm(4.0, hex = "AHEAD", altitudeFt = 0.0)
        val us = userState(safeInset = 25.0, plotSafeInset = null)

        val result = Indicators.build(listOf(ac), us, staleThresholdSeconds = 20.0)
        val item = result.single()

        val bearing = Geo.calculateBearing(userLat, userLon, ac.lat, ac.lon)
        val relBearing = Geo.calculateRelativeBearing(bearing, us.heading)
        val vis = Visibility.estimate(userLat, userLon, Visibility.AircraftInput(ac.lat, ac.lon, ac.altitudeFt, lastSeenSeconds = ac.lastSeenSeconds))
        val expected = Geo.projectToPolarPosition(
            relBearing, vis.slantRangeNm, us.viewportWidth, us.viewportHeight, Indicators.RING_BANDS_NM,
            anchorY = 0.8, safeInset = 25.0
        )!!

        assertEquals(expected.x, item.x)
        assertEquals(expected.y, item.y)
    }

    // ---- Direction-of-travel (relativeTrackDeg) ----

    @Test
    fun relativeTrackDeg_computedWhenTrackPresent() {
        val ac = acAtRangeNm(5.0, hex = "AHEAD", altitudeFt = 5000.0, trackDeg = 90.0)
        val us = userState(heading = 10.0)

        val result = Indicators.buildAll(listOf(ac), us, staleThresholdSeconds = 20.0)
        val expected = Geo.calculateRelativeBearing(90.0, 10.0)

        assertEquals(expected, result.single().relativeTrackDeg!!, 1e-9)
    }

    @Test
    fun relativeTrackDeg_nullWhenTrackMissing() {
        val ac = acAtRangeNm(5.0, hex = "AHEAD", altitudeFt = 5000.0, trackDeg = null)
        val result = Indicators.buildAll(listOf(ac), userState(), staleThresholdSeconds = 20.0)
        assertNull(result.single().relativeTrackDeg)
    }
}
