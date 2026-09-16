package org.vectair.vcas.car.logic

import org.junit.Assert.*
import org.junit.Test

class ManeuverTrackerTest {

    // 5 points, straight line, lon 0.000/0.001/0.002/0.003/0.004 at lat 51.5 —
    // matches indices 0..4, same shape OrsProviderTest's sample route uses.
    private val coords = listOf(
        doubleArrayOf(0.000, 51.5),
        doubleArrayOf(0.001, 51.5),
        doubleArrayOf(0.002, 51.5),
        doubleArrayOf(0.003, 51.5),
        doubleArrayOf(0.004, 51.5)
    )

    private val steps = listOf(
        OrsProvider.Step(500.0, 60.0, 11, "Head east", "Main St", 0, 2),
        OrsProvider.Step(300.0, 30.0, 1, "Turn right onto Oak Ave", "Oak Ave", 2, 4),
        OrsProvider.Step(0.0, 0.0, 10, "Arrive at destination", "", 4, 4)
    )

    @Test
    fun nextManeuver_userAtRouteStart_targetsSecondStepAndDistanceToCurrentStepEnd() {
        val result = ManeuverTracker.nextManeuver(coords, steps, coords[0][0], coords[0][1])
        assertTrue(result.exists)
        assertEquals("Turn right onto Oak Ave", result.instruction)
        assertEquals(1, result.type)
        assertFalse(result.isArrival)

        // Independent cross-check against the already-verified RouteGeometry
        // primitive, not a hand-computed literal — same discipline the
        // Geo.kt/RouteGeometry.kt ports themselves already established.
        val nearest = RouteGeometry.nearestOnLine(coords, coords[0][0], coords[0][1])
        val expectedDistance = RouteGeometry.distanceToIndex(coords, nearest.segIdx, nearest.t, 2)
        assertEquals(expectedDistance, result.distanceMeters!!, 0.5)
    }

    @Test
    fun nextManeuver_userAtRouteEnd_targetsArrivalStep() {
        val result = ManeuverTracker.nextManeuver(coords, steps, coords[4][0], coords[4][1])
        assertTrue(result.exists)
        assertTrue(result.isArrival)
        assertEquals("Arrive at destination", result.instruction)
        assertEquals(10, result.type)
        // User is AT the arrival point — remaining distance should be ~0.
        assertEquals(0.0, result.distanceMeters!!, 1.0)
    }

    @Test
    fun nextManeuver_userMidwayThroughFirstStep_stillTargetsSecondStep() {
        // Between coord index 0 and 1 — still well within step0's [0,2] range.
        val midLon = (coords[0][0] + coords[1][0]) / 2
        val result = ManeuverTracker.nextManeuver(coords, steps, midLon, 51.5)
        assertTrue(result.exists)
        assertEquals("Turn right onto Oak Ave", result.instruction)
        assertFalse(result.isArrival)
    }

    @Test
    fun nextManeuver_noSteps_returnsNotExists() {
        val result = ManeuverTracker.nextManeuver(coords, emptyList(), coords[0][0], coords[0][1])
        assertFalse(result.exists)
    }

    @Test
    fun nextManeuver_nullSteps_returnsNotExists() {
        val result = ManeuverTracker.nextManeuver(coords, null, coords[0][0], coords[0][1])
        assertFalse(result.exists)
    }

    @Test
    fun nextManeuver_tooFewCoordinates_returnsNotExists() {
        val result = ManeuverTracker.nextManeuver(listOf(coords[0]), steps, coords[0][0], coords[0][1])
        assertFalse(result.exists)
    }

    @Test
    fun nextManeuver_nullCoordinates_returnsNotExists() {
        val result = ManeuverTracker.nextManeuver(null, steps, 0.0, 51.5)
        assertFalse(result.exists)
    }
}
