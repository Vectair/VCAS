package org.vectair.vcas.car

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate

/**
 * Phase 2's real screen (2026-08-25) — supersedes phase 1's
 * `MainScreen`/`MessageTemplate` (see CLAUDE.md's "Android Auto — native
 * rewrite scoping" note and the phase-2 milestone entry) now that there's
 * real content to show: a live `NavigationTemplate` with `VcasMapRenderer`'s
 * MapLibre map drawn onto the car's own Surface, pan/zoom-interactive via
 * `Action.PAN`.
 *
 * Deliberately minimal beyond that, matching MapLibre's own official
 * reference sample's (`maplibre/MapLibre-Android-Auto-Sample`)
 * `CarMapScreen.kt` — no zoom in/out buttons (no icon assets exist yet
 * for them), no routing/travel-estimate info (no route exists yet — that
 * needs the `RouteGeometry.kt`/`NavigationCameraEvaluator.kt` ports
 * already done, wired up to real GPS, a later step). `Action.PAN` alone
 * is what actually enables interactive pan/zoom gestures on the Surface
 * per the Car App Library's own documented behaviour — confirmed against
 * both the official Google sample and the MapLibre reference, which
 * agree on this despite differing elsewhere (see the manifest's own
 * `ACCESS_SURFACE` comment).
 *
 * `setMapActionStrip()` requires car API level 2+ — gated the same way
 * both real references gate it, rather than assuming every host supports
 * it.
 *
 * Deliberately does NOT take a `VcasMapRenderer` reference — the
 * reference sample's own `CarMapScreen` does, purely to wire its zoom
 * in/out buttons to it, which this screen doesn't have (see above). The
 * renderer's own gesture handling (`onScale`/`onScroll`) already covers
 * pan/zoom directly through the `SurfaceCallback`, independent of any
 * `Screen`. Wiring the renderer to a `Screen` for something a `Screen`
 * genuinely needs to trigger on it (e.g. camera re-centering, once GPS
 * is wired up) is a real, expected addition for that later step — not a
 * gap being left here.
 */
class MapScreen(carContext: CarContext) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val builder = NavigationTemplate.Builder()
        builder.setActionStrip(buildActionStrip())
        if (carContext.carAppApiLevel >= 2) {
            builder.setMapActionStrip(buildMapActionStrip())
        }
        return builder.build()
    }

    private fun buildActionStrip(): ActionStrip {
        return ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle("Settings")
                    .setOnClickListener {
                        // TODO: real settings screen — VCAS's PWA already
                        // has one (src/app.js's settings-screen wiring);
                        // this is a placeholder until that's ported.
                        CarToast.makeText(carContext, "Settings not yet available", CarToast.LENGTH_LONG).show()
                    }
                    .build()
            )
            .build()
    }

    private fun buildMapActionStrip(): ActionStrip {
        return ActionStrip.Builder()
            .addAction(Action.PAN) // Enables map pan/zoom gestures on the Surface.
            .build()
    }
}
