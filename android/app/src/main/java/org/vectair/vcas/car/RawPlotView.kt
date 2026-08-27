package org.vectair.vcas.car

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import org.vectair.vcas.car.logic.Geo
import org.vectair.vcas.car.logic.Indicators
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * VCAS's real RAW-mode display — a faithful Kotlin/Canvas port of the
 * PWA's own RAW rendering, not a new design. Direct instruction
 * (2026-08-26): "I want you to build this: https://vectair.github.io/VCAS/
 * ... RAW should function essentially like it is now." Ported line-for-
 * line in spirit from `src/ui.js`'s `renderIndicators`/
 * `declutterRenderedIndicators`/`renderCompassRing`/
 * `renderRangeRingsOverlay`/`renderRangeSelector`/`renderSuppressedDots`,
 * reading the real current source (not memory/summary) before writing a
 * line of this — see CLAUDE.md's dated entry for the full design review.
 *
 * A single custom `View` draws BOTH the full-width compass tape (in the
 * reserved top strip) and the 1:1 square plot below it, matching how the
 * PWA computes both from the exact same `Geo.computeSquarePlotLayout()`
 * region so the tape, rings, and dots can never drift apart — the same
 * "one shared source, not two independently-measured versions" discipline
 * CLAUDE.md documents at length for the car-side camera anchor.
 *
 * All JS pixel values (icon size, label offsets, tick heights, etc.) are
 * treated as dp and scaled by the real device density — the PWA's CSS px
 * values are themselves resolution-independent in the same spirit.
 *
 * **Label decluttering** is the one piece that couldn't be a literal
 * translation: the PWA measures REAL rendered DOM boxes via
 * `getBoundingClientRect()` after painting; Canvas has no such pass, so
 * label width/height here comes from `Paint.measureText()` on the actual
 * two label lines (type, altitude) instead — computed BEFORE the
 * declutter pass runs, not after, but expressing the identical algorithm
 * (8 compass-direction candidates, first-clear-wins, leader-line
 * escalation up to 5 steps) against real per-aircraft label sizes rather
 * than one assumed constant size.
 */
