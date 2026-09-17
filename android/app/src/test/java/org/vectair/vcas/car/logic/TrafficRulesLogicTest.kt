package org.vectair.vcas.car.logic

import org.junit.Assert.*
import org.junit.Test
import org.vectair.vcas.car.logic.TrafficRulesLogic.AltitudeCondition
import org.vectair.vcas.car.logic.TrafficRulesLogic.AltitudeDirection
import org.vectair.vcas.car.logic.TrafficRulesLogic.Conditions
import org.vectair.vcas.car.logic.TrafficRulesLogic.Rule
import org.vectair.vcas.car.logic.TrafficRulesLogic.RuleMode
import org.vectair.vcas.car.logic.TrafficRulesLogic.Traffic

class TrafficRulesLogicTest {

    private fun aircraft(
        type: String? = "A320",
        category: String? = "A3",
        altitudeFt: Double? = 30000.0,
        military: Boolean? = null
    ) = AircraftExtrapolation.Aircraft(
        lat = 51.5, lon = -0.1, hex = "ABC123", type = type, category = category,
        altitudeFt = altitudeFt, military = military
    )

    @Test
    fun matchesConditions_emptyConditions_matchesEverything() {
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(), Conditions()))
    }

    @Test
    fun matchesConditions_typeQuery_singleTerm_substringMatchCaseInsensitive() {
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "A320"), Conditions(typeQuery = "a32")))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(type = "B738"), Conditions(typeQuery = "a32")))
    }

    @Test
    fun matchesConditions_typeQuery_commaSeparatedList_isOred() {
        val conditions = Conditions(typeQuery = " MiG , Su ,, Tu ")
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "MiG-29"), conditions))
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "Su-27"), conditions))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(type = "F-16"), conditions))
    }

    @Test
    fun matchesConditions_category_anyIsUnset() {
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(category = "A5"), Conditions(category = "any")))
    }

    @Test
    fun matchesConditions_category_exactMatchRequired() {
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(category = "A5"), Conditions(category = "A5")))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(category = "A3"), Conditions(category = "A5")))
    }

    @Test
    fun matchesConditions_altitude_above() {
        val cond = Conditions(altitude = AltitudeCondition(enabled = true, direction = AltitudeDirection.ABOVE, ft = 10000.0))
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = 20000.0), cond))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = 5000.0), cond))
    }

    @Test
    fun matchesConditions_altitude_below() {
        val cond = Conditions(altitude = AltitudeCondition(enabled = true, direction = AltitudeDirection.BELOW, ft = 10000.0))
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = 5000.0), cond))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = 20000.0), cond))
    }

    @Test
    fun matchesConditions_altitude_unknownAltitudeNeverSatisfiesEitherDirection() {
        val above = Conditions(altitude = AltitudeCondition(enabled = true, direction = AltitudeDirection.ABOVE, ft = 0.0))
        val below = Conditions(altitude = AltitudeCondition(enabled = true, direction = AltitudeDirection.BELOW, ft = 1000000.0))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = null), above))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(altitudeFt = null), below))
    }

    @Test
    fun matchesConditions_traffic_military() {
        val cond = Conditions(traffic = Traffic.MILITARY)
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(military = true), cond))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(military = false), cond))
    }

    @Test
    fun matchesConditions_traffic_civil() {
        val cond = Conditions(traffic = Traffic.CIVIL)
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(military = false), cond))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(military = true), cond))
    }

    @Test
    fun matchesConditions_traffic_unknownMilitaryStatusNeverSatisfiesEitherDirection() {
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(military = null), Conditions(traffic = Traffic.MILITARY)))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(military = null), Conditions(traffic = Traffic.CIVIL)))
    }

    @Test
    fun matchesConditions_traffic_andTypeQuery_areIndependentAxes() {
        val soviet = Conditions(typeQuery = "MiG,Su")
        // A military Su-27 matches the type-list rule regardless of its
        // own military flag, and vice versa — the two conditions are
        // independent unless a rule sets both.
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "Su-27", military = true), soviet))
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "Su-27", military = false), soviet))
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(type = "F-16", military = true), Conditions(typeQuery = "MiG,Su", traffic = Traffic.ANY)))
    }

    @Test
    fun matchesConditions_allConditionsAndedTogether() {
        val cond = Conditions(
            typeQuery = "A32",
            category = "A3",
            altitude = AltitudeCondition(enabled = true, direction = AltitudeDirection.ABOVE, ft = 10000.0),
            traffic = Traffic.CIVIL
        )
        assertTrue(TrafficRulesLogic.matchesConditions(aircraft(type = "A320", category = "A3", altitudeFt = 30000.0, military = false), cond))
        // Fails on category alone.
        assertFalse(TrafficRulesLogic.matchesConditions(aircraft(type = "A320", category = "A5", altitudeFt = 30000.0, military = false), cond))
    }

    // ---- evaluateFilter / evaluateHighlight ----

    private fun rule(mode: RuleMode, enabled: Boolean, conditions: Conditions, color: String = "#ffcc00", id: String = "r1") =
        Rule(id = id, mode = mode, enabled = enabled, conditions = conditions, color = color)

    @Test
    fun evaluateFilter_matchingEnabledFilterRule_hidesAircraft() {
        val rules = listOf(rule(RuleMode.FILTER, enabled = true, conditions = Conditions(category = "A3")))
        assertTrue(TrafficRulesLogic.evaluateFilter(aircraft(category = "A3"), rules))
        assertFalse(TrafficRulesLogic.evaluateFilter(aircraft(category = "A5"), rules))
    }

    @Test
    fun evaluateFilter_disabledRuleNeverFilters() {
        val rules = listOf(rule(RuleMode.FILTER, enabled = false, conditions = Conditions(category = "A3")))
        assertFalse(TrafficRulesLogic.evaluateFilter(aircraft(category = "A3"), rules))
    }

    @Test
    fun evaluateFilter_highlightModeRuleNeverFilters() {
        val rules = listOf(rule(RuleMode.HIGHLIGHT, enabled = true, conditions = Conditions(category = "A3")))
        assertFalse(TrafficRulesLogic.evaluateFilter(aircraft(category = "A3"), rules))
    }

    @Test
    fun evaluateFilter_orsAcrossMultipleRules() {
        val rules = listOf(
            rule(RuleMode.FILTER, enabled = true, conditions = Conditions(category = "A3"), id = "r1"),
            rule(RuleMode.FILTER, enabled = true, conditions = Conditions(traffic = Traffic.MILITARY), id = "r2")
        )
        assertTrue(TrafficRulesLogic.evaluateFilter(aircraft(category = "A9", military = true), rules))
    }

    @Test
    fun evaluateHighlight_matchingEnabledHighlightRule_returnsItsColor() {
        val rules = listOf(rule(RuleMode.HIGHLIGHT, enabled = true, conditions = Conditions(category = "A3"), color = "#00ff00"))
        assertEquals("#00ff00", TrafficRulesLogic.evaluateHighlight(aircraft(category = "A3"), rules))
        assertNull(TrafficRulesLogic.evaluateHighlight(aircraft(category = "A5"), rules))
    }

    @Test
    fun evaluateHighlight_filterModeRuleNeverHighlights() {
        val rules = listOf(rule(RuleMode.FILTER, enabled = true, conditions = Conditions(category = "A3"), color = "#00ff00"))
        assertNull(TrafficRulesLogic.evaluateHighlight(aircraft(category = "A3"), rules))
    }

    @Test
    fun evaluateHighlight_firstMatchInListOrderWins() {
        val rules = listOf(
            rule(RuleMode.HIGHLIGHT, enabled = true, conditions = Conditions(), color = "#111111", id = "first"),
            rule(RuleMode.HIGHLIGHT, enabled = true, conditions = Conditions(), color = "#222222", id = "second")
        )
        assertEquals("#111111", TrafficRulesLogic.evaluateHighlight(aircraft(), rules))
    }

    @Test
    fun evaluateHighlight_disabledRuleSkipped_secondRuleWins() {
        val rules = listOf(
            rule(RuleMode.HIGHLIGHT, enabled = false, conditions = Conditions(), color = "#111111", id = "first"),
            rule(RuleMode.HIGHLIGHT, enabled = true, conditions = Conditions(), color = "#222222", id = "second")
        )
        assertEquals("#222222", TrafficRulesLogic.evaluateHighlight(aircraft(), rules))
    }

    @Test
    fun categories_containsExpectedKeysAndExcludesUnknownSentinels() {
        val cats = TrafficRulesLogic.CATEGORIES
        assertEquals("Heavy", cats["A5"])
        assertEquals("Surface — emergency vehicle", cats["C1"])
        assertFalse(cats.containsKey("A0"))
        assertFalse(cats.containsKey("any"))
    }
}
