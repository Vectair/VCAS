package org.vectair.vcas.car.logic

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OrsGeocoderTest {

    @Test
    fun parseSearchResponse_realShape_parsesLabelAndLonLatSwap() {
        val json = """
        {
          "features": [
            { "geometry": {"coordinates": [-0.1275, 51.5072]}, "properties": {"label": "London, UK"} },
            { "geometry": {"coordinates": [-2.5879, 51.4545]}, "properties": {"label": "Bristol, UK"} }
          ]
        }
        """.trimIndent()
        val results = OrsGeocoder.parseSearchResponse(JSONObject(json), fallbackLabel = "query")
        assertEquals(2, results.size)
        assertEquals("London, UK", results[0].label)
        assertEquals(51.5072, results[0].lat, 1e-9)
        assertEquals(-0.1275, results[0].lon, 1e-9)
    }

    @Test
    fun parseSearchResponse_missingLabel_fallsBackToQueryText() {
        val json = """{"features": [{"geometry": {"coordinates": [1.0, 2.0]}, "properties": {}}]}"""
        val results = OrsGeocoder.parseSearchResponse(JSONObject(json), fallbackLabel = "my query")
        assertEquals(1, results.size)
        assertEquals("my query", results[0].label)
    }

    @Test
    fun parseSearchResponse_featureMissingCoordinates_isSkippedNotCrash() {
        val json = """
        {
          "features": [
            { "geometry": {}, "properties": {"label": "Bad"} },
            { "geometry": {"coordinates": [1.0, 2.0]}, "properties": {"label": "Good"} }
          ]
        }
        """.trimIndent()
        val results = OrsGeocoder.parseSearchResponse(JSONObject(json), fallbackLabel = "q")
        assertEquals(1, results.size)
        assertEquals("Good", results[0].label)
    }

    @Test
    fun parseSearchResponse_noFeatures_returnsEmptyList() {
        assertTrue(OrsGeocoder.parseSearchResponse(JSONObject("""{"features": []}"""), "q").isEmpty())
    }

    @Test
    fun search_belowMinChars_shortCircuitsWithoutNetworkCall() {
        // "ab" is under MIN_CHARS(3) — must return empty without even
        // attempting the network call (which would hang/fail in this
        // sandbox anyway) — the real behavioural guarantee this test checks.
        assertTrue(OrsGeocoder.search("FAKE_KEY", "ab", null, null).isEmpty())
    }

    @Test
    fun search_blankApiKey_shortCircuitsWithoutNetworkCall() {
        assertTrue(OrsGeocoder.search("", "a real query", null, null).isEmpty())
    }

    @Test
    fun searchUrl_includesFocusPointOnlyWhenProvided() {
        val withFocus = OrsGeocoder.searchUrl("https://api.openrouteservice.org/geocode/search", "KEY", "London", 51.5, -0.1)
        assertTrue(withFocus.contains("focus.point.lat=51.5"))
        assertTrue(withFocus.contains("focus.point.lon=-0.1"))

        val withoutFocus = OrsGeocoder.searchUrl("https://api.openrouteservice.org/geocode/search", "KEY", "London", null, null)
        assertFalse(withoutFocus.contains("focus.point"))
    }
}
