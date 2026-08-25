package org.vectair.vcas.car.logic

import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Deterministic visibility estimator — ported from the PWA's
 * src/logic/visibility.js, the second file in CLAUDE.md's "Android Auto —
 * native rewrite scoping" pure-logic list (after Geo.kt). Assumptions for
 * V1, same as the JS original: flat terrain, no buildings, no cloud/haze/
 * rain beyond what METAR supplies, daylight, user at ground level.
 *
 * Every formula, threshold, and doc-comment reasoning is preserved as-is
 * from visibility.js — including two deliberately-kept quirks that read
 * oddly in isolation but are faithful to the original's actual behaviour,
 * not transcription slips:
 *  - `_sizeForType` never actually returns 0/falsy, so the `||`-chained
 *    category-label fallback in the JS `estimate()` is dead code in
 *    practice (see `_sizeForType`'s own comment) — kept dead here too,
 *    rather than "cleaned up" into something that no longer matches the
 *    JS source line-for-line.
 *  - The 40nm cap and the 50nm contrail cap are DIFFERENT, deliberately
 *    non-unified numbers (see CLAUDE.md's "Contrail visibility" section)
 *    — not a bug to reconcile.
 *
 * See visibility.js itself for the fuller per-constant design rationale
 * (angular-size reference points, TCAS symbology mapping, colour
 * provenance) — not re-duplicated here to avoid the two copies drifting
 * apart in wording even though the numbers/logic must stay in sync by
 * hand across both platforms.
 */
object Visibility {

    data class Category(
        val label: String,
        val minAngle: Double,
        val shape: String,
        val fillOpacity: Double,
        val color: String,
        val colorDay: String,
        val colorRaw: String,
        val colorblindSafe: String,
        val colorblindSafeDay: String,
        val score: Int
    )

    data class CloudLayer(val cover: String, val baseFt: Double?)

    data class Metar(val clouds: List<CloudLayer>? = null, val visibilitySm: Double? = null)

    /** Mirrors visibility.js's `aircraft` param shape passed into estimate(). */
    data class AircraftInput(
        val lat: Double,
        val lon: Double,
        val altitudeFt: Double? = null,
        val type: String? = null,
        val category: String? = null,
        val lastSeenSeconds: Double? = null
    )

    data class EstimateResult(
        val label: String,
        val color: String,
        val colorDay: String,
        val colorRaw: String,
        val colorblindSafe: String,
        val colorblindSafeDay: String,
        val shape: String,
        val fillOpacity: Double,
        val score: Int,
        val angularSizeDeg: Double,
        val elevationDeg: Double,
        val slantRangeNm: Double,
        val isOverhead: Boolean
    )

    // Wingspan/span lookup in metres (approximate).
    private val AIRCRAFT_SIZE_METRES: Map<String, Int> = mapOf(
        "A388" to 80, "A389" to 80,
        "B748" to 76, "B744" to 68, "B743" to 68,
        "A359" to 67, "A35K" to 67,
        "B772" to 64, "B773" to 64, "B77L" to 64, "B77W" to 64,
        "A333" to 60, "A332" to 60, "A339" to 60,
        "B763" to 53, "B762" to 53,
        "A321" to 36, "A320" to 36, "A319" to 36, "A318" to 36,
        "B738" to 36, "B737" to 36, "B739" to 36,
        "B752" to 38, "B753" to 38,
        "E195" to 31, "E190" to 29, "E75L" to 26, "E75S" to 26, "E170" to 26,
        "CRJ9" to 24, "CRJ7" to 21, "CRJ2" to 21,
        "AT75" to 27, "AT72" to 27, "AT45" to 25,
        "DH8D" to 28, "DH8C" to 27, "DH8B" to 26,
        "C172" to 11, "C182" to 11, "C208" to 15, "C25B" to 17, "C25A" to 16,
        "P28A" to 11, "PA28" to 11,
        "PC12" to 16,
        "SF50" to 12,
        "EC45" to 11, "EC35" to 10, "H145" to 11, "H135" to 10, "H125" to 10,
        "AS50" to 10, "R44" to 9, "R22" to 7,
        "B06" to 9, "B407" to 10, "B412" to 14,
        "GLF6" to 29, "GLF5" to 29, "F900" to 19, "F7X" to 19, "C56X" to 15, "C68A" to 18,
        "B58" to 11
    )

    private object FallbackSizes {
        const val HEAVY_JET = 60
        const val MEDIUM_JET = 35
        const val LIGHT_JET = 17
        const val LIGHT_AIRCRAFT = 12
        const val HELICOPTER = 11
        const val UNKNOWN = 25
    }

    // Shape + colour follow TCAS's own symbology (hollow diamond -> filled
    // diamond -> amber/yellow circle -> red square), reinterpreted for
    // VCAS's rules of outright *sightability* rather than TCAS's rules of
    // collision risk. See visibility.js's own doc comment for the full
    // provenance of every minAngle/color value (Moon/Sun angular size,
    // 20/20 Snellen acuity multiples, pixel-sampled ND reference photo,
    // Okabe-Ito colourblind-safe hues) — preserved verbatim here, not
    // re-derived.
    private val CATEGORIES: List<Category> = listOf(
        Category("Certainly visible", 0.5, "square", 1.0, "#e53935", "#a3221d", "#fb000a", "#cc79a7", "#7e4b67", 100),
        Category("Likely visible", 0.167, "circle", 1.0, "#ffd400", "#8a6d00", "#ff9b14", "#f0e442", "#948d28", 66),
        Category("Possibly visible", 0.05, "diamond", 1.0, "#2dd4bf", "#0e6a7d", "#ffffff", "#0072b2", "#00466e", 33),
        Category("Very unlikely/not visible", 0.0, "diamond", 0.0, "#2dd4bf", "#0e6a7d", "#ffffff", "#0072b2", "#00466e", 10)
    )

    private const val NM_TO_M = 1852.0
    private const val NM_PER_SM = 0.868976

    // See visibility.js's own comment: neither figure is derived from a
    // formal model — both are the project owner's own field experience.
    // CONTRAIL_MAX_RANGE_NM (50nm) is an *identification* range, distinct
    // from and NOT unified with the plain 40nm cap below.
    private const val CONTRAIL_MIN_ALTITUDE_FT = 26000.0
    private const val CONTRAIL_MAX_RANGE_NM = 50.0

    private fun sizeForType(typeCode: String?): Int {
        if (typeCode.isNullOrEmpty()) return FallbackSizes.UNKNOWN
        val key = typeCode.uppercase().trim()
        // Never actually returns 0 — see this object's own doc comment on
        // why the category-label fallback below is dead code in the JS
        // original too, kept faithfully rather than simplified away.
        return AIRCRAFT_SIZE_METRES[key] ?: FallbackSizes.UNKNOWN
    }

    private fun categoryFallbackFromLabel(category: String?): Int {
        if (category.isNullOrEmpty()) return FallbackSizes.UNKNOWN
        val c = category.uppercase()
        return when {
            c.contains("HEAVY") -> FallbackSizes.HEAVY_JET
            c.contains("LARGE") -> FallbackSizes.MEDIUM_JET
            c.contains("SMALL") -> FallbackSizes.LIGHT_AIRCRAFT
            c.contains("HELIC") || c.contains("ROTOR") -> FallbackSizes.HELICOPTER
            else -> FallbackSizes.UNKNOWN
        }
    }

    /**
     * The lowest cloud layer that could actually occlude an aircraft at
     * `altitudeFt` — only layers whose base sits below it. Only the
     * LOWEST such layer matters — see visibility.js's own comment.
     */
    private fun lowestOccludingLayer(clouds: List<CloudLayer>?, altitudeFt: Double?): CloudLayer? {
        if (clouds == null || altitudeFt == null) return null
        var lowest: CloudLayer? = null
        for (layer in clouds) {
            if (layer.baseFt == null || layer.baseFt >= altitudeFt) continue
            if (lowest == null || layer.baseFt < lowest.baseFt!!) lowest = layer
        }
        return lowest
    }

    /**
     * Caps a category at "Possibly visible" — used for both partial cloud
     * occlusion (BKN) and reduced reported ground visibility, neither of
     * which should ever make an already-worse tier read as better.
     */
    private fun capAtPossiblyVisible(cat: Category): Category {
        val possiblyIdx = CATEGORIES.indexOfFirst { it.label == "Possibly visible" }
        val curIdx = CATEGORIES.indexOf(cat)
        return CATEGORIES[max(curIdx, possiblyIdx)]
    }

    /**
     * Adjusts a base angular-size category using current METAR conditions.
     * No-ops entirely (returns `cat` unchanged) when `metar` is null, so
     * this is fully opt-in from the caller's side — see visibility.js's
     * own doc comment for the full two-mechanism rationale.
     */
    private fun applyMetarAdjustment(cat: Category, altitudeFt: Double?, slantNm: Double, metar: Metar?): Category {
        if (metar == null) return cat
        var result = cat

        val occluding = lowestOccludingLayer(metar.clouds, altitudeFt)
        if (occluding != null) {
            if (occluding.cover == "OVC" || occluding.cover == "VV") {
                return CATEGORIES[CATEGORIES.size - 1] // "Very unlikely/not visible"
            }
            if (occluding.cover == "BKN") {
                result = capAtPossiblyVisible(result)
            }
        }

        if (metar.visibilitySm != null && metar.visibilitySm < 10) {
            val visNm = metar.visibilitySm * NM_PER_SM
            if (slantNm > visNm) {
                result = capAtPossiblyVisible(result)
            }
        }

        return result
    }

    /**
     * Estimate visual detectability of an aircraft. `metar` is optional —
     * omit/null for no adjustment (matches all prior behaviour exactly).
     */
    fun estimate(userLat: Double, userLon: Double, aircraft: AircraftInput, metar: Metar? = null): EstimateResult {
        val (lat, lon, altitudeFt, type, category, lastSeenSeconds) = aircraft

        val horizNm = Geo.calculateDistanceNm(userLat, userLon, lat, lon)
        val altM = (altitudeFt ?: 0.0) * 0.3048
        val horizM = horizNm * NM_TO_M

        val slantM = sqrt(horizM * horizM + altM * altM)
        val slantNm = slantM / NM_TO_M

        val elevationDeg = if (altM > 0 && horizM > 0) {
            atan2(altM, horizM) * (180.0 / Math.PI)
        } else 0.0

        val isOverhead = elevationDeg > 70

        val sizeFromType = sizeForType(type)
        val sizem = if (sizeFromType != 0) sizeFromType
            else {
                val fromCategory = categoryFallbackFromLabel(category)
                if (fromCategory != 0) fromCategory else FallbackSizes.UNKNOWN
            }
        val angularSizeDeg = if (slantM > 0) (57.3 * sizem / slantM) else 0.0

        // Very close and low aircraft.
        val veryClose = horizNm < 1 && altitudeFt != null && altitudeFt < 500

        var cat: Category

        if (veryClose) {
            cat = CATEGORIES[0] // Certainly visible
        } else if (altitudeFt != null && altitudeFt >= CONTRAIL_MIN_ALTITUDE_FT && slantNm <= CONTRAIL_MAX_RANGE_NM) {
            // High and close enough to plausibly be identifiable by
            // contrail — never worse than "Possibly visible" even when
            // angular size alone would rate it lower, but never overrides
            // a BETTER angular-size result either.
            val angularCat = CATEGORIES.firstOrNull { angularSizeDeg >= it.minAngle } ?: CATEGORIES[CATEGORIES.size - 1]
            val possiblyIdx = CATEGORIES.indexOfFirst { it.label == "Possibly visible" }
            cat = CATEGORIES[min(CATEGORIES.indexOf(angularCat), possiblyIdx)]
        } else if (slantNm > 40) {
            // Beyond 40 NM: cap at Possibly visible regardless of angular
            // size — haze/curvature at that range isn't modelled. The
            // contrail branch above is checked first and can reach 50nm;
            // this is the fallback for anything too low to plausibly
            // contrail but still this far out.
            cat = CATEGORIES.firstOrNull { it.label == "Possibly visible" } ?: CATEGORIES[2]
        } else {
            cat = CATEGORIES.firstOrNull { angularSizeDeg >= it.minAngle } ?: CATEGORIES[CATEGORIES.size - 1]
        }

        // Stale data degrades the category by exactly one tier.
        if (lastSeenSeconds != null && lastSeenSeconds > 20 && cat.score > 10) {
            val idx = CATEGORIES.indexOf(cat)
            cat = CATEGORIES[min(idx + 1, CATEGORIES.size - 1)]
        }

        cat = applyMetarAdjustment(cat, altitudeFt, slantNm, metar)

        return EstimateResult(
            label = cat.label,
            color = cat.color,
            colorDay = cat.colorDay,
            colorRaw = cat.colorRaw,
            colorblindSafe = cat.colorblindSafe,
            colorblindSafeDay = cat.colorblindSafeDay,
            shape = cat.shape,
            fillOpacity = cat.fillOpacity,
            score = cat.score,
            angularSizeDeg = angularSizeDeg,
            elevationDeg = elevationDeg,
            slantRangeNm = slantNm,
            isOverhead = isOverhead
        )
    }

    /**
     * Read-only access to the 4 sightability tiers, for display purposes
     * (e.g. an onboarding legend) rather than scoring — a shallow copy per
     * call so a caller can't mutate the real CATEGORIES table.
     */
    fun getCategories(): List<Category> = CATEGORIES.map { it.copy() }
}
