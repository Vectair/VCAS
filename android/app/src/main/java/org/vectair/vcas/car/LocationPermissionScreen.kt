package org.vectair.vcas.car

import android.Manifest
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.Header
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.ParkedOnlyOnClickListener
import androidx.car.app.model.Template

/**
 * Asks for `ACCESS_FINE_LOCATION` directly via `CarContext.requestPermissions()`
 * (2026-08-25, phase 2 follow-up — GPS wiring).
 *
 * Adapted from Google's own official Car App Library navigation sample's
 * `RequestPermissionScreen.java` (`android/car-samples`), not the MapLibre
 * community sample's own `CarPermissionScreen.kt`/`PhonePermissionActivity.kt`
 * — the two disagree on the actual mechanism (the community sample routes
 * around a supposed inability to show a system permission dialog on a
 * phone-projected Android Auto session by launching a separate phone-side
 * Activity; Google's own sample calls `requestPermissions()` directly with
 * no such workaround and is asserted working). Followed the official
 * sample where they disagreed, same discipline phase 2's manifest
 * comments already establish for `MAP_TEMPLATES`.
 *
 * `VcasSession` pushes `MapScreen` first (as the screen stack's base) and
 * this screen on top only when permission is missing — granting it here
 * pops back to reveal the already-present map screen underneath, rather
 * than this screen owning any map-related state itself.
 */
class LocationPermissionScreen(
    carContext: CarContext,
    private val onPermissionGranted: () -> Unit
) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        val grantAction = Action.Builder()
            .setTitle("Grant Access")
            .setBackgroundColor(CarColor.GREEN)
            .setOnClickListener(
                ParkedOnlyOnClickListener.create {
                    carContext.requestPermissions(listOf(Manifest.permission.ACCESS_FINE_LOCATION)) { approved, _ ->
                        if (approved.contains(Manifest.permission.ACCESS_FINE_LOCATION)) {
                            onPermissionGranted()
                            // Real API confirmed against Google's own official
                            // sample (NavigationSession.java) — popToRoot(),
                            // not a marker-based popTo(), pops back to reveal
                            // the already-pushed MapScreen underneath.
                            carContext.getCarService(ScreenManager::class.java).popToRoot()
                        } else {
                            CarToast.makeText(carContext, "Location permission is required to track your position", CarToast.LENGTH_LONG).show()
                        }
                    }
                }
            )
            .build()

        // MessageTemplate.Builder uses a Header (title + header action bundled
        // together), not the older separate .setTitle()/.setHeaderAction()
        // calls — confirmed against this exact template in Google's own
        // RequestPermissionScreen.java, not assumed from phase 1's
        // never-independently-verified MainScreen.kt (now deleted).
        return MessageTemplate.Builder("VCAS needs location access to track your position and drive the map.")
            .setHeader(
                Header.Builder()
                    .setTitle("Location Permission")
                    .setStartHeaderAction(Action.APP_ICON)
                    .build()
            )
            .addAction(grantAction)
            .build()
    }
}
