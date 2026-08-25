package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.cos

/**
 * Real JUnit4 verification of the relevance.js -> Relevance.kt port,
 * following this project's established discipline (see CLAUDE.md,
 * "Android Auto phase 1, continued" and the two logic ports before this
 * one): run against real execution, not just read for correctness.
 *
 * Three verification styles:
 *  - Exact-boundary tests for the teardrop shape itself (0/60/180 deg),
 *    using values solved analytically from the same closed-form formula
 *    teardropRangeNm() uses, so the `<=` cutoff can be checked precisely
 *    without any geodesic computation being involved at all — evaluate()
 *    accepts relativeBearing/vis.slantRangeNm directly, so these need no
 *    real coordinates.
 *  - Scenario tests (overhead, contrail range extension, "extension never
 *    shrinks a larger custom rMaxNm") against the real documented branch
 *    behaviour, each worked through by hand before asserting.
 *  - Predicted-entry tests, which DO need real coordinates since
 *    predictedEntrySeconds() calls Geo internally: rather than trusting
 *    hand-picked margins, a small helper replicates the same
 *    project/bearing/range computation using Geo's own already-verified
 *    (GeoTest.kt, 34/34 passing) primitives to independently determine
 *    which sample should trigger, then checks Relevance.evaluate()
 *    against that — not a re-test of Geo, a check that
 *    predictedEntrySeconds()'s own sampling loop (step size, sample
 *    count, early-return) matches the documented algorithm.
 */
class RelevanceTest {

    private val userLat = 40.0
    private val userLon = -75.0

    // ---- Exact teardrop-boundary tests (via evaluate(), no real coords) ----

    private fun visAt(slantRangeNm: Double, elevationDeg: Double = 0.0) = Relevance.VisInput(slantRangeNm, elevationDeg)

    // An aircraft with no track/speed data can never trigger predicted-entry,
    // so any evaluate() call using this guarantees only the in-view/overhead
    // branches are exercised.
    private fun acNoMotionData(altitudeFt: Double? = null) =
        Relevance.AircraftState(lat = userLat, lon = userLon, altitudeFt = altitudeFt)

    private val stationaryUser = Relevance.UserState(userLat, userLon, heading = 0.0, speedMph = 0.0)

