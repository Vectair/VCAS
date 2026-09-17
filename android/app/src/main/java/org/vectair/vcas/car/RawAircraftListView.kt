package org.vectair.vcas.car

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.vectair.vcas.car.logic.Indicators
import kotlin.math.roundToInt

/**
 * RAW mode's aircraft-list panel (PWA "Stage 3") — a faithful port of
 * `ui.js`'s `renderAircraftList()` markup/behaviour, built as a real
 * Android view (a title bar + a scrollable list of rows) rather than
 * Canvas-drawn, since this is genuinely a scrolling list widget — the same
 * reasoning `MainActivity.kt`'s own doc comment already gives for using a
 * real `SymbolManager`/`MapView` instead of hand-rolling equivalents
 * elsewhere in this app.
 *
 * Positioned by the caller (`MainActivity`) at exactly
 * `Geo.computePlotLayout()`'s own `rows` rect — the region complementary
 * to the plot `RawPlotView` occupies (below it in portrait, to its right
 * in landscape) — so it can never disagree with where the plot itself
 * decided it has room to exist.
 *
 * 2026-09-06/09-08 sync (PWA rounds 1/9): the PWA's own PRI/RNG/ALT/TYP
 * sort-button header was removed outright — "this is for android auto
 * there should initially be less interaction and rearranging the list is
 * not necessary" — items always render in the same priority order
 * `Indicators.build()` already produces (score desc, then proximity), no
 * resorting. The header row was later brought back as a plain, non-
 * interactive "AIRCRAFT NEARBY {count}" title bar (round 9) — a label, not
 * a control, so it doesn't reopen the interaction concern the sort-button
 * removal was about. Each row's own leading marker changed from a plain
 * colour dot to a colour-matched chevron (round 9, matching the project
 * owner's own mockup), reusing the exact same colour-selection priority.
 *
 * 2026-09-16/17 sync (PWA "RAW aircraft-list panel bounded to the selected
 * range" + "merged to one line"): the caller now hands this view only the
 * range-filtered subset (`withinRange`, matching the plot's own icons),
 * not the full relevant set out to the 50nm reach — so there is nothing
 * left that can ever be "beyond range" within this list, and the old
 * `beyondRangeHexes`/dimmed-row concept is gone entirely, not just hidden.
 * Each row's callsign + type/altitude/range are now a single horizontal
 * line (callsign never truncates — always short, the primary identifier;
 * the meta text takes the rest of the row and ellipsizes only if it
 * genuinely doesn't fit) instead of stacking as two lines, matching
 * `ui.js`'s own `.rlr-info`/`.rlr-callsign`/`.rlr-meta` CSS exactly.
 */
class RawAircraftListView(context: Context) : LinearLayout(context) {

    var onRowClick: ((Indicators.IndicatorItem) -> Unit)? = null

    private val density = context.resources.displayMetrics.density
    private fun dp(v: Float) = (v * density).roundToInt()

    private val titleBar = LinearLayout(context).apply { orientation = HORIZONTAL }
    private val titleLabel = TextView(context)
    private val titleCount = TextView(context)
    private val rowsContainer = LinearLayout(context).apply { orientation = VERTICAL }
    private val scrollView = ScrollView(context)

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.argb((0.85f * 255).toInt(), 14, 17, 23))

        titleBar.gravity = Gravity.CENTER_VERTICAL
        titleBar.setPadding(dp(8f), dp(6f), dp(8f), dp(6f))
        titleLabel.apply {
            text = "AIRCRAFT NEARBY "
            setTextColor(Color.argb((0.75f * 255).toInt(), 240, 240, 240))
            textSize = 10f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        titleCount.apply {
            text = "0"
            setTextColor(VcasPalette.parse(VcasPalette.RAW_VALUE_GREEN))
            textSize = 10f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        titleBar.addView(titleLabel)
        titleBar.addView(titleCount)
        addView(titleBar, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

        scrollView.addView(rowsContainer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(scrollView, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    }

    fun update(
        items: List<Indicators.IndicatorItem>,
        selectedHex: String?,
        colorblindSafe: Boolean = false
    ) {
        titleCount.text = items.size.toString()

        rowsContainer.removeAllViews()
        if (items.isEmpty()) {
            rowsContainer.addView(TextView(context).apply {
                text = "No traffic"
                gravity = Gravity.CENTER
                setTextColor(Color.argb((0.45f * 255).toInt(), 240, 240, 240))
                textSize = 11f
                setPadding(dp(8f), dp(10f), dp(8f), dp(10f))
            })
            return
        }

        for (item in items) {
            val a = item.aircraft
            val row = LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(8f), dp(6f), dp(8f), dp(6f))
                if (a.hex == selectedHex) setBackgroundColor(Color.argb((0.14f * 255).toInt(), 255, 255, 0))
                setOnClickListener { onRowClick?.invoke(item) }
            }

            // Same colourblind-wins-over-RAW-fidelity priority as
            // RawPlotView.kt's own displayColorHex() — see that function's
            // doc comment for the full reasoning (mirrors ui.js's
            // _displayColor()).
            val colorHex = if (colorblindSafe) item.vis.colorblindSafe.ifBlank { item.vis.color } else item.vis.colorRaw.ifBlank { item.vis.color }
            val chevronColor = try { android.graphics.Color.parseColor(colorHex) } catch (e: IllegalArgumentException) { Color.WHITE }
            // Round 9: a colour-matched chevron glyph, not a plain dot —
            // matching the project owner's own mockup, same underlying
            // per-aircraft colour the dot used.
            val chevron = TextView(context).apply {
                text = "❮" // HEAVY LEFT-POINTING ANGLE QUOTATION MARK ORNAMENT ("❮")
                setTextColor(chevronColor)
                textSize = 14f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            row.addView(chevron, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(6f) })

            // 2026-09-15 sync: callsign + type/altitude/range now share ONE
            // horizontal row (matching `.rlr-info`'s `display:flex`) rather
            // than stacking as two lines — callsign is flex-shrink:0 (never
            // truncates), meta takes the rest and ellipsizes if it doesn't
            // fit, using the width the old second line used to waste.
            val info = LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val callsign = TextView(context).apply {
                text = a.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: a.hex
                setTextColor(Color.rgb(240, 240, 240))
                textSize = 11f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            val meta = TextView(context).apply {
                val type = a.type ?: "—"
                val alt = a.altitudeFt?.let { "${it.roundToInt()}ft" } ?: "—"
                val range = "%.1fnm".format(item.distanceNm)
                text = "$type · $alt · $range"
                setTextColor(Color.rgb(240, 240, 240))
                textSize = 11f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            info.addView(callsign, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8f) })
            info.addView(meta, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            row.addView(info, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))

            rowsContainer.addView(row, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        }
    }
}
