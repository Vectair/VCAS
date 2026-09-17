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
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.ForegroundColorSpan
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
import org.vectair.vcas.car.logic.TrafficRulesLogic
import org.vectair.vcas.car.logic.Visibility
import java.util.concurrent.Executors
import kotlin.math.max
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

    // ---- Traffic Rules settings state (2026-09-17) ----
    private var trafficRulesListContainer: LinearLayout? = null
    private var trafficRuleFormView: View? = null
    private var trTypeQueryInput: EditText? = null
    private var trCategoryBtn: TextView? = null
    private var trAltEnabledBtn: TextView? = null
    private var trAltDirectionBtn: TextView? = null
    private var trAltFtInput: EditText? = null
    private var trTrafficBtn: TextView? = null
    private var trColorRow: LinearLayout? = null
    private var trModeLabel: TextView? = null
    // The rule currently open in the edit form, if any — null means the
    // form is closed. A rule created via "+ Filter rule"/"+ Highlight
    // rule" is tracked separately (trPendingNewRuleId) so Cancel can tell
    // "discard a just-created draft" from "discard edits to an existing
    // rule," mirroring app.js's own _trPendingNewRuleId handling.
    private var trEditingRuleId: String? = null
    private var trPendingNewRuleId: String? = null
    private var trEditingConditions = TrafficRulesLogic.Conditions()
    private var trEditingColor = TrafficRulesLogic.DEFAULT_HIGHLIGHT_COLOR
    private var trEditingMode = TrafficRulesLogic.RuleMode.FILTER

    private val trafficRuleColorSwatches = listOf(
        "#ffcc00", "#e69f00", "#56b4e9", "#009e73", "#d55e00", "#ff5252", "#ffffff"
    )

    // ---- Onboarding screen state (2026-08-27) ----
    private var onboardingScreenView: View? = null

    // ---- HYBRID navigation state (2026-08-27) ----
    private var guidanceCardView: View? = null
    private var guidanceCardRow: View? = null
    private var maneuverIconText: TextView? = null
    private var guidanceText: TextView? = null
    private var etaText: TextView? = null
    // RAW-only merged nav-status card fields (2026-09-17 sync, PWA rounds
    // 2/5/6/9) — always populated alongside the Hybrid fields above,
    // visibility toggled by updateGuidanceCard() rather than only one set
    // ever existing, same "write to all targets, let display state decide"
    // pattern app.js's own _updateRouteCard() already uses.
    private var rawEtaText: TextView? = null
    private var hybridEtaRow: View? = null
    private var rawEtaRow: View? = null
    private var rawSpeedText: TextView? = null
    private var rawDistText: TextView? = null
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
        TrafficRulesStore.init(this)

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

        // ---- Active-route group: icon + guidance text + ETA/✕ row, then a
        // second row holding EITHER Hybrid's single mono ETA line OR RAW's
        // own colour-coded speed/distance row — a Kotlin-chrome equivalent
        // of the PWA's `#nav-guidance-card` (icon/.ngc-body/.ngc-eta) +
        // `#route-card` (.route-eta-row vs .route-eta-row-raw), collapsed
        // into one card the same way this class's own doc comment already
        // describes, now additionally covering RAW's merged nav-status
        // styling (2026-09-06/09-08 PWA rounds 2/5/6/9) — not just Hybrid's
        // Google-Maps-style banner. See updateGuidanceCard() for which set
        // is actually populated/shown per mode. ----
        val activeGroup = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        guidanceCardRow = row
        val icon = TextView(this).apply {
            text = "↑"
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 24f
            gravity = Gravity.CENTER
            setPadding(0, 0, 16, 0)
        }
        maneuverIconText = icon
        val guidance = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 15f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
        }
        guidanceText = guidance
        val rawEta = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.RAW_VALUE_GREEN))
            textSize = 14f
            typeface = VcasFonts.mono(this@MainActivity, bold = true)
            setPadding(16, 0, 0, 0)
        }
        rawEtaText = rawEta
        val cancel = TextView(this).apply {
            text = "✕"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 18f
            setPadding(24, 0, 0, 0)
            setOnClickListener { clearActiveRoute() }
        }
        row.addView(icon, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        row.addView(guidance, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(rawEta)
        row.addView(cancel)

        // Hybrid's own single-line mono ETA readout — unchanged from
        // before this sync pass.
        val eta = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.mono(this@MainActivity)
            setPadding(0, 6, 0, 0)
        }
        etaText = eta
        hybridEtaRow = eta

        // RAW's own one-row speed (left, green) + distance (right, cyan)
        // readout — replaces Hybrid's duration+arrival line (moved to
        // rawEtaText above) and distance+destName sub-line, matching
        // `.route-eta-row-raw` exactly.
        val rawRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 6, 0, 0)
        }
        val rawSpeed = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.RAW_VALUE_GREEN))
            textSize = 14f
            typeface = VcasFonts.mono(this@MainActivity, bold = true)
        }
        rawSpeedText = rawSpeed
        val rawDist = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.RAW_VALUE_CYAN))
            textSize = 14f
            typeface = VcasFonts.mono(this@MainActivity, bold = true)
            gravity = Gravity.END
        }
        rawDistText = rawDist
        rawRow.addView(rawSpeed, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        rawRow.addView(rawDist, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        rawEtaRow = rawRow

        activeGroup.addView(row)
        activeGroup.addView(eta)
        activeGroup.addView(rawRow)
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
     * 2026-09-06/09-08 chrome sync (PWA rounds 6/9/11): the "VCAS" text
     * wordmark is gone — the real brand icon (`ic_launcher.png`, the same
     * lime-green-wordmark-integrated artwork the PWA's own launch screen
     * uses) already carries the name in its own artwork, so a second text
     * repeat of it was redundant (same reasoning the PWA's own round-10
     * entry gives). The status pill row is an honest SUBSET of the PWA's
     * current 3-pill set (adsb.fi/MapTiler/Open-Meteo): this native app has
     * no Open-Meteo integration at all, and no live per-poll ADS-B/MapTiler
     * health tracking the way `UpperAirProvider`/`MetarProvider`'s own
     * `getStatus()` give the PWA — building fake "active/stale" pills for
     * signals this app doesn't actually track would be exactly the kind of
     * half-finished control this project's conventions reject (see
     * `buildSettingsScreen()`'s own precedent). Both native pills instead
     * show a real, honest "configured" state (a static key/attribution
     * link, not a live health check) — the same simplification the PWA's
     * own MapTiler pill already makes for the identical reason.
     */
    private fun buildTopBar(): View {
        val brandIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_launcher)
            contentDescription = "VCAS"
        }

        val status = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            setPadding(0, 4, 0, 0)
            typeface = VcasFonts.display(this@MainActivity)
            text = "Acquiring position…"
        }
        statusText = status

        val pillRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 6, 0, 0)
        }
        pillRow.addView(buildStatusPill("adsb.fi", "https://adsb.fi"))
        pillRow.addView(buildStatusPill("MapTiler", "https://www.maptiler.com").apply {
            (layoutParams as? LinearLayout.LayoutParams)?.leftMargin = 12
        })

        val textColumn = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textColumn.addView(status)
        textColumn.addView(pillRow)

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
            setBackgroundColor(VcasPalette.parse(VcasPalette.RAW_CHROME_BG))
            setPadding(28, 20, 28, 14)
        }
        bar.addView(brandIcon, LinearLayout.LayoutParams(dpToPx(30f), dpToPx(30f)).apply { rightMargin = 20 })
        bar.addView(textColumn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(gear)

        return bar
    }

    /**
     * A restyled, real citation link — mirrors the PWA's own round-6
     * `#adsb-status` treatment ("the pill's LABEL itself is the link,
     * satisfying adsb.fi's ongoing-citation requirement for as long as
     * the app is open, not a one-time splash mention"). Same shape reused
     * for MapTiler's own attribution, matching the PWA's own two-real-
     * pills-only scope for this native app.
     */
    private fun buildStatusPill(label: String, url: String): View {
        val spannable = SpannableString(label).apply {
            setSpan(UnderlineSpan(), 0, label.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return TextView(this).apply {
            text = spannable
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 11f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setOnClickListener {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: Exception) {
                    // No browser available to handle the intent -- not
                    // fatal, the pill text itself is still visibly present.
                }
            }
        }
    }

    private fun dpToPx(dp: Float): Int = (dp * resources.displayMetrics.density).roundToInt()

    /**
     * RAW/AIR/HYBRID segmented control — 2026-09-08 chrome sync (PWA
     * rounds 9/11): reworked from one merged/segmented pill (a solid blue
     * fill for the active button) into three INDIVIDUALLY bordered black
     * boxes, matching the project owner's own Photoshop mockup — the
     * active button reads via a coloured cyan border+text rather than a
     * filled background, inactive buttons are white border+text on black.
     * This high-contrast treatment is scoped to these three buttons only
     * (not the whole bottom bar's own chrome background, which uses the
     * softer app-wide `RAW_CHROME_BG` slate — see round 11's own PWA
     * writeup: "deliberately scoped to RAW [buttons]... Hybrid/AIR keep
     * the softer cockpit-panel look" — except THIS native app has no
     * separate softer look to preserve, since the whole native chrome was
     * always a single shared style; applying the high-contrast mockup
     * treatment app-wide here is the honest equivalent of round 11's own
     * "chrome extended app-wide regardless of Day/Night" outcome).
     */
    private fun buildModeToggleBar(): View {
        val outer = LinearLayout(this).apply {
            setBackgroundColor(VcasPalette.parse(VcasPalette.RAW_CHROME_BG))
            setPadding(14, 14, 14, 20)
        }
        val toggle = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("raw" to "RAW", "air" to "AIR", "hybrid" to "HYBRID").forEachIndexed { index, (mode, label) ->
            val btn = TextView(this).apply {
                text = label
                gravity = Gravity.CENTER
                textSize = 11f
                typeface = VcasFonts.display(this@MainActivity, bold = true)
                setPadding(20, 22, 20, 22)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.BLACK)
                    cornerRadius = 4f * resources.displayMetrics.density
                    setStroke((1.5f * resources.displayMetrics.density).roundToInt(), Color.WHITE)
                }
                setOnClickListener { switchMode(mode) }
            }
            modeButtons[mode] = btn
            val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            if (index > 0) lp.leftMargin = 10
            toggle.addView(btn, lp)
        }
        outer.addView(toggle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        updateModeButtonHighlight()
        return outer
    }

    private fun updateModeButtonHighlight() {
        modeButtons.forEach { (mode, btn) ->
            val active = mode == currentMode
            val borderColor = if (active) VcasPalette.parse(VcasPalette.RAW_VALUE_CYAN) else Color.WHITE
            (btn.background as? android.graphics.drawable.GradientDrawable)?.setStroke(
                (1.5f * resources.displayMetrics.density).roundToInt(), borderColor
            )
            btn.setTextColor(borderColor)
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
     *
     * A fourth section, **Traffic Rules** (2026-09-17 sync), was added
     * after this doc comment was originally written — user-defined
     * filter/highlight rules by type/category/altitude/military-vs-civil,
     * wired to the same `onAircraftUpdated()` filtering pass and to a real
     * highlight ring drawn on RAW's plot (`RawPlotView.kt`) and baked into
     * AIR/HYBRID's marker bitmaps (`PhoneAircraftIcons.kt`) — see
     * `buildTrafficRuleForm()`'s own doc comment for the UI.
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

        // ---- Traffic Rules (2026-09-17) — filter (hide) or highlight
        // matching aircraft by type/category/altitude/military-vs-civil,
        // a structural port of TrafficRulesLogic.kt/TrafficRulesStore.kt's
        // own rule engine + app.js's `_renderTrafficRulesList()`/
        // `_renderTrafficRuleForm()`. See buildTrafficRuleForm()'s own
        // doc comment for the pending-new-rule Cancel-deletes-it footgun
        // this mirrors from the PWA exactly. ----
        body.addView(buildSettingsSectionHeader("Traffic Rules"))
        val trList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        trafficRulesListContainer = trList
        body.addView(trList)

        val trAddRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 12, 0, 0)
        }
        val addFilter = TextView(this).apply {
            text = "+ Filter rule"
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 12, 24, 12)
            setOnClickListener { onAddTrafficRuleClick(TrafficRulesLogic.RuleMode.FILTER) }
        }
        val addHighlight = TextView(this).apply {
            text = "+ Highlight rule"
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 12, 0, 12)
            setOnClickListener { onAddTrafficRuleClick(TrafficRulesLogic.RuleMode.HIGHLIGHT) }
        }
        trAddRow.addView(addFilter)
        trAddRow.addView(addHighlight)
        body.addView(trAddRow)

        val trForm = buildTrafficRuleForm()
        trafficRuleFormView = trForm
        body.addView(trForm)

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
        // A still-open, never-saved new-rule form counts as an implicit
        // Cancel — same reasoning app.js's own settings-screen-close
        // handling already applies to its own pending-new-rule state.
        if (trPendingNewRuleId != null && trPendingNewRuleId == trEditingRuleId) {
            onTrafficRuleFormCancel()
        }
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
        refreshTrafficRulesList()
    }

    // ---- Traffic Rules settings UI (2026-09-17) — filter or highlight
    // matching aircraft by type/category/altitude/military-vs-civil. A
    // structural port of app.js's `_trConditionSummary()`/
    // `_renderTrafficRulesList()`/`_openTrafficRuleForm()`/
    // `_saveTrafficRuleForm()` onto `TrafficRulesLogic.kt`/
    // `TrafficRulesStore.kt`. ----

    /** Matches app.js's own `_trConditionSummary()` wording exactly. */
    private fun trConditionSummary(conditions: TrafficRulesLogic.Conditions): String {
        val parts = mutableListOf<String>()
        if (conditions.typeQuery.isNotBlank()) {
            val terms = conditions.typeQuery.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            parts.add(if (terms.size > 1) "Type is any of: ${terms.joinToString(", ")}" else "Type contains \"${conditions.typeQuery}\"")
        }
        if (conditions.category != "any") {
            parts.add(TrafficRulesLogic.CATEGORIES[conditions.category] ?: conditions.category)
        }
        if (conditions.altitude.enabled) {
            val dir = if (conditions.altitude.direction == TrafficRulesLogic.AltitudeDirection.BELOW) "Below" else "Above"
            parts.add("$dir ${conditions.altitude.ft.roundToInt()}ft")
        }
        if (conditions.traffic != TrafficRulesLogic.Traffic.ANY) {
            parts.add(if (conditions.traffic == TrafficRulesLogic.Traffic.MILITARY) "Military (OAT)" else "Civil (GAT)")
        }
        return if (parts.isNotEmpty()) parts.joinToString(" · ") else "Any aircraft"
    }

    /** Full rebuild each call — a handful of rows, not the render-cost-
     * sensitive NAV/RAW indicator layer. */
    private fun refreshTrafficRulesList() {
        val container = trafficRulesListContainer ?: return
        container.removeAllViews()
        val rules = TrafficRulesStore.list()
        for ((index, rule) in rules.withIndex()) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 10, 0, 10)
                alpha = if (rule.enabled) 1f else 0.5f
            }
            val swatch = TextView(this).apply {
                text = if (rule.mode == TrafficRulesLogic.RuleMode.HIGHLIGHT) "●" else "✕"
                setTextColor(if (rule.mode == TrafficRulesLogic.RuleMode.HIGHLIGHT) {
                    try { Color.parseColor(rule.color) } catch (e: IllegalArgumentException) { Color.WHITE }
                } else {
                    VcasPalette.parse(VcasPalette.TEXT_SECONDARY)
                })
                textSize = 14f
                setPadding(0, 0, 16, 0)
            }
            val summary = TextView(this).apply {
                text = (if (rule.mode == TrafficRulesLogic.RuleMode.HIGHLIGHT) "Highlight: " else "Filter: ") + trConditionSummary(rule.conditions)
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
                textSize = 12f
                typeface = VcasFonts.display(this@MainActivity)
            }
            val toggleBtn = trafficRuleRowButton(if (rule.enabled) "●" else "○") {
                TrafficRulesStore.toggleEnabled(rule.id)
                refreshTrafficRulesList()
            }
            val editBtn = trafficRuleRowButton("✎") { openTrafficRuleForm(rule.id) }
            val deleteBtn = trafficRuleRowButton("🗑") {
                TrafficRulesStore.remove(rule.id)
                if (trEditingRuleId == rule.id) closeTrafficRuleForm()
                refreshTrafficRulesList()
            }
            val moveUpBtn = trafficRuleRowButton("▲") { TrafficRulesStore.move(rule.id, -1); refreshTrafficRulesList() }.apply {
                isEnabled = index > 0; alpha = if (index > 0) 1f else 0.3f
            }
            val moveDownBtn = trafficRuleRowButton("▼") { TrafficRulesStore.move(rule.id, 1); refreshTrafficRulesList() }.apply {
                isEnabled = index < rules.size - 1; alpha = if (index < rules.size - 1) 1f else 0.3f
            }
            row.addView(swatch)
            row.addView(summary, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(moveUpBtn)
            row.addView(moveDownBtn)
            row.addView(toggleBtn)
            row.addView(editBtn)
            row.addView(deleteBtn)
            container.addView(row)
        }
        if (rules.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "No traffic rules yet."
                setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
                textSize = 12f
                typeface = VcasFonts.display(this@MainActivity)
            })
        }
    }

    private fun trafficRuleRowButton(label: String, onClick: () -> Unit): TextView = TextView(this).apply {
        text = label
        setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
        textSize = 14f
        setPadding(14, 4, 14, 4)
        setOnClickListener { onClick() }
    }

    /** Direct instruction: "filter and highlight share ONE rule-building
     * UI with a per-rule mode" — new-rule buttons pick the mode, the form
     * itself doesn't re-offer it. Starts DISABLED (TrafficRulesStore.add()'s
     * own doc comment) — a real footgun the same instant it's created if
     * left enabled, since empty conditions match every aircraft. */
    private fun onAddTrafficRuleClick(mode: TrafficRulesLogic.RuleMode) {
        val rule = TrafficRulesStore.add(mode)
        trPendingNewRuleId = rule.id
        openTrafficRuleForm(rule.id)
        refreshTrafficRulesList()
    }

    private fun openTrafficRuleForm(ruleId: String) {
        val rule = TrafficRulesStore.list().find { it.id == ruleId } ?: return
        trEditingRuleId = ruleId
        trEditingConditions = rule.conditions
        trEditingColor = rule.color
        trEditingMode = rule.mode
        trTypeQueryInput?.setText(rule.conditions.typeQuery)
        trAltFtInput?.setText(rule.conditions.altitude.ft.roundToInt().toString())
        trModeLabel?.text = if (rule.mode == TrafficRulesLogic.RuleMode.HIGHLIGHT) "Highlight rule" else "Filter rule"
        trColorRow?.visibility = if (rule.mode == TrafficRulesLogic.RuleMode.HIGHLIGHT) View.VISIBLE else View.GONE
        refreshTrafficRuleFormButtons()
        trafficRuleFormView?.visibility = View.VISIBLE
    }

    /** Cancel on a just-created, never-saved rule deletes it outright
     * (mirrors app.js's `_trPendingNewRuleId` handling exactly) — Cancel
     * on an EXISTING rule's edit only discards the in-form changes. */
    private fun onTrafficRuleFormCancel() {
        val pendingId = trPendingNewRuleId
        val editingId = trEditingRuleId
        if (pendingId != null && pendingId == editingId) {
            TrafficRulesStore.remove(pendingId)
        }
        closeTrafficRuleForm()
        refreshTrafficRulesList()
    }

    private fun onTrafficRuleFormSave() {
        val id = trEditingRuleId ?: return
        val existing = TrafficRulesStore.list().find { it.id == id } ?: return
        // Saving a brand-new rule is what actually enables it — see
        // TrafficRulesStore.add()'s own "starts disabled" doc comment.
        val enabled = if (id == trPendingNewRuleId) true else existing.enabled
        TrafficRulesStore.update(existing.copy(conditions = trEditingConditions, color = trEditingColor, enabled = enabled))
        closeTrafficRuleForm()
        refreshTrafficRulesList()
    }

    private fun closeTrafficRuleForm() {
        trPendingNewRuleId = null
        trEditingRuleId = null
        trafficRuleFormView?.visibility = View.GONE
    }

    private fun refreshTrafficRuleFormButtons() {
        trCategoryBtn?.text = TrafficRulesLogic.CATEGORIES[trEditingConditions.category] ?: "Any category"
        trAltEnabledBtn?.let { setToggleActive(it, trEditingConditions.altitude.enabled); it.text = if (trEditingConditions.altitude.enabled) "On" else "Off" }
        trAltDirectionBtn?.text = if (trEditingConditions.altitude.direction == TrafficRulesLogic.AltitudeDirection.BELOW) "Below" else "Above"
        trTrafficBtn?.text = when (trEditingConditions.traffic) {
            TrafficRulesLogic.Traffic.MILITARY -> "Military (OAT)"
            TrafficRulesLogic.Traffic.CIVIL -> "Civil (GAT)"
            TrafficRulesLogic.Traffic.ANY -> "Any"
        }
        trColorRow?.let { row ->
            for (i in 0 until row.childCount) {
                val swatch = row.getChildAt(i) as? TextView ?: continue
                val swatchColor = swatch.tag as? String ?: continue
                (swatch.background as? android.graphics.drawable.GradientDrawable)?.setStroke(
                    (if (swatchColor == trEditingColor) 3f else 1f).let { (it * resources.displayMetrics.density).roundToInt() },
                    if (swatchColor == trEditingColor) Color.WHITE else VcasPalette.parse(VcasPalette.BORDER)
                )
            }
        }
    }

    /**
     * One shared inline form, reused for both add and edit — direct
     * instruction confirmed via `AskUserQuestion` before building this:
     * "filter and highlight share ONE rule-building UI with a per-rule
     * mode." Category selection uses a real `PopupMenu` (18 real options —
     * a tap-to-cycle button would be tedious at that count); altitude
     * direction and traffic (any/military/civil) cycle on tap (only 2-3
     * options each) — same tap-only, no-drag-gesture convention this
     * project already applies to every other settings control.
     */
    private fun buildTrafficRuleForm(): View {
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL_ALT))
            setPadding(24, 20, 24, 20)
            visibility = View.GONE
        }

        val modeLabel = TextView(this).apply {
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 0, 0, 12)
        }
        trModeLabel = modeLabel
        form.addView(modeLabel)

        val typeInput = EditText(this).apply {
            hint = "Type contains… (e.g. A320, or MiG,Su,Tu)"
            setHintTextColor(VcasPalette.parse(VcasPalette.TEXT_MUTED))
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity)
            setSingleLine(true)
            setBackgroundColor(Color.TRANSPARENT)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    trEditingConditions = trEditingConditions.copy(typeQuery = s?.toString() ?: "")
                }
            })
        }
        trTypeQueryInput = typeInput
        form.addView(typeInput)

        val categoryBtn = trafficRuleFormRow("Category") { btn ->
            btn.setOnClickListener {
                val popup = android.widget.PopupMenu(this@MainActivity, btn)
                popup.menu.add(0, 0, 0, "Any category")
                TrafficRulesLogic.CATEGORIES.values.forEachIndexed { i, label -> popup.menu.add(0, i + 1, i + 1, label) }
                val keys = listOf("any") + TrafficRulesLogic.CATEGORIES.keys.toList()
                popup.setOnMenuItemClickListener { item ->
                    trEditingConditions = trEditingConditions.copy(category = keys.getOrElse(item.itemId) { "any" })
                    refreshTrafficRuleFormButtons()
                    true
                }
                popup.show()
            }
        }
        trCategoryBtn = categoryBtn
        form.addView(trafficRuleFormLabeledRow("Category", categoryBtn))

        val altEnabledBtn = trafficRuleFormRow("Altitude") { btn ->
            btn.setOnClickListener {
                trEditingConditions = trEditingConditions.copy(altitude = trEditingConditions.altitude.copy(enabled = !trEditingConditions.altitude.enabled))
                refreshTrafficRuleFormButtons()
            }
        }
        trAltEnabledBtn = altEnabledBtn
        val altDirBtn = trafficRuleFormRow("Direction") { btn ->
            btn.setOnClickListener {
                val next = if (trEditingConditions.altitude.direction == TrafficRulesLogic.AltitudeDirection.ABOVE) TrafficRulesLogic.AltitudeDirection.BELOW else TrafficRulesLogic.AltitudeDirection.ABOVE
                trEditingConditions = trEditingConditions.copy(altitude = trEditingConditions.altitude.copy(direction = next))
                refreshTrafficRuleFormButtons()
            }
        }
        trAltDirectionBtn = altDirBtn
        val altRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        altRow.addView(altEnabledBtn)
        altRow.addView(altDirBtn)
        form.addView(trafficRuleFormLabeledRow("Altitude condition", altRow))

        val altFtInput = EditText(this).apply {
            hint = "Threshold (ft)"
            setHintTextColor(VcasPalette.parse(VcasPalette.TEXT_MUTED))
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 13f
            typeface = VcasFonts.mono(this@MainActivity)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
            setBackgroundColor(Color.TRANSPARENT)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    val ft = s?.toString()?.toDoubleOrNull() ?: return
                    trEditingConditions = trEditingConditions.copy(altitude = trEditingConditions.altitude.copy(ft = ft))
                }
            })
        }
        trAltFtInput = altFtInput
        form.addView(altFtInput)

        val trafficBtn = trafficRuleFormRow("Traffic") { btn ->
            btn.setOnClickListener {
                val next = when (trEditingConditions.traffic) {
                    TrafficRulesLogic.Traffic.ANY -> TrafficRulesLogic.Traffic.MILITARY
                    TrafficRulesLogic.Traffic.MILITARY -> TrafficRulesLogic.Traffic.CIVIL
                    TrafficRulesLogic.Traffic.CIVIL -> TrafficRulesLogic.Traffic.ANY
                }
                trEditingConditions = trEditingConditions.copy(traffic = next)
                refreshTrafficRuleFormButtons()
            }
        }
        trTrafficBtn = trafficBtn
        form.addView(trafficRuleFormLabeledRow("Military/civil (OAT/GAT)", trafficBtn))

        // Highlight-mode only — a real colour picker isn't a plain Android
        // widget worth pulling a dependency in for; a row of curated
        // swatches (the same Okabe-Ito-adjacent set the PWA's own
        // colour-blind-mode shortcuts use) is a simpler, still-functional
        // equivalent for a secondary settings screen.
        val colorRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (hex in trafficRuleColorSwatches) {
            val swatch = TextView(this).apply {
                text = " "
                tag = hex
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(try { Color.parseColor(hex) } catch (e: IllegalArgumentException) { Color.WHITE })
                    setSize(56, 56)
                }
                setPadding(28, 0, 0, 0)
                setOnClickListener { trEditingColor = hex; refreshTrafficRuleFormButtons() }
            }
            colorRow.addView(swatch, LinearLayout.LayoutParams(60, 60).apply { marginStart = 8 })
        }
        trColorRow = colorRow
        form.addView(trafficRuleFormLabeledRow("Highlight colour", colorRow))

        val actionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 16, 0, 0)
        }
        val cancelBtn = TextView(this).apply {
            text = "Cancel"
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 13f
            setPadding(0, 8, 32, 8)
            setOnClickListener { onTrafficRuleFormCancel() }
        }
        val saveBtn = TextView(this).apply {
            text = "Save"
            setTextColor(VcasPalette.parse(VcasPalette.ACCENT))
            textSize = 13f
            typeface = VcasFonts.display(this@MainActivity, bold = true)
            setPadding(0, 8, 0, 8)
            setOnClickListener { onTrafficRuleFormSave() }
        }
        actionsRow.addView(cancelBtn)
        actionsRow.addView(saveBtn)
        form.addView(actionsRow)

        return form
    }

    private fun trafficRuleFormRow(label: String, configure: (TextView) -> Unit): TextView {
        val btn = TextView(this).apply {
            text = label
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
            setPadding(20, 8, 20, 8)
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 8f
                setColor(VcasPalette.parse(VcasPalette.BTN_BG))
            }
        }
        configure(btn)
        return btn
    }

    private fun trafficRuleFormLabeledRow(label: String, control: View): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 12, 0, 0)
        }
        val labelText = TextView(this).apply {
            text = label
            setTextColor(VcasPalette.parse(VcasPalette.TEXT_SECONDARY))
            textSize = 12f
            typeface = VcasFonts.display(this@MainActivity)
        }
        row.addView(labelText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(control)
        return row
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
            // User-defined traffic rules (2026-09-17 sync, TrafficRulesLogic.kt/
            // TrafficRulesStore.kt) — same single filtering point every other
            // exclusion above already reads from. Highlight-mode rules are NOT
            // applied here — they never remove an aircraft, only mark it at
            // render time (RawPlotView.kt's highlightColors/renderAirMarkers()).
            if (TrafficRulesLogic.evaluateFilter(a, TrafficRulesStore.list())) return@filter false
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
            // User-defined Traffic Rules highlight (2026-09-17) — AIR/HYBRID's
            // equivalent of RawPlotView.kt's own highlightColors ring, baked
            // into the icon bitmap itself since SymbolManager markers have no
            // per-instance CSS box-shadow the way the PWA's real DOM markers do.
            val highlightColor = TrafficRulesLogic.evaluateHighlight(a, TrafficRulesStore.list())
            val iconName = PhoneAircraftIcons.iconNameFor(vis.shape, colorHex, vis.fillOpacity, a.trackDeg, highlightColor)
            if (style.getImage(iconName) == null) {
                style.addImage(iconName, PhoneAircraftIcons.bitmapFor(vis.shape, colorHex, vis.fillOpacity, a.trackDeg, highlightColor))
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
    // ORS maneuver `type` code -> guidance-card icon rotation/glyph, and
    // (RAW only) -> a plain direction word — structural port of app.js's
    // own MANEUVER_ICONS/MANEUVER_DIRECTION_WORD tables, verbatim. See
    // that file's own comment for the "unverified against a live ORS
    // response" caveat this port carries too.
    private data class ManeuverIcon(val rotationDeg: Float, val glyph: String)
    private val maneuverIcons = mapOf(
        0 to ManeuverIcon(-90f, "↑"), 1 to ManeuverIcon(90f, "↑"),
        2 to ManeuverIcon(-135f, "↑"), 3 to ManeuverIcon(135f, "↑"),
        4 to ManeuverIcon(-45f, "↑"), 5 to ManeuverIcon(45f, "↑"),
        6 to ManeuverIcon(0f, "↑"), 7 to ManeuverIcon(0f, "⟳"),
        8 to ManeuverIcon(0f, "⟳"), 9 to ManeuverIcon(180f, "↑"),
        10 to ManeuverIcon(0f, "📍"), 11 to ManeuverIcon(0f, "↑"),
        12 to ManeuverIcon(-30f, "↑"), 13 to ManeuverIcon(30f, "↑")
    )
    private val defaultManeuverIcon = ManeuverIcon(0f, "↑")
    private val maneuverDirectionWord = mapOf(
        0 to "LEFT", 1 to "RIGHT", 2 to "LEFT", 3 to "RIGHT", 4 to "LEFT", 5 to "RIGHT",
        6 to "STRAIGHT", 7 to "ROUNDABOUT", 8 to "ROUNDABOUT", 9 to "U-TURN",
        11 to "DEPART", 12 to "LEFT", 13 to "RIGHT"
    )
    private val defaultDirectionWord = "AHEAD"

    /**
     * The ManeuverTracker call itself, hoisted out of updateGuidanceCard()
     * so refreshRawMode() can compute it exactly once per tick and hand
     * the SAME result to both the guidance card and RAW's own screen-space
     * flight-plan line's turn label — matching app.js's own
     * `_computeRouteManeuver()` and its call site's comment.
     */
    private fun computeRouteManeuver(location: Location?): ManeuverTracker.NextManeuver {
        val route = activeRoute ?: return ManeuverTracker.NextManeuver(exists = false)
        if (location == null || route.steps.isEmpty()) return ManeuverTracker.NextManeuver(exists = false)
        return ManeuverTracker.nextManeuver(route.geometry, route.steps, location.longitude, location.latitude)
    }

    /**
     * A structural port of `_updateGuidanceCard()`/`_updateRouteCard()`,
     * generalised (2026-09-17 sync) to also render RAW's own merged
     * ND-style nav-status card (PWA rounds 2/5/6/9) — previously this only
     * ever showed in Hybrid, with RAW getting nothing at all (`routeInfo`
     * always null). Both the Hybrid and RAW field sets are always written
     * together when a route is active; only which ROW is VISIBLE differs
     * by mode, same "write to all targets, let display state decide"
     * pattern already used elsewhere in this port.
     *
     * @param precomputedManeuver  Optional — refreshRawMode() passes the
     *   SAME ManeuverTracker result it already computed for the flight-
     *   plan line's own turn label, so the two can't disagree. Hybrid's
     *   own call site (onLocationChanged) omits it and this function
     *   derives it itself, matching the pre-existing behaviour there.
     */
    private fun updateGuidanceCard(precomputedManeuver: ManeuverTracker.NextManeuver? = null) {
        val card = guidanceCardView ?: return
        if (currentMode != "hybrid" && currentMode != "raw") {
            card.visibility = View.GONE
            return
        }
        val isRaw = currentMode == "raw"
        val route = activeRoute

        // Matches the PWA exactly: `#nav-guidance-card` is shown/hidden
        // purely by whether `activeRoute` exists (`_showRouteCard()`/
        // `_hideGuidanceCard()`), never by mode — RAW has no destination-
        // search UI of its own (that's Hybrid's job), so a passive RAW
        // view (no route) must hide this card entirely rather than
        // showing an empty rgba(14,17,23,.85) panel with nothing in it.
        // Hybrid keeps its own pre-existing behaviour: always visible,
        // toggling between the search box and the active-route content.
        if (isRaw && route == null) {
            card.visibility = View.GONE
            return
        }
        card.visibility = View.VISIBLE
        applyGuidanceCardStyle(isRaw)

        destSearchGroupView?.visibility = if (route == null) View.VISIBLE else View.GONE
        activeRouteGroupView?.visibility = if (route == null) View.GONE else View.VISIBLE
        if (route == null) {
            // Hybrid only — the isRaw+null case already returned above.
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

        hybridEtaRow?.visibility = if (isRaw) View.GONE else View.VISIBLE
        rawEtaRow?.visibility = if (isRaw) View.VISIBLE else View.GONE
        rawEtaText?.visibility = if (isRaw) View.VISIBLE else View.GONE

        val location = lastKnownLocation
        val maneuver = precomputedManeuver ?: computeRouteManeuver(location)

        if (rerouteInFlight) {
            guidanceText?.text = "Rerouting…"
            maneuverIconText?.apply { text = "↻"; rotation = 0f }
        } else if (maneuver.exists) {
            val icon = maneuverIcons[maneuver.type] ?: defaultManeuverIcon
            maneuverIconText?.apply { text = icon.glyph; rotation = icon.rotationDeg }
            val distStr = fmtDistance(maneuver.distanceMeters ?: 0.0)
            if (isRaw) {
                // Abbreviated ND-instrument readout: "IN {dist} TURN
                // {direction}" (or bare "TURN ARRIVE" at the final step) —
                // no street names, an ND has no room for prose.
                val directionWord = if (maneuver.isArrival) "ARRIVE"
                    else (maneuverDirectionWord[maneuver.type] ?: defaultDirectionWord)
                guidanceText?.text = if (maneuver.isArrival) {
                    rawArrivalSpannable(directionWord)
                } else {
                    rawInstructionSpannable(distStr.uppercase(), directionWord)
                }
            } else {
                guidanceText?.text = if (maneuver.isArrival) {
                    maneuver.instruction ?: "Arrive at destination"
                } else {
                    "${maneuver.instruction ?: "Continue"} — $distStr"
                }
            }
        } else {
            maneuverIconText?.apply { text = "↑"; rotation = 0f }
            guidanceText?.text = "Head to destination"
        }

        if (location != null) {
            val nearest = RouteGeometry.nearestOnLine(route.geometry, location.longitude, location.latitude)
            val remainingMeters = RouteGeometry.distanceToIndex(route.geometry, nearest.segIdx, nearest.t, route.geometry.size - 1)
            val fraction = if (route.distanceMeters > 0) (remainingMeters / route.distanceMeters).coerceIn(0.0, 1.0) else 0.0
            val remainingSeconds = route.durationSeconds * fraction
            val arrivalMs = System.currentTimeMillis() + (remainingSeconds * 1000).toLong()
            val arrivalClock = fmtClock(arrivalMs)
            etaText?.text = "${fmtDistance(remainingMeters)} · ${fmtDuration(remainingSeconds)} · ETA $arrivalClock"
            rawEtaText?.text = arrivalClock
            rawSpeedText?.text = "SPD ${currentSpeedMph().roundToInt()} MPH"
            rawDistText?.text = fmtDistance(remainingMeters)
        }
    }

    /**
     * RAW's own merged-panel look (2026-09-06 round 2) vs Hybrid's
     * Google-Maps-style banner — a position + colour override only, same
     * scope the PWA's own CSS comment describes (`_updateGuidanceCard()`/
     * `_updateRouteCard()`'s population logic is completely unchanged by
     * which style is active). rgba(14,17,23,.85) matches
     * `RawAircraftListView`'s own panel background exactly — "every
     * RAW-only panel reads as the same material," per the PWA's own
     * comment on `#nav-guidance-card`'s RAW override.
     */
    private fun applyGuidanceCardStyle(isRaw: Boolean) {
        val card = guidanceCardView as? LinearLayout ?: return
        if (isRaw) {
            card.setBackgroundColor(Color.argb((0.85f * 255).toInt(), 14, 17, 23))
            card.setPadding(20, 12, 20, 10)
            maneuverIconText?.apply { setTextColor(VcasPalette.parse(VcasPalette.RAW_TEXT)); textSize = 18f }
            guidanceText?.apply { setTextColor(VcasPalette.parse(VcasPalette.RAW_TEXT)); textSize = 13f; typeface = VcasFonts.mono(this@MainActivity, bold = true) }
        } else {
            card.setBackgroundColor(VcasPalette.parse(VcasPalette.BG_PANEL_ALT))
            card.setPadding(28, 14, 28, 14)
            maneuverIconText?.apply { setTextColor(VcasPalette.parse(VcasPalette.ACCENT)); textSize = 24f }
            guidanceText?.apply { setTextColor(VcasPalette.parse(VcasPalette.TEXT_PRIMARY)); textSize = 15f; typeface = VcasFonts.display(this@MainActivity, bold = true) }
        }
    }

    /**
     * "IN {dist} TURN {direction}" — matching `.ngc-dist-value`
     * (RAW_VALUE_CYAN) / `.ngc-direction-value` (RAW_VALUE_GREEN)'s own
     * RAW colour overrides exactly; every other run stays plain RAW_TEXT.
     */
    private fun rawInstructionSpannable(distUpper: String, directionWord: String): CharSequence {
        val sb = SpannableStringBuilder("IN ")
        val distStart = sb.length
        sb.append(distUpper)
        sb.setSpan(ForegroundColorSpan(VcasPalette.parse(VcasPalette.RAW_VALUE_CYAN)), distStart, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.append(" TURN ")
        val dirStart = sb.length
        sb.append(directionWord)
        sb.setSpan(ForegroundColorSpan(VcasPalette.parse(VcasPalette.RAW_VALUE_GREEN)), dirStart, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return sb
    }

    /** Bare "TURN {direction}" — the final-step arrival case. */
    private fun rawArrivalSpannable(directionWord: String): CharSequence {
        val sb = SpannableStringBuilder("TURN ")
        val dirStart = sb.length
        sb.append(directionWord)
        sb.setSpan(ForegroundColorSpan(VcasPalette.parse(VcasPalette.RAW_VALUE_GREEN)), dirStart, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return sb
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
    // refreshIndicators()/onRawRangeCycleClick() 1:1). ----

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

        // RAW's own merged nav-status card (2026-09-17 sync) — computed
        // once here so it can feed BOTH updateGuidanceCard() and the
        // screen-space flight-plan line's own turn label below, matching
        // app.js's own _computeRouteManeuver() hoisting reasoning exactly
        // (the guidance card and the flight-plan-line's turn label can
        // never disagree about which maneuver is "next").
        val routeManeuver = computeRouteManeuver(location)
        updateGuidanceCard(routeManeuver)

        val density = resources.displayMetrics.density
        // Includes the merged nav-status card's own real (previous-frame)
        // height when it's visible — same "measure the real chrome, don't
        // guess" reasoning topBarView/modeToggleBar's own heights already
        // rely on; a route just activated leaves the square using last
        // frame's (smaller) inset for one tick, self-correcting the next.
        val guidanceCardInset = guidanceCardView?.takeIf { it.visibility == View.VISIBLE }?.height ?: 0
        val chromeTopInset = ((topBarView?.height ?: (56 * density).toInt()) + guidanceCardInset).toDouble()
        val bottomInset = ((modeToggleBar?.height ?: (60 * density).toInt())).toDouble()
        val squareContentTop = chromeTopInset + RAW_COMPASS_RESERVED_DP * density
        val squareContentHeight = (vh - squareContentTop - bottomInset).coerceAtLeast(0.0)

        val plotSafeInsetPx = (SQUARE_EDGE_MARGIN_DP * density).toDouble()
        val desiredAnchorY = NavigationCameraEvaluator.STATE_PRESETS.getValue("NAV_RAW").anchorY
        // 2026-09-08 round-7 plot-layout rework: the plot box no longer
        // forces a literal square — it's now sized to just fit its own
        // true radius, with anchorY DERIVED from that (not a flat
        // constant). Read anchorY back from the layout itself, the exact
        // same call NavigationCameraEvaluator's own NAV_RAW branch makes
        // for the real camera (see that class's own doc comment) — one
        // shared source, so the plot and the real camera anchor can't
        // silently drift apart.
        val plotOpts = Geo.PlotLayoutOpts(
            desiredAnchorY = desiredAnchorY,
            safeInset = plotSafeInsetPx,
            fovHalfAngleDeg = Indicators.FOV_HALF_ANGLE_DEG
        )
        val square = Geo.computePlotLayout(vw, squareContentTop, squareContentHeight, plotOpts)
        val anchorY = square.anchorY

        val activeBandsNm = Indicators.RING_BANDS_NM.subList(0, selectedRangeIndex + 1)
        val selectedRangeNm = activeBandsNm.last()

        val userState = Indicators.UserState(
            lat = location.latitude,
            lon = location.longitude,
            heading = heading,
            speedMph = speedMph,
            viewportWidth = vw,
            viewportHeight = vh,
            anchorY = anchorY,
            fovHalfAngleDeg = Indicators.FOV_HALF_ANGLE_DEG,
            plotWidth = square.plotWidth,
            plotHeight = square.plotHeight,
            plotOffsetX = square.plotLeft,
            plotOffsetY = square.plotTop,
            plotSafeInset = plotSafeInsetPx,
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

        // User-defined Traffic Rules highlight (2026-09-17) — evaluated
        // once per tick against the rule list, for every plotted icon and
        // suppressed edge dot (both draw off this same map by hex).
        val rules = TrafficRulesStore.list()
        val highlightColors = (shownOnPlot + beyondRange)
            .mapNotNull { item -> TrafficRulesLogic.evaluateHighlight(item.aircraft, rules)?.let { item.aircraft.hex to it } }
            .toMap()

        rawPlotView.update(
            withinRange = shownOnPlot,
            beyondRange = beyondRange,
            headingDeg = heading,
            speedMph = speedMph,
            routeLine = computeRawRouteLine(location, heading, square, anchorY, plotSafeInsetPx, activeBandsNm, routeManeuver),
            routeActive = activeRoute != null,
            square = square,
            anchorY = anchorY,
            bandsNm = activeBandsNm,
            selectedRangeNm = selectedRangeNm,
            selectedHex = selectedHex,
            chromeTopInsetPx = chromeTopInset.toFloat(),
            colorblindSafe = VcasSettings.isColorblindSafeEnabled(),
            highlightColors = highlightColors
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
        // 2026-09-16/17 sync (PWA "RAW aircraft-list panel bounded to the
        // selected range"): the list now shows only `withinRange` — the
        // same range-filtered, already-priority-sorted subset the plot's
        // own icons are capped from — not the full relevant set out to the
        // 50nm reach. There is no longer a resort control (round 1) or a
        // "beyond range, dimmed" row state (round 1 removed the sort UI;
        // this later fix removed the now-impossible beyond-range case
        // entirely, since nothing rendered here can be beyond the selected
        // range any more).
        rawListView.update(withinRange, selectedHex, VcasSettings.isColorblindSafeEnabled())
    }

    /**
     * RAW's own screen-space flight-plan line (2026-09-06 PWA round 2) —
     * a structural port of `ui.js`'s `renderRouteLine()`. Deliberately NOT
     * the real geo-referenced route line `PhoneMapContainer` draws (that's
     * hidden while RAW is active, matching `map.js`'s own
     * `_applyRouteVisibility` — RAW's dots/rings plot on a banded
     * screen-space scale, not the map's real geographic zoom, so the two
     * would disagree exactly like the historical "rings vs dots" mismatch
     * this project has already hit and fixed once). Built from the
     * identical `Geo.projectToPolarPosition` call the aircraft dots use,
     * with the same square/anchor/bands/FOV params, so a plotted turn can
     * never disagree with where the rings/dots put the same real-world
     * distance. Returns null (clearing the line) whenever there's no
     * active route, no GPS fix, or fewer than 2 projectable points ahead
     * of the user — mirroring `renderRouteLine()`'s own early-return/
     * `clearRouteLine()` calls.
     */
    private fun computeRawRouteLine(
        location: Location,
        heading: Double,
        square: Geo.PlotLayout,
        anchorY: Double,
        safeInsetPx: Double,
        bandsNm: List<Double>,
        routeManeuver: ManeuverTracker.NextManeuver
    ): RawPlotView.RouteLine? {
        val route = activeRoute ?: return null
        val coords = route.geometry
        if (coords.size < 2) return null
        val nearest = RouteGeometry.nearestOnLine(coords, location.longitude, location.latitude)
        val aheadCoords = coords.subList(nearest.segIdx, coords.size)
        val turnIndex = if (routeManeuver.exists && routeManeuver.targetCoordIndex != null) {
            max(0, routeManeuver.targetCoordIndex - nearest.segIdx)
        } else null

        val points = mutableListOf<Geo.Point>()
        var turnPoint: Geo.Point? = null
        for (i in aheadCoords.indices) {
            if (points.size >= ROUTE_LINE_MAX_POINTS) break
            val lon = aheadCoords[i][0]
            val lat = aheadCoords[i][1]
            val bearing = Geo.calculateBearing(location.latitude, location.longitude, lat, lon)
            val relativeBearing = Geo.calculateRelativeBearing(bearing, heading)
            val rangeNm = Geo.calculateDistanceNm(location.latitude, location.longitude, lat, lon)
            val pos = Geo.projectToPolarPosition(
                relativeBearing, rangeNm, square.plotWidth, square.plotHeight, bandsNm,
                anchorY, safeInsetPx, Indicators.FOV_HALF_ANGLE_DEG, square.plotLeft, square.plotTop
            ) ?: break // outside the FOV — stop rather than exact-clip, matching renderRouteLine()
            points.add(pos)
            if (turnIndex != null && i == turnIndex) turnPoint = pos
        }
        if (points.size < 2) return null

        return RawPlotView.RouteLine(points, turnPoint, routeManeuver.name?.takeIf { it.isNotBlank() })
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

        // RAW's own screen-space flight-plan line — matches ui.js's own
        // ROUTE_LINE_MAX_POINTS exactly: "rudimentary" per spec, a hard
        // cap rather than exact FOV clipping.
        private const val ROUTE_LINE_MAX_POINTS = 30

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
