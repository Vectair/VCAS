package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the aircraftExtrapolation.js ->
 * AircraftExtrapolation.kt port, following this project's established
 * discipline (see CLAUDE.md, the three prior logic ports): run against
 * real execution, not just read for correctness.
 *
 * Small, mostly-branchy file, so the emphasis here is on the early-return
 * guards (each verified via reference identity — JS's `return aircraft;`
 * hands back the exact same object, not a copy, so Kotlin's early-return
 * `return aircraft` should too — checked with assertSame, not just
 * assertEquals) and one exact numeric cross-check against Geo's own
 * already-verified destinationPoint(), since extrapolate()'s real formula
 * is a thin wrapper around it with identical double arithmetic — no
 * geodesic/relational margin needed, an exact comparison is legitimate.
 */
class AircraftExtrapolationTest {

    private fun aircraftAt(
        lat: Double = 40.0,
        lon: Double = -75.0,
        groundSpeedKt: Double? = 250.0,
        trackDeg: Double? = 90.0,
        onGround: Boolean = false
    ) = AircraftExtrapolation.Aircraft(
        lat = lat,
        lon = lon,
        hex = "A1B2C3",
        callsign = "TEST123",
        type = "B738",
        altitudeFt = 5000.0,
        onGround = onGround,
        trackDeg = trackDeg,
        groundSpeedKt = groundSpeedKt,
        verticalRateFpm = 500.0,
        lastSeenSeconds = 2.0,
        category = "A3",
        registration = "N12345",
        isGroundVehicleOrObstacle = false
    )

    // ---- Early-return guards: must return the exact same instance ----

