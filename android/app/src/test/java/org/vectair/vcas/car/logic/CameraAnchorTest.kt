package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Real JUnit4 verification of CameraAnchor.paddingForAnchor(), the pure
 * padding-derivation logic VcasMapRenderer.kt uses to drive the real
 * MapLibre camera off NavigationCameraEvaluator's anchor fractions (see
 * CameraAnchor.kt's own doc comment for the full context).
 *
 * Every test checks the actual invariant this function exists to
 * guarantee — that low + (dimension - low - high) / 2 == anchorFraction
 * * dimension (MapLibre's own documented padded-center formula) — rather
 * than just asserting hand-picked output numbers, so a correct-looking
 * but subtly wrong implementation couldn't pass by coincidence.
 */
class CameraAnchorTest {

    private fun assertPaddedCenterMatches(anchorFraction: Double, dimension: Double) {
        val (low, high) = CameraAnchor.paddingForAnchor(anchorFraction, dimension)
        val paddedCenter = low + (dimension - low - high) / 2
        assertEquals(anchorFraction.coerceIn(0.0, 1.0) * dimension, paddedCenter, 1e-9)
    }

    @Test
    fun exactCenter_bothSidesZero() {
        val (low, high) = CameraAnchor.paddingForAnchor(0.5, 800.0)
        assertEquals(0.0, low, 1e-9)
        assertEquals(0.0, high, 1e-9)
        assertPaddedCenterMatches(0.5, 800.0)
    }

    @Test
    fun aboveHalf_padsLowSideOnly() {
        // The documented RAW/NAV_IDLE-style case: anchorY=0.8, H=800 -> top=480, bottom=0.
        val (top, bottom) = CameraAnchor.paddingForAnchor(0.8, 800.0)
        assertEquals(480.0, top, 1e-9)
        assertEquals(0.0, bottom, 1e-9)
        assertPaddedCenterMatches(0.8, 800.0)
    }

    @Test
    fun belowHalf_padsHighSideOnly() {
        // The "auto" viewport bias case: anchorX=0.35, W=400 -> left=0, right=120.
        val (left, right) = CameraAnchor.paddingForAnchor(0.35, 400.0)
        assertEquals(0.0, left, 1e-9)
        assertEquals(120.0, right, 1e-9)
        assertPaddedCenterMatches(0.35, 400.0)
    }

    @Test
    fun nearZero_padsHighSideAlmostFully() {
        assertPaddedCenterMatches(0.05, 1000.0)
        val (low, high) = CameraAnchor.paddingForAnchor(0.05, 1000.0)
        assertEquals(0.0, low, 1e-9)
        assertEquals(900.0, high, 1e-9)
    }

    @Test
    fun nearOne_padsLowSideAlmostFully() {
        assertPaddedCenterMatches(0.95, 1000.0)
        val (low, high) = CameraAnchor.paddingForAnchor(0.95, 1000.0)
        assertEquals(900.0, low, 1e-9)
        assertEquals(0.0, high, 1e-9)
    }

    @Test
    fun outOfRangeAboveOne_clampsToOne() {
        val (low, high) = CameraAnchor.paddingForAnchor(1.5, 800.0)
        assertEquals(800.0, low, 1e-9)
        assertEquals(0.0, high, 1e-9)
        assertPaddedCenterMatches(1.0, 800.0) // matches the clamped value, not the raw 1.5
    }

    @Test
    fun outOfRangeBelowZero_clampsToZero() {
        val (low, high) = CameraAnchor.paddingForAnchor(-0.5, 800.0)
        assertEquals(0.0, low, 1e-9)
        assertEquals(800.0, high, 1e-9)
        assertPaddedCenterMatches(0.0, 800.0)
    }

    @Test
    fun zeroDimension_producesZeroPaddingBothSides() {
        val (low, high) = CameraAnchor.paddingForAnchor(0.8, 0.0)
        assertEquals(0.0, low, 1e-9)
        assertEquals(0.0, high, 1e-9)
    }

    @Test
    fun invariantHolds_acrossASweepOfFractionsAndDimensions() {
        val fractions = listOf(0.0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0)
        val dimensions = listOf(100.0, 412.0, 800.0, 1920.0)
        for (f in fractions) {
            for (d in dimensions) {
                assertPaddedCenterMatches(f, d)
            }
        }
    }
}
