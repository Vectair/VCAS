package org.vectair.vcas.car

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import org.vectair.vcas.car.logic.AircraftExtrapolation
import org.vectair.vcas.car.logic.View3DLogic
import org.vectair.vcas.car.logic.Visibility
import kotlin.math.roundToInt

/**
 * 3D View's own planetarium-style scene — a structural Canvas port of the
 * PWA's `render3DView()`/`render3DWorld()`/`renderCompassTicks()`
 * (`ui.js`) driven off `View3DLogic.kt` (already ported+tested). Single
 * custom `View`: sky/ground/horizon backdrop, a compass-tick strip along
 * the top, aircraft dots plotted via `View3DLogic.projectTo3DPosition`,
 * and a fixed centre crosshair marking "where the phone is currently
 * pointing" (the dots move around it as azimuth/pitch change, not the
 * other way around — matching a real planetarium display, not AR).
 *
 * **Deliberately always-dark, no Day/Night branch** — this native app has
 * no Day/Night theming at all yet (see `VcasPalette.kt`'s own doc
 * comment, same precedent RAW mode already established); the PWA's own
 * Day-theme sky variant is skipped here as an honest simplification, not
 * silently dropped.
 *
 * **Clouds are static decorative shapes, not an animated drift** — the
 * PWA's own CSS `@keyframes` drift animation has no zero-cost Canvas
 * equivalent without a continuously-invalidating render loop, which this
 * view has no reason to pay for on a screen whose own render cadence is
 * already gated by `View3DLogic.shouldUpdateFrame()`'s anti-jitter dead
 * zone. A few fixed, semi-transparent ellipses still read as "sky
 * texture" at a glance — the toggle in Settings still controls whether
 * they draw at all, matching `VcasSettings.isView3DCloudsEnabled()`.
 */
