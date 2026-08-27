package org.vectair.vcas.car

import android.content.Context
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat

/**
 * B612 / B612 Mono — the real Airbus flight-deck typeface, bundled as
 * actual `.ttf` files (`res/font/`) rather than Android's Downloadable
 * Fonts API (which depends on Google Play Services being present/
 * up to date on the device — an extra runtime dependency this project
 * has otherwise consistently avoided) or a CSS `@font-face`-style remote
 * fetch (native has no such mechanism at all). Same real font files the
 * PWA's own Google Fonts `<link>` serves — downloaded directly from
 * `fonts.gstatic.com` (the same CDN the PWA's request ultimately
 * resolves to), not a look-alike substitute.
 *
 * Only 400 (regular) and 700 (bold) weights are bundled for B612 — same
 * as the PWA's own `family=B612:wght@400;700` — and only 400 for B612
 * Mono, since Google Fonts doesn't publish a bold B612 Mono at all (the
 * PWA's own CSS comment already notes this: a `font-weight:700` on B612
 * Mono there falls back to the browser's synthesized bold). Android's
 * `Typeface` has the same synthesis behaviour via `Typeface.create(base,
 * Typeface.BOLD)`, so `mono(bold=true)` mirrors that rather than needing
 * a bold `.ttf` that doesn't exist.
 *
 * `ResourcesCompat.getFont()` (androidx.core, already a dependency) is
 * used over the plain framework `Resources.getFont()`/`context.
 * resources.getFont()` specifically because the latter is API 26+;
 * `ResourcesCompat` back-fills to this project's real `minSdk` (23).
 */
object VcasFonts {
    private var displayRegular: Typeface? = null
    private var displayBold: Typeface? = null
    private var monoRegular: Typeface? = null

    /** B612 — display/label text (matches CSS `font-family: 'B612', ...`). */
    fun display(context: Context, bold: Boolean = false): Typeface {
        return if (bold) {
            displayBold ?: (ResourcesCompat.getFont(context, R.font.b612_bold) ?: Typeface.DEFAULT_BOLD).also { displayBold = it }
        } else {
            displayRegular ?: (ResourcesCompat.getFont(context, R.font.b612_regular) ?: Typeface.DEFAULT).also { displayRegular = it }
        }
    }

    /** B612 Mono — digital/numeric readouts (matches CSS `font-family: 'B612 Mono', monospace`). */
    fun mono(context: Context, bold: Boolean = false): Typeface {
        val base = monoRegular ?: (ResourcesCompat.getFont(context, R.font.b612_mono_regular) ?: Typeface.MONOSPACE).also { monoRegular = it }
        return if (bold) Typeface.create(base, Typeface.BOLD) else base
    }
}
