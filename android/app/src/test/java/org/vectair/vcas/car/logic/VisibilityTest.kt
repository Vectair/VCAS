package org.vectair.vcas.car.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Real JUnit4 verification of the visibility.js -> Visibility.kt port,
 * following this project's own established discipline (see CLAUDE.md,
 * "Android Auto phase 1, continued" and the Geo.kt port before it): run
 * against real execution, not just read for correctness.
 *
 * Two verification styles, same split GeoTest.kt already uses:
 *  - Boundary tests place aircraft at a precisely chosen geodesic distance
 *    (via Geo.destinationPoint, so the resulting horizNm is exact modulo
 *    float noise) just inside/outside a minAngle threshold, with a 0.01nm
 *    margin — comfortably clear of floating-point/Earth-radius rounding
 *    noise (checked: R_M/1852 vs Geo.kt's own R_NM constant differ by
 *    ~5.8e-8 relative, i.e. ~1.3e-6nm over the largest distance used here)
 *    while still proving the `>=` tier-selection boundary is exactly
 *    right, not off-by-one.
 *  - Scenario tests (contrail floor, 40nm cap, staleness, METAR) assert
 *    against the real documented behaviour/examples from visibility.js's
 *    own comments and CLAUDE.md, not hand-reasoned expectations.
 */
class VisibilityTest {

    private val userLat = 40.0
    private val userLon = -75.0

    /** Aircraft at exactly `nm` nautical miles east of the user, altitude 0/null. */
    private fun acAtRangeNm(
        nm: Double,
        altitudeFt: Double? = null,
        type: String? = "A320",
        category: String? = null,
        lastSeenSeconds: Double? = null
    ): Visibility.AircraftInput {
        val pt = Geo.destinationPoint(userLat, userLon, 90.0, nm * 1852.0)
        return Visibility.AircraftInput(pt.lat, pt.lon, altitudeFt, type, category, lastSeenSeconds)
    }

    // A320's real wingspan is 36m — used throughout for the boundary tests
    // since it's a stable, table-backed value (not a fallback).
    private fun rangeForAngle(minAngle: Double, sizem: Double = 36.0): Double =
        (57.3 * sizem) / (minAngle * 1852.0)

    // ---- Tier boundaries (angular size, no other modifiers active) ----

    @Test
    fun certainlyVisible_justInsideBoundary() {
        val r = rangeForAngle(0.5) - 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Certainly visible", result.label)
        assertEquals("square", result.shape)
        assertEquals(100, result.score)
        assertEquals(1.0, result.fillOpacity, 1e-9)
    }

    @Test
    fun certainlyVisible_justOutsideBoundary_fallsToLikely() {
        val r = rangeForAngle(0.5) + 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Likely visible", result.label)
    }

    @Test
    fun likelyVisible_justInsideBoundary() {
        val r = rangeForAngle(0.167) - 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Likely visible", result.label)
        assertEquals("circle", result.shape)
        assertEquals(66, result.score)
    }

    @Test
    fun likelyVisible_justOutsideBoundary_fallsToPossibly() {
        val r = rangeForAngle(0.167) + 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Possibly visible", result.label)
    }

    @Test
    fun possiblyVisible_justInsideBoundary() {
        val r = rangeForAngle(0.05) - 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Possibly visible", result.label)
        assertEquals("diamond", result.shape)
        assertEquals(33, result.score)
        assertEquals(1.0, result.fillOpacity, 1e-9)
    }

