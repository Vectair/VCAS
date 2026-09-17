package org.vectair.vcas.car

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * Real Android `SensorManager`-based azimuth + pitch, for 3D View
 * (2026-09-17). Unlike the PWA's own `compassHeading.js`/`devicePitch.js`
 * — built around the browser's fragmented DeviceOrientation API, which
 * needed real, hard-won fixes for event-name/`absolute`-flag
 * inconsistencies across real devices (see CLAUDE.md's own extensive
 * "Compass 'won't settle / settles wrong'" history) — native Android
 * reads a real fused orientation sensor directly via
 * `Sensor.TYPE_ROTATION_VECTOR`, which gives BOTH azimuth and pitch from
 * ONE listener with no separate absolute-vs-relative concept to fight.
 * Matches this project's own long-standing scoping note: "native Android
 * reads the compass/orientation sensor directly — none of that file's
 * cross-browser workaround logic has any native equivalent to port, it
 * just stops being needed."
 *
 * **The pitch sign convention was re-derived from the real, current AOSP
 * source** (`SensorManager.java`'s own `getOrientation()` Javadoc, read
 * directly — `dl.google.com`/`android.googlesource.com` are blocked from
 * this sandbox, but the `aosp-mirror` GitHub mirror isn't), not guessed:
 * `pitch = asin(-R[7])`, where `R[7]` is the device's own screen-"up"
 * (Y) axis's vertical (world-Z) component. Holding the phone vertically,
 * screen facing the user, pointing at the horizon (3D View's actual
 * intended pose) puts the device's Y-axis pointing straight up (world
 * Up), giving `R[7]=1` and therefore raw `pitch = -90°`; tilting the
 * phone flatter, screen toward the sky (pointing at the zenith), takes
 * raw pitch toward `0°`. So `devicePitchDeg = rawPitchDeg + 90`, clamped
 * to [-90, 90], gives the same "0 = pointing at the horizon, +90 =
 * pointing at the zenith" convention `View3DLogic`/the PWA's own
 * `devicePitch.js` already use — verified against the documented
 * formula, not assumed from the textual "tilt the top toward the
 * ground" description alone (that description was independently used to
 * confirm the R[7] formula's own sign, as a cross-check).
 *
 * **The same real, unresolved risk this project's own 3D View code
 * review already flagged for the PWA carries over here, honestly, not
 * silently presented as solved**: Euler-angle decomposition of a
 * rotation matrix has a genuine mathematical near-singularity right at
 * pitch=±90° — exactly the pose 3D View's own intended use (holding the
 * phone vertically) sits at. Small physical rotations near that pose can
 * produce disproportionate or unstable reported-angle changes; this is a
 * structural property of `getOrientation()`'s own Euler decomposition,
 * not a bug in this class. Needs real-device field testing, same
 * standing caveat every sensor-reading fix in this project's history
 * carries.
 */
class DeviceOrientationSensor(context: Context) : SensorEventListener {
    private val sensorManager = context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val rotationSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    var onOrientationChanged: ((azimuthDeg: Double, pitchDeg: Double) -> Unit)? = null

    private var smoothedAzimuthDeg: Double? = null
    private var smoothedPitchDeg: Double? = null

    // Heavier damping than a dash-mounted-and-mostly-still reading would
    // need — 3D View's own use (actively panning to scan the sky) still
    // benefits from real EMA smoothing against magnetometer noise, same
    // reasoning CompassHeading's own SMOOTH_FACTOR history carries.
    private val smoothFactor = 0.15
    private val rotationMatrix = FloatArray(9)
    private val orientationValues = FloatArray(3)

    // "Set North" manual calibration — mirrors CompassHeading.calibrateTo()
    // in the PWA: "I am currently pointing at trueHeadingDeg" re-anchors
    // the reported azimuth without touching the sensor's own relative
    // responsiveness to a real subsequent turn. Deliberately NOT
    // persisted — a fresh stationary period should start from the raw
    // sensor reading, not silently carry a stale correction forward from
    // a different magnetic environment.
    private var calibrationOffsetDeg = 0.0

    fun isSupported(): Boolean = rotationSensor != null

    fun start() {
        val sensor = rotationSensor ?: return
        sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        smoothedAzimuthDeg = null
        smoothedPitchDeg = null
        calibrationOffsetDeg = 0.0
    }

    /** @return false if no reading has arrived yet — nothing to anchor against. */
    fun calibrateTo(trueHeadingDeg: Double): Boolean {
        val current = smoothedAzimuthDeg ?: return false
        calibrationOffsetDeg = normalizeDeg(trueHeadingDeg - current)
        return true
    }

    fun clearCalibration() {
        calibrationOffsetDeg = 0.0
    }

    fun hasCalibration(): Boolean = calibrationOffsetDeg != 0.0

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        SensorManager.getOrientation(rotationMatrix, orientationValues)

        // values[0]: 0=N, +pi/2=E, +pi=S, -pi/2=W — already the standard
        // compass sense, just needs shifting into [0, 360).
        val rawAzimuthDeg = normalizeDeg(Math.toDegrees(orientationValues[0].toDouble()))
        // See this class's own doc comment for the full re-derivation —
        // rawPitchDeg+90, clamped, converts getOrientation()'s own
        // pitch convention into "0 = horizon, +90 = zenith."
        val rawPitchDeg = (Math.toDegrees(orientationValues[1].toDouble()) + 90.0).coerceIn(-90.0, 90.0)

        smoothedAzimuthDeg = emaCircularDeg(smoothedAzimuthDeg, rawAzimuthDeg, smoothFactor)
        smoothedPitchDeg = ema(smoothedPitchDeg, rawPitchDeg, smoothFactor)

        val calibratedAzimuth = normalizeDeg(smoothedAzimuthDeg!! + calibrationOffsetDeg)
        onOrientationChanged?.invoke(calibratedAzimuth, smoothedPitchDeg!!)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun ema(prev: Double?, next: Double, factor: Double): Double =
        if (prev == null) next else prev + (next - prev) * factor

    private fun emaCircularDeg(prev: Double?, next: Double, factor: Double): Double {
        if (prev == null) return next
        val delta = normalizeSignedDeg(next - prev) // shortest path across the 0/360 wrap
        return normalizeDeg(prev + delta * factor)
    }

    private fun normalizeDeg(deg: Double): Double = ((deg % 360.0) + 360.0) % 360.0
    private fun normalizeSignedDeg(deg: Double): Double = ((deg + 540.0) % 360.0) - 180.0
}
