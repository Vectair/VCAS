package org.vectair.vcas.car

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.constants.MapLibreConstants
import org.maplibre.android.geometry.LatLng
import org.vectair.vcas.car.logic.AircraftExtrapolation
import org.vectair.vcas.car.logic.CameraAnchor
import org.vectair.vcas.car.logic.Geo
import org.vectair.vcas.car.logic.NavigationCameraEvaluator
import org.vectair.vcas.car.logic.Visibility
import kotlin.math.roundToInt

/**
 * Phone-side entry point — a genuinely functional standalone screen, not
 * the phase-1 placeholder this class used to be (see git history for the
 * original "Open Android Auto while connected to your car" message-only
 * version). Direct instruction (2026-08-26): VCAS should work like Google
 * Maps — a real, independently-useful app when tapped directly on the
 * phone (walking, no car involved) AND a car-projected app via Android
 * Auto (`VcasCarAppService`/`VcasSession`/`MapScreen`, untouched by this
 * work) when connected — not one experience standing in for the other.
 *
 * **Deliberately built as fully native Kotlin, not a WebView wrapping the
 * already-deployed PWA** — a faster, lower-risk alternative that was
 * raised and explicitly turned down in favour of native, matching the
 * same "genuine rebuild, not a shortcut through the web UI" standard
 * CLAUDE.md's own scoping note already set for the car-Surface UI layer.
 * This activity is that same standard applied to the phone screen: real
 * `MapView`, real `LocationManager`/`AdsbFiClient` wiring, real
 * `Indicators`-pipeline-adjacent logic (`Visibility.estimate()`/
 * `Geo.calculateDistanceNm()` directly — see below for why NOT the full
 * `Indicators.build()`/`buildAll()` pipeline) — sharing the same ported
 * Kotlin logic files the car side already uses and already verified via
 * real `kotlinc`+JUnit4 execution (see CLAUDE.md's six-port history).
 *
 * **Why real `Visibility.estimate()`/`Geo.calculateDistanceNm()` calls
 * directly, not `Indicators.build()`/`buildAll()`.** Those two entry
 * points exist to feed the PWA's NAV/RAW polar-projection display (screen
 * x/y around a forward-looking anchor, relevance-gated, FOV-restricted —
 * concepts that only mean something for that specific display). This
 * screen is a real geographic map — every currently-tracked aircraft gets
 * plotted at its own true lat/lon via a MapLibre marker, matching how the
 * PWA's own AIR mode works (unfiltered by relevance, not polar-projected)
 * rather than NAV/RAW's teardrop-gated display. Calling `Indicators`'
 * pipeline here would compute a polar x/y this screen never uses and
 * imply a relevance gate real map markers don't have — `Visibility`/`Geo`
 * are used directly instead, the same two dependencies `Indicators`
 * itself is built from, just without the parts specific to the other
 * display.
 *
 * **Camera**: reuses `NavigationCameraEvaluator`/`CameraAnchor` exactly as
 * `VcasMapRenderer.kt` does for the car Surface, but with `mode = "air"` —
 * the evaluator's flat, centred, low-pitch `AIR` preset (see that file's
 * `STATE_PRESETS`) is the right camera geometry for "glance at what's
 * around you while walking," not the driving-oriented urban/highway/turn
 * state machine `mode = "nav"` drives on the car side.
 *
 * **GPS/ADS-B**: the exact same `LocationManager`/`AdsbFiClient` pattern
 * `VcasMapRenderer.kt` already established and documented (plain
 * framework `LocationManager` over Play Services, `AdsbFiClient` calling
 * adsb.fi directly with no CORS relay needed) — `AdsbFiClient` itself has
 * zero `CarContext` dependency, so it's reused here completely unchanged,
 * not re-implemented.
 *
 * **Foreground-only, by design, not by oversight.** GPS/ADS-B start in
 * `onResume()` and stop in `onPause()` — matching the fact that this
 * activity only holds foreground-scoped `ACCESS_FINE_LOCATION`, not
 * `ACCESS_BACKGROUND_LOCATION` (still-undone "phase 4" work per CLAUDE.md's
 * own native-rewrite scoping note: a real background-tracking experience
 * needs a proper foreground `Service` with its own persistent notification,
 * not just an Activity that happens to still be resumed). The PWA's own
 * "don't pause on backgrounding" convention (see CLAUDE.md's "Power
 * efficiency pass") doesn't apply here — a backgrounded/screen-off phone
 * Activity genuinely stops receiving location updates on Android without
 * that foreground-service permission, so pausing explicitly is the
 * correct, honest behaviour for what's actually possible right now.
 *
 * **Known, deliberately-scoped simplifications for this first pass, not
 * silently-left gaps**: no own-position marker (the camera already
 * centres on the true GPS fix every update, in AIR's anchorX/anchorY =
 * 0.5/0.5); markers are fully cleared and rebuilt on every ADS-B poll
 * (3s) rather than diffed by hex the way the PWA's own `renderAirMarkers`
 * is — `MapLibreMap`'s classic `Marker`/`addMarker()` API used here is
 * itself marked `@Deprecated` in favour of a separate Annotation Plugin
 * Maven artifact (confirmed by reading `MapLibreMap.java` directly) that
 * isn't a current VCAS dependency; sticking with the still-functional,
 * already-available API rather than pulling in an unverified new
 * dependency for this first pass. No aircraft-position extrapolation
 * between polls (`AircraftExtrapolation.kt`, already ported/verified, is
 * not yet wired in here) and no per-category marker icon tinting (the
 * visibility category's own colour is included as plain text in each
 * marker's info-window snippet instead of a coloured icon bitmap). Each
 * is real, separately-scoped follow-up work, not an oversight.
 */
