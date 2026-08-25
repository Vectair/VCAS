package org.vectair.vcas.car.logic

/**
 * Builds sorted, filtered indicator data for the Driving View. Ported
 * from the PWA's src/logic/indicators.js, the fifth file in CLAUDE.md's
 * "Android Auto — native rewrite scoping" pure-logic list (after
 * Geo.kt, Visibility.kt, Relevance.kt, AircraftExtrapolation.kt) — the
 * orchestration layer that ties all four of the prior ports together.
 *
 * `Aircraft` here is `AircraftExtrapolation.Aircraft` — the same
 * full-fidelity normalised domain object that port already introduced
 * (mirroring src/data/normaliseAircraft.js's real shape), reused rather
 * than yet another narrow per-file type, since this is the first
 * consumer that genuinely needs the whole thing at once: hex (for
 * suppression filtering), lat/lon/altitudeFt/type/category/
 * lastSeenSeconds (for `Visibility.estimate()`), and
 * lat/lon/altitudeFt/trackDeg/groundSpeedKt (for `Relevance.evaluate()`).
 * `computeAll()` adapts it into each dependency's own narrower input
 * type (`Visibility.AircraftInput`, `Relevance.AircraftState`) at the
 * call site, the same way the JS original hands the same duck-typed
 * object to both without either module needing to know about the
 * other's exact field list.
 *
 * Every formula, threshold, and doc-comment reasoning is preserved from
 * the original — see indicators.js itself for the fuller per-constant
 * design rationale (viewport-tiered caps, the banded polar scale, the
 * FOV restriction) — not re-duplicated here to avoid the two copies
 * drifting apart in wording even though the numbers/logic must stay in
 * sync by hand across both platforms.
 */
object Indicators {

    // Viewport-tiered NAV display cap — small phone screens stay
    // glanceable with fewer indicators; larger tablet/infotainment-style
    // displays have room for more before it becomes clutter.
    private const val NAV_CAP_SMALL_MAX_WIDTH = 500.0  // px, exclusive
    private const val NAV_CAP_MEDIUM_MAX_WIDTH = 900.0 // px, inclusive
    private const val NAV_CAP_SMALL = 5
    private const val NAV_CAP_MEDIUM = 7
    private const val NAV_CAP_LARGE = 10

    /** Max NAV indicators to show at a given viewport width (px, real or emulated). */
    fun capForViewportWidth(width: Double): Int {
        if (width < NAV_CAP_SMALL_MAX_WIDTH) return NAV_CAP_SMALL
        if (width <= NAV_CAP_MEDIUM_MAX_WIDTH) return NAV_CAP_MEDIUM
        return NAV_CAP_LARGE
    }

    /**
     * True polar plot range — the distance (nm) that maps to the full
     * available radius from the anchor. Reuses Relevance's own dead-ahead
     * teardrop range extension cap rather than a separate made-up number
     * — see indicators.js's own doc comment for the full "why" (an
     * aircraft at the plot's outer edge should mean something about
     * relevance, not just be an arbitrary cutoff).
     */
    val POLAR_MAX_RANGE_NM: Double = Relevance.DEFAULTS.rangeExtensionCapNm

    /**
     * Ring band boundaries (nm) for the plot's non-linear distance scale
     * — see Geo.bandedRadiusFraction(). See indicators.js's own doc
     * comment for the full rationale (equal screen-space slices per band
     * regardless of real nm width, a deliberately wide final band for
     * sparser high-altitude/contrail traffic).
     */
    val RING_BANDS_NM: List<Double> = listOf(2.0, 5.0, 10.0, 15.0, POLAR_MAX_RANGE_NM)

    /**
     * Half-angle (deg) of RAW mode's forward field of view — 75 deg
     * either side of dead-ahead, ~150 deg total, matching a real
     * TCAS/ND reference photo. Passed through as userState.fovHalfAngleDeg
     * by RAW's caller only.
     */
    const val FOV_HALF_ANGLE_DEG = 75.0

    /** Mirrors indicators.js's `userState` shape — see per-field comments below. */
    data class UserState(
        val lat: Double,
        val lon: Double,
        val heading: Double,
        val speedMph: Double? = null,
        val viewportWidth: Double = 0.0,
        val viewportHeight: Double = 0.0,
        val metar: Visibility.Metar? = null,
        // Must match what the camera actually used for this frame or the
        // plotted origin silently drifts from where the user marker/range
        // rings really are — see geo.js's projectToPolarPosition doc
        // comment. Null (not yet evaluated a camera frame) falls back to
        // Geo.kt's own projectToPolarPosition default (0.8), matching JS's
        // implicit undefined-passthrough exactly.
        val anchorY: Double? = null,
        val fovHalfAngleDeg: Double? = null,
        // RAW's plot lives inside a 1:1 square sub-region of the real
        // viewport (Geo.computeSquarePlotLayout), not the full viewport
        // itself — null (Hybrid, which never sets these) falls back to the
        // plain viewport with no offset.
        val plotWidth: Double? = null,
        val plotHeight: Double? = null,
        val plotOffsetX: Double? = null,
        val plotOffsetY: Double? = null,
        // "Real chrome height to stay clear of" for Hybrid's unrestricted,
        // full-viewport teardrop. Null falls back to Geo.kt's own
        // projectToPolarPosition default (60.0).
        val safeInset: Double? = null,
        // A small fixed in-square margin for RAW specifically — the square
        // already excludes all real chrome from its own bounds, so reusing
        // the full safeInset value within it would needlessly shrink an
        // already chrome-free region. Null (Hybrid) falls back to safeInset.
        val plotSafeInset: Double? = null,
        // The user-selectable ND-style range knob overrides which band
        // boundaries are "in play" for this render. Null falls back to the
        // full RING_BANDS_NM.
        val plotBandsNm: List<Double>? = null
    )

