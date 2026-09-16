package org.vectair.vcas.car.logic

import org.json.JSONObject

/**
 * Normalises a raw ADS-B v2/v3-format API record into VCAS's internal
 * aircraft object. Ported from the PWA's src/data/normaliseAircraft.js —
 * discovered as a necessary dependency while wiring real ADS-B polling
 * (2026-08-25), the same way `RouteGeometry.kt` was discovered while
 * porting `navigationCameraEvaluator.js`: not on the original "cleanly
 * portable" scoping list, but equally pure logic (no DOM, no network
 * itself — the actual HTTP fetch lives in `AdsbFiClient.kt`, an Android-
 * specific class this file has no dependency on).
 *
 * Takes a real `org.json.JSONObject` — the same class Android's own SDK
 * provides at runtime (no extra app dependency needed there), and the
 * same public API the standalone `org.json:json` Maven Central artifact
 * implements, which is what actually makes this file's own test suite
 * possible to run for real in this sandbox (no Android SDK here either).
 *
 * All provider-specific field-name knowledge is preserved exactly as the
 * JS original has it — every `??`-vs-`||` distinction in the source
 * matters and is reproduced faithfully (`firstPresent` mirrors JS's `??`
 * nullish-coalescing chains for the numeric-ish fields, which must NOT
 * fall through on a real `0`; `firstNonBlank` mirrors JS's `||` chains
 * for the string fields, which fall through on an empty string too) —
 * getting this backwards for `seen_pos`/`alt_baro` etc. would silently
 * misinterpret a real zero value as "field absent."
 */
object NormaliseAircraft {

    // ADS-B emitter categories (DO-260B) that are never aircraft: ground
    // service/emergency vehicles (C1/C2) and fixed obstacles like cranes
    // or tethered balloons (C3-C5).
    private val NON_AIRCRAFT_CATEGORIES = setOf("C1", "C2", "C3", "C4", "C5")

    private fun optRaw(json: JSONObject, key: String): Any? {
        if (!json.has(key)) return null
        val v = json.opt(key)
        return if (v == null || v === JSONObject.NULL) null else v
    }

    /** Mirrors a JS `a || b || ""` chain — falls through on absence AND on an empty/blank string. */
    private fun firstNonBlank(json: JSONObject, vararg keys: String): String {
        for (k in keys) {
            val s = optRaw(json, k)?.toString()?.trim()
            if (!s.isNullOrEmpty()) return s
        }
        return ""
    }

    /** Mirrors a JS `a ?? b ?? c` chain — falls through ONLY on null/absent, never on a real 0/false/"". */
    private fun firstPresent(json: JSONObject, vararg keys: String): Any? {
        for (k in keys) {
            val v = optRaw(json, k)
            if (v != null) return v
        }
        return null
    }

    /**
     * Mirrors JS's `parseFloat()`: a real number passes through as-is; a
     * string is parsed leniently from its leading numeric token (JS
     * parseFloat ignores trailing non-numeric characters, unlike
     * `Double.parseDouble`, which requires the WHOLE string to be
     * numeric); anything else, or an unparsable string, is NaN.
     */
    private fun parseFloatLike(value: Any?): Double = when (value) {
        null -> Double.NaN
        is Number -> value.toDouble()
        is String -> parseLeadingDouble(value)
        else -> Double.NaN
    }

    private val LEADING_NUMBER = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")

    private fun parseLeadingDouble(s: String): Double {
        val match = LEADING_NUMBER.find(s.trim()) ?: return Double.NaN
        return match.value.toDoubleOrNull() ?: Double.NaN
    }

    /**
     * @return null if `raw` has no usable `hex`/`icao` identifier or a
     *   non-numeric lat/lon — mirrors the JS original returning `null`
     *   for the same two cases.
     */
    fun normalise(raw: JSONObject): AircraftExtrapolation.Aircraft? {
        val hex = firstNonBlank(raw, "hex", "icao").uppercase()
        if (hex.isEmpty()) return null

        val callsign = firstNonBlank(raw, "flight", "callsign").ifEmpty { null }
        val type = firstNonBlank(raw, "t", "aircraft_type").ifEmpty { null }

        val lat = parseFloatLike(optRaw(raw, "lat"))
        val lon = parseFloatLike(optRaw(raw, "lon"))
        if (lat.isNaN() || lon.isNaN()) return null

        // alt_baro is a number in flight, but the literal string "ground"
        // while parked/taxiing (readsb/dump1090-family convention) —
        // captured explicitly rather than letting parseFloat("ground")
        // silently collapse it into "altitude unknown."
        val rawAltBaro = firstPresent(raw, "alt_baro", "altitude", "alt")
        val onGround = rawAltBaro is String && rawAltBaro.trim().equals("ground", ignoreCase = true)

        val altBaro = if (onGround) Double.NaN else parseFloatLike(rawAltBaro)
        val altGeom = parseFloatLike(firstPresent(raw, "alt_geom"))
        // Prefer GPS/GNSS-derived geometric altitude over barometric —
        // alt_baro assumes standard 1013.25hPa pressure and can be off by
        // 500ft+ without a QNH correction (not done here); alt_geom isn't
        // affected by pressure at all.
        val altitudeFt: Double? = if (!altGeom.isNaN()) altGeom else if (!altBaro.isNaN()) altBaro else null

        val trackDegRaw = parseFloatLike(firstPresent(raw, "track", "true_heading"))
        val trackDeg: Double? = if (trackDegRaw.isNaN()) null else trackDegRaw

        val groundSpeedKtRaw = parseFloatLike(firstPresent(raw, "gs", "speed"))
        val groundSpeedKt: Double? = if (groundSpeedKtRaw.isNaN()) null else groundSpeedKtRaw

        val verticalRateFpmRaw = parseFloatLike(firstPresent(raw, "baro_rate", "geom_rate", "vert_rate"))
        val verticalRateFpm: Double? = if (verticalRateFpmRaw.isNaN()) null else verticalRateFpmRaw

        // seen_pos / seen / last_seen — provider-specific naming variants
        // for "seconds since last position update." No explicit `?? 0`
        // fallback needed here (unlike the JS source's own redundant one)
        // — parseFloatLike(null) is already NaN, and the isNaN check just
        // below already converts that to 0, an exactly equivalent result.
        val seen = parseFloatLike(firstPresent(raw, "seen_pos", "seen", "last_seen"))
        val lastSeenSeconds = if (seen.isNaN()) 0.0 else seen

        val category = firstNonBlank(raw, "category").uppercase().ifEmpty { null }
        val registration = firstNonBlank(raw, "r", "registration").ifEmpty { null }
        val isGroundVehicleOrObstacle = category != null && NON_AIRCRAFT_CATEGORIES.contains(category)

        return AircraftExtrapolation.Aircraft(
            lat = lat,
            lon = lon,
            hex = hex,
            callsign = callsign,
            type = type,
            altitudeFt = altitudeFt,
            onGround = onGround,
            trackDeg = trackDeg,
            groundSpeedKt = groundSpeedKt,
            verticalRateFpm = verticalRateFpm,
            lastSeenSeconds = lastSeenSeconds,
            category = category,
            registration = registration,
            isGroundVehicleOrObstacle = isGroundVehicleOrObstacle
        )
    }
}
