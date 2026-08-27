package org.vectair.vcas.car.logic

import org.json.JSONObject

/**
 * OpenRouteService routing — a structural port of `src/routing/
 * orsProvider.js`'s response parsing, split into a pure, testable
 * `parseRouteResponse()` and the actual network call (`getRoute()`, not
 * unit-testable in this sandbox for the same reason `AdsbFiClient.kt`
 * isn't — no network access to a real ORS endpoint here). Same real ORS
 * Directions v2 GeoJSON response shape the JS original reads:
 * `features[0].properties.summary.{distance,duration}` and
 * `features[0].properties.segments[0].steps[]`, each step
 * `{distance, duration, type, instruction, name, way_points:[start,end]}`.
 *
 * `parseRouteResponse()` mirrors the JS original's defensive-by-field
 * reading exactly — a missing/malformed `segments`/`steps` degrades to an
 * empty steps list (not a crash), matching `ManeuverTracker`'s own doc
 * comment that this schema, while ORS's long-stable public one, was never
 * verified against a live response from a network-restricted sandbox.
 */
object OrsProvider {

    data class Step(
        val distanceMeters: Double,
        val durationSeconds: Double,
        val type: Int?,
        val instruction: String?,
        val name: String?,
        val wayPointStart: Int?,
        val wayPointEnd: Int?
    )

    /** `geometry` is [lon, lat] pairs — same convention Geo.kt/RouteGeometry.kt already use. */
    data class Route(
        val geometry: List<DoubleArray>,
        val distanceMeters: Double,
        val durationSeconds: Double,
        val steps: List<Step>
    )

    private val PROFILES = mapOf(
        "driving" to "driving-car",
        "cycling" to "cycling-regular",
        "walking" to "foot-walking"
    )

    fun profileFor(mode: String): String = PROFILES[mode] ?: PROFILES.getValue("driving")

    fun directionsUrl(baseUrl: String, apiKey: String, mode: String, startLat: Double, startLon: Double, endLat: Double, endLon: Double): String {
        val profile = profileFor(mode)
        return "$baseUrl/$profile?api_key=${java.net.URLEncoder.encode(apiKey, "UTF-8")}" +
            "&start=$startLon,$startLat&end=$endLon,$endLat"
    }

    fun parseRouteResponse(json: JSONObject): Route? {
        val features = json.optJSONArray("features") ?: return null
        if (features.length() == 0) return null
        val feature = features.optJSONObject(0) ?: return null

        val properties = feature.optJSONObject("properties") ?: return null
        val summary = properties.optJSONObject("summary") ?: return null
        val distanceMeters = summary.optDouble("distance", 0.0)
        val durationSeconds = summary.optDouble("duration", 0.0)

        val geometryObj = feature.optJSONObject("geometry")
        val coordsArr = geometryObj?.optJSONArray("coordinates")
        val geometry = ArrayList<DoubleArray>(coordsArr?.length() ?: 0)
        if (coordsArr != null) {
            for (i in 0 until coordsArr.length()) {
                val pair = coordsArr.optJSONArray(i) ?: continue
                if (pair.length() < 2) continue
                geometry.add(doubleArrayOf(pair.optDouble(0), pair.optDouble(1)))
            }
        }
        if (geometry.size < 2) return null

        val steps = ArrayList<Step>()
        val segments = properties.optJSONArray("segments")
        val firstSegment = segments?.optJSONObject(0)
        val stepsArr = firstSegment?.optJSONArray("steps")
        if (stepsArr != null) {
            for (i in 0 until stepsArr.length()) {
                val s = stepsArr.optJSONObject(i) ?: continue
                val wayPoints = s.optJSONArray("way_points")
                steps.add(
                    Step(
                        distanceMeters = s.optDouble("distance", 0.0),
                        durationSeconds = s.optDouble("duration", 0.0),
                        type = if (s.has("type") && !s.isNull("type")) s.optInt("type") else null,
                        instruction = if (s.has("instruction") && !s.isNull("instruction")) s.optString("instruction") else null,
                        name = if (s.has("name") && !s.isNull("name")) s.optString("name") else null,
                        wayPointStart = wayPoints?.optInt(0),
                        wayPointEnd = wayPoints?.optInt(1)
                    )
                )
            }
        }

        return Route(geometry, distanceMeters, durationSeconds, steps)
    }

    /**
     * Real network call — `HttpURLConnection`, same "plain framework API,
     * avoid a dependency this sandbox can't verify" discipline already
     * established for `AdsbFiClient.kt`. Must be called off the main
     * thread. Returns null on any failure (bad key, network error,
     * unparseable response) — the caller degrades gracefully, matching
     * the JS original's own `console.warn`-and-return-null behaviour.
     */
    fun getRoute(apiKey: String, mode: String, startLat: Double, startLon: Double, endLat: Double, endLon: Double): Route? {
        if (apiKey.isBlank()) return null
        val url = directionsUrl(BASE_URL, apiKey, mode, startLat, startLon, endLat, endLon)
        var connection: java.net.HttpURLConnection? = null
        return try {
            connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
            }
            if (connection.responseCode != java.net.HttpURLConnection.HTTP_OK) return null
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            parseRouteResponse(JSONObject(body))
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    private const val BASE_URL = "https://api.openrouteservice.org/v2/directions"
    private const val TIMEOUT_MS = 12000
}
