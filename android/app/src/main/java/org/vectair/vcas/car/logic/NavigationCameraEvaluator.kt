package org.vectair.vcas.car.logic

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * NavigationCameraEvaluator — pure data module that evaluates driving
 * context and returns baseline camera targets. Ported from the PWA's
 * src/navigation/navigationCameraEvaluator.js, the sixth and final file
 * in CLAUDE.md's "Android Auto — native rewrite scoping" pure-logic
 * list (after Geo.kt, Visibility.kt, Relevance.kt,
 * AircraftExtrapolation.kt, Indicators.kt) — already flagged there as
 * "a pure state machine with no MapLibre-JS-specific calls in it,
 * despite living in the 'navigation' folder alongside genuinely
 * web-specific code," confirmed correct by this port.
 *
 * **A `class`, not an `object` — the one deliberate structural
 * departure from every prior port.** Geo/Visibility/Relevance/
 * AircraftExtrapolation/Indicators are all genuinely stateless pure
 * functions, ported as Kotlin `object`s (one shared namespace, no
 * instance state) mirroring their JS IIFE-module pattern. This file is
 * different in the JS original too: it keeps real persistent state
 * across calls in its own module-level closure (`lastEvaluatedState`,
 * `stateDwellTimestamp`, `smoothedSpeedMph` — the hysteresis/dwell-lock/
 * speed-smoothing memory that makes the camera state machine actually
 * work frame to frame). A Kotlin `object` would still work for a single
 * real car-app session (one evaluator, one persistent instance, same as
 * the JS module persisting for a page's lifetime) — but a `class` is
 * more faithful to what this state actually IS (per-session camera
 * memory, not global app-wide truth) and lets each JUnit test start
 * from a clean `NavigationCameraEvaluator()` instance rather than
 * fighting cross-test state leakage through a shared singleton, the
 * same way a fresh page load gives the JS module a fresh closure.
 *
 * **One other deliberate, clearly-scoped adaptation for testability**:
 * `evaluate()` takes an explicit `currentTimeMs: Long` parameter
 * (defaulting to `System.currentTimeMillis()`, i.e. behaviourally
 * identical to the JS original's internal `Date.now()` call for any real
 * caller that doesn't pass one) instead of reading wall-clock time
 * internally and unconditionally. This is what makes the
 * `MIN_STATE_DWELL_MS` hysteresis lock actually testable with
 * deterministic synthetic timestamps rather than real `Thread.sleep()`
 * calls in a test suite — not a behaviour change for production
 * callers, purely a seam for injecting time in tests.
 *
 * **`_dist`/`_segBearing` are deliberately duplicated here, not reused
 * from `Geo.kt`/`RouteGeometry.kt`, mirroring the JS original's own
 * duplication** — `navigationCameraEvaluator.js` keeps its own local
 * `_dist`/`_toRad`/`_segBearing` rather than importing `geo.js`'s or
 * `routeGeometry.js`'s mathematically-equivalent haversine-distance/
 * true-bearing functions, even though the formulas are identical. This
 * port preserves that duplication rather than "DRYing it up" — translate
 * the structure that's actually there, not a redesigned version of it,
 * same discipline `Visibility.kt`'s own deliberately-preserved dead code
 * already established.
 *
 * Route coordinates use the same `List<DoubleArray>` (`[lon, lat]`)
 * convention `RouteGeometry.kt` and `Geo.kt` already use.
 *
 * Every formula, threshold, and doc-comment reasoning is preserved from
 * the original — see navigationCameraEvaluator.js itself for the fuller
 * per-constant design rationale (the NAV_RAW zoom/anchor derivation, the
 * viewport-bias presets, the square-anchor special case) — not
 * re-duplicated here to avoid the two copies drifting apart in wording
 * even though the numbers/logic must stay in sync by hand across both
 * platforms.
 */
class NavigationCameraEvaluator {

    data class CameraPreset(val pitch: Double, val zoom: Double, val anchorY: Double, val anchorX: Double)

    data class ViewportBias(
        val pitchBias: Double,
        val anchorYBias: Double,
        val anchorXOverride: Double?,
        val anchorYOverride: Double?,
        val maxPitch: Double?
    )

    /** Mirrors navigationCameraEvaluator.js's `ctx` param shape. */
    data class Ctx(
        val mode: String, // "nav" | "air"
        val routeActive: Boolean,
        // Flattened from JS's `ctx.routeGeometry.coordinates` — the only
        // field of routeGeometry this module ever reads.
        val routeCoordinates: List<DoubleArray>? = null,
        val userLat: Double,
        val userLon: Double,
        val userSpeedMph: Double? = null,
        val viewportPreset: String? = null, // "full" | "phone-p" | "phone-l" | "auto"
        val navDisplayStyle: String? = null, // "raw" or anything else
        // Real DOM-measured numbers, used only by NAV_RAW's square-anchor
        // branch (9b below) to align this state's anchor with RAW's own
        // screen-space square plot.
        val viewportWidth: Double? = null,
        val viewportHeight: Double? = null,
        val squareContentTop: Double? = null,
        val squareContentHeight: Double? = null
    )

    data class Maneuver(val exists: Boolean, val distanceMeters: Double, val bearingDeltaDeg: Double)

    data class EvaluationResult(
        val state: String,
        val pitch: Double,
        val zoom: Double,
        val anchorY: Double,
        val anchorX: Double,
        val suppressionLevel: Int,
        val transitionProfile: String,
        val bearingMode: String,
        val maneuver: Maneuver
    )

    private data class TurnMetrics(val exists: Boolean, val distance: Double, val bearingDeltaDeg: Double)

    companion object {
        // ---- State presets (baseline camera geometry per state) ----
        val STATE_PRESETS: Map<String, CameraPreset> = mapOf(
            "NAV_IDLE" to CameraPreset(pitch = 45.0, zoom = 17.0, anchorY = 0.75, anchorX = 0.5),
            "URBAN_GUIDANCE" to CameraPreset(pitch = 55.0, zoom = 16.2, anchorY = 0.80, anchorX = 0.5),
            "HIGHWAY_GUIDANCE" to CameraPreset(pitch = 60.0, zoom = 14.2, anchorY = 0.85, anchorX = 0.5),
            "TURN_APPROACH" to CameraPreset(pitch = 35.0, zoom = 16.8, anchorY = 0.70, anchorX = 0.5),
            "AIR" to CameraPreset(pitch = 0.0, zoom = 10.0, anchorY = 0.50, anchorX = 0.5),
            // Selectable NAV display style (NavDisplayStyle.RAW) — see
            // navigationCameraEvaluator.js's own doc comment for the full
            // zoom-11.2 derivation (Web Mercator ground resolution at the
            // relevance teardrop's ~15nm dead-ahead range).
            "NAV_RAW" to CameraPreset(pitch = 0.0, zoom = 11.2, anchorY = 0.80, anchorX = 0.5)
        )

        // ---- Operational Tuning Constants ----
        private const val HIGHWAY_SPEED_ENTER = 53.0 // Hysteresis upper gate limit
        private const val HIGHWAY_SPEED_EXIT = 46.0  // Hysteresis lower gate limit
        private const val MIN_STATE_DWELL_MS = 3500L // Blocks rapid back-to-back state oscillations
        private const val SPEED_SMOOTH_FACTOR = 0.08 // Low-pass filter smoothing weight

        // Time Horizon parameters for turn approaches
        private const val T_IMPACT_APPROACH_S = 18.0 // Start turn transition 18 seconds before arrival
        private const val TURN_THRESH_DEG = 25.0     // Angular trajectory deviation threshold

        // Viewport structural bias presets
        val VIEWPORT_BIASES: Map<String, ViewportBias> = mapOf(
            "full" to ViewportBias(pitchBias = 0.0, anchorYBias = 0.0, anchorXOverride = null, anchorYOverride = null, maxPitch = null),
            "phone-p" to ViewportBias(pitchBias = 0.0, anchorYBias = 0.0, anchorXOverride = null, anchorYOverride = null, maxPitch = null),
            "phone-l" to ViewportBias(pitchBias = -5.0, anchorYBias = -0.05, anchorXOverride = null, anchorYOverride = null, maxPitch = null),
            "auto" to ViewportBias(pitchBias = 0.0, anchorYBias = 0.0, anchorXOverride = 0.35, anchorYOverride = 0.75, maxPitch = 40.0)
        )

        private const val EARTH_RADIUS_M = 6371000.0
        private fun toRad(d: Double) = d * Math.PI / 180.0

        // See this class's own doc comment: deliberately duplicated, not
        // reused from Geo.kt/RouteGeometry.kt, mirroring the JS original.
        private fun dist(a: DoubleArray, b: DoubleArray): Double {
            val dLat = toRad(b[1] - a[1])
            val dLon = toRad(b[0] - a[0])
            val s = Math.sin(dLat / 2)
            val o = Math.sin(dLon / 2)
            val h = s * s + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * o * o
            return 2 * EARTH_RADIUS_M * Math.asin(min(1.0, Math.sqrt(h)))
        }

        private fun segBearing(a: DoubleArray, b: DoubleArray): Double {
            val dLon = toRad(b[0] - a[0])
            val lat1 = toRad(a[1])
            val lat2 = toRad(b[1])
            val y = Math.sin(dLon) * Math.cos(lat2)
            val x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
            return (Math.atan2(y, x) * 180.0 / Math.PI + 360) % 360
        }
    }

    // ---- PERSISTENT CACHE CORE (Maintains memory state across frames) ----
    private var lastEvaluatedState: String = "NAV_IDLE"
    private var stateDwellTimestamp: Long = 0L
    private var smoothedSpeedMph: Double = 0.0

    /** Evaluates Time-To-Impact trajectory profiles against upcoming path arrays. */
    private fun calculateTimeIndependentManeuver(
        coords: List<DoubleArray>?,
        userLon: Double,
        userLat: Double,
        currentSpeedMs: Double
    ): TurnMetrics {
        if (coords == null || coords.size < 2 || currentSpeedMs < 2.0) {
            return TurnMetrics(exists = false, distance = 0.0, bearingDeltaDeg = 0.0)
        }

        val nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat)
        val segIdx = nearest.segIdx
        val t = nearest.t

        val a = coords[segIdx]
        val b = coords[min(segIdx + 1, coords.size - 1)]

        val startPt = doubleArrayOf(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

        val dynamicScanLimitMeters = max(300.0, currentSpeedMs * T_IMPACT_APPROACH_S)

        var totalDistanceAccumulator = 0.0
        var prevBearing: Double? = null

        var i = segIdx
        while (i < coords.size - 1 && totalDistanceAccumulator < dynamicScanLimitMeters) {
            val from = if (i == segIdx) startPt else coords[i]
            val to = coords[i + 1]
            val curBearing = segBearing(from, to)

            if (prevBearing != null) {
                var deltaAngle = abs(curBearing - prevBearing)
                if (deltaAngle > 180) deltaAngle = 360 - deltaAngle

                if (deltaAngle >= TURN_THRESH_DEG) {
                    // Signed turn angle: positive = clockwise = right, negative = left.
                    val signedDelta = ((curBearing - prevBearing + 180) % 360 + 360) % 360 - 180
                    return TurnMetrics(exists = true, distance = totalDistanceAccumulator, bearingDeltaDeg = signedDelta)
                }
            }
            prevBearing = curBearing
            totalDistanceAccumulator += dist(from, to)
            i++
        }
        return TurnMetrics(exists = false, distance = 0.0, bearingDeltaDeg = 0.0)
    }

    /**
     * @param currentTimeMs Defaults to real wall-clock time — see this
     *   class's own doc comment on why this is an explicit parameter
     *   rather than an internal `Date.now()`-equivalent call.
     */
    fun evaluate(ctx: Ctx, currentTimeMs: Long = System.currentTimeMillis()): EvaluationResult {
        val rawSpeedMph = ctx.userSpeedMph ?: 0.0

        // 1. Filter layout input speed transitions via low-pass constants
        smoothedSpeedMph += (rawSpeedMph - smoothedSpeedMph) * SPEED_SMOOTH_FACTOR
        val speedMs = smoothedSpeedMph * 0.44704
        val coords = ctx.routeCoordinates

        // 2. Compute Impending Maneuver Horizon State metrics
        val turnMetrics = calculateTimeIndependentManeuver(coords, ctx.userLon, ctx.userLat, speedMs)

        // 3. Determine target runtime configurations
        var targetState = if (ctx.mode == "air") {
            "AIR"
        } else if (ctx.navDisplayStyle == "raw") {
            // A deliberate, explicit user preference — not a speed-driven
            // automatic state — so it bypasses the urban/highway/turn
            // state machine entirely, including the maneuver-driven
            // TURN_APPROACH framing. Guidance data (maneuver, below)
            // still computes normally; only the camera framing itself
            // goes flat/rudimentary.
            "NAV_RAW"
        } else if (!ctx.routeActive) {
            "NAV_IDLE"
        } else if (turnMetrics.exists) {
            "TURN_APPROACH"
        } else {
            // Enforce dual-boundary speed gates to block rapid frame fluctuations
            if (lastEvaluatedState == "HIGHWAY_GUIDANCE") {
                if (smoothedSpeedMph > HIGHWAY_SPEED_EXIT) "HIGHWAY_GUIDANCE" else "URBAN_GUIDANCE"
            } else {
                if (smoothedSpeedMph > HIGHWAY_SPEED_ENTER) "HIGHWAY_GUIDANCE" else "URBAN_GUIDANCE"
            }
        }

        // 4. Enforce State Dwell Lock timers — except into/out of NAV_RAW,
        // which (like AIR) is a direct user choice that should apply on
        // the very next frame, not smoothed behind the same hysteresis
        // meant for noisy automatic speed-based transitions.
        if (targetState != lastEvaluatedState) {
            if (targetState == "NAV_RAW" || lastEvaluatedState == "NAV_RAW" ||
                (currentTimeMs - stateDwellTimestamp) > MIN_STATE_DWELL_MS
            ) {
                lastEvaluatedState = targetState
                stateDwellTimestamp = currentTimeMs
            } else {
                targetState = lastEvaluatedState // Clamp execution state to cache memory
            }
        }

        // 7. Base Camera Param Extraction
        val basePreset = STATE_PRESETS[targetState] ?: STATE_PRESETS.getValue("URBAN_GUIDANCE")
        var pitch = basePreset.pitch
        var zoom = basePreset.zoom
        var anchorY = basePreset.anchorY
        var anchorX = basePreset.anchorX

        // 8. Apply Velocity-Proportional Scale Delta Scaling
        if (targetState == "URBAN_GUIDANCE" || targetState == "HIGHWAY_GUIDANCE") {
            val dynamicSpeedZoomDelta = (smoothedSpeedMph / 85.0) * 1.8
            zoom -= dynamicSpeedZoomDelta
        }

        // 9. Viewport Aspect Custom Adjustments
        val vp = ctx.viewportPreset ?: "full"
        val bias = VIEWPORT_BIASES[vp] ?: VIEWPORT_BIASES.getValue("full")

        pitch += bias.pitchBias
        anchorY = bias.anchorYOverride ?: (anchorY + bias.anchorYBias)
        anchorX = bias.anchorXOverride ?: anchorX

        // 9b. NAV_RAW's anchor is a special case, computed AFTER
        // (superseding) the viewport-bias blending above rather than
        // through it — see this class's own doc comment reference to
        // navigationCameraEvaluator.js for the full "why" (RAW's
        // screen-space square plot vs the real map camera anchor having
        // to land at the same point, or the user marker visibly drifts
        // from the dots/rings around it).
        if (targetState == "NAV_RAW" &&
            ctx.viewportWidth != null && ctx.viewportWidth != 0.0 &&
            ctx.viewportHeight != null && ctx.viewportHeight != 0.0 &&
            ctx.squareContentHeight != null
        ) {
            val square = Geo.computeSquarePlotLayout(ctx.viewportWidth, ctx.squareContentTop ?: 0.0, ctx.squareContentHeight)
            val withinSquareAnchorY = STATE_PRESETS.getValue("NAV_RAW").anchorY
            val anchorXPx = square.squareLeft + square.squareSize * 0.5
            val anchorYPx = square.squareTop + square.squareSize * withinSquareAnchorY
            anchorX = anchorXPx / ctx.viewportWidth
            anchorY = anchorYPx / ctx.viewportHeight
        }

        if (bias.maxPitch != null) {
            pitch = min(pitch, bias.maxPitch)
        }
        pitch = max(0.0, min(85.0, pitch))

        // 10. Assign contextual transition easing parameters
        var transitionProfile = "STANDARD_FOLLOW"
        if (targetState == "TURN_APPROACH") transitionProfile = "TURN_APPROACH_CHOREOGRAPHY"
        if (targetState == "HIGHWAY_GUIDANCE") transitionProfile = "HIGHWAY_SMOOTH_PERSPECTIVE"

        // 11. Determine Contextual Cartography Suppression Engine Level
        var suppressionLevel = 1
        if (targetState == "HIGHWAY_GUIDANCE") suppressionLevel = 3
        if (targetState == "TURN_APPROACH") suppressionLevel = 2

        return EvaluationResult(
            state = targetState,
            pitch = pitch,
            zoom = zoom,
            anchorY = anchorY,
            anchorX = anchorX,
            suppressionLevel = suppressionLevel,
            transitionProfile = transitionProfile,
            bearingMode = if (targetState == "TURN_APPROACH") "DECOUPLED_MANEUVER" else "VEHICLE_TRACKING",
            // Real-time, independent of the state-dwell lock above —
            // guidance text should reflect the actual route ahead
            // immediately, even while the camera itself is still
            // smoothing into TURN_APPROACH.
            maneuver = Maneuver(
                exists = turnMetrics.exists,
                distanceMeters = turnMetrics.distance,
                bearingDeltaDeg = turnMetrics.bearingDeltaDeg
            )
        )
    }
}
