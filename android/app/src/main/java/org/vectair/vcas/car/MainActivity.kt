package org.vectair.vcas.car

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
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
import org.vectair.vcas.car.logic.NavigationCameraEvaluator
import org.vectair.vcas.car.logic.Visibility
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
 * - **HYBRID** — active navigation with aircraft overlaid: NOT built yet.
 *   Real routing/turn-by-turn doesn't exist anywhere in this native
 *   project (car side or phone side), so for now the HYBRID button
 *   deliberately reuses the exact same AIR rendering path rather than
 *   shipping a distinct broken/fake screen — see `switchMode()`'s own
 *   comment. A real, separately-scoped follow-up, not silently skipped.
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
 * log/suppress buttons — a real, separate follow-up. Each is real,
 * separately-scoped follow-up work.
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

        val topBar = buildTopBar()
        topBarView = topBar
        root.addView(
            topBar,
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

        if (!hasLocationPermission()) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), LOCATION_PERMISSION_REQUEST_CODE)
        }
    }

    /**
     * Two-line top bar (title + live status) styled with VCAS's real
     * cockpit-panel palette — see `VcasPalette.kt`'s own doc comment.
     * Deliberately NOT the PWA's full top bar (ADS-B status pill,
     * settings gear, adsb.fi credit line) — `#adsb-credit` in particular
     * is still owed here before this screen could ever ship beyond
     * personal use, see CLAUDE.md's Pre-V1 checklist entry.
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

        val accentRule = View(this).apply { setBackgroundColor(VcasPalette.parse(VcasPalette.ACCENT)) }
        val wrapper = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        wrapper.addView(bar)
        wrapper.addView(accentRule, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 3))
        return wrapper
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
     * HYBRID deliberately falls through to the exact same rendering path
     * as AIR right now — see this class's own doc comment on why a real
     * distinct Hybrid screen (real routing/turn-by-turn) isn't built yet.
     * `currentMode` still tracks "hybrid" separately so the toggle bar
     * highlights the right button and this fallback is easy to find and
     * replace later (`grep` for this comment) without archaeology.
     */
    private fun switchMode(mode: String) {
        if (mode == currentMode) return
        currentMode = mode
        selectedHex = null
        updateModeButtonHighlight()
        applyModeVisibility()
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

        if (currentMode == "raw") {
            refreshRawMode()
        } else {
            updateAirCamera(location)
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
    }
}
