package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the navigationCameraEvaluator.js ->
 * NavigationCameraEvaluator.kt port, following this project's
 * established discipline (see CLAUDE.md, the five prior logic ports):
 * run against real execution, not just read for correctness.
 *
 * Each test constructs a fresh `NavigationCameraEvaluator()` instance —
 * see the class's own doc comment on why this is a `class`, not an
 * `object`, specifically so state from one test can never leak into
 * another the way a shared singleton would.
 *
 * A real, verifiable discrepancy was found while writing these tests,
 * not assumed away: the JS source's own comment on the state-dwell-lock
 * block claims NAV_RAW bypasses the hysteresis timer "(like AIR)" — but
 * the ACTUAL CODE CONDITION only ever checks
 * `targetState === "NAV_RAW" || lastEvaluatedState === "NAV_RAW"`, never
 * mentioning "AIR" at all. This port is faithful to the real code, not
 * the comment's aspirational claim (same "verify against real execution,
 * not what a comment says" discipline this project has applied
 * repeatedly elsewhere — e.g. the compass `event.absolute` finding, the
 * RAW-glyphs finding) — `airMode_isBlockedByDwellLock_thenSucceeds...`
 * below proves AIR mode genuinely IS subject to the same
 * MIN_STATE_DWELL_MS hysteresis as any automatic transition, exactly
 * matching the shipped JS behaviour, not the comment describing it.
 */
class NavigationCameraEvaluatorTest {

    private fun ctx(
        mode: String = "nav",
        routeActive: Boolean = false,
        routeCoordinates: List<DoubleArray>? = null,
        userLat: Double = 0.0,
        userLon: Double = 0.0,
        userSpeedMph: Double? = 0.0,
        viewportPreset: String? = null,
        navDisplayStyle: String? = null,
        viewportWidth: Double? = null,
        viewportHeight: Double? = null,
        squareContentTop: Double? = null,
        squareContentHeight: Double? = null
    ) = NavigationCameraEvaluator.Ctx(
        mode = mode, routeActive = routeActive, routeCoordinates = routeCoordinates,
        userLat = userLat, userLon = userLon, userSpeedMph = userSpeedMph,
        viewportPreset = viewportPreset, navDisplayStyle = navDisplayStyle,
        viewportWidth = viewportWidth, viewportHeight = viewportHeight,
        squareContentTop = squareContentTop, squareContentHeight = squareContentHeight
    )

