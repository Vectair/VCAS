package org.vectair.vcas.car

import android.content.Context
import android.content.SharedPreferences

/**
 * Persisted user settings (2026-08-27) — a Kotlin port of the PWA's own
 * small settings-state modules (`src/colorblindMode.js`,
 * `src/altitudeSuppressPanel.js`), combined into one `SharedPreferences`-
 * backed object rather than three separate near-empty files' worth of
 * ceremony — this native app has no build-time module system requiring
 * that separation the way the PWA's own plain-`<script>`-tag loading did.
 * Each function/constant here has a direct, named counterpart in one of
 * those two JS files; see `MainActivity.kt`'s `buildSettingsScreen()` doc
 * comment for which PWA settings-screen sections this covers and which
 * are deliberately NOT included (Theme, the AIR range-rings toggle, Data
 * & Logging) because they have no real native effect to control yet.
 *
 * `SharedPreferences` is this platform's direct equivalent of the JS
 * modules' own `localStorage` persistence — same "small, simple,
 * synchronous key-value store" role, no reason to reach for anything
 * heavier (Room, DataStore) for three settings.
 */
object VcasSettings {
    private const val PREFS_NAME = "vcas_settings"
    private const val KEY_COLORBLIND_SAFE = "colorblind_safe"
    private const val KEY_HIDE_GROUND = "hide_ground_aircraft"
    private const val KEY_ALT_SUPPRESS_ENABLED = "alt_suppress_enabled"
    private const val KEY_ALT_SUPPRESS_FT = "alt_suppress_ft"

    // Matches AltitudeSuppressPanel.PRESETS_FT exactly.
    val ALT_SUPPRESS_PRESETS_FT = listOf(200, 500, 1000, 2000, 3000)

    // Matches CONFIG.SUPPRESS_LOW_ALTITUDE_FT (src/config.js) — the
    // fallback threshold if a preset is enabled with no prior stored
    // value, not a value any preset button itself uses.
    private const val DEFAULT_ALT_SUPPRESS_FT = 500

    private var prefs: SharedPreferences? = null

    /** Must be called once, before any other function here — see MainActivity.onCreate(). */
    fun init(context: Context) {
        if (prefs != null) return
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ---- Colour-blind-safe palette — mirrors colorblindMode.js exactly ----

    fun isColorblindSafeEnabled(): Boolean = prefs?.getBoolean(KEY_COLORBLIND_SAFE, false) ?: false

    fun toggleColorblindSafe(): Boolean {
        val next = !isColorblindSafeEnabled()
        prefs?.edit()?.putBoolean(KEY_COLORBLIND_SAFE, next)?.apply()
        return next
    }

    // ---- Ground/low-altitude traffic filtering — mirrors altitudeSuppressPanel.js ----

    // Default true — matches altitudeSuppressPanel.js's own `_hideGround = true`
    // default and its reasoning: an aircraft reported on the ground usually has
    // no usable altitude at all, so the numeric threshold below can't catch it,
    // and ground clutter near an airport was the original reported problem.
    fun isGroundHidden(): Boolean = prefs?.getBoolean(KEY_HIDE_GROUND, true) ?: true

    fun setGroundHidden(hidden: Boolean) {
        prefs?.edit()?.putBoolean(KEY_HIDE_GROUND, hidden)?.apply()
    }

    fun isAltSuppressEnabled(): Boolean = prefs?.getBoolean(KEY_ALT_SUPPRESS_ENABLED, false) ?: false

    fun altSuppressThresholdFt(): Int = prefs?.getInt(KEY_ALT_SUPPRESS_FT, DEFAULT_ALT_SUPPRESS_FT) ?: DEFAULT_ALT_SUPPRESS_FT

    /** @param ft Ignored when enabled is false — mirrors setThreshold()'s own JS signature/behaviour. */
    fun setAltSuppressThreshold(enabled: Boolean, ft: Int) {
        val editor = prefs?.edit() ?: return
        editor.putBoolean(KEY_ALT_SUPPRESS_ENABLED, enabled)
        if (enabled) editor.putInt(KEY_ALT_SUPPRESS_FT, ft)
        editor.apply()
    }
}
