package org.vectair.vcas.car.logic

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Route polyline geometry utilities — ported from the PWA's
 * src/routing/routeGeometry.js. Not originally on CLAUDE.md's
 * "cleanly portable" pure-logic list (that list named geo.js/
 * visibility.js/relevance.js/aircraftExtrapolation.js/indicators.js/
 * navigationCameraEvaluator.js specifically) — discovered as a genuine,
 * necessary dependency while porting navigationCameraEvaluator.js
 * itself, which calls `RouteGeometry.nearestOnLine()` directly. It's
 * pure logic with no DOM dependency, same as the rest of this list, so
 * it ported the same way.
 *
 * Route coordinates are represented the same way Geo.kt's own
 * `circleCoordinates`/`arcCoordinates` already represent them —
 * `List<DoubleArray>`, each element `[lon, lat]` (GeoJSON/ORS convention,
 * index 0 = longitude) — rather than a dedicated point type, matching
 * how the real route geometry flowing through the app (OpenRouteService
 * responses) arrives as literal arrays of `[lon, lat]` pairs.
 *
 * Only `nearestOnLine()` and `projectAlong()`/`distanceToIndex()`'s own
 * private helpers (`dist`, `nearestOnSegment`) are actually needed by
 * `NavigationCameraEvaluator.kt`, but the whole file is ported — the
 * three functions are a small, cohesive module in the JS original, and
 * CLAUDE.md documents `distanceToIndex()`/`nearestOnLine()` as already
 * used by other navigation logic (off-route detection, maneuver
 * tracking) likely to be ported later too.
 */
object RouteGeometry {

    private const val R = 6371000.0 // Earth radius in metres
    private const val DEG_TO_RAD = PI / 180.0

    private fun toRad(d: Double) = d * DEG_TO_RAD

    /** Great-circle Haversine distance in metres between two [lon, lat] points. */
    private fun dist(a: DoubleArray, b: DoubleArray): Double {
        val dLat = (b[1] - a[1]) * DEG_TO_RAD
        val dLon = (b[0] - a[0]) * DEG_TO_RAD
        val s = sin(dLat / 2)
        val o = sin(dLon / 2)
        val h = s * s + cos(a[1] * DEG_TO_RAD) * cos(b[1] * DEG_TO_RAD) * o * o
        return 2 * R * asin(min(1.0, sqrt(h)))
    }

    private data class SegProjection(val t: Double, val point: DoubleArray)

    /**
     * Nearest point on segment [a, b] to point p, scaled using cosine
     * latitude weights to resolve Mercator distortion.
     */
    private fun nearestOnSegment(p: DoubleArray, a: DoubleArray, b: DoubleArray): SegProjection {
        val cosLatFactor = cos(((a[1] + b[1]) / 2) * DEG_TO_RAD)

        val dx = (b[0] - a[0]) * cosLatFactor
        val dy = b[1] - a[1]

        val lenSq = dx * dx + dy * dy
        if (lenSq == 0.0) return SegProjection(0.0, doubleArrayOf(a[0], a[1]))

        val px = (p[0] - a[0]) * cosLatFactor
        val py = p[1] - a[1]

        var t = (px * dx + py * dy) / lenSq
        t = t.coerceIn(0.0, 1.0)

        return SegProjection(t, doubleArrayOf(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    }

    data class NearestOnLineResult(val segIdx: Int, val t: Double, val point: DoubleArray)

    /** Find nearest snapped trajectory node on a route coordinate array. */
    fun nearestOnLine(coords: List<DoubleArray>?, lon: Double, lat: Double): NearestOnLineResult {
        if (coords == null || coords.isEmpty()) {
            return NearestOnLineResult(0, 0.0, doubleArrayOf(lon, lat))
        }
        if (coords.size < 2) {
            return NearestOnLineResult(0, 0.0, doubleArrayOf(coords[0][0], coords[0][1]))
        }

        val p = doubleArrayOf(lon, lat)
        var bestDist = Double.POSITIVE_INFINITY
        var bestSeg = 0
        var bestT = 0.0
        var bestPt = doubleArrayOf(coords[0][0], coords[0][1])

        for (i in 0 until coords.size - 1) {
            val proj = nearestOnSegment(p, coords[i], coords[i + 1])
            val d = dist(p, proj.point)
            if (d < bestDist) {
                bestDist = d
                bestSeg = i
                bestT = proj.t
                bestPt = proj.point
            }
        }
        return NearestOnLineResult(bestSeg, bestT, bestPt)
    }

    data class ProjectAlongResult(val lon: Double, val lat: Double)

    /** Project forward along the route from a given snapped position by `meters`. */
    fun projectAlong(coords: List<DoubleArray>?, segIdx: Int, t: Double, meters: Double): ProjectAlongResult? {
        if (coords == null || coords.size < 2) return null
        if (meters <= 0) {
            val currentSegmentNode = coords[segIdx]
            return ProjectAlongResult(currentSegmentNode[0], currentSegmentNode[1])
        }

        val a = coords[segIdx]
        val b = coords[min(segIdx + 1, coords.size - 1)]

        val curLon = a[0] + t * (b[0] - a[0])
        val curLat = a[1] + t * (b[1] - a[1])

        val segRemain = dist(doubleArrayOf(curLon, curLat), b)

        if (meters <= segRemain) {
            // Avoid division-by-zero crashes on ultra-short coordinate vectors.
            val denominator = max(segRemain, 0.1)
            val frac = meters / denominator
            return ProjectAlongResult(curLon + frac * (b[0] - curLon), curLat + frac * (b[1] - curLat))
        }

        var remainingMeters = meters - segRemain
        var targetIndex = segIdx + 1

        while (targetIndex < coords.size - 1) {
            val p1 = coords[targetIndex]
            val p2 = coords[targetIndex + 1]
            val currentSegmentLength = dist(p1, p2)

            if (remainingMeters <= currentSegmentLength) {
                val denominator = max(currentSegmentLength, 0.1)
                val frac = remainingMeters / denominator
                return ProjectAlongResult(p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]))
            }

            remainingMeters -= currentSegmentLength
            targetIndex++
        }

        // Clamp to the destination vertex if the projection exceeds the route.
        val absoluteFinalNode = coords[coords.size - 1]
        return ProjectAlongResult(absoluteFinalNode[0], absoluteFinalNode[1])
    }

    /**
     * Distance (metres) from a snapped position (segIdx/t, as returned by
     * nearestOnLine) forward along the route to a given coordinate-array
     * index.
     */
    fun distanceToIndex(coords: List<DoubleArray>?, segIdx: Int, t: Double, targetIdx: Int): Double {
        if (coords == null || coords.size < 2 || targetIdx <= segIdx) return 0.0

        val a = coords[segIdx]
        val b = coords[min(segIdx + 1, coords.size - 1)]
        val startPt = doubleArrayOf(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

        var total = dist(startPt, b)
        var i = segIdx + 1
        while (i < targetIdx && i < coords.size - 1) {
            total += dist(coords[i], coords[i + 1])
            i++
        }
        return total
    }
}
