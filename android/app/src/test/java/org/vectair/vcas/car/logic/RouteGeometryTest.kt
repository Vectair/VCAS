package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the routeGeometry.js -> RouteGeometry.kt
 * port, following this project's established discipline. Ported as a
 * discovered dependency of NavigationCameraEvaluator.kt (see that file's
 * own doc comment) — verified as thoroughly as any of the planned ports.
 */
class RouteGeometryTest {

    // A simple 3-point route: due east along the equator-ish latitude 0,
    // from (0,0) to (0.1,0) to (0.2,0) -- i.e. lon increases, lat constant.
    private val straightRoute = listOf(
        doubleArrayOf(0.0, 0.0),
        doubleArrayOf(0.1, 0.0),
        doubleArrayOf(0.2, 0.0)
    )

    // ---- nearestOnLine ----

    @Test
    fun nearestOnLine_emptyCoords_returnsInputPointUnchanged() {
        val result = RouteGeometry.nearestOnLine(emptyList(), lon = 5.0, lat = 6.0)
        assertEquals(0, result.segIdx)
        assertEquals(0.0, result.t, 1e-9)
        assertEquals(5.0, result.point[0], 1e-9)
        assertEquals(6.0, result.point[1], 1e-9)
    }

    @Test
    fun nearestOnLine_nullCoords_returnsInputPointUnchanged() {
        val result = RouteGeometry.nearestOnLine(null, lon = 5.0, lat = 6.0)
        assertEquals(5.0, result.point[0], 1e-9)
        assertEquals(6.0, result.point[1], 1e-9)
    }

    @Test
    fun nearestOnLine_singlePointRoute_returnsThatPoint() {
        val result = RouteGeometry.nearestOnLine(listOf(doubleArrayOf(1.0, 2.0)), lon = 5.0, lat = 6.0)
        assertEquals(0, result.segIdx)
        assertEquals(1.0, result.point[0], 1e-9)
        assertEquals(2.0, result.point[1], 1e-9)
    }

    @Test
    fun nearestOnLine_pointExactlyOnFirstSegment() {
        // (0.05, 0) sits exactly on segment 0 (0,0)->(0.1,0), t=0.5.
        val result = RouteGeometry.nearestOnLine(straightRoute, lon = 0.05, lat = 0.0)
        assertEquals(0, result.segIdx)
        assertEquals(0.5, result.t, 1e-6)
        assertEquals(0.05, result.point[0], 1e-6)
        assertEquals(0.0, result.point[1], 1e-9)
    }

    @Test
    fun nearestOnLine_pointExactlyOnSecondSegment() {
        val result = RouteGeometry.nearestOnLine(straightRoute, lon = 0.15, lat = 0.0)
        assertEquals(1, result.segIdx)
        assertEquals(0.5, result.t, 1e-6)
    }

    @Test
    fun nearestOnLine_pointOffToTheSide_snapsPerpendicular() {
        // Directly "above" the midpoint of segment 0 -- nearest point
        // should still land on the route at t=0.5, not at an endpoint.
        val result = RouteGeometry.nearestOnLine(straightRoute, lon = 0.05, lat = 0.01)
        assertEquals(0, result.segIdx)
        assertTrue(result.t > 0.0 && result.t < 1.0)
    }

    @Test
    fun nearestOnLine_pointBeforeRouteStart_clampsToFirstVertex() {
        val result = RouteGeometry.nearestOnLine(straightRoute, lon = -0.5, lat = 0.0)
        assertEquals(0, result.segIdx)
        assertEquals(0.0, result.t, 1e-9)
        assertEquals(0.0, result.point[0], 1e-9)
    }

    @Test
    fun nearestOnLine_pointBeyondRouteEnd_clampsToLastVertex() {
        val result = RouteGeometry.nearestOnLine(straightRoute, lon = 1.0, lat = 0.0)
        assertEquals(1, result.segIdx) // last segment
        assertEquals(1.0, result.t, 1e-9)
        assertEquals(0.2, result.point[0], 1e-6)
    }

    @Test
    fun nearestOnLine_degenerateZeroLengthSegment_doesNotDivideByZero() {
        val degenerate = listOf(doubleArrayOf(0.0, 0.0), doubleArrayOf(0.0, 0.0), doubleArrayOf(0.1, 0.0))
        val result = RouteGeometry.nearestOnLine(degenerate, lon = 0.0, lat = 0.0)
        // Must not throw/NaN; the zero-length segment's t collapses to 0.
        assertTrue(!result.t.isNaN())
    }

