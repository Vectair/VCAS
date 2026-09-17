package org.vectair.vcas.car.logic

import org.junit.Assert.*
import org.junit.Test

class View3DLogicTest {

    // ---- projectTo3DPosition ----

    @Test
    fun projectTo3DPosition_deadCentre_whenBothOffsetsZero() {
        val p = View3DLogic.projectTo3DPosition(0.0, 0.0, 400.0, 800.0)!!
        assertEquals(200.0, p.x, 1e-9)
        assertEquals(400.0, p.y, 1e-9)
    }

    @Test
    fun projectTo3DPosition_fourWindowEdges() {
        // Right edge (bearing = +halfH) -> screen right edge.
        assertEquals(400.0, View3DLogic.projectTo3DPosition(40.0, 0.0, 400.0, 800.0)!!.x, 1e-9)
        // Left edge (bearing = -halfH) -> screen left edge.
        assertEquals(0.0, View3DLogic.projectTo3DPosition(-40.0, 0.0, 400.0, 800.0)!!.x, 1e-9)
        // Top edge (elevation = +halfV) -> screen y=0 (inverted axis).
        assertEquals(0.0, View3DLogic.projectTo3DPosition(0.0, 30.0, 400.0, 800.0)!!.y, 1e-9)
        // Bottom edge (elevation = -halfV) -> screen y=viewportHeight.
        assertEquals(800.0, View3DLogic.projectTo3DPosition(0.0, -30.0, 400.0, 800.0)!!.y, 1e-9)
    }

    @Test
    fun projectTo3DPosition_outsideWindow_returnsNull() {
        assertNull(View3DLogic.projectTo3DPosition(41.0, 0.0, 400.0, 800.0))
        assertNull(View3DLogic.projectTo3DPosition(0.0, 31.0, 400.0, 800.0))
    }

    @Test
    fun projectTo3DPosition_customFov() {
        val p = View3DLogic.projectTo3DPosition(10.0, 0.0, 400.0, 800.0, fovHalfHDeg = 10.0)!!
        assertEquals(400.0, p.x, 1e-9) // right at the custom, narrower edge
    }

    @Test
    fun projectTo3DPosition_defaultConstantsApplyWhenOmitted() {
        val withDefault = View3DLogic.projectTo3DPosition(20.0, 15.0, 400.0, 800.0)
        val explicit = View3DLogic.projectTo3DPosition(20.0, 15.0, 400.0, 800.0, View3DLogic.FOV_HALF_H_DEG, View3DLogic.FOV_HALF_V_DEG)
        assertEquals(explicit, withDefault)
    }

    // ---- horizonScreenY ----

    @Test
    fun horizonScreenY_levelPitch_horizonAtCentre() {
        assertEquals(400.0, View3DLogic.horizonScreenY(0.0, 800.0), 1e-9)
    }

    @Test
    fun horizonScreenY_pitchedToFovEdge_horizonAtScreenEdge() {
        // Pointing up (devicePitchDeg positive) pushes the horizon DOWN
        // the screen (larger y) — "if the phone points above the true
        // horizon, the horizon sits below wherever the phone is centred,"
        // per this function's own doc comment.
        assertEquals(800.0, View3DLogic.horizonScreenY(30.0, 800.0), 1e-9) // pointing up 30 deg -> horizon at bottom
        assertEquals(0.0, View3DLogic.horizonScreenY(-30.0, 800.0), 1e-9) // pointing down -> horizon at top
    }

    @Test
    fun horizonScreenY_beyondWindow_stillReturnsRealUnclampedValue() {
        // A pitch beyond the FOV window still returns a real, correctly
        // computed off-screen value rather than clamping or nulling —
        // deliberately different from projectTo3DPosition's own behaviour.
        val y = View3DLogic.horizonScreenY(60.0, 800.0)
        assertEquals(400.0 + (60.0 / 30.0) * 400.0, y, 1e-9)
        assertTrue(y > 800.0) // genuinely off the bottom of the screen
    }

    // ---- shouldUpdateFrame ----

    @Test
    fun shouldUpdateFrame_firstFrame_alwaysPaints() {
        assertTrue(View3DLogic.shouldUpdateFrame(null, null, 10.0, 5.0))
    }

    @Test
    fun shouldUpdateFrame_belowThresholdOnBothAxes_doesNotRepaint() {
        assertFalse(View3DLogic.shouldUpdateFrame(100.0, 20.0, 100.1, 20.1))
    }

    @Test
    fun shouldUpdateFrame_atExactThreshold_doesNotRepaint() {
        assertFalse(View3DLogic.shouldUpdateFrame(100.0, 20.0, 100.3, 20.0))
    }

    @Test
    fun shouldUpdateFrame_aboveThresholdOnAzimuthOnly_repaints() {
        assertTrue(View3DLogic.shouldUpdateFrame(100.0, 20.0, 100.31, 20.0))
    }

    @Test
    fun shouldUpdateFrame_aboveThresholdOnPitchOnly_repaints() {
        assertTrue(View3DLogic.shouldUpdateFrame(100.0, 20.0, 100.0, 20.31))
    }

    @Test
    fun shouldUpdateFrame_azimuthWraparound_smallCrossingDoesNotRepaint() {
        // 359.9 -> 0.05 is a genuinely small ~0.15deg move across the
        // 0/360 boundary, not a large jump.
        assertFalse(View3DLogic.shouldUpdateFrame(359.9, 0.0, 0.05, 0.0))
    }

    @Test
    fun shouldUpdateFrame_azimuthWraparound_largeCrossingRepaints() {
        assertTrue(View3DLogic.shouldUpdateFrame(359.9, 0.0, 5.0, 0.0))
    }

    // ---- compassTicks ----

    @Test
    fun compassTicks_facingNorth_deadAheadTickIsCentredAndMajor() {
        val ticks = View3DLogic.compassTicks(0.0, 400.0)
        val north = ticks.find { it.deg == 0.0 }!!
        assertEquals(200.0, north.x, 1e-9)
        assertTrue(north.major)
        assertEquals("N", north.label)
    }

    @Test
    fun compassTicks_outOfWindowDirection_absent() {
        // Facing north (0deg), south (180deg) is far outside the +-40deg window.
        val ticks = View3DLogic.compassTicks(0.0, 400.0)
        assertNull(ticks.find { it.deg == 180.0 })
    }

    @Test
    fun compassTicks_minorTicksHaveNoLabel() {
        val ticks = View3DLogic.compassTicks(0.0, 400.0)
        val minor = ticks.find { it.deg == 10.0 }!!
        assertFalse(minor.major)
        assertNull(minor.label)
    }

    @Test
    fun compassTicks_facingEast_eastTickCentred_northAbsent() {
        val ticks = View3DLogic.compassTicks(90.0, 400.0)
        val east = ticks.find { it.deg == 90.0 }!!
        assertEquals(200.0, east.x, 1e-9)
        assertEquals("E", east.label)
        assertNull(ticks.find { it.deg == 0.0 })
    }

    @Test
    fun compassTicks_customFovWidensWindow() {
        val narrow = View3DLogic.compassTicks(0.0, 400.0, fovHalfHDeg = 5.0)
        val wide = View3DLogic.compassTicks(0.0, 400.0, fovHalfHDeg = 90.0)
        assertTrue(wide.size > narrow.size)
    }
}