    @Test
    fun missingGroundSpeed_returnsSameInstanceUnchanged() {
        val ac = aircraftAt(groundSpeedKt = null)
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 10.0, maxElapsedSeconds = 30.0)
        assertSame(ac, result)
    }

    @Test
    fun missingTrackDeg_returnsSameInstanceUnchanged() {
        val ac = aircraftAt(trackDeg = null)
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 10.0, maxElapsedSeconds = 30.0)
        assertSame(ac, result)
    }

    @Test
    fun onGround_returnsSameInstanceUnchanged_evenWithFullMotionData() {
        val ac = aircraftAt(onGround = true, groundSpeedKt = 15.0, trackDeg = 45.0)
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 10.0, maxElapsedSeconds = 30.0)
        assertSame(ac, result)
    }

    @Test
    fun zeroElapsedSeconds_returnsSameInstanceUnchanged() {
        val ac = aircraftAt()
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 0.0, maxElapsedSeconds = 30.0)
        assertSame(ac, result)
    }

    @Test
    fun negativeElapsedSeconds_clampsToZero_returnsSameInstanceUnchanged() {
        // Math.min(Math.max(elapsedSeconds, 0), max) clamps a negative
        // elapsed time up to exactly 0, which then hits the `seconds == 0`
        // early return too.
        val ac = aircraftAt()
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = -5.0, maxElapsedSeconds = 30.0)
        assertSame(ac, result)
    }

    // ---- Normal extrapolation: exact cross-check against Geo.destinationPoint ----

    @Test
    fun normalExtrapolation_matchesGeoDestinationPointExactly() {
        val ac = aircraftAt(lat = 40.0, lon = -75.0, groundSpeedKt = 250.0, trackDeg = 90.0)
        val elapsedSeconds = 12.0
        val maxElapsedSeconds = 30.0 // not clamping

        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds, maxElapsedSeconds)

        val expectedDistanceMeters = 250.0 * 0.514444 * elapsedSeconds
        val expected = Geo.destinationPoint(40.0, -75.0, 90.0, expectedDistanceMeters)

        assertEquals(expected.lat, result.lat, 1e-12)
        assertEquals(expected.lon, result.lon, 1e-12)
    }

    @Test
    fun normalExtrapolation_preservesEveryOtherFieldUntouched() {
        val ac = aircraftAt(groundSpeedKt = 400.0, trackDeg = 270.0)
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 5.0, maxElapsedSeconds = 30.0)

        assertEquals(ac.hex, result.hex)
        assertEquals(ac.callsign, result.callsign)
        assertEquals(ac.type, result.type)
        assertEquals(ac.altitudeFt, result.altitudeFt)
        assertEquals(ac.onGround, result.onGround)
        assertEquals(ac.trackDeg, result.trackDeg)
        assertEquals(ac.groundSpeedKt, result.groundSpeedKt)
        assertEquals(ac.verticalRateFpm, result.verticalRateFpm)
        assertEquals(ac.lastSeenSeconds, result.lastSeenSeconds, 1e-9)
        assertEquals(ac.category, result.category)
        assertEquals(ac.registration, result.registration)
        assertEquals(ac.isGroundVehicleOrObstacle, result.isGroundVehicleOrObstacle)
        // Only lat/lon actually changed.
        assertTrue(result.lat != ac.lat || result.lon != ac.lon)
    }

    @Test
    fun elapsedSecondsBeyondCap_isClampedToMaxElapsedSeconds() {
        val ac = aircraftAt(lat = 40.0, lon = -75.0, groundSpeedKt = 300.0, trackDeg = 45.0)
        val maxElapsedSeconds = 8.0

        // Far beyond the cap — must project using maxElapsedSeconds, not
        // the raw elapsed time.
        val resultCapped = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 500.0, maxElapsedSeconds)
        val expectedAtCap = Geo.destinationPoint(40.0, -75.0, 45.0, 300.0 * 0.514444 * maxElapsedSeconds)
        assertEquals(expectedAtCap.lat, resultCapped.lat, 1e-12)
        assertEquals(expectedAtCap.lon, resultCapped.lon, 1e-12)

        // And it must genuinely differ from what the UNcapped elapsed time
        // would have produced — proves real clamping happened, not a
        // coincidental match.
        val uncappedWouldBe = Geo.destinationPoint(40.0, -75.0, 45.0, 300.0 * 0.514444 * 500.0)
        assertTrue(
            Math.abs(uncappedWouldBe.lat - resultCapped.lat) > 1e-6 ||
                Math.abs(uncappedWouldBe.lon - resultCapped.lon) > 1e-6
        )
    }

    @Test
    fun elapsedSecondsExactlyAtCap_notFurtherClamped() {
        val ac = aircraftAt(lat = 40.0, lon = -75.0, groundSpeedKt = 200.0, trackDeg = 180.0)
        val maxElapsedSeconds = 10.0
        val result = AircraftExtrapolation.extrapolate(ac, elapsedSeconds = 10.0, maxElapsedSeconds)
        val expected = Geo.destinationPoint(40.0, -75.0, 180.0, 200.0 * 0.514444 * 10.0)
        assertEquals(expected.lat, result.lat, 1e-12)
        assertEquals(expected.lon, result.lon, 1e-12)
    }

    // ---- extrapolateAll ----

    @Test
    fun extrapolateAll_mapsEachAircraftIndependently_preservingOrder() {
        val noTrack = aircraftAt(trackDeg = null)
        val grounded = aircraftAt(onGround = true, groundSpeedKt = 10.0, trackDeg = 0.0)
        val flying = aircraftAt(lat = 40.0, lon = -75.0, groundSpeedKt = 250.0, trackDeg = 90.0)

        val result = AircraftExtrapolation.extrapolateAll(
            listOf(noTrack, grounded, flying),
            elapsedSeconds = 12.0,
            maxElapsedSeconds = 30.0
        )

        assertEquals(3, result.size)
        assertSame(noTrack, result[0])
        assertSame(grounded, result[1])

        val expected = Geo.destinationPoint(40.0, -75.0, 90.0, 250.0 * 0.514444 * 12.0)
        assertEquals(expected.lat, result[2].lat, 1e-12)
        assertEquals(expected.lon, result[2].lon, 1e-12)
    }

    @Test
    fun extrapolateAll_emptyList_returnsEmptyList() {
        val result = AircraftExtrapolation.extrapolateAll(emptyList(), elapsedSeconds = 5.0, maxElapsedSeconds = 30.0)
        assertTrue(result.isEmpty())
    }
}
