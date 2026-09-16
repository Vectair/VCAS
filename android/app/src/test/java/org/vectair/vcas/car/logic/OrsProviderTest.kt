package org.vectair.vcas.car.logic

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OrsProviderTest {

    private fun sampleRouteJson(includeSteps: Boolean = true): String {
        val stepsJson = if (includeSteps) """
            [
              {"distance": 500.0, "duration": 60.0, "type": 11, "instruction": "Head north", "name": "Main St", "way_points": [0, 2]},
              {"distance": 300.0, "duration": 30.0, "type": 1, "instruction": "Turn right onto Oak Ave", "name": "Oak Ave", "way_points": [2, 4]},
              {"distance": 0.0, "duration": 0.0, "type": 10, "instruction": "Arrive at destination", "name": "", "way_points": [4, 4]}
            ]
        """.trimIndent() else "[]"

        return """
        {
          "features": [
            {
              "geometry": { "coordinates": [[-0.1,51.5],[-0.1,51.51],[-0.1,51.52],[-0.11,51.52],[-0.11,51.53]] },
              "properties": {
                "summary": { "distance": 800.0, "duration": 90.0 },
                "segments": [ { "steps": $stepsJson } ]
              }
            }
          ]
        }
        """.trimIndent()
    }

    @Test
    fun parseRouteResponse_realShape_parsesGeometryDistanceDurationAndSteps() {
        val route = OrsProvider.parseRouteResponse(JSONObject(sampleRouteJson()))
        assertNotNull(route)
        assertEquals(5, route!!.geometry.size)
        assertEquals(-0.1, route.geometry[0][0], 1e-9)
        assertEquals(51.5, route.geometry[0][1], 1e-9)
        assertEquals(800.0, route.distanceMeters, 1e-9)
        assertEquals(90.0, route.durationSeconds, 1e-9)
        assertEquals(3, route.steps.size)
        assertEquals("Turn right onto Oak Ave", route.steps[1].instruction)
        assertEquals(1, route.steps[1].type)
        assertEquals(2, route.steps[1].wayPointStart)
        assertEquals(4, route.steps[1].wayPointEnd)
    }

    @Test
    fun parseRouteResponse_missingSteps_degradesToEmptyStepsNotCrash() {
        val route = OrsProvider.parseRouteResponse(JSONObject(sampleRouteJson(includeSteps = false)))
        assertNotNull(route)
        assertTrue(route!!.steps.isEmpty())
        // Geometry/distance/duration still parse fine even with no steps.
        assertEquals(5, route.geometry.size)
    }

    @Test
    fun parseRouteResponse_noFeatures_returnsNull() {
        assertNull(OrsProvider.parseRouteResponse(JSONObject("""{"features": []}""")))
    }

    @Test
    fun parseRouteResponse_malformedJson_returnsNullNotThrows() {
        assertNull(OrsProvider.parseRouteResponse(JSONObject("""{"nonsense": true}""")))
    }

    @Test
    fun parseRouteResponse_tooFewCoordinates_returnsNull() {
        val json = """
        {
          "features": [
            { "geometry": { "coordinates": [[-0.1,51.5]] },
              "properties": { "summary": {"distance":1.0,"duration":1.0}, "segments": [] } }
          ]
        }
        """.trimIndent()
        assertNull(OrsProvider.parseRouteResponse(JSONObject(json)))
    }

    @Test
    fun profileFor_mapsModesToRealOrsProfileIds() {
        assertEquals("driving-car", OrsProvider.profileFor("driving"))
        assertEquals("cycling-regular", OrsProvider.profileFor("cycling"))
        assertEquals("foot-walking", OrsProvider.profileFor("walking"))
        assertEquals("driving-car", OrsProvider.profileFor("unknown-mode")) // falls back to driving
    }

    @Test
    fun directionsUrl_includesProfileKeyAndCoordinatesInLonLatOrder() {
        val url = OrsProvider.directionsUrl("https://api.openrouteservice.org/v2/directions", "KEY123", "walking", 51.5, -0.1, 51.6, -0.2)
        assertTrue(url.contains("/foot-walking?"))
        assertTrue(url.contains("api_key=KEY123"))
        assertTrue(url.contains("start=-0.1,51.5"))
        assertTrue(url.contains("end=-0.2,51.6"))
    }
}