class RawPlotView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    data class TapTargets(
        val rangeButtonRect: RectF?,
        val itemHitboxes: List<Pair<String, RectF>> // hex -> tappable rect (icon or suppressed dot)
    )

    var onAircraftTap: ((Indicators.IndicatorItem) -> Unit)? = null
    var onRangeButtonTap: (() -> Unit)? = null
    var onEmptyTap: (() -> Unit)? = null

    private val density = context.resources.displayMetrics.density
    private fun dp(v: Float) = v * density

    // ---- State supplied by the controller (MainActivity) each tick ----
    private var withinRange: List<Indicators.IndicatorItem> = emptyList()
    private var beyondRange: List<Indicators.IndicatorItem> = emptyList()
    private var headingDeg = 0.0
    private var speedMph = 0.0
    private var routeInfo: String? = null
    private var square: Geo.SquarePlotLayout? = null
    private var anchorY = 0.8
    private var bandsNm: List<Double> = Indicators.RING_BANDS_NM
    private var selectedRangeNm: Double = Indicators.RING_BANDS_NM.last()
    private var selectedHex: String? = null
    private var chromeTopInsetPx = 0f
    private var colorblindSafe = false

    private var tapTargets = TapTargets(null, emptyList())

    fun update(
        withinRange: List<Indicators.IndicatorItem>,
        beyondRange: List<Indicators.IndicatorItem>,
        headingDeg: Double,
        speedMph: Double,
        routeInfo: String?,
        square: Geo.SquarePlotLayout,
        anchorY: Double,
        bandsNm: List<Double>,
        selectedRangeNm: Double,
        selectedHex: String?,
        chromeTopInsetPx: Float,
        colorblindSafe: Boolean = false
    ) {
        this.withinRange = withinRange
        this.beyondRange = beyondRange
        this.headingDeg = headingDeg
        this.speedMph = speedMph
        this.routeInfo = routeInfo
        this.square = square
        this.anchorY = anchorY
        this.bandsNm = bandsNm
        this.selectedRangeNm = selectedRangeNm
        this.selectedHex = selectedHex
        this.chromeTopInsetPx = chromeTopInsetPx
        this.colorblindSafe = colorblindSafe
        invalidate()
    }

    /**
     * Colour selection priority — matches `ui.js`'s own `_displayColor()`
     * exactly: "Accessibility wins over reference-fidelity — colourblind-
     * safe applies even in RAW style, checked first regardless of which
     * style is active." RAW's own reference-matched `colorRaw` is the
     * fallback below that, `color` the final fallback if either is blank.
     * (The PWA's own day/night `colorDay` branch is skipped entirely here
     * — RAW forces dark regardless of theme in the PWA too, and this
     * native app has no Day/Night theming at all yet.)
     */
    private fun displayColorHex(vis: org.vectair.vcas.car.logic.Visibility.EstimateResult): String =
        if (colorblindSafe) vis.colorblindSafe.ifBlank { vis.color } else vis.colorRaw.ifBlank { vis.color }

    // ---- Paints (reused across draws) ----
    private val bgPaint = Paint().apply { color = VcasPalette.parse(VcasPalette.RAW_BG); style = Paint.Style.FILL }
    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_TEXT); alpha = (0.7f * 255).toInt(); strokeWidth = dp(1.5f)
    }
    private val tickLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_TEXT); alpha = (0.85f * 255).toInt()
        textAlign = Paint.Align.CENTER
    }
    private val lubberPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_LUBBER); alpha = (0.9f * 255).toInt(); style = Paint.Style.FILL
    }
    private val digitalPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_TEXT); textAlign = Paint.Align.CENTER
    }
    private val stripBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb((0.82f * 255).toInt(), 14, 17, 23) }
    private val stripTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_TEXT); textAlign = Paint.Align.CENTER
    }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = dp(1.5f); color = VcasPalette.parse(VcasPalette.RAW_RING_STROKE)
        alpha = (0.55f * 255).toInt()
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(dp(3f), dp(4f)), 0f)
    }
    private val ringLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = VcasPalette.parse(VcasPalette.RAW_RING_STROKE); alpha = (0.7f * 255).toInt()
        textAlign = Paint.Align.CENTER
    }
    private val rangeBtnBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb((0.85f * 255).toInt(), 14, 17, 23) }
    private val rangeBtnBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = dp(1f); color = Color.argb((0.3f * 255).toInt(), 240, 240, 240)
    }
    private val rangeBtnTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = VcasPalette.parse(VcasPalette.RAW_TEXT) }
    private val labelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb((0.88f * 255).toInt(), 14, 17, 23) }
    private val labelTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = VcasPalette.parse(VcasPalette.RAW_TEXT); textAlign = Paint.Align.CENTER }
    private val leaderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = dp(1f); alpha = (0.55f * 255).toInt() }
    private val selectedGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.YELLOW; strokeWidth = dp(2f)
    }

    init {
        tickLabelPaint.textSize = dp(12f)
        digitalPaint.textSize = dp(14f)
        digitalPaint.isFakeBoldText = true
        stripTextPaint.textSize = dp(13f)
        stripTextPaint.isFakeBoldText = true
        ringLabelPaint.textSize = dp(11f)
        rangeBtnTextPaint.textSize = dp(12f)
        rangeBtnTextPaint.isFakeBoldText = true
        labelTextPaint.textSize = dp(10f)
        setWillNotDraw(false)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        val sq = square ?: return
        drawCompassTape(canvas)
        drawRangeRings(canvas, sq)
        val hitboxes = mutableListOf<Pair<String, RectF>>()
        drawAircraft(canvas, hitboxes)
        val rangeBtnRect = drawRangeSelector(canvas, sq)
        tapTargets = TapTargets(rangeBtnRect, hitboxes)
    }

    // ---- Compass tape — port of ui.js's renderCompassRing() ----
    private fun drawCompassTape(canvas: Canvas) {
        val vw = width.toFloat()
        val cx = vw * 0.5f
        val tickTopY = chromeTopInsetPx
        val pxPerDeg = dp(6f)
        val halfSpanDeg = min(60.0, (vw / (2 * pxPerDeg)).toDouble())
        val heading = ((headingDeg % 360) + 360) % 360

        var startDeg = Math.ceil((heading - halfSpanDeg) / 10) * 10
        val endDeg = heading + halfSpanDeg

        while (startDeg <= endDeg) {
            val wrapped = ((startDeg % 360) + 360) % 360
            val x = cx + ((startDeg - heading) * pxPerDeg).toFloat()
            val isMajor = wrapped % 30 == 0.0
            val tickH = dp(if (isMajor) 14f else 8f)
            canvas.drawLine(x, tickTopY, x, tickTopY + tickH, tickPaint)
            if (isMajor) {
                val label = wrapped.toInt().toString().padStart(3, '0')
                canvas.drawText(label, x, tickTopY + tickH + dp(14f), tickLabelPaint)
            }
            startDeg += 10
        }

        // Fixed lubber line — always centred, pointing down at the tick baseline.
        val lubberPath = Path().apply {
            moveTo(cx - dp(7f), tickTopY - dp(16f))
            lineTo(cx + dp(7f), tickTopY - dp(16f))
            lineTo(cx, tickTopY - dp(2f))
            close()
        }
        canvas.drawPath(lubberPath, lubberPaint)

        val hdgRounded = Math.round(heading).toInt() % 360
        canvas.drawText(hdgRounded.toString().padStart(3, '0'), cx, tickTopY - dp(22f), digitalPaint)

        // SPD/route info strip.
        val stripY = tickTopY + dp(14f) + dp(14f) + dp(20f)
        val speedLabel = "SPD ${Math.round(speedMph)} MPH"
        val route = routeInfo
        val estWidth = { s: String -> s.length * dp(7.2f) }
        val boxW = max(estWidth(speedLabel), route?.let { estWidth(it) } ?: 0f) + dp(28f)
        val boxH = if (route != null) dp(46f) else dp(26f)
        canvas.drawRoundRect(
            RectF(cx - boxW / 2, stripY - dp(17f), cx + boxW / 2, stripY - dp(17f) + boxH),
            dp(4f), dp(4f), stripBgPaint
        )
        canvas.drawText(speedLabel, cx, stripY, stripTextPaint)
        if (route != null) {
            val routePaint = Paint(stripTextPaint).apply { textSize = dp(12f); isFakeBoldText = false; alpha = (0.85f * 255).toInt() }
            canvas.drawText(route, cx, stripY + dp(18f), routePaint)
        }
    }

    // ---- Range rings — port of ui.js's renderRangeRingsOverlay() ----
    private fun drawRangeRings(canvas: Canvas, sq: Geo.SquarePlotLayout) {
        val cx = (sq.squareLeft + sq.squareSize * 0.5).toFloat()
        val cy = (sq.squareTop + sq.squareSize * anchorY).toFloat()
        val plotRadius = Geo.circularPlotRadius(sq.squareSize, sq.squareSize, anchorY, dp(16f).toDouble(), Indicators.FOV_HALF_ANGLE_DEG)
        val fovRad = Math.toRadians(Indicators.FOV_HALF_ANGLE_DEG)

        for (nm in bandsNm) {
            val radius = (Geo.bandedRadiusFraction(nm, bandsNm) * plotRadius).toFloat()
            if (radius < dp(4f)) continue

            val rect = RectF(cx - radius, cy - radius, cx + radius, cy + radius)
            // Arc spans dead-ahead +/- FOV half-angle. Canvas angles are
            // measured clockwise from 3-o'clock; dead-ahead here is "up"
            // (-90deg in Canvas terms), matching the SVG arc this replaces.
            val startAngleDeg = Math.toDegrees(-fovRad) - 90.0
            val sweepDeg = Math.toDegrees(2 * fovRad)
            canvas.drawArc(rect, startAngleDeg.toFloat(), sweepDeg.toFloat(), false, ringPaint)

            val labelStr = if (nm == nm.toLong().toDouble()) nm.toLong().toString() else nm.toString()
            canvas.drawText(labelStr, cx, cy - radius - dp(4f), ringLabelPaint)
        }
    }

    // ---- Range selector button — port of ui.js's renderRangeSelector() ----
    private fun drawRangeSelector(canvas: Canvas, sq: Geo.SquarePlotLayout): RectF {
        val text = "${formatNm(selectedRangeNm)}NM"
        val textW = rangeBtnTextPaint.measureText(text)
        val padH = dp(8f)
        val padV = dp(4f)
        val x = (sq.squareLeft + sq.squareSize - dp(8f)).toFloat() // right edge anchor
        val y = chromeTopInsetPx + dp(48f)
        val rect = RectF(x - textW - padH * 2, y, x, y + rangeBtnTextPaint.textSize + padV * 2)
        canvas.drawRoundRect(rect, dp(4f), dp(4f), rangeBtnBgPaint)
        canvas.drawRoundRect(rect, dp(4f), dp(4f), rangeBtnBorderPaint)
        canvas.drawText(text, rect.centerX(), rect.top + rangeBtnTextPaint.textSize, rangeBtnTextPaint)
        return rect
    }

    private fun formatNm(nm: Double): String = if (nm == nm.toLong().toDouble()) nm.toLong().toString() else nm.toString()

    // ---- Aircraft: shapes, arrows, decluttered labels — port of
    // renderIndicators()/renderSuppressedDots()/declutterRenderedIndicators() ----
    private data class LabelItem(
        val hex: String,
        val iconX: Float,
        val iconY: Float,
        val lines: List<String>,
        val labelW: Float,
        val labelH: Float,
        val borderColor: Int
    )

    private val labelCandidateAnglesDeg = listOf(0f, 45f, -45f, 90f, -90f, 135f, -135f, 180f)
    private fun labelRadiusPx() = dp(24f)
    private fun leaderStepPx() = dp(18f)
    private val maxLeaderSteps = 5
    private fun obstaclePaddingPx() = dp(3f)

    private fun drawAircraft(canvas: Canvas, hitboxes: MutableList<Pair<String, RectF>>) {
        val iconObstacles = mutableListOf<Triple<String, Boolean, RectF>>() // hex, ownIconExemption, rect
        val labelItems = mutableListOf<LabelItem>()

        val iconSize = dp(20f)
        val arrowW = dp(10f)
        val arrowH = dp(14f)
        val arrowOffset = dp(18f) // matches renderIndicators()'s translateY(-18px), NAV/RAW-specific (not AIR's -16px)

        // Pass 1: draw shapes + arrows at their TRUE plotted points (never
        // moved by decluttering), and gather obstacle rects + label sizing.
        for (item in withinRange) {
            val x = (item.x ?: continue).toFloat()
            val y = (item.y ?: continue).toFloat()
            val colorHex = displayColorHex(item.vis)
            val color = try { VcasPalette.parse(colorHex) } catch (e: IllegalArgumentException) { Color.WHITE }

            val shapePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL; this.color = color
                alpha = (item.vis.fillOpacity.coerceIn(0.0, 1.0) * 255).toInt()
            }
            val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; this.color = color; strokeWidth = dp(1.5f)
            }
            val overhead = item.relevance.reason == "overhead"
            val shapeRect = drawShape(canvas, if (overhead) "overhead" else item.vis.shape, x, y, iconSize, shapePaint, strokePaint)
            iconObstacles.add(Triple(item.aircraft.hex, true, shapeRect))

            if (item.relativeTrackDeg != null) {
                val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }
                val arrowRect = drawDirectionArrow(canvas, x, y, item.relativeTrackDeg, arrowOffset, arrowW, arrowH, arrowPaint)
                iconObstacles.add(Triple(item.aircraft.hex, false, arrowRect))
            }

            if (item.aircraft.hex == selectedHex) {
                canvas.drawCircle(x, y, iconSize * 0.75f, selectedGlowPaint)
            }

            hitboxes.add(item.aircraft.hex to RectF(x - iconSize, y - iconSize, x + iconSize, y + iconSize))

            val typeLine = item.aircraft.type ?: ""
            val altLine = item.aircraft.altitudeFt?.let { "${Math.round(it)}ft" } ?: ""
            val lines = listOfNotNull(typeLine.ifBlank { null }, altLine.ifBlank { null })
            if (lines.isEmpty()) continue
            val lineW = lines.maxOf { labelTextPaint.measureText(it) }
            val labelW = max(lineW + dp(14f), dp(56f))
            val labelH = lines.size * dp(13f) + dp(6f)
            val borderColor = colorWithAlpha(color, 0x33)
            labelItems.add(LabelItem(item.aircraft.hex, x, y, lines, labelW, labelH, borderColor))
        }

        // Suppressed edge dots — bare colour dot, no shape/label/arrow.
        for (item in beyondRange) {
            val x = (item.x ?: continue).toFloat()
            val y = (item.y ?: continue).toFloat()
            val colorHex = displayColorHex(item.vis)
            val color = try { VcasPalette.parse(colorHex) } catch (e: IllegalArgumentException) { Color.WHITE }
            val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }
            canvas.drawCircle(x, y, dp(4f), dotPaint)
            if (item.aircraft.hex == selectedHex) canvas.drawCircle(x, y, dp(7f), selectedGlowPaint)
            hitboxes.add(item.aircraft.hex to RectF(x - dp(8f), y - dp(8f), x + dp(8f), y + dp(8f)))
        }

        // Pass 2: 8-point candidate label decluttering, in priority order
        // (withinRange is already sorted by Indicators.build()).
        val placedLabelRects = mutableListOf<RectF>()
        for (item in labelItems) {
            val obstacles = iconObstacles
                .filter { !(it.first == item.hex && it.second) }
                .map { it.third }
                .toMutableList()
            obstacles.addAll(placedLabelRects)

            fun rectAt(radius: Float, angleDeg: Float): RectF {
                val rad = Math.toRadians(angleDeg.toDouble())
                val cx = item.iconX + radius * sin(rad).toFloat()
                val cy = item.iconY + radius * cos(rad).toFloat()
                return RectF(cx - item.labelW / 2, cy - item.labelH / 2, cx + item.labelW / 2, cy + item.labelH / 2)
            }
            fun overlapArea(r: RectF): Float {
                var sum = 0f
                for (o in obstacles) sum += rectOverlapArea(r, o)
                return sum
            }

            var bestAngle = labelCandidateAnglesDeg[0]
            var bestOverlap = Float.MAX_VALUE
            var bestRect = rectAt(labelRadiusPx(), bestAngle)
            for (angle in labelCandidateAnglesDeg) {
                val rect = rectAt(labelRadiusPx(), angle)
                val overlap = overlapArea(rect)
                if (overlap < bestOverlap) {
                    bestOverlap = overlap; bestAngle = angle; bestRect = rect
                    if (overlap == 0f) break
                }
            }

            var finalRadius = labelRadiusPx()
            var finalRect = bestRect
            var usedLeader = false
            if (bestOverlap > 0f) {
                for (step in 1..maxLeaderSteps) {
                    val radius = labelRadiusPx() + step * leaderStepPx()
                    val rect = rectAt(radius, bestAngle)
                    val overlap = overlapArea(rect)
                    usedLeader = true
                    finalRadius = radius
                    finalRect = rect
                    if (overlap == 0f) break
                }
            }
            placedLabelRects.add(inflate(finalRect, obstaclePaddingPx()))

            if (usedLeader) {
                val rad = Math.toRadians(bestAngle.toDouble())
                val dx = finalRadius * sin(rad).toFloat()
                val dy = finalRadius * cos(rad).toFloat()
                leaderPaint.color = item.borderColor
                canvas.drawLine(item.iconX, item.iconY, item.iconX + dx, item.iconY + dy, leaderPaint)
            }

            drawLabelBox(canvas, finalRect, item.lines, item.borderColor)
        }
    }

    private fun drawShape(canvas: Canvas, shape: String, cx: Float, cy: Float, size: Float, fill: Paint, stroke: Paint): RectF {
        val half = size / 2f
        val path = Path()
        when (shape) {
            "circle" -> path.addCircle(cx, cy, half * 0.75f, Path.Direction.CW)
            "square" -> path.addRect(cx - half * 0.83f, cy - half * 0.83f, cx + half * 0.83f, cy + half * 0.83f, Path.Direction.CW)
            "overhead" -> {
                // Upward chevron — "look up" cue, matches aircraftSymbol.js's overhead override.
                path.moveTo(cx, cy - half)
                path.lineTo(cx + half * 0.9f, cy + half * 0.7f)
                path.lineTo(cx - half * 0.9f, cy + half * 0.7f)
                path.close()
            }
            else -> { // diamond (default)
                path.moveTo(cx, cy - half)
                path.lineTo(cx + half, cy)
                path.lineTo(cx, cy + half)
                path.lineTo(cx - half, cy)
                path.close()
            }
        }
        canvas.drawPath(path, fill)
        canvas.drawPath(path, stroke)
        return RectF(cx - half, cy - half, cx + half, cy + half)
    }

    private fun drawDirectionArrow(canvas: Canvas, iconX: Float, iconY: Float, trackDeg: Double, offset: Float, w: Float, h: Float, paint: Paint): RectF {
        canvas.save()
        canvas.translate(iconX, iconY)
        canvas.rotate(trackDeg.toFloat())
        canvas.translate(-w / 2f, -offset - h)
        val path = Path().apply {
            moveTo(w * 0.5f, 0f)
            lineTo(w, h * 0.64f)
            lineTo(w * 0.5f, h * 0.46f)
            lineTo(0f, h * 0.64f)
            close()
        }
        canvas.drawPath(path, paint)
        canvas.restore()

        // Approximate bounding box in the UNROTATED frame around the icon —
        // used only as a decluttering obstacle, a slightly generous circle
        // is a safe (if not pixel-exact) stand-in for a rotated rect.
        val r = offset + h
        return RectF(iconX - r, iconY - r, iconX + r, iconY + r)
    }

    private fun drawLabelBox(canvas: Canvas, rect: RectF, lines: List<String>, borderColor: Int) {
        canvas.drawRoundRect(rect, dp(3f), dp(3f), labelBgPaint)
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(1.5f); color = borderColor }
        canvas.drawRoundRect(rect, dp(3f), dp(3f), borderPaint)
        var ty = rect.top + dp(11f)
        for (line in lines) {
            canvas.drawText(line, rect.centerX(), ty, labelTextPaint)
            ty += dp(13f)
        }
    }

    private fun colorWithAlpha(color: Int, alphaByte: Int): Int =
        Color.argb(alphaByte, Color.red(color), Color.green(color), Color.blue(color))

    private fun rectOverlapArea(a: RectF, b: RectF): Float {
        val ox = min(a.right, b.right) - max(a.left, b.left)
        val oy = min(a.bottom, b.bottom) - max(a.top, b.top)
        return if (ox > 0 && oy > 0) ox * oy else 0f
    }

    private fun inflate(r: RectF, px: Float): RectF = RectF(r.left - px, r.top - px, r.right + px, r.bottom + px)

    // ---- Touch handling ----
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_UP) return true
        val x = event.x
        val y = event.y

        tapTargets.rangeButtonRect?.let {
            if (it.contains(x, y)) { onRangeButtonTap?.invoke(); return true }
        }
        for ((hex, rect) in tapTargets.itemHitboxes) {
            if (rect.contains(x, y)) {
                val item = (withinRange + beyondRange).firstOrNull { it.aircraft.hex == hex }
                if (item != null) { onAircraftTap?.invoke(item); return true }
            }
        }
        onEmptyTap?.invoke()
        return true
    }
}