    data class IndicatorItem(
        val aircraft: AircraftExtrapolation.Aircraft,
        val bearing: Double,
        val distanceNm: Double,
        val relativeBearing: Double,
        val relativeTrackDeg: Double?,
        val vis: Visibility.EstimateResult,
        val relevance: Relevance.EvaluationResult,
        val x: Int?,
        val y: Int?,
        val isStale: Boolean
    )

    /**
     * Shared per-aircraft computation used by both build() and buildAll()
     * — bearing/distance/visibility/relevance/polar screen position/
     * direction-of-travel, for every aircraft that passes the hard
     * staleness cutoff. Does NOT filter by relevance or suppression;
     * callers decide what to do with that.
     */
    private fun computeAll(
        aircraftList: List<AircraftExtrapolation.Aircraft>,
        userState: UserState,
        staleThresholdSeconds: Double
    ): List<IndicatorItem> {
        val anchorY = userState.anchorY ?: 0.8 // Geo.kt's own projectToPolarPosition default
        val fovHalfAngleDeg = userState.fovHalfAngleDeg
        val plotWidth = userState.plotWidth ?: userState.viewportWidth
        val plotHeight = userState.plotHeight ?: userState.viewportHeight
        val plotOffsetX = userState.plotOffsetX ?: 0.0
        val plotOffsetY = userState.plotOffsetY ?: 0.0
        val safeInset = (userState.plotSafeInset ?: userState.safeInset) ?: 60.0 // Geo.kt's own default
        val bandsNm = userState.plotBandsNm ?: RING_BANDS_NM

        return aircraftList
            .filter { it.lastSeenSeconds < staleThresholdSeconds * 3 } // hard cut
            .map { a ->
                val bearing = Geo.calculateBearing(userState.lat, userState.lon, a.lat, a.lon)
                val distanceNm = Geo.calculateDistanceNm(userState.lat, userState.lon, a.lat, a.lon)
                val vis = Visibility.estimate(
                    userState.lat, userState.lon,
                    Visibility.AircraftInput(a.lat, a.lon, a.altitudeFt, a.type, a.category, a.lastSeenSeconds),
                    userState.metar
                )
                val relativeBearing = Geo.calculateRelativeBearing(bearing, userState.heading)
                val relevance = Relevance.evaluate(
                    Relevance.UserState(userState.lat, userState.lon, userState.heading, userState.speedMph),
                    Relevance.AircraftState(a.lat, a.lon, a.altitudeFt, a.trackDeg, a.groundSpeedKt),
                    relativeBearing,
                    Relevance.VisInput(vis.slantRangeNm, vis.elevationDeg)
                )
                // Slant range (not flat horizontal distance) — the same
                // figure Relevance itself compares against the teardrop, so
                // an aircraft's plotted radius agrees with whether it's near
                // the edge of relevance. null when fovHalfAngleDeg is set
                // and this bearing falls outside RAW's forward field of
                // view — callers must skip rendering those.
                val pos = Geo.projectToPolarPosition(
                    relativeBearing, vis.slantRangeNm, plotWidth, plotHeight, bandsNm,
                    anchorY, safeInset, fovHalfAngleDeg, plotOffsetX, plotOffsetY
                )
                // Direction-of-travel indicator — null when the aircraft
                // isn't transmitting a track (no arrow drawn for those).
                val relativeTrackDeg = a.trackDeg?.let { Geo.calculateRelativeBearing(it, userState.heading) }
                val isStale = a.lastSeenSeconds > staleThresholdSeconds

                IndicatorItem(
                    aircraft = a,
                    bearing = bearing,
                    distanceNm = distanceNm,
                    relativeBearing = relativeBearing,
                    relativeTrackDeg = relativeTrackDeg,
                    vis = vis,
                    relevance = relevance,
                    x = pos?.x,
                    y = pos?.y,
                    isStale = isStale
                )
            }
    }

    /**
     * Given the full aircraft list and user state, return every relevant
     * aircraft, sorted best-candidate-first. Aircraft that
     * Relevance.evaluate() rules out never reach the sort stage at all —
     * this is a TCAS-style relevance gate, not just a visibility ranking.
     *
     * Deliberately unpaginated — the caller decides how many to actually
     * display (via capForViewportWidth) and which page.
     *
     * @param suppressedHexes Aircraft hex codes to exclude regardless of
     *   relevance (manually dismissed via the popup's Suppress button).
     *   Applies uniformly — no relevance reason is exempt, including
     *   overhead/close cases.
     */
    fun build(
        aircraftList: List<AircraftExtrapolation.Aircraft>,
        userState: UserState,
        staleThresholdSeconds: Double,
        suppressedHexes: Set<String>? = null
    ): List<IndicatorItem> {
        return computeAll(aircraftList, userState, staleThresholdSeconds)
            .filter { suppressedHexes == null || !suppressedHexes.contains(it.aircraft.hex) }
            .filter { it.relevance.relevant }
            // Higher visibility score first, then proximity.
            .sortedWith(compareByDescending<IndicatorItem> { it.vis.score }.thenBy { it.distanceNm })
    }

    /**
     * Same per-aircraft computation as build(), but with NO relevance or
     * suppression filtering — every tracked aircraft, nearest first. Used
     * by the ground-truth logging panel, which needs to log "not visible"
     * observations against aircraft the relevance filter already
     * excluded, not just the ones NAV currently shows.
     */
    fun buildAll(
        aircraftList: List<AircraftExtrapolation.Aircraft>,
        userState: UserState,
        staleThresholdSeconds: Double
    ): List<IndicatorItem> {
        return computeAll(aircraftList, userState, staleThresholdSeconds).sortedBy { it.distanceNm }
    }
}
