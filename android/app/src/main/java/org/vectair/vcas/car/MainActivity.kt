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
import android.text.Editable
import android.text.SpannableString
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.UnderlineSpan
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
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
import org.vectair.vcas.car.logic.OrsGeocoder
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
 * **A real settings screen now exists** (`buildSettingsScreen()`,
 * 2026-08-27) — colour-blind-safe palette (wired into RAW/AIR/HYBRID's
 * colour selection alike, see `RawPlotView.kt`/`RawAircraftListView.kt`'s
 * own `displayColorHex()` and this class's `renderAirMarkers()`) and real
 * traffic filtering (hide-ground-aircraft, low-altitude suppression
 * presets — `VcasSettings.kt`, applied in `onAircraftUpdated()`'s own
 * filtering pass, the first time either has ever been filtered natively).
 * Its own doc comment explains exactly which PWA settings sections are
 * ported and which are deliberately not (Theme, AIR range rings, Data &
 * Logging) and why.
 *
 * **RAW's aircraft-tap detail is now a real popup card** (2026-08-27,
 * see the "RAW popup card" section below), not a plain `Toast` — read-
 * only info + a real Suppress button (wired into `Indicators.build()`'s
 * own `suppressedHexes` parameter). AIR/HYBRID's marker tap is still a
 * plain `Toast`, since neither runs `Indicators`/`Relevance` at all (see
 * this class's own doc comment on why AIR/HYBRID call `Visibility`/`Geo`
 * directly) — there's nothing to suppress FROM there, so the popup
 * card's Suppress button has no equivalent meaning on that screen. The
 * PWA's own ground-truth log-outcome buttons are NOT included in either
 * popup — that needs `ObservationLogger`/the central-log system, which
 * hasn't been ported to this native app at all, same reasoning
 * `buildSettingsScreen()`'s own doc comment gives for excluding "Data &
 * Logging" from the settings screen.
 *
 * **Known, deliberately-scoped simplifications, not silently-left
 * gaps**: no own-position marker in AIR/HYBRID (the camera already
 * centres on the true GPS fix); AIR/HYBRID symbols are cleared/rebuilt
 * each poll rather than diffed by hex; no `AircraftExtrapolation`
 * smoothing between polls anywhere yet; no Day/Night theming (this app
 * is always-dark, matching RAW's own "no day mode for a cockpit
 * instrument" precedent — genuinely deferred now because `VcasPalette.kt`
 * has no day-variant colours to switch to, NOT because there's nowhere
 * to put a toggle now that a real settings screen exists); HYBRID's
 * route line is one plain `LineLayer`, not the PWA's own 3-layer glow/
 * line/highlight polyline; no destination pin/marker on the map for
 * either the tap-map or search-box picking method; `TURN_APPROACH`'s
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

    // Manually-suppressed aircraft (via the popup's Suppress button) —
    // mirrors app.js's own `suppressedUntil` Map<hex, expiryMs> exactly.
    private val suppressedUntilMs = mutableMapOf<String, Long>()

    private var topBarView: View? = null
    private var modeToggleBar: View? = null
    private var mapContentView: View? = null
    private lateinit var rawPlotView: RawPlotView
    private lateinit var rawListView: RawAircraftListView
    private val modeButtons = mutableMapOf<String, TextView>()

    // ---- RAW popup card state (2026-08-27) ----
    private var rawPopupView: View? = null
    private var rawPopupCallsignText: TextView? = null
    private var rawPopupTypeText: TextView? = null
    private var rawPopupDistanceText: TextView? = null
    private var rawPopupAltitudeText: TextView? = null
    private var rawPopupBearingText: TextView? = null
    private var rawPopupUpdatedText: TextView? = null
    private var rawPopupBadgeText: TextView? = null
    private var rawPopupSuppressBtn: TextView? = null
    private var rawPopupCurrentHex: String? = null
    private var rawPopupDismissRunnable: Runnable? = null

    // ---- Settings screen state (2026-08-27) ----
    private var settingsScreenView: View? = null
    private var colorblindToggleBtn: TextView? = null
    private var groundHideToggleBtn: TextView? = null
    private val altPresetButtons = mutableMapOf<String, TextView>() // "off" or a PRESETS_FT value as string

    // ---- Onboarding screen state (2026-08-27) ----
    private var onboardingScreenView: View? = null

    // ---- HYBRID navigation state (2026-08-27) ----
    private var guidanceCardView: View? = null
    private var guidanceText: TextView? = null
    private var etaText: TextView? = null
    private var activeRouteGroupView: View? = null

    private var activeRoute: OrsProvider.Route? = null
    private var routeDestLat: Double? = null
    private var routeDestLon: Double? = null
    private var rerouteInFlight = false
    private var routeRequestToken = 0
    private var offRouteSinceMs: Long? = null

    // Destination search (2026-08-27 follow-up) — OrsGeocoder.kt, ported
    // and tested alongside OrsProvider.kt/ManeuverTracker.kt, was left
    // unwired to any UI in the first HYBRID-navigation pass; this is that
    // follow-up. See buildGuidanceCard()/scheduleDestSearch()'s own doc
    // comments for the full port writeup.
    private var destSearchGroupView: View? = null
    private var destSearchInput: EditText? = null
    private var destSearchStatusText: TextView? = null
    private var destSearchResultsContainer: LinearLayout? = null
    private var destSearchToken = 0
    private var pendingSearchRunnable: Runnable? = null

    private val routeExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        VcasSettings.init(this)

        val root = FrameLayout(this)

        val mapView = mapContainer.createView(savedInstanceState)
        mapContentView = mapView
        root.addView(mapView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        rawPlotView = RawPlotView(this).apply {
            onAircraftTap = { item -> onRawAircraftTap(item) }
            onRangeButtonTap = { onRawRangeCycle() }
            onEmptyTap = { selectedHex = null; hideRawPopup() }
        }
        root.addView(rawPlotView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        rawListView = RawAircraftListView(this).apply {
            onSortClick = { mode -> rawSortMode = mode; refreshRawMode() }
            onRowClick = { item -> selectedHex = item.aircraft.hex; onRawAircraftTap(item) }
        }
        root.addView(rawListView, FrameLayout.LayoutParams(0, 0)) // sized/positioned per-frame in refreshRawMode()

        val rawPopup = buildRawPopupCard()
        rawPopupView = rawPopup
        root.addView(rawPopup, FrameLayout.LayoutParams(0, 0)) // sized/positioned per-tap in showRawPopup()

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

        // Added last so it draws on top of everything else, modal-style —
        // see buildSettingsScreen()'s own doc comment.
        val settingsScreen = buildSettingsScreen()
        settingsScreenView = settingsScreen
        root.addView(settingsScreen, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        // Added last of all — even above the settings screen (which only
        // ever opens from an explicit tap, so ordering between the two
        // doesn't otherwise matter) — see buildOnboardingScreen()'s own
        // doc comment.
        val onboardingScreen = buildOnboardingScreen()
        onboardingScreenView = onboardingScreen
        root.addView(onboardingScreen, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        setContentView(root)
        applyModeVisibility()
        updateGuidanceCard()
        maybeShowOnboarding()

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
     * separate DOM elements. Two mutually-exclusive groups, toggled by
     * `updateGuidanceCard()` based on whether a route is active — a
     * structural mirror of the PWA's own destination-picker-vs-active-
     * route split (`#dpb-search-input` vs `#guidance-card`/`#route-card`):
     * - **No route**: `destSearchGroupView` — a debounced search box
     *   (`OrsGeocoder.kt`, see `scheduleDestSearch()`'s own doc comment)
     *   plus a results list, alongside the still-available tap-the-map
     *   option (`onMapTapped()`).
     * - **Active route**: `activeRouteGroupView` — a top row (next-
     *   maneuver instruction, + a ✕ cancel button) and a mono-font ETA/
     *   distance line below it.
     * Hidden outside HYBRID mode entirely — see `updateGuidanceCard()`.
     */
    private fun buildGuidanceCard(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL_ALT))
            setPadding(28, 14, 28, 14)
            visibility = View.GONE
        }

        // ---- No-route group: search box + results ----
        val searchGroup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val search = EditText(this).apply {
            hint = "Search destination or tap the map"
            setHintTextColor(VcasPalette.parse(VcasPalette.TEXT_MUTED))
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 14f
            typeface = VcasFonts.display(this@MainActivity)
            setSingleLine(true)
            setBackgroundColor(Color.TRANSPARENT)
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            setPadding(0, 0, 0, 4)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    scheduleDestSearch(s?.toString() ?: "")
                }
            })
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                    pendingSearchRunnable?.let { mainHandler.removeCallbacks(it) }
                    performDestSearch(text.toString())
                    true
                } else {
                    false
                }
            }
        }
        destSearchInput = search
        val status = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
            visibility = View.GONE
        }
        destSearchStatusText = status
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        destSearchResultsContainer = results
        searchGroup.addView(search)
        searchGroup.addView(status)
        searchGroup.addView(results)
        destSearchGroupView = searchGroup

        // ---- Active-route group: guidance row + ETA ----
        val activeGroup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
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
            setOnClickListener { clearActiveRoute() }
        }
        row.addView(guidance, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(cancel)

        val eta = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.mono(this@MainActivity)
            setPadding(0, 6, 0, 0)
        }
        etaText = eta

        activeGroup.addView(row)
        activeGroup.addView(eta)
        activeRouteGroupView = activeGroup

        card.addView(searchGroup)
        card.addView(activeGroup)
        return card
    }

    /**
     * Debounced as-you-type search — a structural port of `app.js`'s
     * `_searchDestination()` (350ms debounce, `MIN_CHARS`(3) short-
     * circuit, a monotonic token discarding a slow response to an
     * earlier keystroke that would otherwise clobber a faster response
     * to a later one — the exact same `_destSearchToken` pattern
     * `_routeRequestToken`/this class's own `routeRequestToken` already
     * use). `Handler.postDelayed`/`removeCallbacks` stands in for the
     * PWA's `setTimeout`/`clearTimeout`, same mechanism `AdsbFiClient.kt`
     * already established for its own poll scheduling.
     */
    private fun scheduleDestSearch(query: String) {
        pendingSearchRunnable?.let { mainHandler.removeCallbacks(it) }
        if (query.trim().length < OrsGeocoder.MIN_CHARS) {
            clearDestSearchResults()
            return
        }
        val runnable = Runnable { performDestSearch(query) }
        pendingSearchRunnable = runnable
        mainHandler.postDelayed(runnable, DEST_SEARCH_DEBOUNCE_MS)
    }

    private fun performDestSearch(query: String) {
        val text = query.trim()
        if (text.length < OrsGeocoder.MIN_CHARS) {
            clearDestSearchResults()
            return
        }
        val token = ++destSearchToken
        val location = lastKnownLocation
        val focusLat = location?.latitude
        val focusLon = location?.longitude
        routeExecutor.execute {
            val results = OrsGeocoder.search(ORS_API_KEY, text, focusLat, focusLon)
            mainHandler.post {
                if (token != destSearchToken) return@post // superseded by a newer search
                renderDestSearchResults(results)
            }
        }
    }

    private fun clearDestSearchResults() {
        destSearchToken++ // discards any in-flight search response
        destSearchResultsContainer?.removeAllViews()
    }

    private fun renderDestSearchResults(results: List<OrsGeocoder.Result>) {
        val container = destSearchResultsContainer ?: return
        container.removeAllViews()
        results.take(MAX_DEST_SEARCH_RESULTS).forEach { result ->
            val row = TextView(this).apply {
                text = result.label
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
                textSize = 13f
                typeface = VcasFonts.display(this@MainActivity)
                setPadding(0, 16, 0, 16)
                setOnClickListener { onDestSearchResultSelected(result) }
            }
            container.addView(row)
        }
    }

    private fun onDestSearchResultSelected(result: OrsGeocoder.Result) {
        destSearchInput?.let { input ->
            input.text?.clear()
            val imm = getSystemService(InputMethodManager::class.java)
            imm?.hideSoftInputFromWindow(input.windowToken, 0)
        }
        clearDestSearchResults()
        requestRouteTo(result.lat, result.lon)
    }

    /**
     * Two-line top bar (title + live status) styled with VCAS's real
     * cockpit-panel palette — see `VcasPalette.kt`'s own doc comment. A
     * real settings gear (opens `buildSettingsScreen()`) now sits at the
     * bar's right edge, 2026-08-27. Still deliberately NOT the PWA's own
     * ADS-B status pill — that has no real native counterpart yet (no
     * live/stale/error status tracking beyond the plain aircraft-count
     * text already shown). The adsb.fi credit line was added the same
     * day, before the settings gear — see `buildAdsbCreditLine()`'s own
     * doc comment for why it couldn't stay deferred the way the rest of
     * the top bar could.
     */
    private fun buildTopBar(): View {
        val textColumn = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
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
        textColumn.addView(title)
        textColumn.addView(status)
        textColumn.addView(buildAdsbCreditLine())

        val gear = TextView(this).apply {
            text = "⚙"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 22f
            setPadding(28, 0, 0, 0)
            setOnClickListener { openSettingsScreen() }
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL))
            setPadding(28, 20, 28, 14)
        }
        bar.addView(textColumn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(gear)

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
     * once. Originally added before this app had any settings screen to
     * gate a settings gear behind — that gear now exists (see
     * `buildSettingsScreen()`), but this credit line was never gated
     * behind it in the first place and still doesn't need to be; an
     * ongoing citation still belongs in the persistent chrome, not a
     * screen the user has to go open.
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

    // ---- Settings screen (2026-08-27) — a structural port of index.html's
    // #settings-screen + app.js's _openSettingsScreen/_renderAltPresets/
    // _refreshSettingsScreen, trimmed to the sections that actually have a
    // real effect in this native app today. See buildSettingsScreen()'s
    // own doc comment for exactly what's included and what's deliberately
    // deferred. ----

    /**
     * A full-screen modal overlay (`FrameLayout`, added last in
     * `onCreate()` so it draws on top of everything else), matching the
     * PWA's own `#settings-screen` div — a real in-app screen, not a
     * separate `Activity`, since there's no reason for this small a
     * feature to need its own lifecycle/back-stack entry.
     *
     * **Two of the PWA's three sections are ported, one deliberately
     * isn't, stated plainly rather than silently dropped:**
     * - **Display & Accessibility** → only the colour-blind-safe palette
     *   toggle. The PWA's Theme (Day/Auto/Night) row and "Range rings in
     *   Air view" toggle are both skipped — this app has no Day/Night
     *   theming at all yet (`VcasPalette.kt` has no day variant to switch
     *   to), and AIR mode has no range-rings map layer built yet either
     *   (unlike the PWA's real `EosMap.updateRangeRings`). Adding a
     *   toggle with no real effect behind it would be exactly the kind of
     *   half-finished control this project's own conventions reject —
     *   both are real, separate follow-ups once their underlying feature
     *   exists, not omissions here.
     * - **Traffic Filtering** → both rows, in full: hide-aircraft-on-
     *   ground and the low-altitude suppression presets. Both are wired
     *   to a real filtering pass (`onAircraftUpdated()`'s own doc
     *   comment) that applies to every mode's aircraft list, matching
     *   `app.js`'s own single filtering point.
     * - **Data & Logging** → not included at all. The PWA's "Export
     *   buffered observations" button exists because `ObservationLogger`/
     *   the LOG ground-truth panel exist — neither has been ported to
     *   this native app yet, so there's nothing here for an export
     *   button to export. A real, separate, much larger follow-up (the
     *   whole LOG panel/central-log system), not a settings-screen gap.
     */
    private fun buildSettingsScreen(): View {
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_DARK))
            visibility = View.GONE
        }

        val scroll = android.widget.ScrollView(this)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 48)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 32)
        }
        val title = TextView(this).apply {
            text = "Settings"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 20f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        }
        val close = TextView(this).apply {
            text = "✕"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 20f
            setPadding(24, 0, 0, 0)
            setOnClickListener { closeSettingsScreen() }
        }
        header.addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(close)
        body.addView(header)

        body.addView(buildSettingsSectionHeader("Display & Accessibility"))
        body.addView(buildSettingsToggleRow("Colour-blind-safe palette") { btn ->
            colorblindToggleBtn = btn
            btn.setOnClickListener {
                VcasSettings.toggleColorblindSafe()
                refreshSettingsScreen()
                // Re-render immediately rather than waiting for the next GPS/
                // ADS-B tick, matching app.js's own onColorblindToggleClick().
                if (currentMode == "raw") {
                    refreshRawMode()
                } else if (lastKnownLocation != null) {
                    renderAirMarkers(latestAircraft)
                }
            }
        })

        body.addView(buildSettingsSectionHeader("Traffic Filtering"))
        body.addView(buildSettingsToggleRow("Hide aircraft on the ground") { btn ->
            groundHideToggleBtn = btn
            btn.setOnClickListener {
                VcasSettings.setGroundHidden(!VcasSettings.isGroundHidden())
                refreshSettingsScreen()
            }
        })
        body.addView(TextView(this).apply {
            text = "Low-altitude suppression"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 20, 0, 8)
        })
        body.addView(buildAltPresetsSection())

        scroll.addView(body)
        overlay.addView(scroll, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        return overlay
    }

    private fun buildSettingsSectionHeader(text: String): View {
        return TextView(this).apply {
            this.text = text
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 32, 0, 12)
        }
    }

    /**
     * A label + a right-aligned On/Off toggle button, matching
     * `index.html`'s `.settings-row`/`.settings-toggle-btn` shape.
     * `wireButton` lets the caller both stash the button reference (for
     * `refreshSettingsScreen()` to update its text/active state later)
     * and attach its click handler — done this way rather than returning
     * the button separately since every caller needs to do both anyway.
     */
    private fun buildSettingsToggleRow(label: String, wireButton: (TextView) -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 16, 0, 16)
        }
        val labelView = TextView(this).apply {
            text = label
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 14f
            typeface = VcasFonts.display(this@MainActivity)
        }
        val toggleBtn = TextView(this).apply {
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            setPadding(28, 12, 28, 12)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.BTN_BG))
                cornerRadius = 6f
            }
        }
        wireButton(toggleBtn)
        row.addView(labelView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(toggleBtn)
        return row
    }

    /**
     * "Off (show everything)" + one row per `VcasSettings.
     * ALT_SUPPRESS_PRESETS_FT` value, matching `_renderAltPresets()`'s own
     * button set exactly (same values: 200/500/1000/2000/3000ft). Stacked
     * as full-width rows rather than the PWA's own wrapping flex-row
     * layout — a plain `LinearLayout` has no wrap behaviour, and stacking
     * vertically is a reasonable, honest simplification for a first pass
     * rather than pulling in a flexbox-equivalent dependency for six
     * buttons.
     */
    private fun buildAltPresetsSection(): View {
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        fun addPresetButton(key: String, label: String, onClick: () -> Unit) {
            val btn = TextView(this).apply {
                text = label
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
                textSize = 13f
                typeface = VcasFonts.display(this@MainActivity)
                setPadding(24, 18, 24, 18)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(VcasPalette.parse(VcasPalette.BTN_BG))
                    cornerRadius = 6f
                }
                setOnClickListener { onClick(); refreshSettingsScreen() }
            }
            altPresetButtons[key] = btn
            container.addView(btn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 8 })
        }

        addPresetButton("off", "Off (show everything)") {
            VcasSettings.setAltSuppressThreshold(false, VcasSettings.altSuppressThresholdFt())
        }
        VcasSettings.ALT_SUPPRESS_PRESETS_FT.forEach { ft ->
            addPresetButton(ft.toString(), "Below $ft ft") {
                VcasSettings.setAltSuppressThreshold(true, ft)
            }
        }
        return container
    }

    private fun openSettingsScreen() {
        settingsScreenView?.visibility = View.VISIBLE
        refreshSettingsScreen()
    }

    private fun closeSettingsScreen() {
        settingsScreenView?.visibility = View.GONE
    }

    /**
     * Sets a toggle/preset button's active-state colour by mutating its
     * existing rounded `GradientDrawable` background in place — NOT
     * `setBackgroundColor()`, which would replace that drawable with a
     * plain flat `ColorDrawable` and silently lose the rounded corners
     * every one of these buttons is built with.
     */
    private fun setToggleActive(view: TextView, active: Boolean) {
        val color = VcasPalette.parse(if (active) VcasPalette.BTN_ACTIVE_BG else VcasPalette.BTN_BG)
        (view.background as? android.graphics.drawable.GradientDrawable)?.setColor(color)
    }

    /** Re-syncs every dynamic bit of the settings screen with current state — matches `_refreshSettingsScreen()`. */
    private fun refreshSettingsScreen() {
        colorblindToggleBtn?.let { btn ->
            val on = VcasSettings.isColorblindSafeEnabled()
            btn.text = if (on) "On" else "Off"
            setToggleActive(btn, on)
        }
        groundHideToggleBtn?.let { btn ->
            val on = VcasSettings.isGroundHidden()
            btn.text = if (on) "On" else "Off"
            setToggleActive(btn, on)
        }
        val enabled = VcasSettings.isAltSuppressEnabled()
        val thresholdKey = VcasSettings.altSuppressThresholdFt().toString()
        altPresetButtons.forEach { (key, btn) ->
            val active = if (key == "off") !enabled else (enabled && key == thresholdKey)
            setToggleActive(btn, active)
        }
    }

    // ---- First-launch onboarding screen (2026-08-27) — a structural port
    // of index.html's #onboarding-screen + app.js's
    // _maybeShowOnboarding()/_renderOnboardingLegend()/_initOnboarding(). ----

    // Plain-language one-liners for the legend, keyed by the same `label`
    // string `Visibility.getCategories()` uses — matches
    // ONBOARDING_LEGEND_COPY in app.js verbatim, not re-derived wording.
    // Angular-size thresholds are deliberately left out — "quick
    // explanation" for non-technical testers, not a physics readout.
    private val onboardingLegendCopy = mapOf(
        "Certainly visible" to "Big and close — you shouldn't be able to miss it.",
        "Likely visible" to "Large enough to actually resolve as an aircraft shape.",
        "Possibly visible" to "Worth a look if you're already looking that way.",
        "Very unlikely/not visible" to "Probably too small or far to spot by eye."
    )

    /**
     * A full-screen modal overlay, same structural approach as
     * `buildSettingsScreen()` (real in-app screen, not a separate
     * `Activity`) — shown once per install (`VcasSettings.
     * isOnboardingSeen()`), unlike the settings screen which only ever
     * opens on an explicit tap. Added last in `onCreate()`, even above
     * the settings screen, so it's never accidentally hidden behind
     * anything on a fresh install.
     *
     * **Content mirrors the PWA's four sections, one adapted rather than
     * copied verbatim**: "Welcome"/"Three views"/"What the symbols mean"
     * carry the PWA's own real copy essentially unchanged (still
     * accurate descriptions of this native app's actual RAW/AIR/HYBRID
     * behaviour). "Getting somewhere" is reworded — the PWA's own text
     * references tapping a 📍 button to open a dedicated destination
     * search UI; this app's HYBRID guidance card shows its search box
     * directly whenever no route is active (see `buildGuidanceCard()`),
     * with no separate arm/disarm button to describe.
     *
     * **The legend is generated from the app's real code, not hand-
     * copied approximations** — same discipline the PWA's own
     * `_renderOnboardingLegend()` doc comment describes: `Visibility.
     * getCategories()` (the real tier table) drives both the label text
     * and `PhoneAircraftIcons.bitmapFor()` (the SAME icon-drawing code
     * every real indicator/marker on screen already uses, with
     * `trackDeg=null` so no direction arrow is drawn) for the icon
     * itself — if the real tier colours/shapes ever change, this legend
     * changes with them automatically, exactly like the PWA's own
     * `AircraftSymbol.svg()`-driven version.
     *
     * **One real, honest difference from the PWA's own legend footnote,
     * not silently glossed over**: the PWA's note also mentions a
     * "dashed outline = predicted entry" modifier — this native app has
     * never implemented that modifier anywhere (`PhoneAircraftIcons.kt`'s
     * own doc comment already flags this: only the "overhead" chevron
     * shape is ported, RAW-only, matching `RawPlotView.kt`'s actual
     * `relevance.reason == "overhead"` check). The footnote here only
     * mentions the chevron, not a feature that doesn't exist yet.
     */
    private fun buildOnboardingScreen(): View {
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_DARK))
            visibility = View.GONE
        }

        val scroll = android.widget.ScrollView(this)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 40)
        }

        body.addView(TextView(this).apply {
            text = "Welcome to VCAS"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 20f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        })
        body.addView(TextView(this).apply {
            text = "VCAS shows you nearby aircraft while you drive, plotted by bearing and distance so you know where to actually look — plus turn-by-turn navigation to get you somewhere. Two things, one screen."
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 14f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 12, 0, 0)
        })

        body.addView(buildSettingsSectionHeader("Three views"))
        body.addView(buildOnboardingTagRow("RAW", "A TCAS/ND-style instrument display — no map, just the traffic picture. Your default view."))
        body.addView(buildOnboardingTagRow("AIR", "Top-down airspace view, every tracked aircraft, unfiltered."))
        body.addView(buildOnboardingTagRow("HYBRID", "Road map with traffic overlaid."))
        body.addView(TextView(this).apply {
            text = "Tap any aircraft icon or indicator for its details. In RAW, tap the range readout (top right of the display) to cycle through how far out it shows."
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 12, 0, 0)
        })

        body.addView(buildSettingsSectionHeader("Getting somewhere"))
        body.addView(TextView(this).apply {
            text = "In HYBRID mode, search for a destination by name or tap the map directly — VCAS routes you there and keeps tracking traffic the whole way."
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 14f
            typeface = VcasFonts.display(this@MainActivity)
        })

        body.addView(buildSettingsSectionHeader("What the symbols mean"))
        body.addView(TextView(this).apply {
            text = "Shape and colour show how easy an aircraft should actually be to spot with your own eyes right now — not how close it is on the map."
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 14f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 0, 0, 8)
        })
        Visibility.getCategories().forEach { category ->
            body.addView(buildOnboardingLegendRow(category))
        }
        body.addView(TextView(this).apply {
            text = "In RAW mode, an upward chevron shape means an aircraft is almost directly overhead — look up."
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_MUTED))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 12, 0, 0)
        })

        val dismiss = TextView(this).apply {
            text = "Got it — let's go"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 28, 0, 28)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.BTN_ACTIVE_BG))
                cornerRadius = 8f
            }
            setOnClickListener { dismissOnboarding() }
        }
        body.addView(
            dismiss,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 32 }
        )

        scroll.addView(body)
        overlay.addView(scroll, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        return overlay
    }

    private fun buildOnboardingTagRow(tag: String, description: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 8, 0, 8)
        }
        val tagView = TextView(this).apply {
            text = tag
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(16, 8, 16, 8)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.ACCENT))
                cornerRadius = 6f
            }
        }
        val desc = TextView(this).apply {
            text = description
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(16, 0, 0, 0)
        }
        row.addView(tagView)
        row.addView(desc, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        return row
    }

    private fun buildOnboardingLegendRow(category: Visibility.Category): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 10, 0, 10)
        }
        val icon = ImageView(this).apply {
            setImageBitmap(PhoneAircraftIcons.bitmapFor(category.shape, category.color, category.fillOpacity, null))
        }
        row.addView(icon, LinearLayout.LayoutParams(72, 72).apply { rightMargin = 20 })

        val textColumn = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textColumn.addView(TextView(this).apply {
            text = category.label
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        })
        textColumn.addView(TextView(this).apply {
            text = onboardingLegendCopy[category.label] ?: ""
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
        })
        row.addView(textColumn)
        return row
    }

    private fun maybeShowOnboarding() {
        if (VcasSettings.isOnboardingSeen()) return
        onboardingScreenView?.visibility = View.VISIBLE
    }

    private fun dismissOnboarding() {
        VcasSettings.markOnboardingSeen()
        onboardingScreenView?.visibility = View.GONE
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

    /**
     * Traffic filtering (2026-08-27, settings screen follow-up) — ports
     * `app.js`'s own `aircraftList = result.aircraft.filter(...)` pass
     * (the one place the PWA filters BEFORE feeding either NAV or AIR),
     * applied here at the same single point every mode's rendering reads
     * from (`latestAircraft`). The first two checks are unconditional —
     * no settings toggle governs them, matching the PWA exactly — the
     * last two are real, user-configurable settings (`VcasSettings.kt`),
     * previously not filtered anywhere in this native app at all.
     */
    private fun onAircraftUpdated(rawAircraft: List<AircraftExtrapolation.Aircraft>) {
        val filtered = rawAircraft.filter { a ->
            // Ground service vehicles/fixed obstacles are never aircraft — unconditional, no toggle.
            if (a.isGroundVehicleOrObstacle) return@filter false
            // Stale removal — matches CONFIG.REMOVE_THRESHOLD_SECONDS exactly.
            if (a.lastSeenSeconds >= REMOVE_THRESHOLD_SECONDS) return@filter false
            // Aircraft themselves on the ground — a real settings toggle, separate
            // from the altitude threshold below since ground aircraft usually have
            // no usable altitude at all (see NormaliseAircraft.kt).
            if (VcasSettings.isGroundHidden() && a.onGround) return@filter false
            // Low-altitude clutter suppression — only ever suppresses a KNOWN
            // altitude below the threshold, never missing altitude data.
            if (VcasSettings.isAltSuppressEnabled() &&
                a.altitudeFt != null &&
                a.altitudeFt < VcasSettings.altSuppressThresholdFt()
            ) {
                return@filter false
            }
            true
        }

        latestAircraft = filtered
        statusText?.text = "${filtered.size} aircraft in range"

        if (currentMode == "raw") {
            refreshRawMode()
        } else {
            renderAirMarkers(filtered)
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

            // Colourblind-safe palette (2026-08-27) — AIR/HYBRID have no
            // RAW-style reference-fidelity color to weigh against, unlike
            // RawPlotView.kt's own displayColorHex(), so this is just a
            // straight swap: vis.color normally, vis.colorblindSafe when
            // the setting is on, matching ui.js's own _displayColor()
            // priority (colourblind wins whenever it's enabled).
            val colorHex = if (VcasSettings.isColorblindSafeEnabled()) vis.colorblindSafe.ifBlank { vis.color } else vis.color
            val iconName = PhoneAircraftIcons.iconNameFor(vis.shape, colorHex, vis.fillOpacity, a.trackDeg)
            if (style.getImage(iconName) == null) {
                style.addImage(iconName, PhoneAircraftIcons.bitmapFor(vis.shape, colorHex, vis.fillOpacity, a.trackDeg))
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
     * has). The alternative, faster path — searching by name/address —
     * is `buildGuidanceCard()`'s own debounced search box
     * (`scheduleDestSearch()`, 2026-08-27 follow-up); both paths converge
     * on this same `requestRouteTo()` call.
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
        destSearchInput?.text?.clear()
        clearDestSearchResults()
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
        destSearchGroupView?.visibility = if (route == null) View.VISIBLE else View.GONE
        activeRouteGroupView?.visibility = if (route == null) View.GONE else View.VISIBLE
        if (route == null) {
            destSearchStatusText?.apply {
                if (rerouteInFlight) {
                    text = "Finding route…"
                    visibility = View.VISIBLE
                } else {
                    visibility = View.GONE
                }
            }
            return
        }

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

        // Keeps an already-open popup's Suppress button live-updated as
        // speed changes, rather than only at the moment it was opened —
        // matches ui.js's own setSpeedMph() being called from every GPS
        // tick's speed-override convergence point.
        updateRawPopupInteractivity()

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
            plotSafeInset = (SQUARE_EDGE_MARGIN_DP * density).toDouble(),
            plotBandsNm = activeBandsNm
        )

        // Expire manually-suppressed aircraft (via the popup's Suppress
        // button) — mirrors app.js's own suppressedUntil-pruning loop
        // in refreshIndicators() exactly, run every call rather than on
        // a separate timer.
        val now = System.currentTimeMillis()
        suppressedUntilMs.entries.removeAll { it.value <= now }

        val allRelevant = Indicators.build(latestAircraft, userState, STALE_THRESHOLD_SECONDS, suppressedUntilMs.keys)
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
            routeInfo = null, // RAW mode itself carries no route info — that's HYBRID's own guidance card
            square = square,
            anchorY = anchorY,
            bandsNm = activeBandsNm,
            selectedRangeNm = selectedRangeNm,
            selectedHex = selectedHex,
            chromeTopInsetPx = chromeTopInset.toFloat(),
            colorblindSafe = VcasSettings.isColorblindSafeEnabled()
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
        rawListView.update(sortedForList, rawSortMode, beyondRangeHexes, selectedHex, VcasSettings.isColorblindSafeEnabled())
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

    // ---- RAW popup card (2026-08-27) — a structural port of ui.js's
    // showPopup()/hidePopup(), replacing the plain Toast this class used
    // for RAW's aircraft-tap detail until now. Read-only info (distance/
    // altitude/bearing/updated/vis badge) + a real Suppress button (wired
    // to Indicators.build()'s own suppressedHexes parameter, previously
    // always passed null — this is the first time this native app has
    // ever actually suppressed an aircraft). Deliberately does NOT include
    // the PWA's own ground-truth log-outcome buttons — those need
    // ObservationLogger/the central-log system, which hasn't been ported
    // to this native app at all (same reasoning already established for
    // excluding "Data & Logging" from the settings screen, see
    // buildSettingsScreen()'s own doc comment) — `showPopup(ind,
    // onSuppressClick, onLogOutcome)` itself already supports omitting
    // the log buttons entirely when `onLogOutcome` isn't passed, so this
    // is a real, already-designed-for variant of the PWA's own popup, not
    // a half-finished one. ----

    private fun buildRawPopupCard(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.BG_PANEL))
                cornerRadius = 8f
                setStroke(2, VcasPalette.parse(VcasPalette.BORDER))
            }
            visibility = View.GONE
        }

        val callsign = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 16f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        }
        rawPopupCallsignText = callsign
        val type = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(0, 2, 0, 10)
        }
        rawPopupTypeText = type
        card.addView(callsign)
        card.addView(type)

        card.addView(buildRawPopupRow("Distance") { rawPopupDistanceText = it })
        card.addView(buildRawPopupRow("Altitude") { rawPopupAltitudeText = it })
        card.addView(buildRawPopupRow("Bearing") { rawPopupBearingText = it })
        card.addView(buildRawPopupRow("Updated") { rawPopupUpdatedText = it })

        val badge = TextView(this).apply {
            setTextColor(Color.BLACK)
            textSize = 11f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(16, 6, 16, 6)
            background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = 4f }
        }
        rawPopupBadgeText = badge
        card.addView(
            badge,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 10 }
        )

        val suppress = TextView(this).apply {
            text = "Suppress"
            gravity = Gravity.CENTER
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 16, 0, 16)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(VcasPalette.parse(VcasPalette.BTN_BG))
                cornerRadius = 6f
            }
            setOnClickListener { onRawPopupSuppressClick() }
        }
        rawPopupSuppressBtn = suppress
        card.addView(
            suppress,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 14 }
        )

        return card
    }

    private fun buildRawPopupRow(label: String, storeValueView: (TextView) -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 3, 0, 3)
        }
        row.addView(
            TextView(this).apply {
                text = label
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_MUTED))
                textSize = 12f
                typeface = VcasFonts.display(this@MainActivity)
            },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        val value = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 12f
            typeface = VcasFonts.mono(this@MainActivity)
        }
        storeValueView(value)
        row.addView(value)
        return row
    }

    /**
     * A structural port of `showPopup()` — positioned near the aircraft's
     * true plotted point (`item.x`/`item.y`, the same coordinates
     * `RawPlotView` draws its icon at), clamped to stay on screen. Uses a
     * fixed estimated card size rather than actually measuring the real
     * view before it's laid out, matching `showPopup()`'s own
     * `popW`/`popH` estimate — an honest simplification, not a hidden gap
     * (this app's popup shape is fixed — no log-button row to make the
     * real height variable the way the PWA's own estimate has to account
     * for).
     */
    private fun showRawPopup(item: Indicators.IndicatorItem) {
        val card = rawPopupView ?: return
        val a = item.aircraft

        rawPopupCurrentHex = a.hex
        rawPopupCallsignText?.text = a.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: a.hex
        rawPopupTypeText?.text = a.type ?: "Unknown"
        rawPopupDistanceText?.text = "%.1f NM".format(item.distanceNm)
        rawPopupAltitudeText?.text = a.altitudeFt?.let { "%,d ft".format(it.roundToInt()) } ?: "Unknown"
        rawPopupBearingText?.text = rawBearingLabel(item.relativeBearing, item.vis.isOverhead)
        rawPopupUpdatedText?.text = "${a.lastSeenSeconds.roundToInt()}s ago"

        rawPopupBadgeText?.text = item.vis.label
        val colorblind = VcasSettings.isColorblindSafeEnabled()
        val badgeColorHex = if (colorblind) item.vis.colorblindSafe.ifBlank { item.vis.color } else item.vis.colorRaw.ifBlank { item.vis.color }
        val badgeColor = try { VcasPalette.parse(badgeColorHex) } catch (e: IllegalArgumentException) { Color.WHITE }
        (rawPopupBadgeText?.background as? android.graphics.drawable.GradientDrawable)?.setColor(badgeColor)

        updateRawPopupInteractivity()

        val density = resources.displayMetrics.density
        val popW = (220 * density).toInt()
        val popH = (215 * density).toInt() // matches showPopup()'s own 180 + 35 (Suppress row, no log buttons) estimate
        val vw = rawPlotView.width
        val vh = rawPlotView.height
        val x = item.x ?: (vw / 2)
        val y = item.y ?: (vh / 2)
        val margin = (8 * density).toInt()
        val gap = (14 * density).toInt()
        val left = (x - popW / 2).coerceIn(margin, (vw - popW - margin).coerceAtLeast(margin))
        val top = (y - popH - gap).coerceIn(margin, (vh - popH - margin).coerceAtLeast(margin))

        val lp = card.layoutParams as FrameLayout.LayoutParams
        lp.width = popW
        lp.leftMargin = left
        lp.topMargin = top
        card.layoutParams = lp
        card.visibility = View.VISIBLE

        rawPopupDismissRunnable?.let { mainHandler.removeCallbacks(it) }
        val dismissRunnable = Runnable { hideRawPopup() }
        rawPopupDismissRunnable = dismissRunnable
        mainHandler.postDelayed(dismissRunnable, RAW_POPUP_DISMISS_MS)
    }

    private fun hideRawPopup() {
        rawPopupView?.visibility = View.GONE
        rawPopupCurrentHex = null
        rawPopupDismissRunnable?.let { mainHandler.removeCallbacks(it) }
        rawPopupDismissRunnable = null
    }

    /**
     * Same distraction/safety gate ui.js's own `_actionsInteractive()`
     * establishes for the PWA's popup — reading a card and tapping a
     * specific action is real, sustained screen attention this app
     * shouldn't invite while actually driving. Called both when the
     * popup is first shown (`showRawPopup()`) and from `refreshRawMode()`
     * itself — which every GPS fix and ADS-B poll already re-runs while
     * in RAW mode — so an already-open popup's Suppress button disables
     * live the moment effective speed crosses the threshold, not just on
     * the next tap, matching `setSpeedMph()`'s own "update an already-
     * open popup live" behaviour without needing a second, separately-
     * triggered call site.
     */
    private fun updateRawPopupInteractivity() {
        val interactive = currentSpeedMph() <= GPS_HEADING_MIN_SPEED_MPH
        rawPopupSuppressBtn?.alpha = if (interactive) 1f else 0.45f
    }

    private fun onRawPopupSuppressClick() {
        if (currentSpeedMph() > GPS_HEADING_MIN_SPEED_MPH) return
        val hex = rawPopupCurrentHex ?: return
        suppressedUntilMs[hex] = System.currentTimeMillis() + SUPPRESS_DURATION_SECONDS * 1000L
        hideRawPopup()
        refreshRawMode()
    }

    private fun currentSpeedMph(): Double {
        val location = lastKnownLocation ?: return 0.0
        return if (location.hasSpeed()) location.speed * MPS_TO_MPH else 0.0
    }

    /** A structural port of ui.js's own `_bearingLabel()`, verbatim. */
    private fun rawBearingLabel(relativeBearing: Double, isOverhead: Boolean): String {
        if (isOverhead) return "overhead"
        val abs = kotlin.math.abs(relativeBearing)
        if (abs <= 20) return "ahead"
        if (abs >= 160) return "behind"
        val side = if (relativeBearing > 0) "right" else "left"
        if (abs <= 60) return "$side-front"
        if (abs <= 120) return side
        return "$side-rear"
    }

    private fun onRawAircraftTap(item: Indicators.IndicatorItem) {
        selectedHex = item.aircraft.hex
        showRawPopup(item)
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

        // Matches app.js's own destination-search debounce (350ms).
        private const val DEST_SEARCH_DEBOUNCE_MS = 350L
        private const val MAX_DEST_SEARCH_RESULTS = 6

        // Matches CONFIG.REMOVE_THRESHOLD_SECONDS (src/config.js) exactly.
        private const val REMOVE_THRESHOLD_SECONDS = 30.0

        // RAW popup card constants — matches CONFIG.GPS_HEADING_MIN_SPEED_MPH/
        // CONFIG.SUPPRESS_DURATION_SECONDS/ui.js's own POPUP_DISMISS_MS exactly.
        private const val GPS_HEADING_MIN_SPEED_MPH = 5.0
        private const val SUPPRESS_DURATION_SECONDS = 180
        private const val RAW_POPUP_DISMISS_MS = 4000L
    }
}
