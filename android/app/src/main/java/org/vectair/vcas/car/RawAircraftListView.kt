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
 * RAW mode's sortable aircraft-list panel (PWA "Stage 3") — a faithful
 * port of `ui.js`'s `renderAircraftList()` markup/behaviour, built as a
 * real Android view (a header row of sort buttons + a scrollable list of
 * rows) rather than Canvas-drawn, since this is genuinely a scrolling
 * list widget — the same reasoning `MainActivity.kt`'s own doc comment
 * already gives for using a real `SymbolManager`/`MapView` instead of
 * hand-rolling equivalents elsewhere in this app.
 *
 * Positioned by the caller (`MainActivity`) at exactly
 * `Geo.computeSquarePlotLayout()`'s own `rows` rect — the region
 * complementary to the 1:1 square `RawPlotView` occupies (below it in
 * portrait, to its right in landscape) — so it can never disagree with
 * where the plot itself decided it has room to exist.
 */
class RawAircraftListView(context: Context) : LinearLayout(context) {

    var onSortClick: ((String) -> Unit)? = null
    var onRowClick: ((Indicators.IndicatorItem) -> Unit)? = null

    private val density = context.resources.displayMetrics.density
    private fun dp(v: Float) = (v * density).roundToInt()

    private val sortButtons = mutableMapOf<String, TextView>()
    private val rowsContainer = LinearLayout(context).apply { orientation = VERTICAL }
    private val scrollView = ScrollView(context)

    private val sortModes = listOf("priority" to "PRI", "range" to "RNG", "altitude" to "ALT", "type" to "TYP")

    init {
        orientation = VERTICAL
        setBackgroundColor(Color.argb((0.85f * 255).toInt(), 14, 17, 23))

        val header = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setBackgroundColor(Color.argb((0.0f * 255).toInt(), 0, 0, 0))
        }
        sortModes.forEach { (key, label) ->
            val btn = TextView(context).apply {
                text = label
                gravity = Gravity.CENTER
                setTextColor(Color.argb((0.55f * 255).toInt(), 240, 240, 240))
                textSize = 9f
                setPadding(dp(2f), dp(6f), dp(2f), dp(6f))
                setOnClickListener { onSortClick?.invoke(key) }
            }
            sortButtons[key] = btn
            header.addView(btn, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        }
        addView(header, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

        scrollView.addView(rowsContainer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(scrollView, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))
    }

    fun update(
        items: List<Indicators.IndicatorItem>,
        sortMode: String,
        beyondRangeHexes: Set<String>,
        selectedHex: String?,
        colorblindSafe: Boolean = false
    ) {
        sortButtons.forEach { (key, btn) ->
            val active = key == sortMode
            btn.setBackgroundColor(if (active) Color.argb((0.16f * 255).toInt(), 240, 240, 240) else Color.TRANSPARENT)
            btn.setTextColor(if (active) Color.rgb(240, 240, 240) else Color.argb((0.55f * 255).toInt(), 240, 240, 240))
        }

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
                val beyond = beyondRangeHexes.contains(a.hex)
                alpha = if (beyond) 0.5f else 1f
                if (a.hex == selectedHex) setBackgroundColor(Color.argb((0.14f * 255).toInt(), 255, 255, 0))
                setOnClickListener { onRowClick?.invoke(item) }
            }

            // Same colourblind-wins-over-RAW-fidelity priority as
            // RawPlotView.kt's own displayColorHex() — see that function's
            // doc comment for the full reasoning (mirrors ui.js's
            // _displayColor()).
            val colorHex = if (colorblindSafe) item.vis.colorblindSafe.ifBlank { item.vis.color } else item.vis.colorRaw.ifBlank { item.vis.color }
            val dotColor = try { android.graphics.Color.parseColor(colorHex) } catch (e: IllegalArgumentException) { Color.WHITE }
            val dot = View(context).apply {
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(dotColor)
                }
            }
            row.addView(dot, LayoutParams(dp(8f), dp(8f)).apply { rightMargin = dp(6f) })

            val info = LinearLayout(context).apply { orientation = VERTICAL }
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
                setTextColor(Color.argb((0.6f * 255).toInt(), 240, 240, 240))
                textSize = 9f
            }
            info.addView(callsign)
            info.addView(meta)
            row.addView(info, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))

            rowsContainer.addView(row, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        }
    }
}