    @Test
    fun possiblyVisible_justOutsideBoundary_fallsToVeryUnlikely() {
        val r = rangeForAngle(0.05) + 0.01
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r))
        assertEquals("Very unlikely/not visible", result.label)
        assertEquals("diamond", result.shape)
        assertEquals(10, result.score)
        assertEquals(0.0, result.fillOpacity, 1e-9)
    }

    @Test
    fun angularSizeDeg_matchesFormula_forKnownType() {
        val r = 8.0 // clear of every boundary above (rangeForAngle(0.05) ~ 22.28nm)
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r, type = "B738"))
        // B738 shares A320's 36m table entry; altitude null => slantM == horizM.
        val expectedAngular = 57.3 * 36.0 / (r * 1852.0)
        assertEquals(expectedAngular, result.angularSizeDeg, 1e-6)
    }

    @Test
    fun unknownType_usesFallbackUnknownSize() {
        val r = 8.0
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r, type = "ZZZZ"))
        val expectedAngular = 57.3 * 25.0 / (r * 1852.0) // FallbackSizes.UNKNOWN = 25
        assertEquals(expectedAngular, result.angularSizeDeg, 1e-6)
    }

    @Test
    fun nullType_usesFallbackUnknownSize() {
        val r = 8.0
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(r, type = null))
        val expectedAngular = 57.3 * 25.0 / (r * 1852.0)
        assertEquals(expectedAngular, result.angularSizeDeg, 1e-6)
    }

    // ---- Very close override ----

    @Test
    fun veryClose_lowAltitude_isCertainlyVisibleRegardlessOfSize() {
        // < 1nm and < 500ft, tiny aircraft (would otherwise likely be a
        // lower tier at typical light-aircraft angular sizes at this range).
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"))
        assertEquals("Certainly visible", result.label)
        assertEquals(100, result.score)
    }

    @Test
    fun veryClose_requiresBothConditions_farEnoughDoesNotQualify() {
        // >= 1nm disqualifies veryClose even at low altitude; falls through
        // to ordinary angular-size scoring for a small aircraft at 1.5nm,
        // which lands in "Likely visible" (66), not the veryClose-only
        // "Certainly visible" (100) — verified against the same formula
        // estimate() itself uses, not a hand-picked label.
        val altM = 300.0 * 0.3048
        val horizM = 1.5 * 1852.0
        val slantM = kotlin.math.sqrt(horizM * horizM + altM * altM)
        val expectedAngular = 57.3 * 11.0 / slantM // C172 = 11m

        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(1.5, altitudeFt = 300.0, type = "C172"))
        assertEquals(expectedAngular, result.angularSizeDeg, 1e-6)
        assertEquals("Likely visible", result.label)
        assertEquals(66, result.score)
    }

    @Test
    fun veryClose_requiresBothConditions_tooHighDoesNotQualify() {
        // < 1nm but >= 500ft disqualifies veryClose; falls through to
        // ordinary angular-size scoring, landing in "Likely visible" (66)
        // rather than veryClose's "Certainly visible" (100) — verified
        // against the same formula estimate() itself uses.
        val altM = 5000.0 * 0.3048
        val horizM = 0.5 * 1852.0
        val slantM = kotlin.math.sqrt(horizM * horizM + altM * altM)
        val expectedAngular = 57.3 * 11.0 / slantM // C172 = 11m

        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 5000.0, type = "C172"))
        assertEquals(expectedAngular, result.angularSizeDeg, 1e-6)
        assertEquals("Likely visible", result.label)
        assertEquals(66, result.score)
    }

    // ---- Contrail floor (26,000ft+, <=50nm) ----

    @Test
    fun contrail_smallAircraft_floorsAtPossiblyVisible_notLower() {
        // A small type at high altitude and 45nm — angular size alone would
        // read "Very unlikely," but the contrail floor rescues it to
        // "Possibly visible," matching CLAUDE.md's documented real case.
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(45.0, altitudeFt = 32000.0, type = "C172"))
        assertEquals("Possibly visible", result.label)
        assertEquals(33, result.score)
    }

    @Test
    fun contrail_largeAircraft_neverDowngradedBelowItsOwnAngularTier() {
        // A very large aircraft close enough within the contrail window
        // that its own angular size already earns better than "Possibly
        // visible" must NOT be capped down to it. (0.3nm horizontal at
        // 26,000ft: slantM ~7944m, angularSizeDeg = 57.3*80/7944 ~ 0.577,
        // comfortably clear of the 0.5 "Certainly visible" threshold.)
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.3, altitudeFt = 26000.0, type = "A388"))
        assertEquals("Certainly visible", result.label)
        assertEquals(100, result.score)
    }

    @Test
    fun contrail_beyond50nm_doesNotApply() {
        // High altitude but past the 50nm contrail cap — falls through to
        // the plain 40nm-cap branch instead, still capped at Possibly
        // visible (not "Very unlikely" despite tiny angular size).
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(55.0, altitudeFt = 32000.0, type = "C172"))
        assertEquals("Possibly visible", result.label)
    }

    @Test
    fun contrail_belowAltitudeThreshold_doesNotApply() {
        // Just under 26,000ft, and within 40nm so the plain 40nm cap
        // doesn't mask the result either — angular size alone is "Very
        // unlikely" here, and the contrail floor must not rescue it.
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(35.0, altitudeFt = 25900.0, type = "C172"))
        assertEquals("Very unlikely/not visible", result.label)
    }

    // ---- Plain 40nm cap (non-contrail) ----

    @Test
    fun beyond40nm_capsAtPossiblyVisible_evenForLargeAircraft() {
        // Low altitude (no contrail eligibility) but past 40nm — even a
        // huge aircraft's own angular size must not push it above
        // "Possibly visible."
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(45.0, altitudeFt = 5000.0, type = "A388"))
        assertEquals("Possibly visible", result.label)
        assertEquals(33, result.score)
    }

    @Test
    fun within40nm_notCapped() {
        // 10nm, below the contrail altitude threshold: angularSizeDeg =
        // 57.3*80/~18583m ~ 0.247, clearing the 0.167 "Likely visible"
        // threshold — must not be pulled down to the 40nm-cap's ceiling.
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(10.0, altitudeFt = 5000.0, type = "A388"))
        assertTrue(result.score > 33)
    }

    // ---- Staleness ----

    @Test
    fun staleData_degradesByExactlyOneTier() {
        val fresh = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"))
        val stale = Visibility.estimate(
            userLat, userLon,
            acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172", lastSeenSeconds = 25.0)
        )
        assertEquals("Certainly visible", fresh.label)
        assertEquals("Likely visible", stale.label)
        assertEquals(66, stale.score)
    }

    @Test
    fun staleData_atWorstTier_doesNotDegradeFurther() {
        val result = Visibility.estimate(
            userLat, userLon,
            acAtRangeNm(rangeForAngle(0.05) + 5.0, type = "C172", lastSeenSeconds = 25.0)
        )
        assertEquals("Very unlikely/not visible", result.label)
        assertEquals(10, result.score)
    }

    @Test
    fun staleness_exactlyAt20Seconds_doesNotDegrade() {
        // JS/Kotlin condition is strictly `> 20`, not `>= 20`.
        val result = Visibility.estimate(
            userLat, userLon,
            acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172", lastSeenSeconds = 20.0)
        )
        assertEquals("Certainly visible", result.label)
    }

    // ---- METAR adjustment ----

    @Test
    fun metarNull_noAdjustment() {
        val withoutMetar = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"))
        val withNullMetar = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), null)
        assertEquals(withoutMetar.label, withNullMetar.label)
    }

    @Test
    fun metar_ovcLayerBelowAircraft_forcesWorstTier() {
        val metar = Visibility.Metar(clouds = listOf(Visibility.CloudLayer("OVC", 200.0)))
        val result = Visibility.estimate(
            userLat, userLon,
            acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), // would be "Certainly visible" otherwise
            metar
        )
        assertEquals("Very unlikely/not visible", result.label)
        assertEquals(10, result.score)
    }

    @Test
    fun metar_vvLayerBelowAircraft_forcesWorstTier() {
        val metar = Visibility.Metar(clouds = listOf(Visibility.CloudLayer("VV", 200.0)))
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), metar)
        assertEquals("Very unlikely/not visible", result.label)
    }

    @Test
    fun metar_bknLayerBelowAircraft_capsAtPossiblyVisible_partialOnly() {
        val metar = Visibility.Metar(clouds = listOf(Visibility.CloudLayer("BKN", 200.0)))
        val result = Visibility.estimate(
            userLat, userLon,
            acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), // would be "Certainly visible" otherwise
            metar
        )
        assertEquals("Possibly visible", result.label)
        assertEquals(33, result.score)
    }

    @Test
    fun metar_cloudLayerAboveAircraft_noEffect() {
        // Layer base is ABOVE the aircraft's own altitude — not occluding.
        val metar = Visibility.Metar(clouds = listOf(Visibility.CloudLayer("OVC", 10000.0)))
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), metar)
        assertEquals("Certainly visible", result.label)
    }

    @Test
    fun metar_onlyLowestOccludingLayerMatters() {
        // A lower BKN layer (partial cap) sits below a higher OVC layer,
        // both under the aircraft's altitude — only the LOWEST layer (BKN)
        // should govern, per visibility.js's own documented rule, not the
        // OVC layer that happens to also qualify.
        val metar = Visibility.Metar(
            clouds = listOf(
                Visibility.CloudLayer("BKN", 200.0),
                Visibility.CloudLayer("OVC", 800.0)
            )
        )
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 1500.0, type = "C172"), metar)
        assertEquals("Possibly visible", result.label) // BKN's partial cap, not OVC's full block
    }

    @Test
    fun metar_reducedVisibility_capsWhenSlantExceedsIt() {
        // 3SM reported visibility (~2.6nm); aircraft well beyond that in
        // slant range gets capped at "Possibly visible" regardless of
        // whatever tier its own angular size alone would have earned.
        val metar = Visibility.Metar(visibilitySm = 3.0)
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(5.0, altitudeFt = 0.0, type = "A388"), metar)
        assertEquals("Possibly visible", result.label)
    }

    @Test
    fun metar_reducedVisibility_noCapWhenWithinRange() {
        val metar = Visibility.Metar(visibilitySm = 3.0)
        // Well within 3SM (~2.6nm) of reported visibility.
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(0.5, altitudeFt = 300.0, type = "C172"), metar)
        assertEquals("Certainly visible", result.label)
    }

    @Test
    fun metar_visibilityAtOrAbove10sm_noCapApplied() {
        // Station-reported cap of exactly 10SM must NOT trigger the
        // adjustment (condition is strictly `< 10`). Same 10nm/A388 setup
        // as within40nm_notCapped, which independently establishes the
        // pre-metar score here is 66, not 33.
        val metar = Visibility.Metar(visibilitySm = 10.0)
        val result = Visibility.estimate(userLat, userLon, acAtRangeNm(10.0, altitudeFt = 5000.0, type = "A388"), metar)
        assertTrue(result.score > 33)
    }

    // ---- getCategories() ----

    @Test
    fun getCategories_returnsAllFourTiersInOrder() {
        val cats = Visibility.getCategories()
        assertEquals(4, cats.size)
        assertEquals(
            listOf("Certainly visible", "Likely visible", "Possibly visible", "Very unlikely/not visible"),
            cats.map { it.label }
        )
        assertEquals(listOf(100, 66, 33, 10), cats.map { it.score })
    }

    @Test
    fun getCategories_isAFreshCopyEachCall() {
        val first = Visibility.getCategories()
        val second = Visibility.getCategories()
        assertEquals(first, second) // same values...
        assertNotSame(first, second) // ...but distinct list instances
    }
}