    @Test
    fun teardrop_deadAhead_justInsideBoundary() {
        // teardropRangeNm(0) == rMaxNm == 15.0 exactly (cos(0)=1, f=1).
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 0.0, visAt(15.0))
        assertEquals(true, result.relevant)
        assertEquals("in-view", result.reason)
        assertEquals(0.0, result.enterInSeconds!!, 1e-9)
    }

    @Test
    fun teardrop_deadAhead_justOutsideBoundary() {
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 0.0, visAt(15.01))
        assertEquals(false, result.relevant)
        assertNull(result.reason)
        assertNull(result.enterInSeconds)
    }

    @Test
    fun teardrop_deadBehind_justInsideBoundary() {
        // teardropRangeNm(180) == rMinNm == 3.0 exactly (cos(180)=-1, f=0).
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 180.0, visAt(3.0))
        assertEquals(true, result.relevant)
        assertEquals("in-view", result.reason)
    }

    @Test
    fun teardrop_deadBehind_justOutsideBoundary() {
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 180.0, visAt(3.01))
        assertEquals(false, result.relevant)
    }

    @Test
    fun teardrop_at60Degrees_exactAnalyticBoundary() {
        // cos(60deg)=0.5, f=((1+0.5)/2)^2=0.5625, range = 3 + 12*0.5625 = 9.75 exactly.
        val boundary = Relevance.DEFAULTS.rMinNm +
            (Relevance.DEFAULTS.rMaxNm - Relevance.DEFAULTS.rMinNm) *
            ((1 + cos(Math.toRadians(60.0))) / 2).let { Math.pow(it, Relevance.DEFAULTS.pinchExponent) }
        assertEquals(9.75, boundary, 1e-9)

        val inside = Relevance.evaluate(stationaryUser, acNoMotionData(), 60.0, visAt(boundary))
        assertEquals("in-view", inside.reason)

        val outside = Relevance.evaluate(stationaryUser, acNoMotionData(), 60.0, visAt(boundary + 0.01))
        assertEquals(false, outside.relevant)
    }

    // ---- Overhead ----

    @Test
    fun overhead_justAboveThreshold_isRelevantRegardlessOfBearingOrRange() {
        // elevationDeg > 70, with bearing/range that would otherwise be
        // nowhere near the teardrop.
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 90.0, visAt(slantRangeNm = 999.0, elevationDeg = 70.01))
        assertEquals(true, result.relevant)
        assertEquals("overhead", result.reason)
        assertEquals(0.0, result.enterInSeconds!!, 1e-9)
    }

    @Test
    fun overhead_exactlyAtThreshold_doesNotQualify() {
        // Condition is strictly `>`, not `>=`.
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(), 90.0, visAt(slantRangeNm = 999.0, elevationDeg = 70.0))
        assertEquals(false, result.relevant)
    }

    // ---- Contrail range extension ----

    @Test
    fun highAltitude_extendsDeadAheadRangeTo50nm() {
        // 40nm is beyond the base 15nm teardrop but within the 50nm
        // contrail extension cap, for an aircraft at/above 26,000ft.
        val result = Relevance.evaluate(
            stationaryUser,
            acNoMotionData(altitudeFt = 30000.0),
            0.0,
            visAt(40.0)
        )
        assertEquals(true, result.relevant)
        assertEquals("in-view", result.reason)
    }

    @Test
    fun belowContrailAltitude_doesNotExtendRange() {
        val result = Relevance.evaluate(
            stationaryUser,
            acNoMotionData(altitudeFt = 10000.0),
            0.0,
            visAt(40.0)
        )
        assertEquals(false, result.relevant)
    }

    @Test
    fun contrailExtension_neverShrinksALargerCustomRMaxNm() {
        // A custom rMaxNm (60) bigger than the default rangeExtensionCapNm
        // (50) must not be clamped DOWN to 50 just because the contrail
        // condition also applies — effectiveRMaxNm is max(rMaxNm, cap).
        val customOpts = Relevance.Options(rMaxNm = 60.0)
        val result = Relevance.evaluate(
            stationaryUser,
            acNoMotionData(altitudeFt = 30000.0),
            0.0,
            visAt(55.0),
            customOpts
        )
        assertEquals(true, result.relevant)
        assertEquals("in-view", result.reason)
    }

    @Test
    fun altitudeNull_doesNotExtendRange() {
        val result = Relevance.evaluate(stationaryUser, acNoMotionData(altitudeFt = null), 0.0, visAt(40.0))
        assertEquals(false, result.relevant)
    }

    // ---- Predicted entry: insufficient data ----

    @Test
    fun predictedEntry_missingTrackDeg_neverTriggers() {
        val aircraft = Relevance.AircraftState(userLat, userLon, trackDeg = null, groundSpeedKt = 250.0)
        val result = Relevance.evaluate(stationaryUser, aircraft, 0.0, visAt(999.0))
        assertEquals(false, result.relevant)
    }

    @Test
    fun predictedEntry_missingGroundSpeed_neverTriggers() {
        val aircraft = Relevance.AircraftState(userLat, userLon, trackDeg = 180.0, groundSpeedKt = null)
        val result = Relevance.evaluate(stationaryUser, aircraft, 0.0, visAt(999.0))
        assertEquals(false, result.relevant)
    }

    // ---- Predicted entry: real convergence, verified against an
    // independent replica built from Geo's own verified primitives ----

    /**
     * Replicates predictedEntrySeconds()'s own per-sample projection
     * exactly (same formulas, freshly written here rather than copied)
     * so the expected trigger sample can be derived independently of
     * Relevance.kt's own implementation, using Geo functions already
     * proven correct by GeoTest.kt.
     */
    private fun independentEntrySeconds(
        userState: Relevance.UserState,
        aircraft: Relevance.AircraftState,
        opts: Relevance.Options
    ): Double? {
        val acSpeedMps = aircraft.groundSpeedKt!! * 0.514444
        val userSpeedMps = (userState.speedMph ?: 0.0) * 0.44704
        val userIsMoving = (userState.speedMph ?: 0.0) >= opts.stationarySpeedMph
        val stepSeconds = opts.lookaheadSeconds / opts.lookaheadSamples

        for (i in 1..opts.lookaheadSamples) {
            val t = stepSeconds * i
            val acPos = Geo.projectPosition(aircraft.lat, aircraft.lon, aircraft.trackDeg!!, acSpeedMps * t)
            val userPos = if (userIsMoving) {
                Geo.projectPosition(userState.lat, userState.lon, userState.heading, userSpeedMps * t)
            } else {
                Geo.LatLon(userState.lat, userState.lon)
            }
            val bearing = Geo.calculateBearing(userPos.lat, userPos.lon, acPos.lat, acPos.lon)
            val relBearing = Geo.calculateRelativeBearing(bearing, userState.heading)
            val rangeNm = Geo.calculateDistanceNm(userPos.lat, userPos.lon, acPos.lat, acPos.lon)

            val c = cos(Math.toRadians(relBearing))
            val f = Math.pow((1 + c) / 2, opts.pinchExponent)
            val boundary = opts.rMinNm + (opts.rMaxNm - opts.rMinNm) * f
            if (rangeNm <= boundary) return t
        }
        return null
    }

    @Test
    fun predictedEntry_aircraftConvergingOnStationaryUser_matchesIndependentReplica() {
        // Aircraft 22nm dead ahead (north) of a stationary user, flying
        // south (track 180) directly toward the user at a speed high
        // enough to close inside the 15nm dead-ahead teardrop within the
        // 15s lookahead window.
        val acStart = Geo.destinationPoint(userLat, userLon, 0.0, 22.0 * 1852.0)
        val aircraft = Relevance.AircraftState(acStart.lat, acStart.lon, trackDeg = 180.0, groundSpeedKt = 1800.0)

        val currentBearing = Geo.calculateBearing(userLat, userLon, acStart.lat, acStart.lon)
        val currentRelBearing = Geo.calculateRelativeBearing(currentBearing, stationaryUser.heading)
        val currentRangeNm = Geo.calculateDistanceNm(userLat, userLon, acStart.lat, acStart.lon)

        val expected = independentEntrySeconds(stationaryUser, aircraft, Relevance.DEFAULTS)
        assertNotNull("test setup must actually converge within the lookahead window", expected)

        val result = Relevance.evaluate(stationaryUser, aircraft, currentRelBearing, visAt(currentRangeNm))
        assertEquals(true, result.relevant)
        assertEquals("predicted-entry", result.reason)
        assertEquals(expected!!, result.enterInSeconds!!, 1e-9)
    }

    @Test
    fun predictedEntry_movingUserApproachingStationaryAircraft_matchesIndependentReplica() {
        // Stationary aircraft 15.5nm dead ahead (north); the USER moves
        // toward it (exercising the userIsMoving=true projection branch,
        // not covered by the stationary-user test above).
        val movingUser = Relevance.UserState(userLat, userLon, heading = 0.0, speedMph = 150.0)
        val acPos = Geo.destinationPoint(userLat, userLon, 0.0, 15.5 * 1852.0)
        val aircraft = Relevance.AircraftState(acPos.lat, acPos.lon, trackDeg = 0.0, groundSpeedKt = 0.0)

        val currentBearing = Geo.calculateBearing(userLat, userLon, acPos.lat, acPos.lon)
        val currentRelBearing = Geo.calculateRelativeBearing(currentBearing, movingUser.heading)
        val currentRangeNm = Geo.calculateDistanceNm(userLat, userLon, acPos.lat, acPos.lon)

        val expected = independentEntrySeconds(movingUser, aircraft, Relevance.DEFAULTS)
        assertNotNull("test setup must actually converge within the lookahead window", expected)

        val result = Relevance.evaluate(movingUser, aircraft, currentRelBearing, visAt(currentRangeNm))
        assertEquals(true, result.relevant)
        assertEquals("predicted-entry", result.reason)
        assertEquals(expected!!, result.enterInSeconds!!, 1e-9)
    }

    @Test
    fun predictedEntry_aircraftDivergingFromUser_neverTriggers() {
        // Same setup as the first convergence test, but the aircraft
        // flies AWAY (track 0, continuing north) instead of toward the
        // user — range only increases, so no sample should ever qualify.
        val acStart = Geo.destinationPoint(userLat, userLon, 0.0, 22.0 * 1852.0)
        val aircraft = Relevance.AircraftState(acStart.lat, acStart.lon, trackDeg = 0.0, groundSpeedKt = 1800.0)

        val currentBearing = Geo.calculateBearing(userLat, userLon, acStart.lat, acStart.lon)
        val currentRelBearing = Geo.calculateRelativeBearing(currentBearing, stationaryUser.heading)
        val currentRangeNm = Geo.calculateDistanceNm(userLat, userLon, acStart.lat, acStart.lon)

        val expected = independentEntrySeconds(stationaryUser, aircraft, Relevance.DEFAULTS)
        assertNull("diverging aircraft must not converge in the independent replica either", expected)

        val result = Relevance.evaluate(stationaryUser, aircraft, currentRelBearing, visAt(currentRangeNm))
        assertEquals(false, result.relevant)
        assertNull(result.reason)
        assertNull(result.enterInSeconds)
    }

    // ---- DEFAULTS ----

    @Test
    fun defaults_matchDocumentedTunedConstants() {
        assertEquals(15.0, Relevance.DEFAULTS.rMaxNm, 1e-9)
        assertEquals(3.0, Relevance.DEFAULTS.rMinNm, 1e-9)
        assertEquals(2.0, Relevance.DEFAULTS.pinchExponent, 1e-9)
        assertEquals(70.0, Relevance.DEFAULTS.overheadElevationDeg, 1e-9)
        assertEquals(15.0, Relevance.DEFAULTS.lookaheadSeconds, 1e-9)
        assertEquals(3, Relevance.DEFAULTS.lookaheadSamples)
        assertEquals(5.0, Relevance.DEFAULTS.stationarySpeedMph, 1e-9)
        assertEquals(26000.0, Relevance.DEFAULTS.contrailMinAltitudeFt, 1e-9)
        assertEquals(50.0, Relevance.DEFAULTS.rangeExtensionCapNm, 1e-9)
    }
}
