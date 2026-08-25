package org.vectair.vcas.car.logic

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow

/**
 * Relevance — decides which aircraft are worth showing in the driving view,
 * independent of how visible they'd be once you look. Ported from the
 * PWA's src/logic/relevance.js, the third file in CLAUDE.md's "Android
 * Auto — native rewrite scoping" pure-logic list (after Geo.kt and
 * Visibility.kt).
 *
 * Modelled on how TCAS's own coverage is illustrated: not a symmetric arc,
 * but a teardrop — long and wide ahead, pinched at the sides, with a small
 * residual allowance directly behind. An aircraft is relevant if:
 *
 *   1. It's nearly overhead (elevation > ~70 deg) — a plan-view
 *      "ahead/behind" test doesn't mean anything for something almost
 *      straight up.
 *   2. It's currently within the teardrop boundary for its bearing.
 *   3. It isn't yet, but projecting both the user's and the aircraft's
 *      motion forward a few seconds puts it inside the teardrop — i.e.
 *      it's converging into view even though it isn't visible *this
 *      instant*.
 *
 * Rule 3 only ever adds candidates — something relevant right now via 1
 * or 2 is never excluded because it's about to leave the teardrop a
 * moment later.
 *
 * Only `evaluate()` and `DEFAULTS` are public, mirroring relevance.js's
 * own `{ evaluate, DEFAULTS }` export — every internal helper
 * (`effectiveRMaxNm`/`teardropRangeNm`/`inTeardrop`/`predictedEntrySeconds`)
 * stays private, tested indirectly through `evaluate()` only, same
 * convention Visibility.kt already established for its own private
 * helpers.
 *
 * Every formula, threshold, and doc-comment reasoning is preserved from
 * the original — see relevance.js itself for the fuller per-constant
 * design rationale (why a teardrop, the contrail-range-extension
 * provenance shared with Visibility's own contrail floor) — not
 * re-duplicated here to avoid the two copies drifting apart in wording
 * even though the numbers/logic must stay in sync by hand across both
 * platforms.
 */
object Relevance {

    data class Options(
        val rMaxNm: Double = 15.0,              // teardrop range dead ahead (relative bearing 0 deg)
        val rMinNm: Double = 3.0,               // teardrop range dead behind (relative bearing 180 deg) — never zero
        val pinchExponent: Double = 2.0,        // higher = narrower sides
        val overheadElevationDeg: Double = 70.0, // matches Visibility's own isOverhead threshold
        val lookaheadSeconds: Double = 15.0,
        val lookaheadSamples: Int = 3,
        val stationarySpeedMph: Double = 5.0,   // below this, the user's own motion isn't projected forward
        // See relevance.js's own doc comment for the full provenance —
        // both numbers are the project owner's own field experience, not
        // physically derived, and must match Visibility's
        // CONTRAIL_MIN_ALTITUDE_FT / CONTRAIL_MAX_RANGE_NM exactly.
        val contrailMinAltitudeFt: Double = 26000.0,
        val rangeExtensionCapNm: Double = 50.0
    )

    /** Mirrors relevance.js's `{lat,lon,heading,speedMph}` userState shape. */
    data class UserState(val lat: Double, val lon: Double, val heading: Double, val speedMph: Double? = null)

    /** Mirrors the subset of a normalised aircraft object relevance.js reads. */
    data class AircraftState(
        val lat: Double,
        val lon: Double,
        val altitudeFt: Double? = null,
        val trackDeg: Double? = null,
        val groundSpeedKt: Double? = null
    )

    /**
     * The subset of Visibility.estimate()'s result relevance.js's `vis`
     * param actually reads — kept as its own small type here rather than
     * importing Visibility.EstimateResult, matching how relevance.js
     * itself has no dependency on visibility.js at all (the caller
     * precomputes and passes this in).
     */
    data class VisInput(val slantRangeNm: Double, val elevationDeg: Double)

    data class EvaluationResult(val relevant: Boolean, val reason: String?, val enterInSeconds: Double?)

    val DEFAULTS = Options()

    private const val KT_TO_MPS = 0.514444
    private const val MPH_TO_MPS = 0.44704

    private fun toRad(d: Double) = d * PI / 180.0

