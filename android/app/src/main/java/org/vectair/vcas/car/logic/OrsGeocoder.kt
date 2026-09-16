package org.vectair.vcas.car.logic

import org.json.JSONObject

/**
 * OpenRouteService geocoding (search-by-name/address) — a structural port
 * of `src/routing/orsGeocoder.js`, same split as `OrsProvider.kt`: a pure,
 * testable `parseSearchResponse()` and the real network call. Same
 * Pelias-based GeoJSON response shape the JS original reads:
 * `features[].properties.label` / `features[].geometry.coordinates`
 * (`[lon, lat]`).
 */
object OrsGeocoder {

    data class Result(val label: String, val lat: Double, val lon: Double)

    const val MIN_CHARS = 3 // shorter queries are mostly noise/wasted quota, matches the JS original

    fun searchUrl(baseUrl: String, apiKey: String, text: String, focusLat: Double?, focusLon: Double?): String {
        val params = StringBuilder()
        params.append("api_key=").append(java.net.URLEncoder.encode(apiKey, "UTF-8"))
        params.append("&text=").append(java.net.URLEncoder.encode(text, "UTF-8"))
        params.append("&size=6")
        if (focusLat != null && focusLon != null) {
            params.append("&focus.point.lat=").append(focusLat)
            params.append("&focus.point.lon=").append(focusLon)
        }
        return "$baseUrl?$params"
    }

    fun parseSearchResponse(json: JSONObject, fallbackLabel: String): List<Result> {
        val features = json.optJSONArray("features") ?: return emptyList()
        val results = ArrayList<Result>(features.length())
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val geometry = f.optJSONObject("geometry") ?: continue
            val coords = geometry.optJSONArray("coordinates") ?: continue
            if (coords.length() < 2) continue
            val properties = f.optJSONObject("properties")
            val label = properties?.optString("label")?.takeIf { it.isNotBlank() } ?: fallbackLabel
            results.add(Result(label = label, lon = coords.optDouble(0), lat = coords.optDouble(1)))
        }
        return results
    }

    /** Real network call — see `OrsProvider.kt`'s own doc comment for the same discipline. */
    fun search(apiKey: String, text: String, focusLat: Double?, focusLon: Double?): List<Result> {
        val query = text.trim()
        if (query.length < MIN_CHARS || apiKey.isBlank()) return emptyList()

        val url = searchUrl(BASE_URL, apiKey, query, focusLat, focusLon)
        var connection: java.net.HttpURLConnection? = null
        return try {
            connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
            }
            if (connection.responseCode != java.net.HttpURLConnection.HTTP_OK) return emptyList()
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            parseSearchResponse(JSONObject(body), query)
        } catch (e: Exception) {
            emptyList()
        } finally {
            connection?.disconnect()
        }
    }

    private const val BASE_URL = "https://api.openrouteservice.org/geocode/search"
    private const val TIMEOUT_MS = 8000
}
