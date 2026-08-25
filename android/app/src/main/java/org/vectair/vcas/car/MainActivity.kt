package org.vectair.vcas.car

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

/**
 * Phone-side entry point — what shows if someone taps VCAS's icon in their
 * app drawer directly, rather than through Android Auto. NOT what Android
 * Auto itself uses to discover/launch the car app (that's driven entirely
 * by VcasCarAppService's own manifest intent-filter, independent of this
 * activity existing at all) — added for parity with every real Car App
 * Library sample, which all have one, and to remove the harmless-but-
 * confusing "Default Activity not found" Android Studio warning phase 1
 * originally shipped without it.
 *
 * Deliberately minimal and built without a layout resource — phase 1 has
 * no real content to show yet (no GPS, no ADS-B, no map; see
 * VcasCarAppService.kt's own doc comment). Plain android.app.Activity
 * rather than androidx.activity.ComponentActivity specifically to avoid
 * pulling in a new Maven dependency whose current version this sandbox
 * can't verify live (dl.google.com is blocked — see android/README.md) —
 * a phase-1 placeholder screen has no need for anything ComponentActivity
 * adds over the plain SDK base class.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            text = "VCAS\n\nOpen Android Auto while connected to your car — " +
                "VCAS will appear in the car's app list."
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#12181c"))
        }
        setContentView(text)
    }
}