    /**
     * Dead-ahead teardrop range (rMaxNm), extended for high-altitude
     * aircraft. Mirrors Visibility's own contrail-floor condition exactly
     * — same altitude threshold, same range cap.
     */
    private fun effectiveRMaxNm(altitudeFt: Double?, opts: Options): Double {
        if (altitudeFt != null && altitudeFt >= opts.contrailMinAltitudeFt) {
            return max(opts.rMaxNm, opts.rangeExtensionCapNm)
        }
        return opts.rMaxNm
    }

    /**
     * Maximum relevant slant range for a given relative bearing — the
     * teardrop boundary itself. 0 deg = dead ahead (rMaxNm), 180 deg =
     * dead behind (rMinNm).
     */
    private fun teardropRangeNm(relativeBearingDeg: Double, opts: Options): Double {
        val rad = toRad(relativeBearingDeg)
        val c = cos(rad) // 1 at 0 deg, -1 at 180 deg
        val f = ((1 + c) / 2).pow(opts.pinchExponent)
        return opts.rMinNm + (opts.rMaxNm - opts.rMinNm) * f
    }

    private fun inTeardrop(relativeBearingDeg: Double, slantRangeNm: Double, opts: Options): Boolean =
        slantRangeNm <= teardropRangeNm(relativeBearingDeg, opts)

    /**
     * Sample the user's and aircraft's projected positions forward across
     * the lookahead window; return seconds-until-entry if any sample
     * point falls inside the teardrop, else null.
     *
     * Uses projected horizontal range (not slant range) — altitude is
     * assumed roughly constant over the short window.
     */
    private fun predictedEntrySeconds(userState: UserState, aircraft: AircraftState, opts: Options): Double? {
        if (aircraft.trackDeg == null || aircraft.groundSpeedKt == null) return null

        val acSpeedMps = aircraft.groundSpeedKt * KT_TO_MPS
        val userSpeedMps = (userState.speedMph ?: 0.0) * MPH_TO_MPS
        val userIsMoving = (userState.speedMph ?: 0.0) >= opts.stationarySpeedMph

        val stepSeconds = opts.lookaheadSeconds / opts.lookaheadSamples

        for (i in 1..opts.lookaheadSamples) {
            val t = stepSeconds * i

            val acPos = Geo.projectPosition(aircraft.lat, aircraft.lon, aircraft.trackDeg, acSpeedMps * t)
            val userPos = if (userIsMoving) {
                Geo.projectPosition(userState.lat, userState.lon, userState.heading, userSpeedMps * t)
            } else {
                Geo.LatLon(userState.lat, userState.lon)
            }

            val bearing = Geo.calculateBearing(userPos.lat, userPos.lon, acPos.lat, acPos.lon)
            val relativeBearing = Geo.calculateRelativeBearing(bearing, userState.heading)
            val rangeNm = Geo.calculateDistanceNm(userPos.lat, userPos.lon, acPos.lat, acPos.lon)

            if (inTeardrop(relativeBearing, rangeNm, opts)) return t
        }
        return null
    }

    /**
     * @param relativeBearing Precomputed by the caller (avoids recomputation).
     * @param vis Precomputed Visibility.estimate()-equivalent result (needs slantRangeNm/elevationDeg).
     * @param options Overrides for any Options field — defaults to DEFAULTS.
     */
    fun evaluate(
        userState: UserState,
        aircraft: AircraftState,
        relativeBearing: Double,
        vis: VisInput,
        options: Options = DEFAULTS
    ): EvaluationResult {
        // See effectiveRMaxNm's doc comment — extends the teardrop's
        // dead-ahead range for high-altitude aircraft, which are visible
        // from much farther out than the fixed rMaxNm floor assumes.
        val effectiveOpts = options.copy(rMaxNm = effectiveRMaxNm(aircraft.altitudeFt, options))

        if (vis.elevationDeg > effectiveOpts.overheadElevationDeg) {
            return EvaluationResult(relevant = true, reason = "overhead", enterInSeconds = 0.0)
        }

        if (inTeardrop(relativeBearing, vis.slantRangeNm, effectiveOpts)) {
            return EvaluationResult(relevant = true, reason = "in-view", enterInSeconds = 0.0)
        }

        val enterInSeconds = predictedEntrySeconds(userState, aircraft, effectiveOpts)
        if (enterInSeconds != null) {
            return EvaluationResult(relevant = true, reason = "predicted-entry", enterInSeconds = enterInSeconds)
        }

        return EvaluationResult(relevant = false, reason = null, enterInSeconds = null)
    }
}