class View3DView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    data class Item(
        val aircraft: AircraftExtrapolation.Aircraft,
        val vis: Visibility.EstimateResult,
        val pos: View3DLogic.Point
    )

    var onAircraftTap: ((Item) -> Unit)? = null

    private val density = context.resources.displayMetrics.density
    private fun dp(v: Float) = v * density

    private var items: List<Item> = emptyList()
    private var headingDeg = 0.0
    private var devicePitchDeg = 0.0
    private var cloudsEnabled = true
    private var colorblindSafe = false

    private var hitboxes: List<Pair<Item, RectF>> = emptyList()

    fun update(items: List<Item>, headingDeg: Double, devicePitchDeg: Double, cloudsEnabled: Boolean, colorblindSafe: Boolean = false) {
        this.items = items
        this.headingDeg = headingDeg
        this.devicePitchDeg = devicePitchDeg
        this.cloudsEnabled = cloudsEnabled
        this.colorblindSafe = colorblindSafe
        invalidate()
    }

    // ---- Paints ----
    private val skyPaint = Paint()
    private val groundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(20, 14, 8) }
    private val horizonPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(180, 70, 55, 35); strokeWidth = dp(2f)
    }
    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(220, 255, 255, 255) }
    private val cloudPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(55, 190, 195, 205) }
    private val crosshairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = dp(1.5f); color = Color.argb(210, 240, 240, 240)
    }
    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeWidth = dp(1.5f); color = Color.argb(220, 240, 240, 240)
    }
    private val tickLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = Paint.Align.CENTER; isFakeBoldText = true
    }
    private val dotLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textAlign = Paint.Align.CENTER
    }
    private val dotLabelBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(160, 10, 12, 16) }
    private val hintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(150, 240, 240, 240); textAlign = Paint.Align.CENTER
    }

    // Fixed decorative star positions (fraction of sky-region width/height)
    // — a static texture, not real astronomy; see this class's own doc
    // comment on why a real starfield is out of scope.
    private val starFractions = listOf(
        0.08f to 0.12f, 0.22f to 0.30f, 0.38f to 0.08f, 0.52f to 0.22f,
        0.65f to 0.35f, 0.78f to 0.10f, 0.88f to 0.28f, 0.15f to 0.45f,
        0.45f to 0.48f, 0.92f to 0.50f
    )

    // Cloud shapes: (leftFrac, topFrac, widthFrac, heightFrac) within the sky region.
    private val cloudFractions = listOf(
        0.05f to Triple(0.18f, 0.22f, 0.08f),
        0.35f to Triple(0.28f, 0.16f, 0.06f),
        0.60f to Triple(0.34f, 0.20f, 0.07f),
        0.15f to Triple(0.55f, 0.14f, 0.05f),
        0.70f to Triple(0.60f, 0.18f, 0.06f)
    )

    init {
        tickLabelPaint.textSize = dp(11f)
        dotLabelPaint.textSize = dp(10f)
        hintPaint.textSize = dp(12f)
        setWillNotDraw(false)
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        drawWorld(canvas, w, h)
        drawCompassTicks(canvas, w)
        val newHitboxes = mutableListOf<Pair<Item, RectF>>()
        drawAircraft(canvas, w, h, newHitboxes)
        drawCrosshair(canvas, w, h)
        hitboxes = newHitboxes

        if (items.isEmpty()) {
            canvas.drawText("Point your phone at the sky to find nearby aircraft", w / 2f, h * 0.6f, hintPaint)
        }
    }

    private fun drawWorld(canvas: Canvas, w: Float, h: Float) {
        val horizonY = View3DLogic.horizonScreenY(devicePitchDeg, h.toDouble()).toFloat()

        skyPaint.shader = LinearGradient(0f, 0f, 0f, horizonY.coerceAtLeast(1f), Color.rgb(4, 6, 14), Color.rgb(20, 26, 46), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, w, horizonY, skyPaint)
        canvas.drawRect(0f, horizonY, w, h, groundPaint)
        canvas.drawLine(0f, horizonY, w, horizonY, horizonPaint)

        if (horizonY > 0f) {
            for ((fx, fy) in starFractions) {
                val sy = fy * horizonY
                if (sy in 0f..horizonY) canvas.drawCircle(fx * w, sy, dp(1.3f), starPaint)
            }
            if (cloudsEnabled) {
                for ((leftFrac, dims) in cloudFractions) {
                    val (topFrac, wFrac, hFrac) = dims
                    val cx = leftFrac * w + (wFrac * w) / 2f
                    val cy = topFrac * horizonY
                    canvas.drawOval(
                        RectF(cx - wFrac * w / 2f, cy - hFrac * horizonY / 2f, cx + wFrac * w / 2f, cy + hFrac * horizonY / 2f),
                        cloudPaint
                    )
                }
            }
        }
    }

    private fun drawCompassTicks(canvas: Canvas, w: Float) {
        val ticks = View3DLogic.compassTicks(headingDeg, w.toDouble())
        for (tick in ticks) {
            val x = tick.x.toFloat()
            val tickH = if (tick.major) dp(12f) else dp(6f)
            canvas.drawLine(x, dp(6f), x, dp(6f) + tickH, tickPaint)
            if (tick.major && tick.label != null) {
                canvas.drawText(tick.label, x, dp(6f) + tickH + tickLabelPaint.textSize, tickLabelPaint)
            }
        }
    }

    private fun drawAircraft(canvas: Canvas, w: Float, h: Float, hitboxesOut: MutableList<Pair<Item, RectF>>) {
        for (item in items) {
            val x = item.pos.x.toFloat()
            val y = item.pos.y.toFloat()
            val colorHex = if (colorblindSafe) item.vis.colorblindSafe.ifBlank { item.vis.color } else item.vis.color
            val color = try { android.graphics.Color.parseColor(colorHex) } catch (e: IllegalArgumentException) { Color.WHITE }
            val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }
            canvas.drawCircle(x, y, dp(5f), dotPaint)
            canvas.drawCircle(x, y, dp(5f), Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; this.color = Color.argb(200, 10, 10, 10); strokeWidth = dp(1f) })

            val label = item.aircraft.callsign?.trim()?.takeIf { it.isNotEmpty() } ?: item.aircraft.hex
            val labelW = dotLabelPaint.measureText(label)
            val labelY = y + dp(18f)
            canvas.drawRoundRect(
                RectF(x - labelW / 2f - dp(4f), labelY - dp(11f), x + labelW / 2f + dp(4f), labelY + dp(3f)),
                dp(3f), dp(3f), dotLabelBgPaint
            )
            canvas.drawText(label, x, labelY, dotLabelPaint)

            hitboxesOut.add(item to RectF(x - dp(16f), y - dp(16f), x + dp(16f), labelY + dp(4f)))
        }
    }

    private fun drawCrosshair(canvas: Canvas, w: Float, h: Float) {
        val cx = w / 2f
        val cy = h / 2f
        canvas.drawCircle(cx, cy, dp(10f), crosshairPaint)
        canvas.drawLine(cx - dp(16f), cy, cx - dp(6f), cy, crosshairPaint)
        canvas.drawLine(cx + dp(6f), cy, cx + dp(16f), cy, crosshairPaint)
        canvas.drawLine(cx, cy - dp(16f), cx, cy - dp(6f), crosshairPaint)
        canvas.drawLine(cx, cy + dp(6f), cx, cy + dp(16f), crosshairPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action != MotionEvent.ACTION_UP) return true
        val x = event.x
        val y = event.y
        for ((item, rect) in hitboxes) {
            if (rect.contains(x, y)) {
                onAircraftTap?.invoke(item)
                return true
            }
        }
        return true
    }
}
