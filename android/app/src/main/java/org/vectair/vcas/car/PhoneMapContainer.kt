package org.vectair.vcas.car

import android.app.Activity
import android.graphics.Color
import android.graphics.Paint
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.MainThread
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.plugins.annotation.SymbolManager

/**
 * Owns a real MapLibre `MapView`'s lifecycle for the phone-side, walking-
 * mode screen (2026-08-26, "bring VCAS back as a real phone-visible app").
 * Sibling to `VcasMapContainer.kt` (the car-Surface equivalent), but
 * deliberately simpler in three ways specific to running in a normal
 * `Activity` rather than being smuggled onto Android Auto's `Surface` via
 * a `Presentation`:
 *
 * 1. **No `CarContext`** — a plain `Activity`, the same as any other
 *    Android app's map screen.
 * 2. **No manual gesture math.** `VcasMapContainer`'s `onScale`/`scrollBy`
 *    exist ONLY because Android Auto's `SurfaceCallback` delivers
 *    synthetic scroll/scale calls instead of real touch events — a
 *    MapView added directly into a normal Activity view hierarchy
 *    already receives real touch/pinch/pan/rotate gestures and handles
 *    them itself via its own built-in gesture detector. Nothing to port.
 * 3. **Real `onCreate(Bundle?)`/`onSaveInstanceState(Bundle)` lifecycle
 *    calls are wired up** (see `MainActivity.kt`) — the car-Surface path
 *    skips these because a `Presentation` has no `Activity`-style
 *    save/restore lifecycle to hand a `Bundle` through; a real `Activity`
 *    does, and `MapView`'s own doc comments (confirmed by reading
 *    `MapView.java` directly, not assumed) say to call them from exactly
 *    those two Activity callbacks.
 *
 * **Map style (2026-08-26 follow-up): a real MapTiler-hosted style, not
 * the demo tiles — but NOT VCAS's own hand-built 31-layer custom style
 * either.** `src/map/navStyle.js` constructs the PWA's Hybrid/day/night
 * look layer-by-layer against raw OpenMapTiles vector tiles
 * (`api.maptiler.com/tiles/v3/tiles.json`) with VCAS's own tuned colour
 * palette — porting that whole thing to Kotlin `Style.Builder` calls is a
 * real, separate, substantially larger undertaking (comparable in scope
 * to the rest of the "genuine UI rebuild" work), not something folded
 * into this pass. What IS wired in here is MapTiler's own pre-made
 * `streets-v2` style — a single `style.json` URL, the same shape as the
 * demo-tiles URL it replaces, using the SAME key `src/config.js` already
 * has (`MAPTILER_KEY`, duplicated below rather than read from a single
 * source of truth — there's no way for Kotlin to read a `.js` file at
 * build time, the same reason the crash reporter's `LOG_ENDPOINT`/
 * `LOG_ENDPOINT_KEY` are duplicated in `index.html`; see CLAUDE.md's own
 * comment on that for the same "keep in sync by hand" caveat). Explicit
 * project-owner decision to try the existing key rather than wait on a
 * separate native-specific one — see CLAUDE.md's dated entry. Falls back
 * to the demo style on a real load failure (`OnDidFailLoadingMapListener`
 * — e.g. the key turning out to be domain/referrer-restricted against
 * native requests) rather than leaving the map blank.
 */
class PhoneMapContainer(private val activity: Activity) {

    // Duplicated from src/config.js's CONFIG.MAPTILER_KEY — see this
    // class's own doc comment above for why there's no single source of
    // truth across the JS/Kotlin boundary. Keep in sync by hand if the
    // key ever rotates.
    private val maptilerStyleUrl = "https://api.maptiler.com/maps/streets-v2/style.json?key=IIq8EPZSZfg9swGWgqbH"
    private val demoStyleUrl = "https://demotiles.maplibre.org/style.json"
    private var fellBackToDemoStyle = false

    var mapViewInstance: MapView? = null
        private set

