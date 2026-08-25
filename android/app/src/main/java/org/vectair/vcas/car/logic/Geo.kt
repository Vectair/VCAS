package org.vectair.vcas.car.logic

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Geodesic and polar-projection utilities — ported from the PWA's
 * src/logic/geo.js. This is one of the "cleanly portable, no DOM
 * dependency" files identified in CLAUDE.md's "Android Auto — native
 * rewrite scoping" note: pure math, no MapLibre/DOM/browser API calls,
 * so the port is close to line-for-line rather than a redesign.
 *
 * A Kotlin `object` (not a class) mirrors geo.js's own IIFE module
 * pattern — pure functions, no instance state, one shared namespace.
 * Greek-letter variable names from the JS source (φ/λ/Δ/δ/θ) are spelled
 * out in ASCII here (phi/lambda/delta/theta) rather than kept literal —
 * a real, documented gotcha this project already hit once in a web test
 * harness whose non-UTF-8 fetch silently corrupted those exact
 * characters (see CLAUDE.md's "Stage 3" verification notes) is worth
 * avoiding entirely in a second codebase, not just working around again.
 *
 * Every function's actual formula, parameter meaning, and doc-comment
 * reasoning is preserved from the original — only the language and
 * identifier spelling changed. See geo.js itself for the fuller
 * per-function design rationale (band-scale reasoning, the anchor-anchored
 * camera math, etc.) — not fully re-duplicated here to avoid the two
 * copies drifting apart in wording even though the code itself must stay
 * in sync by hand across both platforms.
 */
object Geo {
    private const val R_M = 6371000.0   // Earth radius in metres
    private const val R_NM = 3440.065   // Earth radius in nautical miles

    data class Point(val x: Int, val y: Int)
    data class LatLon(val lat: Double, val lon: Double)
    data class Rect(val left: Double, val top: Double, val width: Double, val height: Double)
    data class SquarePlotLayout(
        val orientation: String, // "portrait" or "landscape"
        val squareLeft: Double,
        val squareTop: Double,
        val squareSize: Double,
        val rows: Rect
    )

    private fun toRad(d: Double) = d * PI / 180.0
    private fun toDeg(r: Double) = r * 180.0 / PI

    /** Bearing from point A to point B (degrees true, 0-360). */
    fun calculateBearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = toRad(lat1)
        val phi2 = toRad(lat2)
        val deltaLambda = toRad(lon2 - lon1)
        val y = sin(deltaLambda) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(deltaLambda)
        return (toDeg(atan2(y, x)) + 360) % 360
    }

    /** Great-circle distance in metres. */
    fun calculateDistanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = toRad(lat1)
        val phi2 = toRad(lat2)
        val deltaPhi = toRad(lat2 - lat1)
        val deltaLambda = toRad(lon2 - lon1)
        val a = sin(deltaPhi / 2) * sin(deltaPhi / 2) +
            cos(phi1) * cos(phi2) * sin(deltaLambda / 2) * sin(deltaLambda / 2)
        return R_M * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /** Great-circle distance in nautical miles (aircraft airspeed correlation). */
    fun calculateDistanceNm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = toRad(lat1)
        val phi2 = toRad(lat2)
        val deltaPhi = toRad(lat2 - lat1)
        val deltaLambda = toRad(lon2 - lon1)
        val a = sin(deltaPhi / 2) * sin(deltaPhi / 2) +
            cos(phi1) * cos(phi2) * sin(deltaLambda / 2) * sin(deltaLambda / 2)
        return R_NM * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /**
     * Relative bearing: bearing to aircraft minus user's heading, normalised
     * to [-180, 180]. Positive = right of heading, negative = left.
     */
    fun calculateRelativeBearing(aircraftBearing: Double, userHeading: Double): Double {
        var rel = ((aircraftBearing - userHeading) % 360 + 360) % 360
        if (rel > 180) rel -= 360
        return rel
    }

    /**
     * Fraction (0-1) of the available radius a given range should plot at,
     * under a piecewise-banded (non-linear) distance scale — see geo.js's
     * own doc comment for the full "why" (close bands get equal visual room
     * to far bands so the plot stays legible for nearby traffic).
     */
    fun bandedRadiusFraction(rangeNm: Double, bandsNm: List<Double>): Double {
        val n = bandsNm.size
        if (n == 0) return 0.0
        val clamped = rangeNm.coerceIn(0.0, bandsNm[n - 1])
        for (i in 0 until n) {
            val bandStart = if (i == 0) 0.0 else bandsNm[i - 1]
            val bandEnd = bandsNm[i]
            if (clamped <= bandEnd) {
                val withinBandFrac =
                    if (bandEnd > bandStart) (clamped - bandStart) / (bandEnd - bandStart) else 0.0
                return (i + withinBandFrac) / n
            }
        }
        return 1.0
    }

    /**
     * The dead-ahead radius (px) available above the anchor before the safe
     * screen area runs out — see geo.js's own doc comment for why this is a
     * uniform circular scale rather than a per-bearing ellipse.
     */
    fun maxRadiusForBearing(
        relativeBearing: Double,
        viewportWidth: Double,
        viewportHeight: Double,
        anchorY: Double = 0.8,
        safeInset: Double = 60.0
    ): Double {
        val cx = viewportWidth * 0.5
        val cy = viewportHeight * anchorY

        val angleRad = toRad(relativeBearing)
        val sinA = sin(angleRad)
        val cosA = cos(angleRad)

        val edgeMarginPx = 20.0
        val topY = safeInset + 20
        val bottomY = min(viewportHeight - safeInset - 20, cy + 40)
        val leftX = edgeMarginPx
        val rightX = viewportWidth - edgeMarginPx

        val maxScaleX =
            if (sinA != 0.0) (if (sinA > 0) (rightX - cx) else (cx - leftX)) / abs(sinA)
            else Double.POSITIVE_INFINITY
        val maxScaleY =
            if (cosA != 0.0) (if (cosA > 0) (cy - topY) else (bottomY - cy)) / abs(cosA)
            else Double.POSITIVE_INFINITY
        return min(maxScaleX, maxScaleY)
    }

    /**
     * True polar plot of a relative bearing + range: angle = bearing, radius
     * = a banded (non-linear) function of distance. Returns null when
     * fovHalfAngleDeg is set and the bearing falls outside it — the caller
     * must not render those. See geo.js's own doc comment for the full
     * design rationale (anchor-anchored camera math, band-vs-edge scaling).
     */
    fun projectToPolarPosition(
        relativeBearing: Double,
        rangeNm: Double,
        viewportWidth: Double,
        viewportHeight: Double,
        bandsNm: List<Double>,
        anchorY: Double = 0.8,
        safeInset: Double = 60.0,
        fovHalfAngleDeg: Double? = null,
        offsetX: Double = 0.0,
        offsetY: Double = 0.0
    ): Point? {
        if (fovHalfAngleDeg != null && abs(relativeBearing) > fovHalfAngleDeg) return null

        val cx = viewportWidth * 0.5
        val cy = viewportHeight * anchorY

        val angleRad = toRad(relativeBearing)
        val sinA = sin(angleRad)
        val cosA = cos(angleRad)

        val radiusScale = if (fovHalfAngleDeg != null) {
            circularPlotRadius(viewportWidth, viewportHeight, anchorY, safeInset, fovHalfAngleDeg)
        } else {
            maxRadiusForBearing(relativeBearing, viewportWidth, viewportHeight, anchorY, safeInset)
        }
        val radiusPx = bandedRadiusFraction(rangeNm, bandsNm) * radiusScale

        val x = Math.round(offsetX + cx + sinA * radiusPx).toInt()
        val y = Math.round(offsetY + cy - cosA * radiusPx).toInt() // screen Y runs inverted

        return Point(x, y)
    }

    /**
     * Project a point forward from (lat, lon) by distanceMeters along a true
     * heading, using a flat-earth approximation (fine for the short
     * distances — tens to low hundreds of metres — this is used for).
     */
    fun projectPosition(lat: Double, lon: Double, headingDeg: Double, distanceMeters: Double): LatLon {
        val metersPerDegreeLat = 111111.0
        val metersPerDegreeLon = 111111.0 * cos(toRad(lat))
        val headingRad = toRad(headingDeg)
        return LatLon(
            lat = lat + (distanceMeters * cos(headingRad)) / metersPerDegreeLat,
            lon = lon + (distanceMeters * sin(headingRad)) /
                (if (metersPerDegreeLon != 0.0) metersPerDegreeLon else 1e-9)
        )
    }

    /**
     * Project a point from (lat, lon) by distanceMeters along a true
     * bearing, using the proper spherical-earth destination formula — see
     * geo.js's own comment on why this differs from projectPosition() (real
     * range-ring radii need the spherical formula, unlike the short flat-
     * earth use cases above).
     */
    fun destinationPoint(lat: Double, lon: Double, bearingDeg: Double, distanceMeters: Double): LatLon {
        val delta = distanceMeters / R_M
        val theta = toRad(bearingDeg)
        val phi1 = toRad(lat)
        val lambda1 = toRad(lon)

        val phi2 = asin(sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(theta))
        val lambda2 = lambda1 + atan2(
            sin(theta) * sin(delta) * cos(phi1),
            cos(delta) - sin(phi1) * sin(phi2)
        )

        return LatLon(toDeg(phi2), ((toDeg(lambda2) + 540) % 360) - 180)
    }

    /**
     * Closed ring of [lon, lat] pairs tracing a true circle of radiusMeters
     * around (lat, lon) — first and last points coincide.
     */
    fun circleCoordinates(lat: Double, lon: Double, radiusMeters: Double, numPoints: Int = 72): List<DoubleArray> {
        val coords = ArrayList<DoubleArray>(numPoints + 1)
        for (i in 0..numPoints) {
            val bearing = (360.0 * i) / numPoints
            val pt = destinationPoint(lat, lon, bearing, radiusMeters)
            coords.add(doubleArrayOf(pt.lon, pt.lat))
        }
        return coords
    }

    /**
     * Open arc of [lon, lat] pairs tracing part of a true circle of
     * radiusMeters around (lat, lon), from centerBearingDeg - halfAngleDeg
     * to centerBearingDeg + halfAngleDeg — NOT closed, unlike
     * circleCoordinates().
     */
    fun arcCoordinates(
        lat: Double,
        lon: Double,
        radiusMeters: Double,
        centerBearingDeg: Double,
        halfAngleDeg: Double,
        numPoints: Int = 48
    ): List<DoubleArray> {
        val coords = ArrayList<DoubleArray>(numPoints + 1)
        for (i in 0..numPoints) {
            val bearing = centerBearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / numPoints
            val pt = destinationPoint(lat, lon, bearing, radiusMeters)
            coords.add(doubleArrayOf(pt.lon, pt.lat))
        }
        return coords
    }

    /**
     * The single, bearing-independent plot radius (px) for a field-of-view-
     * restricted circular display (RAW mode) — see geo.js's own doc comment
     * for why a single fixed radius (not per-bearing maxRadiusForBearing)
     * is what makes a round-instrument-style display read correctly.
     */
    fun circularPlotRadius(
        viewportWidth: Double,
        viewportHeight: Double,
        anchorY: Double,
        safeInset: Double,
        fovHalfAngleDeg: Double
    ): Double {
        val deadAhead = maxRadiusForBearing(0.0, viewportWidth, viewportHeight, anchorY, safeInset)
        val edge = maxRadiusForBearing(fovHalfAngleDeg, viewportWidth, viewportHeight, anchorY, safeInset)
        return min(deadAhead, edge)
    }

    /**
     * RAW's plot region: a true 1:1 square, pinned to the top in portrait
     * (list rows below) or the left in landscape (list rows to the right).
     * See geo.js's own doc comment — this must stay the single shared
     * source for both the real camera anchor and the screen-space plot, or
     * the two silently drift apart the way an earlier bug already did once.
     */
    fun computeSquarePlotLayout(contentWidth: Double, contentTop: Double, contentHeight: Double): SquarePlotLayout {
        val portrait = contentWidth <= contentHeight
        val squareSize = max(0.0, if (portrait) contentWidth else contentHeight)
        val squareLeft = 0.0
        val squareTop = contentTop
        val rows = if (portrait) {
            Rect(
                left = 0.0,
                top = contentTop + squareSize,
                width = contentWidth,
                height = max(0.0, contentHeight - squareSize)
            )
        } else {
            Rect(
                left = squareSize,
                top = contentTop,
                width = max(0.0, contentWidth - squareSize),
                height = contentHeight
            )
        }
        return SquarePlotLayout(
            orientation = if (portrait) "portrait" else "landscape",
            squareLeft = squareLeft,
            squareTop = squareTop,
            squareSize = squareSize,
            rows = rows
        )
    }
}
