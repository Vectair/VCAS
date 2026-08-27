package org.vectair.vcas.car

import android.graphics.Color

/**
 * VCAS's real cockpit-panel colour palette — the Night theme values from
 * `src/styles/VCAS.css`'s `:root` block, copied as literal hex, not
 * approximated. See that file's own doc comment for the full provenance
 * (pixel-sampled from a real A320 panel reference photo; Day/Night are
 * one material lit differently, not two independently-chosen palettes).
 *
 * This phone app has no Day/Night toggle yet (2026-08-26) — same
 * "always dark" precedent RAW mode's own map content already sets in the
 * PWA ("RAW has no day mode for a cockpit instrument"), extended here to
 * the whole native app rather than just one display mode, since there's
 * no settings screen yet to host a toggle. Revisiting this once Hybrid
 * mode (which DOES want to follow ambient light, per the PWA) is built
 * is real, separate, expected follow-up — not an oversight.
 *
 * Duplicated as literals rather than read from `VCAS.css` for the same
 * reason `MAPTILER_KEY`/the chrome hex values in `PhoneMapContainer.kt`/
 * `MainActivity.kt` already are — no build-time bridge between this
 * native project and the PWA's CSS. Keep in sync by hand if the palette
 * changes.
 */
object VcasPalette {
    const val BG_DARK       = "#12181c"
    const val BG_PANEL      = "#232d34"
    const val BG_PANEL_ALT  = "#2b3840"
    const val BORDER        = "#3d505c"
    const val TEXT_PRIMARY  = "#eaeef1"
    const val TEXT_SECONDARY = "#8ba3b1"
    const val TEXT_MUTED    = "#56707d"
    const val ACCENT        = "#1191d8"
    const val ACCENT_USER   = "#9cc828"
    const val BTN_BG        = "#33434c"
    const val BTN_HOVER     = "#475e6b"
    const val BTN_ACTIVE_BG = "#1f6feb"

    // RAW mode specifically forces near-black/near-white regardless of
    // Day/Night/Auto in the PWA (see VCAS.css's own body[data-nav-style=
    // "raw"] overrides and ui.js's renderCompassRing/renderRangeRingsOverlay
    // comments on why) — these are that forced palette, pixel-sampled from
    // a real ND reference photo, not the general chrome palette above.
    const val RAW_BG          = "#0e1117" // rgba(14,17,23,1) — RAW's near-black instrument background
    const val RAW_TEXT        = "#f0f0f0" // compass tape ticks/labels/digital heading
    const val RAW_LUBBER      = "#ffff00" // heading-tape lubber line, pixel-sampled ownship yellow
    const val RAW_RING_STROKE = "#f0f0f0" // range ring arcs (opacity applied separately)
    const val RAW_LIST_BG     = "#0e1117"
    const val RAW_LIST_BORDER = "#f0f0f0" // used at low alpha, matching rgba(240,240,240,.18) etc.

    fun parse(hex: String): Int = Color.parseColor(hex)
}