    var mapLibreMapInstance: MapLibreMap? = null
        private set

    /**
     * Non-null once the map's style has finished loading. `SymbolManager`
     * (from the `org.maplibre.gl:android-plugin-annotation-v9` Maven
     * Central artifact — see build.gradle.kts's own comment on why this
     * dependency was added, and CLAUDE.md for the version-compatibility
     * check done before pinning it) is what actually draws VCAS's real
     * TCAS-style aircraft icons (`PhoneAircraftIcons.kt`) with a genuinely
     * centred anchor — unlike the classic, `@Deprecated` `Marker`/
     * `addMarker()` API the first pass used, which has no anchor
     * customisation at all and would have pinned icons by a fixed corner
     * instead of their true centre.
     */
    var symbolManagerInstance: SymbolManager? = null
        private set

    @MainThread
    fun createView(savedInstanceState: android.os.Bundle?): View {
        MapLibre.getInstance(activity)

        val mapView = MapView(activity, MapLibreMapOptions.createFromAttributes(activity)).apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, Paint())
            onCreate(savedInstanceState)
        }
        mapViewInstance = mapView
        mapView.getMapAsync { map ->
            mapLibreMapInstance = map
            map.setStyle(Style.Builder().fromUri(maptilerStyleUrl)) { style ->
                // SymbolManager needs a live MapView + MapLibreMap + loaded
                // Style all at once (confirmed against the real, version-
                // pinned plugin source — SymbolManager's own constructor
                // signature) — only available once this callback fires, not
                // at getMapAsync time.
                symbolManagerInstance = SymbolManager(mapView, map, style)
            }
        }

        // Real load failure (e.g. the MapTiler key rejecting a native,
        // non-browser request) falls back to the demo tiles once, rather
        // than leaving the map permanently blank. Guarded so a SECOND
        // failure (the demo style itself somehow failing) doesn't loop.
        mapView.addOnDidFailLoadingMapListener {
            if (!fellBackToDemoStyle) {
                fellBackToDemoStyle = true
                mapView.getMapAsync { map ->
                    map.setStyle(Style.Builder().fromUri(demoStyleUrl)) { style ->
                        symbolManagerInstance?.onDestroy()
                        symbolManagerInstance = SymbolManager(mapView, map, style)
                    }
                }
            }
        }

        val attribution = TextView(activity).apply {
            // MapTiler's own attribution requirement (same "cite the data
            // source, visibly, for as long as it's shown" principle
            // CLAUDE.md documents at length for adsb.fi/MapLibre) — a
            // plain-text mirror of navStyle.js's own ATTR string, since a
            // real MapLibre style.json's own embedded attribution isn't
            // surfaced as tappable UI by this SDK the way maplibre-gl-js
            // renders its bottom-right attribution control automatically.
            text = "© MapTiler © OpenStreetMap contributors"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#88000000"))
            setPadding(12, 4, 12, 4)
        }

        val frameLayout = FrameLayout(activity)
        frameLayout.addView(mapView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        frameLayout.addView(
            attribution,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.END
            )
        )
        return frameLayout
    }

    // Plain forwarding of Activity lifecycle callbacks to the MapView, per
    // MapView.java's own doc comments on each method (read directly from
    // the cloned maplibre-native source, not assumed) — a real Activity
    // has all of these, unlike the car-Surface Presentation path.
    fun onStart() = mapViewInstance?.onStart()
    fun onResume() = mapViewInstance?.onResume()
    fun onPause() = mapViewInstance?.onPause()
    fun onStop() = mapViewInstance?.onStop()
    fun onLowMemory() = mapViewInstance?.onLowMemory()
    fun onSaveInstanceState(outState: android.os.Bundle) = mapViewInstance?.onSaveInstanceState(outState)

    fun onDestroy() {
        symbolManagerInstance?.onDestroy()
        symbolManagerInstance = null
        mapViewInstance?.onDestroy()
        mapViewInstance = null
        mapLibreMapInstance = null
    }
}
