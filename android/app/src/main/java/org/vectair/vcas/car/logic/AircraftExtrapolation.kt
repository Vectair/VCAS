package org.vectair.vcas.car.logic

import kotlin.math.max
import kotlin.math.min

/**
 * Dead-reckons aircraft positions between ADS-B polls, using each
 * aircraft's own reported ground speed + track — same principle real
 * TCAS/ND displays use to stay smooth between radar sweeps. Ported from
 * the PWA's src/logic/aircraftExtrapolation.js, the fourth file in
 * CLAUDE.md's "Android Auto — native rewrite scoping" pure-logic list
 * (after Geo.kt, Visibility.kt, Relevance.kt).
 *
 * adsb.fi's feed only updates every REFRESH_INTERVAL_SECONDS; without
 * this, a fast-moving aircraft close to the user visibly teleports
 * between polls, while a distant one (which barely changes position over
 * the same interval) gets no benefit from polling that often.
 * Extrapolating client-side fixes the near case for free, at zero extra
 * API cost, and helps every aircraft rather than just the close ones a
 * tiered-polling approach would target.
 *
 * `Aircraft` here is the actual normalised domain object (mirroring
 * src/data/normaliseAircraft.js's real output shape: hex, callsign,
 * type, lat, lon, altitudeFt, onGround, trackDeg, groundSpeedKt,
 * verticalRateFpm, lastSeenSeconds, category, registration,
 * isGroundVehicleOrObstacle) rather than a narrow per-function subset
 * like Visibility.kt's `AircraftInput` or Relevance.kt's
 * `AircraftState` — this file's own job is specifically to hand back a
 * copy of the WHOLE aircraft with only lat/lon changed (the JS original
 * does this via `{ ...aircraft, lat, lon }`), so a full-fidelity type is
 * what makes `.copy(lat=..., lon=...)` a faithful equivalent of that
 * spread rather than silently dropping fields the way a narrower type
 * would.
 */
object AircraftExtrapolation {

    data class Aircraft(
        val lat: Double,
        val lon: Double,
        val hex: String = "A00000",
        val callsign: String? = null,
        val type: String? = null,
        val altitudeFt: Double? = null,
        val onGround: Boolean = false,
        val trackDeg: Double? = null,
        val groundSpeedKt: Double? = null,
        val verticalRateFpm: Double? = null,
        val lastSeenSeconds: Double = 0.0,
        val category: String? = null,
        val registration: String? = null,
        val isGroundVehicleOrObstacle: Boolean = false
    )

    private const val KT_TO_MPS = 0.514444

    /**
     * @param elapsedSeconds Time since the fix this aircraft's lat/lon came from.
     * @param maxElapsedSeconds Cap on how far to project — beyond this the fix
     *   is too old to trust a straight-line projection from, so position is
     *   held rather than extrapolated further.
     */
    fun extrapolate(aircraft: Aircraft, elapsedSeconds: Double, maxElapsedSeconds: Double): Aircraft {
        if (aircraft.groundSpeedKt == null || aircraft.trackDeg == null) return aircraft
        // Taxiing aircraft turn corners along taxiways; a straight-line
        // projection would visibly cut across them, so leave on-ground
        // traffic at its last reported fix instead.
        if (aircraft.onGround) return aircraft

        val seconds = min(max(elapsedSeconds, 0.0), maxElapsedSeconds)
        if (seconds == 0.0) return aircraft

        val distanceMeters = aircraft.groundSpeedKt * KT_TO_MPS * seconds
        val dest = Geo.destinationPoint(aircraft.lat, aircraft.lon, aircraft.trackDeg, distanceMeters)
        return aircraft.copy(lat = dest.lat, lon = dest.lon)
    }

    fun extrapolateAll(aircraftList: List<Aircraft>, elapsedSeconds: Double, maxElapsedSeconds: Double): List<Aircraft> =
        aircraftList.map { extrapolate(it, elapsedSeconds, maxElapsedSeconds) }
}
