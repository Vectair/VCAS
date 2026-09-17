package org.vectair.vcas.car.logic

/**
 * TrafficRulesLogic — pure evaluation of user-defined "traffic rules"
 * against a single normalised aircraft object, a structural port of
 * `src/logic/trafficRules.js`. No persistence, no Android dependency —
 * `TrafficRulesStore.kt` (the sibling state/persistence class, same split
 * `VcasSettings.kt` already establishes for other persisted-state modules
 * in this port) owns the actual rule list; this object only answers "does
 * this aircraft match this rule's conditions."
 *
 * A rule's conditions are AND'd together (every condition set on the rule
 * must match); an unset condition is ignored, not treated as "must be
 * absent." Which rules apply to a given aircraft, same as the JS original:
 * - FILTER: any ENABLED filter-mode rule matching = hidden (OR across
 *   rules).
 * - HIGHLIGHT: the FIRST enabled highlight-mode rule (in list order) that
 *   matches wins its colour — not "layer every matching rule's colour,"
 *   since a symbol can only usefully carry one highlight ring at a time.
 */
object TrafficRulesLogic {

    /**
     * ADS-B DO-260B emitter category table — the same axis
     * `NormaliseAircraft.kt`'s own `NON_AIRCRAFT_CATEGORIES` (C1-C5) reads
     * from, exposed here as the single source of category labels for both
     * matching and the settings-screen dropdown. A0/B0/C0 ("no category
     * info") are intentionally omitted, matching the JS original.
     */
    val CATEGORIES: Map<String, String> = linkedMapOf(
        "A1" to "Light",
        "A2" to "Small",
        "A3" to "Large",
        "A4" to "High vortex large",
        "A5" to "Heavy",
        "A6" to "High performance",
        "A7" to "Rotorcraft",
        "B1" to "Glider/sailplane",
        "B2" to "Lighter-than-air",
        "B3" to "Parachutist/skydiver",
        "B4" to "Ultralight/hang-glider",
        "B6" to "Unmanned (UAV)",
        "B7" to "Space/trans-atmospheric",
        "C1" to "Surface — emergency vehicle",
        "C2" to "Surface — service vehicle",
        "C3" to "Point obstacle",
        "C4" to "Cluster obstacle",
        "C5" to "Line obstacle"
    )

    enum class RuleMode { FILTER, HIGHLIGHT }
    enum class Traffic { ANY, MILITARY, CIVIL }
    enum class AltitudeDirection { ABOVE, BELOW }

    data class AltitudeCondition(
        val enabled: Boolean = false,
        val direction: AltitudeDirection = AltitudeDirection.ABOVE,
        val ft: Double = 10000.0
    )

    data class Conditions(
        val typeQuery: String = "", // "" = unset; comma-separated OR list, substring match
        val category: String = "any", // "any" = unset; else one of CATEGORIES's keys
        val altitude: AltitudeCondition = AltitudeCondition(),
        val traffic: Traffic = Traffic.ANY
    )

    data class Rule(
        val id: String,
        val mode: RuleMode,
        val enabled: Boolean,
        val conditions: Conditions,
        val color: String = DEFAULT_HIGHLIGHT_COLOR
    )

    const val DEFAULT_HIGHLIGHT_COLOR = "#ffcc00"

    /** True if `aircraft` satisfies every condition SET on `conditions`
     * (an unset/default condition never excludes a match). */
    fun matchesConditions(aircraft: AircraftExtrapolation.Aircraft, conditions: Conditions): Boolean {
        if (conditions.typeQuery.isNotBlank()) {
            val type = (aircraft.type ?: "").uppercase()
            // Comma-separated list, OR'd — e.g. "MiG,Su,Tu,An,Il,Yak,Mi,Ka,Be"
            // lets one rule cover "Soviet-era" without a separate rule per
            // prefix. Each term trimmed/uppercased independently; blank
            // terms (a trailing comma) are dropped rather than matching
            // everything.
            val terms = conditions.typeQuery.split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
            if (terms.isNotEmpty() && terms.none { type.contains(it) }) return false
        }

        if (conditions.category != "any") {
            if (aircraft.category != conditions.category) return false
        }

        if (conditions.altitude.enabled) {
            val ft = aircraft.altitudeFt ?: return false // unknown altitude can't satisfy either direction
            if (conditions.altitude.direction == AltitudeDirection.ABOVE) {
                if (!(ft > conditions.altitude.ft)) return false
            } else {
                if (!(ft < conditions.altitude.ft)) return false
            }
        }

        if (conditions.traffic != Traffic.ANY) {
            // aircraft.military is tri-state — a rule asking specifically
            // for military or civil traffic can't be satisfied by an
            // aircraft whose classification is unknown.
            val mil = aircraft.military ?: return false
            if (conditions.traffic == Traffic.MILITARY && mil != true) return false
            if (conditions.traffic == Traffic.CIVIL && mil != false) return false
        }

        return true
    }

    /** True if any ENABLED filter-mode rule matches — this aircraft should be hidden. */
    fun evaluateFilter(aircraft: AircraftExtrapolation.Aircraft, rules: List<Rule>): Boolean =
        rules.any { it.enabled && it.mode == RuleMode.FILTER && matchesConditions(aircraft, it.conditions) }

    /** The colour of the first ENABLED highlight-mode rule (in list order) that matches, or null. */
    fun evaluateHighlight(aircraft: AircraftExtrapolation.Aircraft, rules: List<Rule>): String? =
        rules.firstOrNull { it.enabled && it.mode == RuleMode.HIGHLIGHT && matchesConditions(aircraft, it.conditions) }?.color
}
