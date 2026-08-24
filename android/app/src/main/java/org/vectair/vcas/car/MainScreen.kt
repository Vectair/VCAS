package org.vectair.vcas.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/**
 * Phase 1's ENTIRE job: prove Developer Mode sideloading actually shows
 * this up and launches it on a real head unit before investing further
 * (see CLAUDE.md's "Android Auto — native rewrite scoping" note, step 1).
 * No map, no traffic overlay, no real content — that's phase 2.
 *
 * Deliberately MessageTemplate here, not NavigationTemplate — this isolates
 * "does the app launch at all" from "is my NavigationTemplate built
 * correctly," which is a materially more involved template (ActionStrip,
 * travel estimates, etc.). Once this screen is confirmed showing up on a
 * real head unit, swapping this for a minimal NavigationTemplate is the
 * very next, small step — not a separate phase.
 *
 * Caveat, stated plainly rather than glossed over: this couldn't be
 * compiled or run anywhere in this session — no Android SDK in this
 * sandbox, and Google's Maven repo (where the Car App Library itself is
 * hosted) isn't reachable from it either (see android/README.md). The
 * overall CarAppService/Session/Screen shape is long-stable, well-
 * established API and is on solid ground; the exact MessageTemplate
 * builder calls below are this project's best-confidence reconstruction
 * from documented usage, not something checked against a live SDK —
 * Android Studio's own code completion/compiler errors are the real check,
 * the first time this is actually opened.
 */
class MainScreen(carContext: CarContext) : Screen(carContext) {
    override fun onGetTemplate(): Template {
        return MessageTemplate.Builder("VCAS phase 1 — Developer Mode sideload check")
            .setTitle("VCAS")
            .setHeaderAction(Action.APP_ICON)
            .build()
    }
}
