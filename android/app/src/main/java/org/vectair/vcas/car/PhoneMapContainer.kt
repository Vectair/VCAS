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
 * Same map-style TODO as `VcasMapContainer.kt`: MapLibre's own public demo
 * tiles for now, not VCAS's real MapTiler key — that's a real product
 * decision (the key is scoped to the PWA's own web usage) still not made,
 * not an oversight here.
 */
class PhoneMapContainer(private val activity: Activity) {

    var mapViewInstance: MapView? = null
        private set

    var mapLibreMapInstance: MapLibreMap? = null
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
            map.setStyle(
                // TODO: same real-MapTiler-key decision as VcasMapContainer.kt's
                // own TODO — not wired in here either, for the same reason.
                Style.Builder().fromUri("https://demotiles.maplibre.org/style.json")
            )
        }

        val attribution = TextView(activity).apply {
            text = "© OpenStreetMap contributors"
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
        mapViewInstance?.onDestroy()
        mapViewInstance = null
        mapLibreMapInstance = null
    }
}
