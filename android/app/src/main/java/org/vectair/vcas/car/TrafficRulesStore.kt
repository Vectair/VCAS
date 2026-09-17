package org.vectair.vcas.car

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import org.vectair.vcas.car.logic.TrafficRulesLogic
import org.vectair.vcas.car.logic.TrafficRulesLogic.AltitudeCondition
import org.vectair.vcas.car.logic.TrafficRulesLogic.AltitudeDirection
import org.vectair.vcas.car.logic.TrafficRulesLogic.Conditions
import org.vectair.vcas.car.logic.TrafficRulesLogic.Rule
import org.vectair.vcas.car.logic.TrafficRulesLogic.RuleMode
import org.vectair.vcas.car.logic.TrafficRulesLogic.Traffic

/**
 * Persisted CRUD state for user-defined traffic rules (2026-09-17) — the
 * `SharedPreferences`-backed sibling to `TrafficRulesLogic.kt`'s pure
 * evaluator, same split `src/trafficRules.js` establishes against
 * `src/logic/trafficRules.js`. The whole rule list serializes to ONE JSON
 * array string under a single key, matching the PWA's own
 * `localStorage.setItem(STORAGE_KEY, JSON.stringify(_rules))` — this
 * app's other settings (`VcasSettings.kt`) are all scalar flags, so a
 * plain per-key `SharedPreferences` entry wouldn't fit a list the way it
 * does there.
 *
 * A brand-new rule starts DISABLED, deliberately — same reasoning as the
 * JS original's own `add()`: an all-unset-conditions filter rule would
 * otherwise instantly hide every aircraft the moment it's created, before
 * the caller has set a single real condition. The settings-screen form is
 * expected to explicitly enable it via `update()` once real conditions
 * are set, and delete it outright on Cancel if never saved.
 */
object TrafficRulesStore {
    private const val PREFS_NAME = "vcas_settings"
    private const val KEY_RULES = "traffic_rules_v1"

    private var prefs: SharedPreferences? = null
    private var rules: MutableList<Rule> = mutableListOf()

    /** Must be called once, before any other function here — see MainActivity.onCreate(). */
    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        rules = loadFromPrefs().toMutableList()
    }

    fun list(): List<Rule> = rules.toList()

    fun add(mode: RuleMode): Rule {
        val rule = Rule(id = newId(), mode = mode, enabled = false, conditions = Conditions())
        rules.add(rule)
        persist()
        return rule
    }

    /** Replaces the stored rule with `updated` (same id) wholesale — the
     * settings form always writes a complete Rule, not a partial patch. */
    fun update(updated: Rule) {
        val idx = rules.indexOfFirst { it.id == updated.id }
        if (idx == -1) return
        rules[idx] = updated
        persist()
    }

    fun remove(id: String) {
        rules.removeAll { it.id == id }
        persist()
    }

    fun toggleEnabled(id: String) {
        val idx = rules.indexOfFirst { it.id == id }
        if (idx == -1) return
        rules[idx] = rules[idx].copy(enabled = !rules[idx].enabled)
        persist()
    }

    fun move(id: String, direction: Int) {
        val idx = rules.indexOfFirst { it.id == id }
        val target = idx + direction
        if (idx == -1 || target < 0 || target >= rules.size) return
        val tmp = rules[idx]
        rules[idx] = rules[target]
        rules[target] = tmp
        persist()
    }

    private fun newId(): String = "rule_" + System.currentTimeMillis() + "_" + (Math.random() * 1_000_000).toInt()

    private fun loadFromPrefs(): List<Rule> {
        val raw = prefs?.getString(KEY_RULES, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i -> ruleFromJson(arr.optJSONObject(i)) }
        } catch (e: Exception) {
            // Malformed/corrupted storage — start with no rules rather than throw.
            emptyList()
        }
    }

    private fun persist() {
        val arr = JSONArray()
        rules.forEach { arr.put(ruleToJson(it)) }
        try { prefs?.edit()?.putString(KEY_RULES, arr.toString())?.apply() } catch (e: Exception) { /* private-browsing-equivalent/quota — rules just won't survive a reload */ }
    }

    private fun ruleToJson(r: Rule): JSONObject = JSONObject().apply {
        put("id", r.id)
        put("mode", if (r.mode == RuleMode.FILTER) "filter" else "highlight")
        put("enabled", r.enabled)
        put("color", r.color)
        put("conditions", JSONObject().apply {
            put("typeQuery", r.conditions.typeQuery)
            put("category", r.conditions.category)
            put("altitude", JSONObject().apply {
                put("enabled", r.conditions.altitude.enabled)
                put("direction", if (r.conditions.altitude.direction == AltitudeDirection.ABOVE) "above" else "below")
                put("ft", r.conditions.altitude.ft)
            })
            put("traffic", when (r.conditions.traffic) {
                Traffic.MILITARY -> "military"
                Traffic.CIVIL -> "civil"
                Traffic.ANY -> "any"
            })
        })
    }

    private fun ruleFromJson(obj: JSONObject?): Rule? {
        if (obj == null) return null
        val id = obj.optString("id").takeIf { it.isNotBlank() } ?: return null
        val mode = if (obj.optString("mode") == "highlight") RuleMode.HIGHLIGHT else RuleMode.FILTER
        val enabled = obj.optBoolean("enabled", false)
        val color = obj.optString("color").ifBlank { TrafficRulesLogic.DEFAULT_HIGHLIGHT_COLOR }
        val condObj = obj.optJSONObject("conditions") ?: JSONObject()
        val altObj = condObj.optJSONObject("altitude")
        val conditions = Conditions(
            typeQuery = condObj.optString("typeQuery", ""),
            category = condObj.optString("category", "any").ifBlank { "any" },
            altitude = AltitudeCondition(
                enabled = altObj?.optBoolean("enabled", false) ?: false,
                direction = if (altObj?.optString("direction") == "below") AltitudeDirection.BELOW else AltitudeDirection.ABOVE,
                ft = altObj?.optDouble("ft", 10000.0) ?: 10000.0
            ),
            traffic = when (condObj.optString("traffic", "any")) {
                "military" -> Traffic.MILITARY
                "civil" -> Traffic.CIVIL
                else -> Traffic.ANY
            }
        )
        return Rule(id = id, mode = mode, enabled = enabled, conditions = conditions, color = color)
    }
}