    // ---- projectAlong ----

    @Test
    fun projectAlong_nullOrTooShortCoords_returnsNull() {
        assertNull(RouteGeometry.projectAlong(null, 0, 0.0, 100.0))
        assertNull(RouteGeometry.projectAlong(listOf(doubleArrayOf(0.0, 0.0)), 0, 0.0, 100.0))
    }

    @Test
    fun projectAlong_zeroOrNegativeMeters_returnsCurrentSegmentNode() {
        val result = RouteGeometry.projectAlong(straightRoute, segIdx = 1, t = 0.3, meters = 0.0)!!
        assertEquals(straightRoute[1][0], result.lon, 1e-9)
        assertEquals(straightRoute[1][1], result.lat, 1e-9)
    }

    @Test
    fun projectAlong_withinCurrentSegment_interpolatesCorrectly() {
        // Segment 0 (0,0)->(0.1,0) is roughly 11.1km (1 degree lon ~111km
        // at the equator, 0.1deg ~11.1km). Projecting a small distance
        // from segIdx=0,t=0 should land partway along that segment,
        // roughly proportional to distance/segmentLength.
        val segLengthM = RouteGeometry.distanceToIndex(straightRoute, 0, 0.0, 1)
        val halfway = RouteGeometry.projectAlong(straightRoute, 0, 0.0, segLengthM / 2)!!
        assertEquals(0.05, halfway.lon, 1e-3)
        assertEquals(0.0, halfway.lat, 1e-6)
    }

    @Test
    fun projectAlong_crossingIntoNextSegment_advancesCorrectly() {
        val fullFirstSegment = RouteGeometry.distanceToIndex(straightRoute, 0, 0.0, 1)
        val partway = RouteGeometry.projectAlong(straightRoute, 0, 0.0, fullFirstSegment + 1000.0)!!
        // Should now be somewhere along segment 1 (lon between 0.1 and 0.2).
        assertTrue(partway.lon > 0.1 && partway.lon < 0.2)
    }

    @Test
    fun projectAlong_exceedingRouteLength_clampsToFinalVertex() {
        val result = RouteGeometry.projectAlong(straightRoute, 0, 0.0, meters = 10_000_000.0)!!
        assertEquals(0.2, result.lon, 1e-9)
        assertEquals(0.0, result.lat, 1e-9)
    }

    // ---- distanceToIndex ----

    @Test
    fun distanceToIndex_targetAtOrBeforeSegIdx_returnsZero() {
        assertEquals(0.0, RouteGeometry.distanceToIndex(straightRoute, 1, 0.5, targetIdx = 1), 1e-9)
        assertEquals(0.0, RouteGeometry.distanceToIndex(straightRoute, 1, 0.5, targetIdx = 0), 1e-9)
    }

    @Test
    fun distanceToIndex_nullOrTooShortCoords_returnsZero() {
        assertEquals(0.0, RouteGeometry.distanceToIndex(null, 0, 0.0, 2), 1e-9)
        assertEquals(0.0, RouteGeometry.distanceToIndex(listOf(doubleArrayOf(0.0, 0.0)), 0, 0.0, 2), 1e-9)
    }

    @Test
    fun distanceToIndex_matchesSumOfSegmentDistances() {
        // From the very start (segIdx=0, t=0) to the final vertex (index 2)
        // should equal the full straight-line route length.
        val total = RouteGeometry.distanceToIndex(straightRoute, 0, 0.0, targetIdx = 2)
        val expected = Geo.calculateDistanceMeters(0.0, 0.0, 0.0, 0.1) + Geo.calculateDistanceMeters(0.0, 0.1, 0.0, 0.2)
        assertEquals(expected, total, 1.0) // within 1m -- haversine vs the same formula, should be near-exact
    }

    @Test
    fun distanceToIndex_fromMidSegment_excludesDistanceBehind() {
        val fromStart = RouteGeometry.distanceToIndex(straightRoute, 0, 0.0, targetIdx = 1)
        val fromHalfway = RouteGeometry.distanceToIndex(straightRoute, 0, 0.5, targetIdx = 1)
        assertTrue(fromHalfway < fromStart)
        assertEquals(fromStart / 2, fromHalfway, fromStart * 0.01) // roughly half, within 1%
    }
}
