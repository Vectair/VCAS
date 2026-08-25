package org.vectair.vcas.car

import android.Manifest
import android.app.Presentation
import android.content.pm.PackageManager
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.constants.MapLibreConstants
import org.maplibre.android.geometry.LatLng
import org.vectair.vcas.car.logic.AircraftExtrapolation
import org.vectair.vcas.car.logic.CameraAnchor
import org.vectair.vcas.car.logic.NavigationCameraEvaluator

/**
 * Gets `VcasMapContainer`'s `MapView` onto the car's own Surface, and
 * (2026-08-25 follow-up) drives its camera off real GPS fixes via the
 * already-ported `NavigationCameraEvaluator`.
 *
 * Adapted from `CarMapRenderer.kt` in MapLibre's own official reference
 * (`maplibre/MapLibre-Android-Auto-Sample`, read directly, not guessed —
 * see `VcasMapContainer.kt`'s own doc comment for the full provenance).
 * The actual mechanism is standard Android framework API, nothing
 * MapLibre-specific: a `DisplayManager.createVirtualDisplay()` backed by
 * the car's own `Surface`, showing a plain `Presentation` whose content
 * view is `VcasMapContainer`'s real, ordinary `MapView` — Android's own
 * compositor does the actual work of getting that View hierarchy onto
 * the target Surface, no manual bitmap-blitting or MapLibre-internal
 * texture access needed (an older approach the reference's own README
 * still describes but its current source code has moved past — see
 * `VcasMapContainer.kt`'s doc comment on that staleness).
 *
 * **GPS/camera wiring (2026-08-25)**: uses plain `android.location.
 * LocationManager` (`LocationManager.GPS_PROVIDER`), not Play Services'
 * `FusedLocationProviderClient` — confirmed against Google's own official
 * navigation sample (`NavigationSession.java`), which uses the identical
 * API for the identical purpose. This needs no extra dependency at all
 * (unlike Play Services location, which is `dl.google.com`-hosted and
 * couldn't be verified reachable from this sandbox the way the plain
 * framework API doesn't need to be). Each fix feeds a `NavigationCameraEvaluator`
 * instance (owned per-renderer, matching that class's own doc comment on
 * why it's a stateful `class` rather than an `object`); the resulting
 * pitch/zoom/anchorX/anchorY drives a real `CameraPosition` via
 * `CameraAnchor.paddingForAnchor()` — see that file's own doc comment for
 * why MapLibre Native's own padding-based camera centering replaces the
 * PWA's manual per-frame animation workaround rather than porting it.
 *
 * **Known, honestly-scoped simplifications, not gaps quietly left
 * unmentioned**: `mode` is hardcoded `"nav"` (no AIR-mode-equivalent UI
 * exists in the native app yet) and `routeActive` is hardcoded `false`
 * (no routing wired up yet — phase 3's job). Camera bearing always
 * follows the GPS fix's own reported heading (`VEHICLE_TRACKING`); the
 * evaluator's `DECOUPLED_MANEUVER` bearing mode (a different, more
 * choreographed camera behaviour during `TURN_APPROACH`, which needs a
 * route to even reach that state) isn't specially handled yet since
 * nothing can reach that state without routing. Heading also comes only
 * from the GPS fix's own `hasBearing()`/`bearing` — the PWA's own
 * device-compass fallback below walking speed (`compassHeading.js`) has
 * no native port; CLAUDE.md's own scoping note already flags that file
 * as intentionally NOT portable (native Android would read a real
 * compass/orientation sensor directly), but wiring that sensor up is
 * itself still a real, separate, not-yet-done piece of work — until
 * then, the camera simply holds its last known GPS heading while
 * stationary rather than tracking device orientation.
 *
 * **ADS-B polling (2026-08-25 follow-up)**: owns an `AdsbFiClient`,
 * started/stopped alongside GPS updates (see `startLocationUpdatesIfPermitted()`/
 * `stopLocationUpdates()`) — see `AdsbFiClient.kt`'s own doc comment for
 * why it calls adsb.fi directly rather than through the PWA's CORS relay.
 * Deliberately scoped to just polling + normalising for now, not
 * rendering: `latestAircraft` is stored and logged so real polling is
 * independently observable/verifiable, but nothing yet feeds it through
 * `Indicators.build()`/`AircraftExtrapolation` or draws it on the map
 * surface — that's a separate, larger follow-up (see CLAUDE.md).
 */