class MainActivity : Activity() {

    private val mapContainer by lazy { PhoneMapContainer(this) }
    private val cameraEvaluator = NavigationCameraEvaluator()

    private var statusText: TextView? = null
    private var locationUpdatesActive = false
    private var lastKnownBearingDeg = 0.0
    private var lastKnownLocation: Location? = null
    private val locationListener = LocationListenerCompat { location -> onLocationChanged(location) }

    private val adsbClient = AdsbFiClient(
        locationProvider = { lastKnownLocation },
        onAircraftUpdated = { aircraft -> onAircraftUpdated(aircraft) }
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)
        root.addView(mapContainer.createView(savedInstanceState), FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        val status = TextView(this).apply {
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#aa12181c"))
            setPadding(24, 16, 24, 16)
            text = "VCAS"
        }
        statusText = status
        root.addView(
            status,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START)
        )

        setContentView(root)

        if (!hasLocationPermission()) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), LOCATION_PERMISSION_REQUEST_CODE)
        }
    }

    override fun onStart() {
        super.onStart()
        mapContainer.onStart()
    }

    override fun onResume() {
        super.onResume()
        mapContainer.onResume()
        startLocationUpdatesIfPermitted()
    }

    override fun onPause() {
        stopLocationUpdates()
        mapContainer.onPause()
        super.onPause()
    }

    override fun onStop() {
        mapContainer.onStop()
        super.onStop()
    }

    override fun onDestroy() {
        mapContainer.onDestroy()
        super.onDestroy()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        mapContainer.onLowMemory()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        mapContainer.onSaveInstanceState(outState)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCATION_PERMISSION_REQUEST_CODE) {
            startLocationUpdatesIfPermitted()
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startLocationUpdatesIfPermitted() {
        if (locationUpdatesActive) return
        if (!hasLocationPermission()) {
            statusText?.text = "VCAS — location permission needed"
            return
        }
        val locationManager = getSystemService(LocationManager::class.java) ?: return
        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                LOCATION_UPDATE_MIN_TIME_MS,
                LOCATION_UPDATE_MIN_DISTANCE_M,
                locationListener
            )
            locationUpdatesActive = true
            adsbClient.start()
            statusText?.text = "VCAS — acquiring position…"
        } catch (e: SecurityException) {
            // The permission check above should make this unreachable —
            // kept as a safety net, same as VcasMapRenderer's own.
        }
    }

    private fun stopLocationUpdates() {
        if (!locationUpdatesActive) return
        getSystemService(LocationManager::class.java)?.removeUpdates(locationListener)
        locationUpdatesActive = false
        adsbClient.stop()
    }

    private fun onLocationChanged(location: Location) {
        lastKnownLocation = location
        if (location.hasBearing()) {
            lastKnownBearingDeg = location.bearing.toDouble()
        }
        val speedMph = if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0

        val mapView = mapContainer.mapViewInstance ?: return
        val width = mapView.width.toDouble()
        val height = mapView.height.toDouble()
        if (width <= 0.0 || height <= 0.0) return // not laid out yet; next fix will have real dimensions

        val ctx = NavigationCameraEvaluator.Ctx(
            mode = "air",
            routeActive = false,
            userLat = location.latitude,
            userLon = location.longitude,
            userSpeedMph = speedMph,
            viewportWidth = width,
            viewportHeight = height
        )
        val result = cameraEvaluator.evaluate(ctx)
        applyCameraResult(location, result, width, height)
    }

    private fun applyCameraResult(
        location: Location,
        result: NavigationCameraEvaluator.EvaluationResult,
        viewportWidth: Double,
        viewportHeight: Double
    ) {
        val map = mapContainer.mapLibreMapInstance ?: return

        val (left, right) = CameraAnchor.paddingForAnchor(result.anchorX, viewportWidth)
        val (top, bottom) = CameraAnchor.paddingForAnchor(result.anchorY, viewportHeight)

        // Same real native-SDK tilt ceiling VcasMapRenderer.kt already
        // documents — AIR's own preset pitch (0) never approaches it, but
        // clamping unconditionally keeps this path correct if that preset
        // ever changes.
        val tilt = result.pitch.coerceAtMost(MapLibreConstants.MAXIMUM_TILT)
        val zoom = result.zoom.coerceIn(MapLibreConstants.MINIMUM_ZOOM.toDouble(), MapLibreConstants.MAXIMUM_ZOOM.toDouble())

        val position = CameraPosition.Builder()
            .target(LatLng(location))
            .zoom(zoom)
            .tilt(tilt)
            .bearing(lastKnownBearingDeg)
            .padding(left, top, right, bottom)
            .build()

        map.easeCamera(CameraUpdateFactory.newCameraPosition(position), CAMERA_EASE_DURATION_MS)
    }

    private fun onAircraftUpdated(aircraft: List<AircraftExtrapolation.Aircraft>) {
        val map = mapContainer.mapLibreMapInstance ?: return
        val location = lastKnownLocation ?: return

        map.clear()
        for (a in aircraft) {
            val vis = Visibility.estimate(
                location.latitude, location.longitude,
                Visibility.AircraftInput(a.lat, a.lon, a.altitudeFt, a.type, a.category, a.lastSeenSeconds),
                metar = null
            )
            val distanceNm = Geo.calculateDistanceNm(location.latitude, location.longitude, a.lat, a.lon)
            val altText = a.altitudeFt?.let { "${it.roundToInt()} ft" } ?: "alt n/a"
            val title = (a.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: a.hex) + " · " + (a.type ?: "?")
            val snippet = "${vis.label} · $altText · ${"%.1f".format(distanceNm)} nm"

            map.addMarker(
                MarkerOptions()
                    .position(LatLng(a.lat, a.lon))
                    .title(title)
                    .snippet(snippet)
            )
        }
        statusText?.text = "VCAS — ${aircraft.size} aircraft in range"
    }

    companion object {
        private const val LOCATION_PERMISSION_REQUEST_CODE = 1001
        private const val LOCATION_UPDATE_MIN_TIME_MS = 1000L
        private const val LOCATION_UPDATE_MIN_DISTANCE_M = 1f
        private const val MPS_TO_MPH = 2.23694
        private const val CAMERA_EASE_DURATION_MS = 900
    }
}
