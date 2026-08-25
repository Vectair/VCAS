package org.vectair.vcas.car

import android.animation.Animator
import android.animation.ValueAnimator
import android.graphics.Paint
import android.graphics.PointF
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.MainThread
import androidx.car.app.CarContext
import org.maplibre.android.MapLibre
import org.maplibre.android.constants.MapLibreConstants
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.ln

/**
 * Owns a real MapLibre `MapView`'s lifecycle for the car-app Surface.
 * Phase 2's first real content (2026-08-25) — see CLAUDE.md's "Android
 * Auto — native rewrite scoping" note and the phase-2 milestone entry for
 * the full context on why this exists and how it was derived.
 *
 * Adapted from `CarMapContainer.kt` in MapLibre's own official reference,
 * `maplibre/MapLibre-Android-Auto-Sample` — cloned and read directly
 * (not guessed from docs or the sample's own somewhat-stale README, which
 * still describes an older manual bitmap-blitting approach the actual
 * current source code no longer uses). This class itself never touches
 * the car's `Surface` directly — see `VcasMapRenderer.kt` for how the
 * `View` this returns actually gets onto the car screen (a real Android
 * `VirtualDisplay`/`Presentation`, not anything MapLibre-specific).
 *
 * Pan/zoom gesture handling (`onScroll`/`onScale`, including the
 * reference's double-tap-to-zoom convenience) is ported as-is — genuine,
 * cheap-to-include interactivity that comes from the same verified
 * source, not custom-written and untested code.
 */
class VcasMapContainer(
    private val carContext: CarContext
) {

    var mapViewInstance: MapView? = null
        private set

    var mapLibreMapInstance: MapLibreMap? = null

    private var scaleAnimator: Animator? = null

    fun scrollBy(x: Float, y: Float) {
        mapLibreMapInstance?.scrollBy(-x, -y, 0)
    }

    private fun createScaleAnimator(
        currentZoom: Double,
        zoomAddition: Double,
        animationFocalPoint: PointF?,
    ): Animator {
        val animator = ValueAnimator.ofFloat(currentZoom.toFloat(), (currentZoom + zoomAddition).toFloat())
        animator.apply {
            duration = MapLibreConstants.ANIMATION_DURATION.toLong()
            interpolator = DecelerateInterpolator()
            addUpdateListener { animation ->
                animationFocalPoint?.let {
                    mapLibreMapInstance?.setZoom((animation.animatedValue as Float).toDouble(), it, 0)
                }
            }
        }
        return animator
    }

    private fun doubleClickZoomWithAnimation(zoomFocalPoint: PointF?, isZoomIn: Boolean) {
        cancelCurrentAnimator(scaleAnimator)
        val currentZoom = mapLibreMapInstance?.zoom
        currentZoom?.let {
            scaleAnimator = createScaleAnimator(it, if (isZoomIn) 1.0 else -1.0, zoomFocalPoint)
            scaleAnimator?.start()
        }
    }

    private fun cancelCurrentAnimator(animator: Animator?) {
        if (animator != null && animator.isStarted) {
            animator.cancel()
        }
    }

    fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        if (scaleFactor == DOUBLE_CLICK_FACTOR) {
            doubleClickZoomWithAnimation(PointF(focusX, focusY), true)
            return
        }
        if (scaleFactor == -DOUBLE_CLICK_FACTOR) {
            doubleClickZoomWithAnimation(PointF(focusX, focusY), false)
            return
        }
        val currentZoomLevel = mapLibreMapInstance?.zoom

        val zoomAdditional = (ln(scaleFactor.toDouble()) / ln(Math.PI / 2)) * MapLibreConstants.ZOOM_RATE

        currentZoomLevel?.let {
            mapLibreMapInstance?.setZoom(it + zoomAdditional, PointF(focusX, focusY), 0)
        }
    }

    @MainThread
    fun setupMap(): View {
        MapLibre.getInstance(carContext)

        val mapView = createMapViewInstance().apply {
            onStart()
            getMapAsync {
                mapViewInstance = this
                mapLibreMapInstance = it
                it.setStyle(
                    // TODO: point at VCAS's real MapTiler style once a
                    // native-app key/usage decision is made — src/config.js's
                    // MAPTILER_KEY is scoped to the PWA's own web usage and
                    // shouldn't be assumed reusable here without checking.
                    // MapLibre's own demo style is what the verified
                    // reference sample itself uses for the same reason.
                    Style.Builder().fromUri("https://demotiles.maplibre.org/style.json")
                )
            }
        }
        mapViewInstance = mapView

        // OpenStreetMap's own attribution requirement for the demo style
        // above — same "cite the data source, visibly, for as long as
        // it's shown" principle CLAUDE.md documents at length for the
        // PWA's adsb.fi/MapLibre/MapTiler credits. Placeholder wording
        // until the real MapTiler style (with its own attribution
        // requirements) replaces the demo style above.
        val attribution = TextView(carContext).apply {
            text = "© OpenStreetMap contributors"
            setTextColor(android.graphics.Color.WHITE)
        }

        val frameLayout = FrameLayout(carContext)
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

    @MainThread
    fun cleanUpMap() {
        mapLibreMapInstance = null
        mapViewInstance?.run {
            onStop()
            onDestroy()
            // Deliberately NOT porting the reference's own
            // `carContext.windowManager.removeView(this)` call here — the
            // reference's `setupMap()` never adds the MapView via
            // WindowManager (it becomes a Presentation's content view
            // instead, see setupMap() above), so that call in the
            // reference looks like a real leftover from an older
            // WindowManager-based approach their own README still
            // describes (see this file's own doc comment on that
            // staleness) rather than something that actually needs
            // porting — calling removeView() on a view that was never
            // added via that WindowManager would be expected to throw,
            // not silently no-op.
        }
        mapViewInstance = null
    }

    private fun createMapViewInstance() =
        MapView(carContext, MapLibreMapOptions.createFromAttributes(carContext)).apply {
            setLayerType(View.LAYER_TYPE_HARDWARE, Paint())
        }

    companion object {
        const val DOUBLE_CLICK_FACTOR = 2.0F
    }
}
