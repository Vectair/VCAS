package org.vectair.vcas.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

/**
 * One Session per car-host connection (roughly: per time the phone
 * connects to a head unit). Phase 1 always hands back the same single
 * MainScreen — real multi-screen navigation (destination picker, active
 * route view) is phase 3's job.
 */
class VcasSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen {
        return MainScreen(carContext)
    }
}
