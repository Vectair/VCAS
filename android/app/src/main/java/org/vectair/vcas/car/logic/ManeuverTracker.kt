package org.vectair.vcas.car.logic

/**
 * Turns OpenRouteService's own turn-by-turn steps into "what's the next
 * thing to do, and how far away is it" for the current position — a
 * structural port of `src/navigation/maneuverTracker.js`. See that file's
 * own doc comment for the full ORS response-shape caveat (the `type`
 * maneuver code table, `way_points` indexing) — preserved here verbatim,
 * not re-verified against a live response (no network access to ORS from
 * this sandbox either).
 */
object ManeuverTracker {

    data class NextManeuver(
        val exists: Boolean,
        val instruction: String? = null,
        val type: Int? = null,
        val name: String? = null,
        val distanceMeters: Double? = null,
        val isArrival: Boolean = false
    )

    fun nextManeuver(coords: List<DoubleArray>?, steps: List<OrsProvider.Step>?, userLon: Double, userLat: Double): NextManeuver {
        if (coords == null || coords.size < 2 || steps.isNullOrEmpty()) {
            return NextManeuver(exists = false)
        }

        val nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat)
        val continuousPos = nearest.segIdx + nearest.t

        var currentStepIdx = steps.indexOfFirst { s -> s.wayPointEnd != null && continuousPos < s.wayPointEnd }
        if (currentStepIdx == -1) currentStepIdx = steps.size - 1

        val currentStep = steps.getOrNull(currentStepIdx) ?: return NextManeuver(exists = false)

        val isCurrentLast = currentStepIdx >= steps.size - 1
        val targetStepIdx = if (isCurrentLast) currentStepIdx else currentStepIdx + 1
        val targetStep = steps.getOrNull(targetStepIdx) ?: return NextManeuver(exists = false)

        val targetIdx = currentStep.wayPointEnd ?: (coords.size - 1)

        val distanceMeters = RouteGeometry.distanceToIndex(coords, nearest.segIdx, nearest.t, targetIdx)

        return NextManeuver(
            exists = true,
            instruction = targetStep.instruction,
            type = targetStep.type,
            name = targetStep.name ?: "",
            distanceMeters = distanceMeters,
            isArrival = targetStepIdx == steps.size - 1
        )
    }
}
