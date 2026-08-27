package org.vectair.vcas.car

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.UnderlineSpan
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.constants.MapLibreConstants
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.plugins.annotation.SymbolOptions
import org.maplibre.android.style.layers.Property
import org.vectair.vcas.car.logic.AircraftExtrapolation
import org.vectair.vcas.car.logic.CameraAnchor
import org.vectair.vcas.car.logic.Geo
import org.vectair.vcas.car.logic.Indicators
import org.vectair.vcas.car.logic.ManeuverTracker
import org.vectair.vcas.car.logic.NavigationCameraEvaluator
import org.vectair.vcas.car.logic.OrsProvider
import org.vectair.vcas.car.logic.RouteGeometry
import org.vectair.vcas.car.logic.Visibility
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Phone-side entry point — a genuinely functional standalone screen, not
 * the phase-1 placeholder this class used to be. Direct instruction
 * (2026-08-26): VCAS should work like Google Maps — independently useful
 * on the phone (walking) as well as car-projected via Android Auto
 * (`VcasCarAppService`/`VcasSession`/`MapScreen`, untouched by this work).
 *
 * **The three-mode structure (2026-08-26, same day, after real-device
 * feedback that a single AIR-only screen "doesn't look like VCAS at
 * all").** Direct instruction, restated in full because it reframes
 * everything below: "I want you to build this:
 * https://vectair.github.io/VCAS/ ... use where that part of the project
 * had reached before the move to an apk based app as the starting
 * point." The brief has always been three separate screens with three
 * different use cases, not one screen with three names:
 * - **RAW** — passive identification while moving, no nav needed: the
 *   PWA's actual RAW display (dark TCAS-style plot, compass tape, banded
 *   range rings, aircraft list panel), ported faithfully — see
 *   `RawPlotView.kt`/`RawAircraftListView.kt`'s own doc comments for the
 *   full design-review provenance (real `VCAS.css`/`ui.js` read before
 *   writing a line of Kotlin, not reconstructed from memory).
 * - **AIR** — stationary, 360° stripped-back ADS-B view: what this class
 *   already had before this pass (real MapLibre map, real markers,
 *   `mode="air"` flat camera) — unchanged by this entry, just now
 *   correctly understood as one of three, not the whole app.
 * - **HYBRID** — active navigation with aircraft overlaid: real routing
 *   (2026-08-27 follow-up, "the starting point for the apk version is
 *   the current state of the pwa"). Ports `src/routing/orsProvider.js`/
 *   `orsGeocoder.js`/`navigation/maneuverTracker.js` (as `OrsProvider.kt`/
 *   `OrsGeocoder.kt`/`ManeuverTracker.kt`, already ported+tested) and
 *   `app.js`'s `requestRouteTo`/`_checkOffRoute`/
 *   `_rerouteFromCurrentPosition`/`_updateGuidanceCard`/`_updateRouteCard`
 *   state machine into this class — see the "---- HYBRID navigation
 *   ----" section below for the full port writeup. Map markers/camera
 *   still share AIR's own `renderAirMarkers()`/`applyCameraResult()` —
 *   only `mode`/`routeActive`/`routeCoordinates` differ in the
 *   `NavigationCameraEvaluator.Ctx` passed in, matching how the PWA's
 *   own NAV/AIR modes already share most of their rendering machinery.
 *
 * **GPS/ADS-B**: the exact same `LocationManager`/`AdsbFiClient` pattern
 * `VcasMapRenderer.kt` already established (plain framework
 * `LocationManager` over Play Services; `AdsbFiClient` calling adsb.fi
 * directly, no CORS relay needed — it has zero `CarContext` dependency,
 * reused here completely unchanged). Both keep running regardless of
 * which of the three modes is showing — only the RENDERING branches by
 * `currentMode`, matching how the PWA's own underlying data polling is
 * continuous regardless of which display mode is selected.
 *
 * **Foreground-only, by design.** GPS/ADS-B start in `onResume()`, stop
 * in `onPause()` — this activity only holds foreground-scoped
 * `ACCESS_FINE_LOCATION`, not `ACCESS_BACKGROUND_LOCATION` (still-undone
 * "phase 4" work per CLAUDE.md's native-rewrite scoping note).
 *
 * **AIR mode markers use `SymbolManager`** (the `org.maplibre.gl:android-
 * plugin-annotation-v9` Maven Central artifact), not the classic,
 * `@Deprecated`, non-centering `MapLibreMap.addMarker()`/`Marker` API —
 * see `PhoneAircraftIcons.kt`'s own doc comment for the full reasoning
 * and the version-compatibility check done before adding it.
 *
 * **Known, deliberately-scoped simplifications, not silently-left
 * gaps**: no own-position marker in AIR/HYBRID (the camera already
 * centres on the true GPS fix); AIR/HYBRID symbols are cleared/rebuilt
 * each poll rather than diffed by hex; no `AircraftExtrapolation`
 * smoothing between polls anywhere yet; no Day/Night theming (this app
 * is always-dark, matching RAW's own "no day mode for a cockpit
 * instrument" precedent, extended app-wide since there's no settings
 * screen yet to host a toggle); RAW mode's aircraft-tap detail is a
 * plain `Toast`, not the PWA's real popup card (`#popup`) with its own
 * log/suppress buttons; HYBRID's destination picking is tap-the-map
 * only, not the PWA's full debounced name/address search UI
 * (`OrsGeocoder.kt` is ported and tested, just not wired to a search box
 * yet); HYBRID's route line is one plain `LineLayer`, not the PWA's own
 * 3-layer glow/line/highlight polyline; `TURN_APPROACH`'s
 * `DECOUPLED_MANEUVER` bearing mode is computed by
 * `NavigationCameraEvaluator` but not yet consumed — the camera bearing
 * always follows the raw GPS fix bearing, same as AIR. Each is real,
 * separately-scoped follow-up work, not silently skipped.
 */
class MainActivity : Activity() {

    private val mapContainer by lazy { PhoneMapContainer(this) }
    private val cameraEvaluator = NavigationCameraEvaluator()

    private var statusText: TextView? = null
    private var locationUpdatesActive = false
    private var lastKnownBearingDeg = 0.0
    private var lastKnownLocation: Location? = null
    private var latestAircraft: List<AircraftExtrapolation.Aircraft> = emptyList()
    private val locationListener = LocationListenerCompat { location -> onLocationChanged(location) }

    private val adsbClient = AdsbFiClient(
        locationProvider = { lastKnownLocation },
        onAircraftUpdated = { aircraft -> onAircraftUpdated(aircraft) }
    )

    // Symbol.id -> title/snippet text for AIR/HYBRID's map markers — see
    // this class's own doc comment on why SymbolManager needs this
    // (unlike the classic Marker API's built-in info window).
    private val symbolInfoById = mutableMapOf<Long, String>()
    private var symbolClickListenerWired = false

    // ---- Mode + RAW-mode state ----
    private var currentMode = "raw" // "raw" | "air" | "hybrid" — RAW default, matching the PWA's own.
    private var selectedRangeIndex = Indicators.RING_BANDS_NM.indexOf(10.0).let { if (it < 0) Indicators.RING_BANDS_NM.size - 1 else it }
    private var rawSortMode = "priority"
    private var selectedHex: String? = null

    private var topBarView: View? = null
    private var modeToggleBar: View? = null
    private var mapContentView: View? = null
    private lateinit var rawPlotView: RawPlotView
    private lateinit var rawListView: RawAircraftListView
    private val modeButtons = mutableMapOf<String, TextView>()

    // ---- HYBRID navigation state (2026-08-27) ----
    private var guidanceCardView: View? = null
    private var guidanceText: TextView? = null
    private var etaText: TextView? = null
    private var cancelRouteButton: View? = null

    private var activeRoute: OrsProvider.Route? = null
    private var routeDestLat: Double? = null
    private var routeDestLon: Double? = null
    private var rerouteInFlight = false
    private var routeRequestToken = 0
    private var offRouteSinceMs: Long? = null

    private val routeExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)

        val mapView = mapContainer.createView(savedInstanceState)
        mapContentView = mapView
        root.addView(mapView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        rawPlotView = RawPlotView(this).apply {
            onAircraftTap = { item -> onRawAircraftTap(item) }
            onRangeButtonTap = { onRawRangeCycle() }
            onEmptyTap = { selectedHex = null }
        }
        root.addView(rawPlotView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        rawListView = RawAircraftListView(this).apply {
            onSortClick = { mode -> rawSortMode = mode; refreshRawMode() }
            onRowClick = { item -> selectedHex = item.aircraft.hex; onRawAircraftTap(item) }
        }
        root.addView(rawListView, FrameLayout.LayoutParams(0, 0)) // sized/positioned per-frame in refreshRawMode()

        // Top bar + HYBRID's guidance card stacked in one vertical group so
        // the card sits directly below the bar rather than both fighting
        // over the same Gravity.TOP position independently.
        val topStack = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val topBar = buildTopBar()
        topBarView = topBar
        topStack.addView(topBar)
        val guidanceCard = buildGuidanceCard()
        guidanceCardView = guidanceCard
        topStack.addView(guidanceCard)
        root.addView(
            topStack,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP)
        )

        val toggleBar = buildModeToggleBar()
        modeToggleBar = toggleBar
        root.addView(
            toggleBar,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM)
        )

        setContentView(root)
        applyModeVisibility()
        updateGuidanceCard()

        // Tap-to-set-destination — HYBRID mode only, gated inside
        // onMapTapped() itself (registered once here since the real
        // MapLibreMap doesn't exist yet at onCreate() time; PhoneMapContainer
        // queues it via onMapReady() until the map is actually ready).
        mapContainer.onMapReady { map ->
            map.addOnMapClickListener { point -> onMapTapped(point) }
        }

        if (!hasLocationPermission()) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), LOCATION_PERMISSION_REQUEST_CODE)
        }
    }

    /**
     * HYBRID's guidance/ETA card — a Kotlin-chrome equivalent of the PWA's
     * `#guidance-card`+`#route-card` (`app.js`'s `_updateGuidanceCard()`/
     * `_updateRouteCard()`), collapsed into one card rather than two
     * separate DOM elements: a top row (next-maneuver instruction or a
     * "tap the map" hint, + a ✕ cancel button) and a mono-font ETA/
     * distance line below it. Hidden outside HYBRID mode entirely — see
     * `updateGuidanceCard()`.
     */
    private fun buildGuidanceCard(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL_ALT))
            setPadding(28, 14, 28, 14)
            visibility = View.GONE
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val guidance = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 15f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        }
        guidanceText = guidance
        val cancel = TextView(this).apply {
            text = "✕"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 18f
            setPadding(24, 0, 0, 0)
            visibility = View.GONE
            setOnClickListener { clearActiveRoute() }
        }
        cancelRouteButton = cancel
        row.addView(guidance, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(cancel)

        val eta = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.mono(this@MainActivity)
            setPadding(0, 6, 0, 0)
        }
        etaText = eta

        card.addView(row)
        card.addView(eta)
        return card
    }

    /**
     * Two-line top bar (title + live status) styled with VCAS's real
     * cockpit-panel palette — see `VcasPalette.kt`'s own doc comment.
     * Deliberately NOT the PWA's full top bar (ADS-B status pill,
     * settings gear) — no settings screen exists natively yet. The
     * adsb.fi credit line IS included now (2026-08-27 follow-up) — see
     * `buildAdsbCreditLine()`'s own doc comment for why this one specific
     * piece couldn't stay deferred the way the rest of the top bar could.
     */
    private fun buildTopBar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL))
            setPadding(28, 20, 28, 14)
        }
        val title = TextView(this).apply {
            text = "VCAS"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 20f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        }
        val status = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            setPadding(0, 4, 0, 0)
            typeface = VcasFonts.display(this@MainActivity)
            text = "Acquiring position…"
        }
        statusText = status
        bar.addView(title)
        bar.addView(status)
        bar.addView(buildAdsbCreditLine())

        val accentRule = View(this).apply { setBackgroundColor(VcasPalette.parse(VcasPalette.ACCENT)) }
        val wrapper = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        wrapper.addView(bar)
        wrapper.addView(accentRule, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 3))
        return wrapper
    }

    /**
     * adsb.fi attribution (2026-08-27) — same real requirement CLAUDE.md's
     * Pre-V1 checklist and "How VCAS is actually installed" sections
     * already document at length for the PWA: adsb.fi's usage terms
     * require an ONGOING citation with a link to their homepage for as
     * long as their data is displayed, not a one-time acknowledgment —
     * this is why the PWA places it in its persistent top bar
     * (`#adsb-credit`, `index.html`) rather than a splash screen shown
     * once. Every other piece of the PWA's top bar (ADS-B status pill,
     * settings gear) was fair to defer since this app has no settings
     * screen yet to gate them behind — this one piece couldn't wait,
     * since this screen has been polling and displaying adsb.fi's data
     * since the very first phase-1 pass with no citation anywhere.
     *
     * Exact wording matches the PWA's own real markup
     * (`index.html`: `Data: <a href="https://adsb.fi">adsb.fi</a>`), not
     * a paraphrase — only the "adsb.fi" substring is underlined/tappable,
     * mirroring the PWA's own anchor-only-around-the-name link, opened via
     * a plain `ACTION_VIEW` intent to their real homepage.
     */
    private fun buildAdsbCreditLine(): View {
        val full = "Data: adsb.fi"
        val linkStart = full.indexOf("adsb.fi")
        val spannable = SpannableString(full).apply {
            setSpan(UnderlineSpan(), linkStart, full.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return TextView(this).apply {
            text = spannable
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 11f
            setPadding(0, 4, 0, 0)
            typeface = VcasFonts.display(this@MainActivity)
            setOnClickListener {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://adsb.fi")))
                } catch (e: Exception) {
                    // No browser available to handle the intent — not fatal,
                    // the credit text itself is still visibly present either way.
                }
            }
        }
    }

    /**
     * RAW/AIR/HYBRID segmented control — a Kotlin port of `VCAS.css`'s
     * `.mode-toggle`/`.mode-btn` styling (flat segments in one bevelled
     * bank, active segment gets `--btn-active-bg`), matching the PWA's
     * own button order and RAW-default (see CLAUDE.md's "RAW as default"
     * entry) rather than inventing a new order.
     */
    private fun buildModeToggleBar(): View {
        val outer = LinearLayout(this).apply {
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL))
            setPadding(14, 10, 14, 20)
        }
        val toggle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.BTN_BG))
                cornerRadius = 10f
            }
        }
        listOf("raw" to "RAW", "air" to "AIR", "hybrid" to "HYBRID").forEach { (mode, label) ->
            val btn = TextView(this).apply {
                text = label
                gravity = Gravity.CENTER
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
                textSize = 11f
                typeface = VcasFonts.display(this@MainActivity, bold = true)
                setPadding(28, 22, 28, 22)
                setOnClickListener { switchMode(mode) }
            }
            modeButtons[mode] = btn
            toggle.addView(btn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        outer.addView(toggle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        updateModeButtonHighlight()
        return outer
    }

    private fun updateModeButtonHighlight() {
        modeButtons.forEach { (mode, btn) ->
            val active = mode == currentMode
            btn.setBackgroundColor(if (active) VcasPalette.parse(VcasPalette.BTN_ACTIVE_BG) else Color.TRANSPARENT)
        }
    }

    /**
     * HYBRID's map/marker rendering still falls through to AIR's own
     * `renderAirMarkers()`/`applyCameraResult()` — only the
     * `NavigationCameraEvaluator.Ctx` fed to the shared camera code
     * differs (`updateHybridCamera()` vs `updateAirCamera()`), matching
     * how the PWA's own NAV/AIR modes already share most of their
     * rendering machinery rather than duplicating it. A route started in
     * HYBRID keeps running (GPS/off-route checks) in the background even
     * while RAW/AIR are showing — only the guidance card's own visibility
     * is mode-gated, see `updateGuidanceCard()`.
     */
    private fun switchMode(mode: String) {
        if (mode == currentMode) return
        currentMode = mode
        selectedHex = null
        updateModeButtonHighlight()
        applyModeVisibility()
        updateGuidanceCard()
        if (mode == "raw") refreshRawMode()
    }

    private fun applyModeVisibility() {
        val showRaw = currentMode == "raw"
        rawPlotView.visibility = if (showRaw) View.VISIBLE else View.GONE
        rawListView.visibility = if (showRaw) View.VISIBLE else View.GONE
        mapContentView?.visibility = if (showRaw) View.GONE else View.VISIBLE
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
        routeExecutor.shutdownNow()
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
            statusText?.text = "Location permission needed"
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
            statusText?.text = "Acquiring position…"
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

        when (currentMode) {
            "raw" -> refreshRawMode()
            "hybrid" -> {
                checkOffRoute(location)
                updateHybridCamera(location)
                updateGuidanceCard()
            }
            else -> updateAirCamera(location)
        }
    }

    private fun updateAirCamera(location: Location) {
        val mapView = mapContainer.mapViewInstance ?: return
        val width = mapView.width.toDouble()
        val height = mapView.height.toDouble()
        if (width <= 0.0 || height <= 0.0) return // not laid out yet; next fix will have real dimensions

        val speedMph = if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0
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

    /**
     * HYBRID's own camera update — `mode="nav"` (not `"air"`) with
     * `routeActive`/`routeCoordinates` fed from `activeRoute`, so
     * `NavigationCameraEvaluator`'s urban/highway/turn state machine
     * actually engages once a route exists (this is the first place in
     * either native project — car side or phone side — this state
     * machine runs off a REAL route rather than `routeActive=false`
     * always forcing `NAV_IDLE`). With no active route it still evaluates
     * `NAV_IDLE`'s own flat preset, a reasonable "just show me the map,
     * north/heading-up" default while a destination hasn't been picked
     * yet — matching the PWA's own NAV_IDLE behaviour before a route is
     * requested.
     */
    private fun updateHybridCamera(location: Location) {
        val mapView = mapContainer.mapViewInstance ?: return
        val width = mapView.width.toDouble()
        val height = mapView.height.toDouble()
        if (width <= 0.0 || height <= 0.0) return

        val speedMph = if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0
        val ctx = NavigationCameraEvaluator.Ctx(
            mode = "nav",
            routeActive = activeRoute != null,
            routeCoordinates = activeRoute?.geometry,
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
        latestAircraft = aircraft
        statusText?.text = "${aircraft.size} aircraft in range"

        if (currentMode == "raw") {
            refreshRawMode()
        } else {
            renderAirMarkers(aircraft)
        }
    }

    private fun renderAirMarkers(aircraft: List<AircraftExtrapolation.Aircraft>) {
        val symbolManager = mapContainer.symbolManagerInstance ?: return
        val style = mapContainer.mapLibreMapInstance?.style ?: return
        val location = lastKnownLocation ?: return

        if (!symbolClickListenerWired) {
            symbolManager.addClickListener { symbol ->
                symbolInfoById[symbol.id]?.let { Toast.makeText(this, it, Toast.LENGTH_LONG).show() }
                true
            }
            symbolClickListenerWired = true
        }

        symbolManager.deleteAll()
        symbolInfoById.clear()

        val optionsWithInfo = aircraft.map { a ->
            val vis = Visibility.estimate(
                location.latitude, location.longitude,
                Visibility.AircraftInput(a.lat, a.lon, a.altitudeFt, a.type, a.category, a.lastSeenSeconds),
                metar = null
            )
            val distanceNm = Geo.calculateDistanceNm(location.latitude, location.longitude, a.lat, a.lon)
            val altText = a.altitudeFt?.let { "${it.roundToInt()} ft" } ?: "alt n/a"
            val title = (a.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: a.hex) + " · " + (a.type ?: "?")
            val info = "$title\n${vis.label} · $altText · ${"%.1f".format(distanceNm)} nm"

            val iconName = PhoneAircraftIcons.iconNameFor(vis.shape, vis.color, vis.fillOpacity, a.trackDeg)
            if (style.getImage(iconName) == null) {
                style.addImage(iconName, PhoneAircraftIcons.bitmapFor(vis.shape, vis.color, vis.fillOpacity, a.trackDeg))
            }

            val options = SymbolOptions()
                .withLatLng(LatLng(a.lat, a.lon))
                .withIconImage(iconName)
                .withIconAnchor(Property.ICON_ANCHOR_CENTER)
            options to info
        }

        val symbols = symbolManager.create(optionsWithInfo.map { it.first })
        symbols.forEachIndexed { index, symbol -> symbolInfoById[symbol.id] = optionsWithInfo[index].second }
    }

    // ---- HYBRID navigation: real routing, a structural port of app.js's
    // requestRouteTo()/clearActiveRoute()/_checkOffRoute()/
    // _rerouteFromCurrentPosition()/_updateGuidanceCard()/
    // _updateRouteCard() onto OrsProvider.kt/RouteGeometry.kt/
    // ManeuverTracker.kt (already ported+tested, see CLAUDE.md's dated
    // entries for each) — read straight through in full before writing
    // this, per the standing "the pwa is the starting point" instruction. ----

    /**
     * Tap-to-set-destination — HYBRID mode only, and only before a route
     * exists (cancel the active one via the guidance card's ✕ first, same
     * "one destination at a time" shape the PWA's own `requestRouteTo()`
     * has). Deliberately does NOT offer the PWA's full debounced name/
     * address search UI in this pass — `OrsGeocoder.kt` is ported and
     * tested, just not wired to a search box yet, a real, separately-
     * scoped follow-up (see this class's own "Known simplifications" doc
     * comment).
     */
    private fun onMapTapped(point: LatLng): Boolean {
        if (currentMode != "hybrid" || activeRoute != null) return false
        requestRouteTo(point.latitude, point.longitude)
        return true
    }

    private fun requestRouteTo(destLat: Double, destLon: Double) {
        val origin = lastKnownLocation
        if (origin == null) {
            Toast.makeText(this, "Waiting for a GPS fix before routing…", Toast.LENGTH_SHORT).show()
            return
        }
        routeDestLat = destLat
        routeDestLon = destLon
        performRouteRequest(origin.latitude, origin.longitude, destLat, destLon) {
            Toast.makeText(this, "Couldn't find a route", Toast.LENGTH_SHORT).show()
            routeDestLat = null
            routeDestLon = null
        }
    }

    /**
     * Off-route recovery — keeps the SAME `routeDestLat`/`routeDestLon`
     * (unlike `requestRouteTo()`, which sets them), matching
     * `_rerouteFromCurrentPosition()`'s own "re-request from the user's
     * current position toward the still-unchanged destination" contract.
     */
    private fun rerouteFromCurrentPosition() {
        if (rerouteInFlight) return
        val destLat = routeDestLat ?: return
        val destLon = routeDestLon ?: return
        val origin = lastKnownLocation ?: return
        performRouteRequest(origin.latitude, origin.longitude, destLat, destLon) {
            // A failed reroute doesn't retry next tick — restart the dwell
            // timer from now, same as app.js's own _rerouteFromCurrentPosition(),
            // to avoid hammering ORS every ~1s while genuinely off-route and failing.
            offRouteSinceMs = System.currentTimeMillis()
        }
    }

    /**
     * Shared by both `requestRouteTo()` and `rerouteFromCurrentPosition()`
     * — a real background network call (`OrsProvider.getRoute()`, plain
     * blocking `HttpURLConnection`, same reasoning as `AdsbFiClient.kt`'s
     * own single-thread executor: this would throw
     * `NetworkOnMainThreadException` run inline). `routeRequestToken` is
     * captured before dispatch and checked after the response lands — the
     * same stale-response guard `app.js`'s own `_routeRequestToken`
     * provides, so a slow, now-superseded request (the user cleared the
     * route, or tapped a different destination, while this one was still
     * in flight) can't clobber newer state.
     */
    private fun performRouteRequest(
        originLat: Double,
        originLon: Double,
        destLat: Double,
        destLon: Double,
        onFailure: () -> Unit
    ) {
        val token = ++routeRequestToken
        rerouteInFlight = true
        updateGuidanceCard()
        routeExecutor.execute {
            val route = OrsProvider.getRoute(ORS_API_KEY, "driving", originLat, originLon, destLat, destLon)
            mainHandler.post {
                if (token != routeRequestToken) return@post // superseded — discard
                rerouteInFlight = false
                if (route == null) {
                    onFailure()
                    updateGuidanceCard()
                    return@post
                }
                activeRoute = route
                offRouteSinceMs = null
                mapContainer.updateRouteLine(route.geometry)
                updateGuidanceCard()
            }
        }
    }

    private fun clearActiveRoute() {
        routeRequestToken++ // discards any in-flight request/response
        activeRoute = null
        routeDestLat = null
        routeDestLon = null
        rerouteInFlight = false
        offRouteSinceMs = null
        mapContainer.updateRouteLine(null)
        updateGuidanceCard()
    }

    /**
     * A structural port of `_checkOffRoute()` — the user's real
     * perpendicular distance to the route polyline (via
     * `RouteGeometry.nearestOnLine()` + `Geo.calculateDistanceMeters()`),
     * a deliberately different question from what `ManeuverTracker`'s own
     * "distance along the route" always answers regardless of how far
     * away the nearest point really is. `offRouteSinceMs` tracks when the
     * user was FIRST found beyond the threshold, reset to null the moment
     * they're back within it — a real deviation has to persist
     * continuously for the full dwell delay before a reroute actually
     * fires, matching `OFF_ROUTE_THRESHOLD_METERS`/
     * `OFF_ROUTE_REROUTE_DELAY_SECONDS` from `src/config.js`.
     */
    private fun checkOffRoute(location: Location) {
        val route = activeRoute ?: return
        if (rerouteInFlight) return

        val nearest = RouteGeometry.nearestOnLine(route.geometry, location.longitude, location.latitude)
        val perpendicularMeters = Geo.calculateDistanceMeters(
            location.latitude, location.longitude,
            nearest.point[1], nearest.point[0]
        )
        val now = System.currentTimeMillis()
        if (perpendicularMeters > OFF_ROUTE_THRESHOLD_METERS) {
            val since = offRouteSinceMs
            if (since == null) {
                offRouteSinceMs = now
            } else if (now - since >= OFF_ROUTE_REROUTE_DELAY_MS) {
                rerouteFromCurrentPosition()
            }
        } else {
            offRouteSinceMs = null
        }
    }

    /**
     * A structural port of `_updateGuidanceCard()`/`_updateRouteCard()`,
     * merged into the one card `buildGuidanceCard()` builds. Hidden
     * entirely outside HYBRID mode — a route started in HYBRID keeps
     * running in the background while RAW/AIR are showing (see
     * `switchMode()`'s own doc comment), it just isn't displayed until
     * the user switches back.
     */
    private fun updateGuidanceCard() {
        val card = guidanceCardView ?: return
        if (currentMode != "hybrid") {
            card.visibility = View.GONE
            return
        }
        card.visibility = View.VISIBLE

        val route = activeRoute
        if (route == null) {
            guidanceText?.text = if (rerouteInFlight) "Finding route…" else "Tap the map to set a destination"
            etaText?.text = ""
            cancelRouteButton?.visibility = View.GONE
            return
        }
        cancelRouteButton?.visibility = View.VISIBLE

        val location = lastKnownLocation
        guidanceText?.text = when {
            rerouteInFlight -> "Rerouting…"
            location == null -> "Head to destination"
            else -> {
                val next = ManeuverTracker.nextManeuver(route.geometry, route.steps, location.longitude, location.latitude)
                if (next.exists) {
                    "${next.instruction ?: "Continue"} — ${fmtDistance(next.distanceMeters ?: 0.0)}"
                } else {
                    "Head to destination"
                }
            }
        }

        if (location != null) {
            val nearest = RouteGeometry.nearestOnLine(route.geometry, location.longitude, location.latitude)
            val remainingMeters = RouteGeometry.distanceToIndex(route.geometry, nearest.segIdx, nearest.t, route.geometry.size - 1)
            val fraction = if (route.distanceMeters > 0) (remainingMeters / route.distanceMeters).coerceIn(0.0, 1.0) else 0.0
            val remainingSeconds = route.durationSeconds * fraction
            val arrivalMs = System.currentTimeMillis() + (remainingSeconds * 1000).toLong()
            etaText?.text = "${fmtDistance(remainingMeters)} · ${fmtDuration(remainingSeconds)} · ETA ${fmtClock(arrivalMs)}"
        }
    }

    // ---- Numerical utilities — ports of app.js's own _fmtDistance/_fmtDuration ----

    private fun fmtDistance(meters: Double): String =
        if (meters >= 1000) "%.1f km".format(meters / 1000.0) else "${meters.roundToInt()} m"

    private fun fmtDuration(seconds: Double): String {
        val m = (seconds / 60.0).roundToInt()
        return if (m >= 60) "${m / 60} h ${m % 60} m" else "$m min"
    }

    private fun fmtClock(epochMs: Long): String {
        val cal = java.util.Calendar.getInstance().apply { timeInMillis = epochMs }
        val hh = cal.get(java.util.Calendar.HOUR_OF_DAY).toString().padStart(2, '0')
        val mm = cal.get(java.util.Calendar.MINUTE).toString().padStart(2, '0')
        return "$hh:$mm"
    }

    // ---- RAW mode: drives RawPlotView/RawAircraftListView off the exact
    // same Indicators.build() pipeline Geo/Visibility/Relevance/
    // AircraftExtrapolation already back — see CLAUDE.md's dated entry
    // for the full port writeup (constants/formulas match app.js's
    // refreshIndicators()/onRawRangeCycleClick()/_sortForRawList() 1:1). ----

    private fun refreshRawMode() {
        val location = lastKnownLocation ?: return
        if (rawPlotView.width <= 0 || rawPlotView.height <= 0) return // not laid out yet

        val vw = rawPlotView.width.toDouble()
        val vh = rawPlotView.height.toDouble()
        val speedMph = if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0
        val heading = if (location.hasBearing()) location.bearing.toDouble() else lastKnownBearingDeg

        val density = resources.displayMetrics.density
        val chromeTopInset = ((topBarView?.height ?: (56 * density).toInt())).toDouble()
        val bottomInset = ((modeToggleBar?.height ?: (60 * density).toInt())).toDouble()
        val squareContentTop = chromeTopInset + RAW_COMPASS_RESERVED_DP * density
        val squareContentHeight = (vh - squareContentTop - bottomInset).coerceAtLeast(0.0)

        val square = Geo.computeSquarePlotLayout(vw, squareContentTop, squareContentHeight)

        val activeBandsNm = Indicators.RING_BANDS_NM.subList(0, selectedRangeIndex + 1)
        val selectedRangeNm = activeBandsNm.last()
        val anchorY = NavigationCameraEvaluator.STATE_PRESETS.getValue("NAV_RAW").anchorY

        val userState = Indicators.UserState(
            lat = location.latitude,
            lon = location.longitude,
            heading = heading,
            speedMph = speedMph,
            viewportWidth = vw,
            viewportHeight = vh,
            anchorY = anchorY,
            fovHalfAngleDeg = Indicators.FOV_HALF_ANGLE_DEG,
            plotWidth = square.squareSize,
            plotHeight = square.squareSize,
            plotOffsetX = square.squareLeft,
            plotOffsetY = square.squareTop,
            plotSafeInset = SQUARE_EDGE_MARGIN_DP * density,
            plotBandsNm = activeBandsNm
        )

        val allRelevant = Indicators.build(latestAircraft, userState, STALE_THRESHOLD_SECONDS, null)
            .filter { it.x != null }

        val withinRange = allRelevant.filter { it.vis.slantRangeNm <= selectedRangeNm }
        val beyondRange = allRelevant.filter { it.vis.slantRangeNm > selectedRangeNm }
        val beyondRangeHexes = beyondRange.map { it.aircraft.hex }.toSet()

        // Same viewport-tiered display cap the PWA's own refreshIndicators()
        // applies to the PLOT specifically (never the list panel, which
        // always shows the full relevant set — see below) — withinRange is
        // already priority-sorted, so this keeps the highest-scoring
        // aircraft. Deliberately not porting the PWA's own "tap to cycle
        // to the next page" interaction in this pass — always showing the
        // top-priority page is a reasonable, honest simplification, not a
        // silent behavioural gap (paging further is a real, separate
        // follow-up if the aircraft count in a busy area warrants it).
        val cap = Indicators.capForViewportWidth(vw)
        val shownOnPlot = withinRange.take(cap)

        rawPlotView.update(
            withinRange = shownOnPlot,
            beyondRange = beyondRange,
            headingDeg = heading,
            speedMph = speedMph,
            routeInfo = null, // no routing anywhere in this native project yet
            square = square,
            anchorY = anchorY,
            bandsNm = activeBandsNm,
            selectedRangeNm = selectedRangeNm,
            selectedHex = selectedHex,
            chromeTopInsetPx = chromeTopInset.toFloat()
        )

        rawListView.let { list ->
            val lp = list.layoutParams as FrameLayout.LayoutParams
            lp.width = square.rows.width.toInt()
            lp.height = square.rows.height.toInt()
            lp.leftMargin = square.rows.left.toInt()
            lp.topMargin = square.rows.top.toInt()
            list.layoutParams = lp
            list.visibility = if (square.rows.width < MIN_LIST_PANEL_WIDTH_DP * density || square.rows.height < MIN_LIST_PANEL_HEIGHT_DP * density) {
                View.GONE
            } else {
                View.VISIBLE
            }
        }
        val sortedForList = sortForRawList(allRelevant, rawSortMode)
        rawListView.update(sortedForList, rawSortMode, beyondRangeHexes, selectedHex)
    }

    private fun sortForRawList(items: List<Indicators.IndicatorItem>, mode: String): List<Indicators.IndicatorItem> {
        return when (mode) {
            "range" -> items.sortedBy { it.distanceNm }
            // Explicit null handling (unknown altitude sorts last, not first) —
            // matches app.js's own _sortForRawList exactly, same reasoning as
            // avoiding a generic nullsLast() comparator: this is more
            // transparent and mirrors the JS original's own explicit branches.
            "altitude" -> items.sortedWith { a, b ->
                val aAlt = a.aircraft.altitudeFt
                val bAlt = b.aircraft.altitudeFt
                when {
                    aAlt == null && bAlt == null -> 0
                    aAlt == null -> 1
                    bAlt == null -> -1
                    else -> aAlt.compareTo(bAlt)
                }
            }
            "type" -> items.sortedBy { it.aircraft.type ?: it.aircraft.callsign ?: "" }
            else -> items // "priority" — already sorted by Indicators.build()
        }
    }

    private fun onRawRangeCycle() {
        selectedRangeIndex = (selectedRangeIndex + 1) % Indicators.RING_BANDS_NM.size
        refreshRawMode()
    }

    private fun onRawAircraftTap(item: Indicators.IndicatorItem) {
        selectedHex = item.aircraft.hex
        val a = item.aircraft
        val altText = a.altitudeFt?.let { "${it.roundToInt()} ft" } ?: "alt n/a"
        val title = (a.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: a.hex) + " · " + (a.type ?: "?")
        Toast.makeText(this, "$title\n${item.vis.label} · $altText · ${"%.1f".format(item.distanceNm)} nm", Toast.LENGTH_LONG).show()
        refreshRawMode()
    }

    companion object {
        private const val LOCATION_PERMISSION_REQUEST_CODE = 1001
        private const val LOCATION_UPDATE_MIN_TIME_MS = 1000L
        private const val LOCATION_UPDATE_MIN_DISTANCE_M = 1f
        private const val MPS_TO_MPH = 2.23694
        private const val CAMERA_EASE_DURATION_MS = 900

        // Matches app.js's own RAW_COMPASS_RESERVED_PX/SQUARE_EDGE_MARGIN_PX —
        // fixed worst-case values, not live-measured, for the same reason:
        // the square's own contentTop is derived from these, so measuring
        // the compass tape itself first (which is drawn using the square's
        // contentTop) would be circular.
        private const val RAW_COMPASS_RESERVED_DP = 80f
        private const val SQUARE_EDGE_MARGIN_DP = 16f
        private const val MIN_LIST_PANEL_WIDTH_DP = 90f
        private const val MIN_LIST_PANEL_HEIGHT_DP = 70f
        private const val STALE_THRESHOLD_SECONDS = 15.0 // matches CONFIG.STALE_THRESHOLD_SECONDS in the PWA (src/config.js)

        // Off-route dwell-timer constants, matching CONFIG.OFF_ROUTE_THRESHOLD_METERS/
        // OFF_ROUTE_REROUTE_DELAY_SECONDS in src/config.js exactly (50m / 6s).
        private const val OFF_ROUTE_THRESHOLD_METERS = 50.0
        private const val OFF_ROUTE_REROUTE_DELAY_MS = 6000L

        // Duplicated from src/config.js's CONFIG.ORS_API_KEY — same "no
        // build-time bridge to the PWA's own JS config" reasoning already
        // established for PhoneMapContainer's MAPTILER_KEY. Keep in sync
        // by hand if the key ever rotates.
        private const val ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjM1NzZmMDA4Nzc2OTQ3YzdiYjcwZWFjYzIzMDgwYTIwIiwiaCI6Im11cm11cjY0In0="
    }
}
