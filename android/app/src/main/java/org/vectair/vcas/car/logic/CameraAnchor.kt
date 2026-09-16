package org.vectair.vcas.car.logic

/**
 * Converts a `NavigationCameraEvaluator` anchor fraction (0-1, where the
 * user's real position should render on screen along one axis) into
 * MapLibre `CameraPosition` padding — the mechanism `VcasMapRenderer.kt`
 * uses to drive the real map camera off `NavigationCameraEvaluator`'s
 * output (2026-08-25, the GPS-wiring follow-up to phase 2's map
 * integration).
 *
 * The PWA's own `CameraController` achieves this same effect via a
 * manual per-frame `jumpTo()`+`panBy()` animation loop — a workaround
 * that exists specifically because that was the tool available in a
 * browser (see CLAUDE.md's "Camera anchor math" section, which
 * establishes that `setPadding()` makes MapLibre GL JS center on the
 * *padded* center, not the raw geometric middle). MapLibre Native's
 * Android SDK exposes that same padded-center convention as a first-
 * class part of `CameraPosition` itself (a `padding` array alongside
 * target/zoom/tilt/bearing) — so instead of porting the JS workaround's
 * frame-loop mechanics, this uses the native SDK's own declarative
 * support for the identical underlying concept directly.
 *
 * Kept here as pure, Android-independent logic (no MapLibre/Android
 * imports at all) specifically so it can be verified the same way as
 * every other file in this package — real `kotlinc`+JUnit4 execution,
 * not just read for correctness — despite living alongside code that
 * itself can't be compiled in this environment.
 */
object CameraAnchor {

    /**
     * @param anchorFraction Where along this axis (0-1) the target
     *   should render — clamped to [0,1] defensively (an out-of-range
     *   evaluator output would otherwise put the padded-center outside
     *   the viewport entirely).
     * @param dimension The viewport's size along this axis, in the same
     *   units the resulting padding should be expressed in (pixels).
     * @return (lowSidePadding, highSidePadding) — e.g. for the Y axis,
     *   (top, bottom); for X, (left, right). Whichever side needs LESS
     *   padding to place the padded-center at `anchorFraction` is left
     *   at exactly 0 rather than splitting padding across both sides,
     *   since MapLibre's own padded-center formula only cares about the
     *   difference between the two, not their individual magnitudes.
     */
    fun paddingForAnchor(anchorFraction: Double, dimension: Double): Pair<Double, Double> {
        val clamped = anchorFraction.coerceIn(0.0, 1.0)
        return if (clamped >= 0.5) {
            (dimension * (2 * clamped - 1)) to 0.0
        } else {
            0.0 to (dimension * (1 - 2 * clamped))
        }
    }
}
