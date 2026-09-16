package org.vectair.vcas.car.logic

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the normaliseAircraft.js -> NormaliseAircraft.kt
 * port, following this project's established discipline (see CLAUDE.md,
 * every prior logic port): run against real execution, not just read for
 * correctness. Uses the real `org.json.JSONObject` (the standalone
 * `org.json:json` Maven Central artifact in this test toolchain, the
 * exact same public API Android's own bundled org.json implements at
 * runtime — see NormaliseAircraft.kt's own doc comment).
 *
 * Emphasis is on the `??`-vs-`||` distinction the JS source deliberately
 * makes per-field (see NormaliseAircraft.kt's own doc comment) — a real
 * `0` must survive through the numeric `??` chains, while an empty
 * string must NOT survive through the string `||` chains — since getting
 * this backwards is exactly the kind of bug that's invisible until a
 * real record with a boundary value (an aircraft seen 0 seconds ago, a
 * 0ft barometric altitude) arrives.
 */
class NormaliseAircraftTest {

    private fun json(vararg pairs: Pair<String, Any?>): JSONObject {
        val obj = JSONObject()
        for ((k, v) in pairs) {
            if (v == null) obj.put(k, JSONObject.NULL) else obj.put(k, v)
        }
        return obj
    }

    @Test
    fun validRecord_normalisesEveryField() {
        val raw = json(
            "hex" to "a1b2c3", "flight" to " VCAS123 ", "t" to "B738",
            "lat" to 40.7128, "lon" to -74.0060, "alt_baro" to 5000, "alt_geom" to 5200,
            "track" to 270.5, "gs" to 450.0, "baro_rate" to -500,
            "seen_pos" to 2.5, "category" to "a3", "r" to "N12345"
        )
        val ac = NormaliseAircraft.normalise(raw)!!

        assertEquals("A1B2C3", ac.hex)
        assertEquals("VCAS123", ac.callsign)
        assertEquals("B738", ac.type)
        assertEquals(40.7128, ac.lat, 1e-9)
        assertEquals(-74.0060, ac.lon, 1e-9)
        assertEquals(5200.0, ac.altitudeFt!!, 1e-9) // alt_geom preferred over alt_baro
        assertEquals(false, ac.onGround)
        assertEquals(270.5, ac.trackDeg!!, 1e-9)
        assertEquals(450.0, ac.groundSpeedKt!!, 1e-9)
        assertEquals(-500.0, ac.verticalRateFpm!!, 1e-9)
        assertEquals(2.5, ac.lastSeenSeconds, 1e-9)
        assertEquals("A3", ac.category)
        assertEquals("N12345", ac.registration)
        assertEquals(false, ac.isGroundVehicleOrObstacle)
    }

    // ---- hex / identity ----

    @Test
    fun missingHexAndIcao_returnsNull() {
        assertNull(NormaliseAircraft.normalise(json("lat" to 40.0, "lon" to -75.0)))
    }

    @Test
    fun emptyHex_fallsBackToIcao() {
        val raw = json("hex" to "", "icao" to "abc123", "lat" to 40.0, "lon" to -75.0)
        assertEquals("ABC123", NormaliseAircraft.normalise(raw)!!.hex)
    }

    @Test
    fun completelyEmptyRecord_returnsNull() {
        assertNull(NormaliseAircraft.normalise(JSONObject()))
    }

    // ---- lat/lon ----

    @Test
    fun missingLatLon_returnsNull() {
        assertNull(NormaliseAircraft.normalise(json("hex" to "ABC123")))
    }

    @Test
    fun nonNumericLat_returnsNull() {
        assertNull(NormaliseAircraft.normalise(json("hex" to "ABC123", "lat" to "not-a-number", "lon" to -75.0)))
    }

    @Test
    fun latLonAsNumericStrings_parseCorrectly() {
        val raw = json("hex" to "ABC123", "lat" to "40.5", "lon" to "-74.25")
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals(40.5, ac.lat, 1e-9)
        assertEquals(-74.25, ac.lon, 1e-9)
    }

    // ---- altitude / onGround ----

    @Test
    fun altBaroLiteralGround_setsOnGroundTrue_altitudeNullWithoutAltGeom() {
        val raw = json("hex" to "ABC123", "lat" to 40.0, "lon" to -75.0, "alt_baro" to " Ground ")
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals(true, ac.onGround)
        assertNull(ac.altitudeFt)
    }

    @Test
    fun altBaroGround_stillUsesAltGeomIfPresent() {
        val raw = json("hex" to "ABC123", "lat" to 40.0, "lon" to -75.0, "alt_baro" to "ground", "alt_geom" to 150)
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals(true, ac.onGround)
        assertEquals(150.0, ac.altitudeFt!!, 1e-9)
    }

    @Test
    fun altBaroRealZero_isNotTreatedAsGround_andSurvivesTheNullishChain() {
        // The critical ?? -vs-|| distinction: a real 0 must NOT be treated
        // as "absent" the way an empty string would be for the || chains.
        val raw = json("hex" to "ABC123", "lat" to 40.0, "lon" to -75.0, "alt_baro" to 0)
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals(false, ac.onGround)
        assertEquals(0.0, ac.altitudeFt!!, 1e-9)
    }

    @Test
    fun altGeomPreferredOverAltBaro_whenBothPresent() {
        val raw = json("hex" to "ABC123", "lat" to 40.0, "lon" to -75.0, "alt_baro" to 3000, "alt_geom" to 3200)
        assertEquals(3200.0, NormaliseAircraft.normalise(raw)!!.altitudeFt!!, 1e-9)
    }

    @Test
    fun altBaroFallsBackToAltitudeThenAlt_whenAltBaroAbsent() {
        val ac1 = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "altitude" to 1000))
        assertEquals(1000.0, ac1!!.altitudeFt!!, 1e-9)
        val ac2 = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "alt" to 800))
        assertEquals(800.0, ac2!!.altitudeFt!!, 1e-9)
    }

    @Test
    fun noAltitudeFieldsAtAll_altitudeFtIsNull() {
        val raw = json("hex" to "ABC123", "lat" to 40.0, "lon" to -75.0)
        assertNull(NormaliseAircraft.normalise(raw)!!.altitudeFt)
    }

    // ---- track / speed / vertical rate: null when absent, fallback names honoured ----

    @Test
    fun trackFallsBackToTrueHeading() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "true_heading" to 90.0)
        assertEquals(90.0, NormaliseAircraft.normalise(raw)!!.trackDeg!!, 1e-9)
    }

    @Test
    fun groundSpeedFallsBackToSpeed() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "speed" to 120.0)
        assertEquals(120.0, NormaliseAircraft.normalise(raw)!!.groundSpeedKt!!, 1e-9)
    }

    @Test
    fun verticalRate_priorityOrder_baroThenGeomThenVert() {
        val onlyVert = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "vert_rate" to 100)
        assertEquals(100.0, NormaliseAircraft.normalise(onlyVert)!!.verticalRateFpm!!, 1e-9)

        val geomAndVert = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "geom_rate" to 200, "vert_rate" to 999)
        assertEquals(200.0, NormaliseAircraft.normalise(geomAndVert)!!.verticalRateFpm!!, 1e-9)

        val allThree = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "baro_rate" to 50, "geom_rate" to 200, "vert_rate" to 999)
        assertEquals(50.0, NormaliseAircraft.normalise(allThree)!!.verticalRateFpm!!, 1e-9)
    }

    @Test
    fun missingTrackSpeedVerticalRate_areNull() {
        val ac = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0))!!
        assertNull(ac.trackDeg)
        assertNull(ac.groundSpeedKt)
        assertNull(ac.verticalRateFpm)
    }

    // ---- lastSeenSeconds ----

    @Test
    fun seenPosRealZero_survives_notTreatedAsAbsent() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "seen_pos" to 0)
        assertEquals(0.0, NormaliseAircraft.normalise(raw)!!.lastSeenSeconds, 1e-9)
    }

    @Test
    fun seenPosAbsent_fallsBackToSeenThenLastSeen() {
        val ac1 = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "seen" to 4.0))
        assertEquals(4.0, ac1!!.lastSeenSeconds, 1e-9)
        val ac2 = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "last_seen" to 7.0))
        assertEquals(7.0, ac2!!.lastSeenSeconds, 1e-9)
    }

    @Test
    fun allSeenFieldsAbsent_defaultsToZero() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0)
        assertEquals(0.0, NormaliseAircraft.normalise(raw)!!.lastSeenSeconds, 1e-9)
    }

    // ---- category / isGroundVehicleOrObstacle ----

    @Test
    fun nonAircraftCategory_setsIsGroundVehicleOrObstacleTrue() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "category" to "c2")
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals("C2", ac.category)
        assertEquals(true, ac.isGroundVehicleOrObstacle)
    }

    @Test
    fun ordinaryAircraftCategory_isGroundVehicleOrObstacleFalse() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "category" to "A3")
        assertEquals(false, NormaliseAircraft.normalise(raw)!!.isGroundVehicleOrObstacle)
    }

    @Test
    fun missingCategory_isNullAndNotGroundVehicle() {
        val ac = NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0))!!
        assertNull(ac.category)
        assertEquals(false, ac.isGroundVehicleOrObstacle)
    }

    // ---- string fields: whitespace, fallback names, blank-vs-absent ----

    @Test
    fun callsignAndType_trimmedAndFallbackNamesHonoured() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "callsign" to "  UAL456  ", "aircraft_type" to " A320 ")
        val ac = NormaliseAircraft.normalise(raw)!!
        assertEquals("UAL456", ac.callsign)
        assertEquals("A320", ac.type)
    }

    @Test
    fun blankCallsign_isTreatedAsAbsent_null() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "flight" to "   ")
        assertNull(NormaliseAircraft.normalise(raw)!!.callsign)
    }

    @Test
    fun registrationMissing_isNull() {
        assertNull(NormaliseAircraft.normalise(json("hex" to "A", "lat" to 40.0, "lon" to -75.0))!!.registration)
    }

    // ---- parseFloat leniency (a real, non-obvious JS quirk being replicated) ----

    @Test
    fun parseFloatLike_leadingNumericTokenOfAString_matchesJsParseFloatBehaviour() {
        // JS parseFloat("123abc") === 123, not NaN -- ported faithfully.
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "gs" to "250kt")
        assertEquals(250.0, NormaliseAircraft.normalise(raw)!!.groundSpeedKt!!, 1e-9)
    }

    @Test
    fun parseFloatLike_nonNumericString_isNaN_fieldNull() {
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "gs" to "fast")
        assertNull(NormaliseAircraft.normalise(raw)!!.groundSpeedKt)
    }

    @Test
    fun hexLowercaseInput_isUppercasedInOutput() {
        assertEquals("DEADBEEF", NormaliseAircraft.normalise(json("hex" to "deadbeef", "lat" to 40.0, "lon" to -75.0))!!.hex)
    }

    @Test
    fun explicitJsonNull_isTreatedSameAsAbsent() {
        // A field present in the JSON but explicitly `null` (not merely
        // missing) must fall through the ?? chain the same way an absent
        // key does.
        val raw = json("hex" to "A", "lat" to 40.0, "lon" to -75.0, "alt_baro" to null, "altitude" to 900)
        assertTrue(NormaliseAircraft.normalise(raw)!!.altitudeFt == 900.0)
    }
}