    @Test
    fun freshEvaluator_noRoute_defaultsToNavIdle() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(ctx(routeActive = false), currentTimeMs = 0L)
        assertEquals("NAV_IDLE", result.state)
        assertEquals(45.0, result.pitch, 1e-9)
        assertEquals(17.0, result.zoom, 1e-9)
    }

    @Test
    fun airMode_isBlockedByDwellLock_thenSucceedsAfterElapsed() {
        val evaluator = NavigationCameraEvaluator()
        evaluator.evaluate(ctx(routeActive = false), currentTimeMs = 0L) // establishes NAV_IDLE baseline

        // Only 1000ms later (< MIN_STATE_DWELL_MS = 3500) -- must be
        // clamped back to NAV_IDLE, proving AIR is NOT exempt from the
        // dwell lock despite the JS comment's "(like AIR)" claim.
        val blocked = evaluator.evaluate(ctx(mode = "air"), currentTimeMs = 1000L)
        assertEquals("NAV_IDLE", blocked.state)

        // Now 4000ms after the ORIGINAL dwell timestamp (still 0, since
        // the blocked attempt never advanced it) -- past the 3500ms gate,
        // so the same request now succeeds.
        val allowed = evaluator.evaluate(ctx(mode = "air"), currentTimeMs = 4000L)
        assertEquals("AIR", allowed.state)
    }

    @Test
    fun navRaw_bypassesDwellLock_intoAndOutOf() {
        val evaluator = NavigationCameraEvaluator()
        evaluator.evaluate(ctx(routeActive = false), currentTimeMs = 0L) // NAV_IDLE baseline

        // Only 100ms later -- NAV_RAW must still apply immediately.
        val intoRaw = evaluator.evaluate(ctx(navDisplayStyle = "raw"), currentTimeMs = 100L)
        assertEquals("NAV_RAW", intoRaw.state)

        // Only 50ms after THAT -- switching back out of NAV_RAW must
        // also apply immediately (lastEvaluatedState === "NAV_RAW" arm).
        val outOfRaw = evaluator.evaluate(ctx(routeActive = false), currentTimeMs = 150L)
        assertEquals("NAV_IDLE", outOfRaw.state)
    }

    @Test
    fun urbanGuidance_speedSmoothing_andZoomDelta_singleCall() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(
            ctx(routeActive = true, userSpeedMph = 100.0),
            currentTimeMs = 10_000L
        )

        assertEquals("URBAN_GUIDANCE", result.state)
        // smoothedSpeedMph after one EMA step from 0: 0 + (100-0)*0.08 = 8.0
        val expectedSmoothed = 8.0
        val expectedZoom = 16.2 - (expectedSmoothed / 85.0) * 1.8
        assertEquals(expectedZoom, result.zoom, 1e-9)
        assertEquals(55.0, result.pitch, 1e-9) // URBAN_GUIDANCE preset pitch, no viewport bias
    }

    @Test
    fun turnApproach_detectedForSharpTurnAheadWithinScanWindow() {
        // A route heading due east then turning sharply north, close
        // enough to be inside the dynamic scan window at low speed.
        val p0 = doubleArrayOf(0.0, 0.0)
        val p1 = doubleArrayOf(0.0018, 0.0)  // ~200m east
        val p2 = doubleArrayOf(0.0018, 0.0018) // ~200m further north
        val route = listOf(p0, p1, p2)

        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(
            ctx(routeActive = true, routeCoordinates = route, userLat = 0.0, userLon = 0.0, userSpeedMph = 100.0),
            currentTimeMs = 10_000L
        )

        assertEquals("TURN_APPROACH", result.state)
        assertEquals(true, result.maneuver.exists)

        val expectedDistance = Geo.calculateDistanceMeters(p0[1], p0[0], p1[1], p1[0])
        assertEquals(expectedDistance, result.maneuver.distanceMeters, 1.0)

        // East (~90deg) turning to north (~0deg) is a left turn -> negative.
        assertEquals(-90.0, result.maneuver.bearingDeltaDeg, 1.0)

        assertEquals("TURN_APPROACH_CHOREOGRAPHY", result.transitionProfile)
        assertEquals(2, result.suppressionLevel)
        assertEquals("DECOUPLED_MANEUVER", result.bearingMode)
        assertEquals(35.0, result.pitch, 1e-9) // TURN_APPROACH preset, unaffected by zoom-delta scaling
    }

    @Test
    fun highwaySpeedGate_entersAboveEnterThreshold_withAutoViewportBias_andMaxPitchClamp() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(
            ctx(routeActive = true, userSpeedMph = 700.0, viewportPreset = "auto"),
            currentTimeMs = 10_000L
        )

        // smoothed = 0 + (700-0)*0.08 = 56.0, safely above HIGHWAY_SPEED_ENTER (53).
        assertEquals("HIGHWAY_GUIDANCE", result.state)
        assertEquals("HIGHWAY_SMOOTH_PERSPECTIVE", result.transitionProfile)
        assertEquals(3, result.suppressionLevel)

        val expectedZoom = 14.2 - (56.0 / 85.0) * 1.8
        assertEquals(expectedZoom, result.zoom, 1e-9)

        // "auto" bias: anchorXOverride=0.35, anchorYOverride=0.75 (both win
        // over the preset's own 0.5/0.85), maxPitch=40 clamps the preset's
        // own pitch (60) down.
        assertEquals(0.35, result.anchorX, 1e-9)
        assertEquals(0.75, result.anchorY, 1e-9)
        assertEquals(40.0, result.pitch, 1e-9)
    }

    @Test
    fun highwaySpeedGate_staysAboveExitThreshold_thenRevertsBelowIt() {
        val evaluator = NavigationCameraEvaluator()
        var t = 10_000L

        // Ramp up hard to enter HIGHWAY_GUIDANCE.
        var result = evaluator.evaluate(ctx(routeActive = true, userSpeedMph = 700.0), t)
        assertEquals("HIGHWAY_GUIDANCE", result.state)

        // Hold at a speed inside the 46-53 hysteresis band (50mph) for
        // many iterations -- must NOT drop back to URBAN_GUIDANCE just
        // because it's below the ENTER gate (53), only the lower EXIT
        // gate (46) governs once already in HIGHWAY_GUIDANCE.
        repeat(40) {
            t += 4000
            result = evaluator.evaluate(ctx(routeActive = true, userSpeedMph = 50.0), t)
        }
        assertEquals("HIGHWAY_GUIDANCE", result.state)
        assertEquals(60.0, result.pitch, 1e-9) // still the plain highway preset pitch

        // Now drop the input hard and keep iterating until the smoothed
        // speed genuinely falls below the 46 EXIT gate -- must revert.
        var reverted = false
        repeat(200) {
            t += 4000
            result = evaluator.evaluate(ctx(routeActive = true, userSpeedMph = 0.0), t)
            if (result.state == "URBAN_GUIDANCE") reverted = true
        }
        assertTrue("expected eventual reversion to URBAN_GUIDANCE once smoothed speed drops below 46", reverted)
    }

    @Test
    fun viewportBias_phoneL_appliesPitchAndAnchorYBias() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(ctx(routeActive = false, viewportPreset = "phone-l"), currentTimeMs = 0L)

        assertEquals("NAV_IDLE", result.state)
        // NAV_IDLE preset: pitch=45, anchorY=0.75, anchorX=0.5.
        // phone-l bias: pitchBias=-5, anchorYBias=-0.05, no overrides.
        assertEquals(40.0, result.pitch, 1e-9)
        assertEquals(0.70, result.anchorY, 1e-9)
        assertEquals(0.5, result.anchorX, 1e-9)
    }

    @Test
    fun pitchClamp_lowerBound_neverGoesNegative() {
        // AIR preset pitch is 0; phone-l's -5 pitchBias would push it
        // negative pre-clamp -- must be clamped back to 0.
        val evaluator = NavigationCameraEvaluator()
        evaluator.evaluate(ctx(routeActive = false), currentTimeMs = 0L)
        val result = evaluator.evaluate(
            ctx(mode = "air", viewportPreset = "phone-l"),
            currentTimeMs = 10_000L // clear of the dwell lock
        )
        assertEquals("AIR", result.state)
        assertEquals(0.0, result.pitch, 1e-9)
    }

    @Test
    fun navRaw_squareAnchor_matchesDirectGeoComputation() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(
            ctx(navDisplayStyle = "raw", viewportWidth = 400.0, viewportHeight = 800.0, squareContentTop = 50.0, squareContentHeight = 700.0),
            currentTimeMs = 0L // NAV_RAW bypasses the dwell lock regardless
        )

        assertEquals("NAV_RAW", result.state)

        val square = Geo.computeSquarePlotLayout(400.0, 50.0, 700.0)
        val withinSquareAnchorY = NavigationCameraEvaluator.STATE_PRESETS.getValue("NAV_RAW").anchorY
        val anchorXPx = square.squareLeft + square.squareSize * 0.5
        val anchorYPx = square.squareTop + square.squareSize * withinSquareAnchorY
        val expectedAnchorX = anchorXPx / 400.0
        val expectedAnchorY = anchorYPx / 800.0

        assertEquals(expectedAnchorX, result.anchorX, 1e-9)
        assertEquals(expectedAnchorY, result.anchorY, 1e-9)
        assertEquals(0.0, result.pitch, 1e-9) // NAV_RAW's own preset pitch, "full" bias is a no-op
    }

    @Test
    fun navRaw_squareAnchor_skippedWhenViewportDimsMissing_fallsBackToFlatPreset() {
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(ctx(navDisplayStyle = "raw"), currentTimeMs = 0L)

        assertEquals("NAV_RAW", result.state)
        // No viewportWidth/Height provided -> 9b skipped entirely -> the
        // flat preset values (blended through "full"'s zero bias) stand.
        assertEquals(0.5, result.anchorX, 1e-9)
        assertEquals(0.80, result.anchorY, 1e-9)
    }

    @Test
    fun navRaw_squareAnchor_stillAppliesWhenSquareContentHeightIsZero() {
        // A real asymmetry preserved from the JS source: viewportWidth/
        // viewportHeight use a truthy check (0 excluded), but
        // squareContentHeight uses an explicit `!= null` check, so 0 is a
        // valid degenerate value that must NOT skip the branch.
        val evaluator = NavigationCameraEvaluator()
        val result = evaluator.evaluate(
            ctx(navDisplayStyle = "raw", viewportWidth = 400.0, viewportHeight = 800.0, squareContentHeight = 0.0),
            currentTimeMs = 0L
        )

        assertEquals("NAV_RAW", result.state)
        // Branch entered (not skipped) -> anchors are computed from a
        // degenerate zero-size square, NOT the flat 0.5/0.80 preset
        // defaults that "skipped" would have left in place.
        assertEquals(0.0, result.anchorX, 1e-9)
        assertEquals(0.0, result.anchorY, 1e-9)
    }

    @Test
    fun statePresetsAndViewportBiases_matchDocumentedValues() {
        val idle = NavigationCameraEvaluator.STATE_PRESETS.getValue("NAV_IDLE")
        assertEquals(45.0, idle.pitch, 1e-9)
        assertEquals(17.0, idle.zoom, 1e-9)
        assertEquals(0.75, idle.anchorY, 1e-9)
        assertEquals(0.5, idle.anchorX, 1e-9)

        val highway = NavigationCameraEvaluator.STATE_PRESETS.getValue("HIGHWAY_GUIDANCE")
        assertEquals(60.0, highway.pitch, 1e-9)
        assertEquals(14.2, highway.zoom, 1e-9)

        val auto = NavigationCameraEvaluator.VIEWPORT_BIASES.getValue("auto")
        assertEquals(0.35, auto.anchorXOverride)
        assertEquals(0.75, auto.anchorYOverride)
        assertEquals(40.0, auto.maxPitch)
    }
}
