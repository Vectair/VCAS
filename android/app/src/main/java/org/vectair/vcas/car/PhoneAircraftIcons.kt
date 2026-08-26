package org.vectair.vcas.car

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * Draws the real VCAS TCAS-style aircraft symbol (shape + colour + fill by
 * visibility tier, plus a direction-of-travel arrow) as an Android
 * `Bitmap`, for use as a `SymbolManager` icon image on the phone's real
 * map (2026-08-26, replacing the generic default pin markers the first
 * pass shipped with).
 *
 * A faithful port of `src/aircraftSymbol.js`'s `svg()` (shape paths, same
 * 24x24 viewBox coordinates) and `src/map.js`'s `_directionArrowSvg()`
 * (same 10x14 viewBox arrow path) — not a from-scratch redesign. The
 * `predicted`/`overhead` secondary modifiers that file also supports are
 * deliberately NOT ported here: those are Relevance-evaluation-reason
 * cues, and this screen (like the PWA's own AIR mode — see `map.js`'s
 * `_airMarkerHtml()` comment: "AIR mode shows every aircraft
 * unconditionally... no predicted/overhead modifier here") never runs
 * Relevance at all, by design (see `MainActivity.kt`'s own doc comment on
 * why this screen calls `Visibility`/`Geo` directly rather than the
 * `Indicators` pipeline).
 *
 * **Rotation matches the PWA's own CSS transform order** (`.direction-
 * arrow`'s `translate(-50%,-50%) rotate(trackDeg) translateY(-16px)`,
 * read directly from `map.js`): the arrow orbits the ICON's centre point
 * at a fixed radius — drawn first at a fixed offset "above" the icon,
 * THEN rotated by `trackDeg` around the icon's centre — rather than
 * rotating in place while floating above it. The base shape itself is
 * never rotated, matching `aircraftSymbol.js`'s own doc comment
 * ("Symbols are deliberately not rotated... position already carries
 * bearing... a separate direction-of-travel indicator carries track").
 *
 * **Bitmap layout, and why it's a square with the shape dead-centre**:
 * `SymbolManager`'s `iconAnchor` only supports the standard 9-point grid
 * (center/top/bottom/left/right/corners) — there's no way to anchor on an
 * arbitrary custom point within the image the way the classic (and
 * `@Deprecated`) `Marker`/`MarkerOptions` API's implicit bottom-center
 * pin-anchor would have forced anyway. Since the arrow can orbit the icon
 * at ANY angle depending on `trackDeg`, the bitmap is built as a square
 * with the shape's own centre placed at the bitmap's exact geometric
 * centre and a radius large enough to contain the arrow at any rotation
 * — so `Property.ICON_ANCHOR_CENTER` places the TRUE aircraft position
 * exactly at the shape's own visual centre, not offset toward wherever
 * the arrow happens to be pointing that tick.
 *
 * **Icon images are deliberately named and reused, not created fresh per
 * aircraft per poll.** `Style.addImage(name, bitmap)` with a name already
 * in use updates that image in place rather than accumulating a new one
 * — so `iconNameFor()` derives a deterministic name from the actual
 * shape/colour/fillOpacity/track-bucket values (track quantized to 15°
 * buckets, not the exact float) rather than a unique ID per call. This
 * bounds the real distinct-image count to (shapes × tiers × ~25 track
 * buckets) — a few hundred at most, reused across every poll and every
 * aircraft that happens to share the same tier/heading-bucket — instead
 * of leaking a new bitmap into the style's image cache on every 3-second
 * ADS-B poll forever.
 */
object PhoneAircraftIcons {

    // Matches aircraftSymbol.js's 24x24 SVG viewBox, scaled up for
    // visibility on a real map (the PWA's own 18-20px is tuned for a
    // screen-space overlay, not a real-world map marker).
    private const val SHAPE_VIEWBOX = 24f
    private const val SHAPE_PX = 34f

    // Matches map.js's _directionArrowSvg() 10x14 viewBox.
    private const val ARROW_VIEWBOX_W = 10f
    private const val ARROW_VIEWBOX_H = 14f
    private const val ARROW_PX_W = 16f
    private const val ARROW_PX_H = 22f
    private const val ARROW_GAP_PX = 6f // gap between the icon's edge and the arrow's tip, before rotation

    private const val TRACK_BUCKET_DEG = 15

    /** Deterministic, reused icon name for a given shape/colour/opacity/track combination. */
    fun iconNameFor(shape: String, colorHex: String, fillOpacity: Double, trackDeg: Double?): String {
        val opacityKey = (fillOpacity.coerceIn(0.0, 1.0) * 100).roundToInt()
        val trackKey = trackDeg?.let {
            val bucketed = (Math.floorMod((it.roundToInt()), 360) / TRACK_BUCKET_DEG) * TRACK_BUCKET_DEG
            "t$bucketed"
        } ?: "tnone"
        return "vcas-ac-$shape-${colorHex.removePrefix("#")}-$opacityKey-$trackKey"
    }

    fun bitmapFor(shape: String, colorHex: String, fillOpacity: Double, trackDeg: Double?): Bitmap {
        val color = try {
            Color.parseColor(colorHex)
        } catch (e: IllegalArgumentException) {
            Color.WHITE
        }

        val halfSize = SHAPE_PX / 2f + ARROW_GAP_PX + ARROW_PX_H + 2f
        val side = ceil(halfSize * 2f).toInt()
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val centerX = side / 2f
        val centerY = side / 2f

        drawShape(canvas, shape, color, fillOpacity, centerX, centerY)

        if (trackDeg != null) {
            drawDirectionArrow(canvas, color, centerX, centerY, trackDeg)
        }

        return bitmap
    }

    private fun drawShape(canvas: Canvas, shape: String, color: Int, fillOpacity: Double, centerX: Float, centerY: Float) {
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            this.color = color
            alpha = (fillOpacity.coerceIn(0.0, 1.0) * 255).roundToInt()
        }
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            this.color = color
            strokeWidth = 2.2f
            strokeJoin = Paint.Join.ROUND
        }

        val scale = SHAPE_PX / SHAPE_VIEWBOX
        val left = centerX - SHAPE_PX / 2f
        val top = centerY - SHAPE_PX / 2f
        fun px(vx: Float) = left + vx * scale
        fun py(vy: Float) = top + vy * scale

        val path = Path()
        when (shape) {
            "circle" -> path.addCircle(centerX, centerY, 9f * scale, Path.Direction.CW)
            "square" -> path.addRect(px(4f), py(4f), px(20f), py(20f), Path.Direction.CW)
            else -> {
                // "diamond", and the fallback for any unrecognised shape —
                // matches aircraftSymbol.js's own `SHAPES[tcasShape] ? tcasShape : "diamond"`.
                path.moveTo(px(12f), py(2f))
                path.lineTo(px(22f), py(12f))
                path.lineTo(px(12f), py(22f))
                path.lineTo(px(2f), py(12f))
                path.close()
            }
        }
        canvas.drawPath(path, fillPaint)
        canvas.drawPath(path, strokePaint)
    }

    private fun drawDirectionArrow(canvas: Canvas, color: Int, iconCenterX: Float, iconCenterY: Float, trackDeg: Double) {
        val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            this.color = color
        }
        val sx = ARROW_PX_W / ARROW_VIEWBOX_W
        val sy = ARROW_PX_H / ARROW_VIEWBOX_H
        // Local frame: tip at y=0 (pointing toward -Y, "away from the icon"),
        // base at y=ARROW_PX_H — matches "M5 0 L10 9 L5 6.5 L0 9 Z" from
        // map.js's _directionArrowSvg (viewBox 0 0 10 14).
        val arrowPath = Path().apply {
            moveTo(5f * sx, 0f)
            lineTo(10f * sx, 9f * sy)
            lineTo(5f * sx, 6.5f * sy)
            lineTo(0f, 9f * sy)
            close()
        }

        canvas.save()
        canvas.translate(iconCenterX, iconCenterY)
        canvas.rotate(trackDeg.toFloat())
        // Shift up (in the now-rotated frame, so the arrow orbits the icon
        // centre — matching the PWA's rotate(trackDeg) applied around the
        // icon's own centre point, not the arrow's own local origin) so the
        // arrow's base sits ARROW_GAP_PX above the icon's own edge.
        canvas.translate(-ARROW_PX_W / 2f, -(SHAPE_PX / 2f + ARROW_GAP_PX + ARROW_PX_H))
        canvas.drawPath(arrowPath, arrowPaint)
        canvas.restore()
    }
}
