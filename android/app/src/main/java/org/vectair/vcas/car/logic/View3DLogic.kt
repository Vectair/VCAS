package org.vectair.vcas.car.logic

import kotlin.math.abs

/**
 * View3DLogic — pure angular-matching primitive for the "3D" free-view
 * mode, a structural port of `src/logic/view3dLogic.js`. Given an
 * aircraft's real angular offset from the phone's current pointing
 * direction (bearing offset from device azimuth, elevation offset from
 * device pitch), decides whether it falls inside the phone's current
 * "pointing window" and, if so, where to plot it on screen.
 *
 * Deliberately a NEW primitive, not a reuse of `Geo.projectToPolarPosition`
 * — that function plots by bearing + banded DISTANCE with no elevation
 * axis at all. 3D View needs a genuinely different 2D angular window
 * check: does (bearing offset, elevation offset) fall inside
 * (±fovHalfHDeg, ±fovHalfVDeg) of where the phone is pointing right now.
 *
 * Deliberately planetarium-style, not photorealistic AR — a small-angle
 * LINEAR degrees-to-pixels mapping across the window, same as the JS
 * original, not a true gnomonic/stereographic projection.
 */
object View3DLogic {

    // Genuinely new tuned constants, same honest "reasonable starting
    // guess, not physically derived" provenance every other tuned
    // constant in this project's own history carries.
    const val FOV_HALF_H_DEG = 40.0
    const val FOV_HALF_V_DEG = 30.0

    // Anti-jitter dead zone — see this project's own compass-heading
    // history for the reasoning: rather than fighting residual sensor
    // noise purely with heavier smoothing (which would trade away real
    // responsiveness while the user is deliberately panning), this gates
    // the RENDER decision itself.
    const val FRAME_UPDATE_THRESHOLD_DEG = 0.3

    private val COMPASS_POINT_LABELS = mapOf(
        0.0 to "N", 45.0 to "NE", 90.0 to "E", 135.0 to "SE",
        180.0 to "S", 225.0 to "SW", 270.0 to "W", 315.0 to "NW"
    )

    data class Point(val x: Double, val y: Double)
    data class Tick(val deg: Double, val x: Double, val major: Boolean, val label: String?)

    /** Signed angular difference a-b, normalized to (-180, 180]. */
    private fun angleDiff(a: Double, b: Double): Double = ((a - b + 540) % 360) - 180

    /**
     * @param relativeBearingDeg  Aircraft bearing minus device azimuth,
     *   already normalized to [-180, 180] (Geo.calculateRelativeBearing's
     *   own contract — positive = right of where the phone points).
     * @param elevationOffsetDeg  Aircraft elevation angle minus the
     *   device's own current pointing elevation.
     * @return Screen position, or null if the aircraft falls outside the
     *   phone's current pointing window.
     */
    fun projectTo3DPosition(
        relativeBearingDeg: Double,
        elevationOffsetDeg: Double,
        viewportWidth: Double,
        viewportHeight: Double,
        fovHalfHDeg: Double = FOV_HALF_H_DEG,
        fovHalfVDeg: Double = FOV_HALF_V_DEG
    ): Point? {
        if (abs(relativeBearingDeg) > fovHalfHDeg || abs(elevationOffsetDeg) > fovHalfVDeg) return null
        val x = viewportWidth / 2 + (relativeBearingDeg / fovHalfHDeg) * (viewportWidth / 2)
        // Screen Y is inverted relative to elevation — a higher elevation
        // (more positive) plots nearer the top of the screen (smaller y).
        val y = viewportHeight / 2 - (elevationOffsetDeg / fovHalfVDeg) * (viewportHeight / 2)
        return Point(x, y)
    }

    /**
     * Screen Y for the true horizon (elevation 0), given where the phone
     * is currently pointing — the "world building" backdrop behind the
     * aircraft dots. Same linear degrees-to-pixels mapping
     * `projectTo3DPosition` uses, applied to the horizon's own fixed
     * elevation (0°). Deliberately UNCLAMPED, unlike `projectTo3DPosition`
     * — a horizon is always "somewhere" (even off-screen at a steep
     * tilt), not a single point that can fall meaningfully "outside the
     * window."
     */
    fun horizonScreenY(devicePitchDeg: Double, viewportHeight: Double, fovHalfVDeg: Double = FOV_HALF_V_DEG): Double =
        viewportHeight / 2 + (devicePitchDeg / fovHalfVDeg) * (viewportHeight / 2)

    /**
     * @param lastAzimuthDeg  Azimuth at the last rendered frame, or null if none yet.
     * @param lastPitchDeg    Elevation/pitch at the last rendered frame, or null if none yet.
     * @return true if the scene should repaint this tick.
     */
    fun shouldUpdateFrame(lastAzimuthDeg: Double?, lastPitchDeg: Double?, azimuthDeg: Double, pitchDeg: Double): Boolean {
        if (lastAzimuthDeg == null || lastPitchDeg == null) return true
        val azDiff = abs(angleDiff(azimuthDeg, lastAzimuthDeg))
        val pitchDiff = abs(pitchDeg - lastPitchDeg)
        return azDiff > FRAME_UPDATE_THRESHOLD_DEG || pitchDiff > FRAME_UPDATE_THRESHOLD_DEG
    }

    /**
     * Compass-tick strip for 3D View's top edge. Every 10° of true compass
     * bearing gets a tick if it falls inside the phone's current
     * horizontal pointing window (the SAME fovHalfHDeg window
     * `projectTo3DPosition` gates on); every 45° (the 8-point compass) is
     * a "major" tick with a direction label. `x` uses the identical
     * linear degrees-to-pixels mapping `projectTo3DPosition` uses for its
     * own bearing axis, so a tick and an aircraft dot at the same true
     * bearing always land at the same x.
     *
     * @param headingDeg  Device azimuth (0-360, true compass bearing).
     */
    fun compassTicks(headingDeg: Double, viewportWidth: Double, fovHalfHDeg: Double = FOV_HALF_H_DEG): List<Tick> {
        val ticks = mutableListOf<Tick>()
        var deg = 0.0
        while (deg < 360.0) {
            val offset = angleDiff(deg, headingDeg)
            if (abs(offset) <= fovHalfHDeg) {
                val x = viewportWidth / 2 + (offset / fovHalfHDeg) * (viewportWidth / 2)
                val major = deg % 45.0 == 0.0
                ticks.add(Tick(deg, x, major, if (major) COMPASS_POINT_LABELS[deg] else null))
            }
            deg += 10.0
        }
        return ticks
    }
}