class VcasMapRenderer(
    private val carContext: CarContext,
    serviceLifecycle: Lifecycle
) : SurfaceCallback, DefaultLifecycleObserver {

    private val mapContainer = VcasMapContainer(carContext)
    private val cameraEvaluator = NavigationCameraEvaluator()

    private var surfaceContainer: SurfaceContainer? = null
    private val uiHandler = Handler(Looper.getMainLooper())

    private var lastKnownStableArea = Rect()
    private var lastKnownVisibleArea = Rect()

    private var presentation: Presentation? = null
    private var virtualDisplay: VirtualDisplay? = null

    private var locationUpdatesActive = false
    private var lastKnownBearingDeg = 0.0
    private var lastKnownLocation: Location? = null
    private val locationListener = LocationListenerCompat { location -> onLocationChanged(location) }

    private var latestAircraft: List<AircraftExtrapolation.Aircraft> = emptyList()
    private val adsbClient = AdsbFiClient(
        locationProvider = { lastKnownLocation },
        onAircraftUpdated = { aircraft -> onAircraftUpdated(aircraft) }
    )

    init {
        serviceLifecycle.addObserver(this)
    }

    override fun onCreate(owner: LifecycleOwner) {
        super.onCreate(owner)
        try {
            carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        } catch (e: Exception) {
            Log.e(LOG_TAG, "Could not set surface callback", e)
        }
    }

    override fun onDestroy(owner: LifecycleOwner) {
        stopLocationUpdates()
        mapContainer.cleanUpMap()
        // The reference doesn't explicitly dismiss the Presentation or
        // release the VirtualDisplay here — a real (if minor, app-exit-
        // adjacent) resource-cleanup gap in the sample, not something
        // deliberately being deviated from without reason. Both are real
        // system resources with an explicit release API, so cleaning them
        // up here is a deliberate, low-risk addition, not a faithfulness
        // requirement being skipped.
        presentation?.dismiss()
        presentation = null
        virtualDisplay?.release()
        virtualDisplay = null
        surfaceContainer = null
        uiHandler.removeCallbacksAndMessages(null)
        try {
            carContext.getCarService(AppManager::class.java).setSurfaceCallback(null)
        } catch (e: Exception) {
            Log.e(LOG_TAG, "Could not remove surface callback", e)
        }
    }

    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        this.surfaceContainer = surfaceContainer
        val newVirtualDisplay = carContext
            .getSystemService(DisplayManager::class.java)
            .createVirtualDisplay(
                "VcasCarVirtualDisplay",
                surfaceContainer.width,
                surfaceContainer.height,
                surfaceContainer.dpi,
                surfaceContainer.surface,
                0
            )
        virtualDisplay = newVirtualDisplay
        val newPresentation = Presentation(carContext, newVirtualDisplay.display)
        presentation = newPresentation
        newPresentation.setContentView(mapContainer.setupMap())
        newPresentation.show()
        // Defensive, idempotent — VcasSession already calls this once
        // permission is known to be granted, but that can race ahead of
        // the surface itself becoming available; startLocationUpdatesIfPermitted()
        // no-ops if updates are already active or permission still isn't
        // granted, so calling it again here costs nothing and removes any
        // ordering assumption between the two.
        startLocationUpdatesIfPermitted()
    }

    override fun onVisibleAreaChanged(visibleArea: Rect) {
        if (visibleArea != lastKnownVisibleArea) {
            lastKnownVisibleArea = visibleArea
        }
    }

    override fun onStableAreaChanged(stableArea: Rect) {
        if (stableArea != lastKnownStableArea) {
            // If only the vertical space has changed (e.g. a bottom
            // action bar appearing/disappearing), this can mostly be
            // ignored — see the reference's own comment. VCAS's own
            // content (traffic overlay, once ported) will need to read
            // this once it exists, matching how the PWA already keeps
            // its own chrome-insets math (app.js's _rawChromeInsets) in
            // sync with what's actually drawable — not needed yet for a
            // bare map.
            lastKnownStableArea = stableArea
        }
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        this.surfaceContainer = null
        uiHandler.removeCallbacksAndMessages(null)
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        mapContainer.onScale(focusX, focusY, scaleFactor)
    }

    @Synchronized
    override fun onScroll(distanceX: Float, distanceY: Float) {
        mapContainer.scrollBy(distanceX, distanceY)
    }

    /**
     * Starts real GPS updates if `ACCESS_FINE_LOCATION` is granted and
     * updates aren't already flowing. Safe to call speculatively/
     * repeatedly — see call sites (`VcasSession`'s permission check,
     * `LocationPermissionScreen`'s grant callback, `onSurfaceAvailable`
     * above) for why more than one exists.
     */
    fun startLocationUpdatesIfPermitted() {
        if (locationUpdatesActive) return
        if (ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val locationManager = carContext.getSystemService(LocationManager::class.java) ?: return
        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                LOCATION_UPDATE_MIN_TIME_MS,
                LOCATION_UPDATE_MIN_DISTANCE_M,
                locationListener
            )
            locationUpdatesActive = true
            adsbClient.start()
        } catch (e: SecurityException) {
            // The permission check above should make this unreachable —
            // kept as a safety net, not a substitute for the check.
            Log.e(LOG_TAG, "Location permission check passed but request still threw", e)
        }
    }

    private fun stopLocationUpdates() {
        if (!locationUpdatesActive) return
        carContext.getSystemService(LocationManager::class.java)?.removeUpdates(locationListener)
        locationUpdatesActive = false
        adsbClient.stop()
    }

    private fun onAircraftUpdated(aircraft: List<AircraftExtrapolation.Aircraft>) {
        latestAircraft = aircraft
        val preview = aircraft.take(5).joinToString(", ") { it.hex }
        val suffix = if (aircraft.size > 5) ", …" else ""
        Log.i(LOG_TAG, "ADS-B: ${aircraft.size} aircraft in range" + if (aircraft.isEmpty()) "" else " ($preview$suffix)")
    }

    private fun onLocationChanged(location: Location) {
        lastKnownLocation = location
        if (location.hasBearing()) {
            lastKnownBearingDeg = location.bearing.toDouble()
        }
        val speedMph = if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0

        val surface = surfaceContainer ?: return
        val ctx = NavigationCameraEvaluator.Ctx(
            mode = "nav",
            routeActive = false,
            userLat = location.latitude,
            userLon = location.longitude,
            userSpeedMph = speedMph,
            viewportWidth = surface.width.toDouble(),
            viewportHeight = surface.height.toDouble()
        )
        val result = cameraEvaluator.evaluate(ctx)
        applyCameraResult(location, result, surface.width.toDouble(), surface.height.toDouble())
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

        // MapLibre Native's own MAXIMUM_TILT (60deg) is stricter than the
        // evaluator's generic 0-85 clamp (a web-MapLibre-GL-JS-era value —
        // see NavigationCameraEvaluator.kt's own doc comment on the pitch
        // clamp) — HIGHWAY_GUIDANCE's own base preset (60) sits exactly at
        // this native ceiling with zero headroom, so this second clamp is
        // a real, load-bearing safety net here, not a defensive formality:
        // building a CameraPosition with tilt > 60 would throw.
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

    companion object {
        private const val LOG_TAG = "VcasMapRenderer"
        private const val LOCATION_UPDATE_MIN_TIME_MS = 1000L
        private const val LOCATION_UPDATE_MIN_DISTANCE_M = 1f
        private const val MPS_TO_MPH = 2.23694
        // Comfortably under LOCATION_UPDATE_MIN_TIME_MS so one fix's
        // animation finishes before the next fix likely arrives, rather
        // than perpetually interrupting itself mid-ease.
        private const val CAMERA_EASE_DURATION_MS = 900
    }
}
