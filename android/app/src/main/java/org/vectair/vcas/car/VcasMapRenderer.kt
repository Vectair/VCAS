package org.vectair.vcas.car

import android.app.Presentation
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/**
 * Gets `VcasMapContainer`'s `MapView` onto the car's own Surface.
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
 */
class VcasMapRenderer(
    private val carContext: CarContext,
    serviceLifecycle: Lifecycle
) : SurfaceCallback, DefaultLifecycleObserver {

    private val mapContainer = VcasMapContainer(carContext)

    private var surfaceContainer: SurfaceContainer? = null
    private val uiHandler = Handler(Looper.getMainLooper())

    private var lastKnownStableArea = Rect()
    private var lastKnownVisibleArea = Rect()

    private var presentation: Presentation? = null
    private var virtualDisplay: VirtualDisplay? = null

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

    companion object {
        private const val LOG_TAG = "VcasMapRenderer"
    }
}
