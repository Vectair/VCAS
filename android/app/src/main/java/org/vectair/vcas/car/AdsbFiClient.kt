package org.vectair.vcas.car

import android.location.Location
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.vectair.vcas.car.logic.AircraftExtrapolation
import org.vectair.vcas.car.logic.NormaliseAircraft
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

/**
 * Polls adsb.fi directly for nearby aircraft (2026-08-25, the ADS-B
 * follow-up to phase 2's GPS/camera wiring). Ports the actual HTTP/
 * polling behaviour of the PWA's src/data/adsbExchangeClient.js's
 * `adsb_fi` provider — not a structural Kotlin "port" of that whole
 * file, since this class is genuinely Android-specific (real threading,
 * real `HttpURLConnection`) in a way `NormaliseAircraft.kt` deliberately
 * isn't; see that file's own doc comment for the actual ported logic.
 *
 * **Calls adsb.fi directly, with no CORS relay** — CLAUDE.md's own
 * "ADS-B data source" section already establishes why the relay exists
 * at all (adsb.fi sends no CORS header, so a BROWSER's `fetch()` can't
 * read the response) and explicitly flags that "a real native app's HTTP
 * requests aren't subject to browser CORS restrictions at all, so this
 * whole relay becomes unnecessary at that point." This is that point —
 * `HttpURLConnection` has no CORS concept, so the relay's entire reason
 * to exist doesn't apply here. The relay's OTHER job (protecting adsb.fi
 * from aggregate load across many concurrent PWA testers funneled
 * through one shared server) also doesn't apply to a single native
 * client polling on its own at the same ordinary interval the PWA
 * itself uses (`REFRESH_INTERVAL_MS`, matching `CONFIG.
 * REFRESH_INTERVAL_SECONDS`) — nowhere near adsb.fi's own documented
 * 1req/s limit for one client.
 *
 * Uses `org.json.JSONObject` (Android's own bundled implementation at
 * runtime, no extra app dependency) and plain `HttpURLConnection` (JDK/
 * Android built-in) rather than OkHttp or Play Services — same
 * "avoid a dependency the framework already provides, especially one
 * this sandbox can't verify against `dl.google.com`" discipline already
 * established for `LocationManager` over `FusedLocationProviderClient`
 * (see `VcasMapRenderer.kt`'s own doc comment).
 *
 * The actual network call always runs on a background single-thread
 * executor — `HttpURLConnection` on the main thread would throw
 * `NetworkOnMainThreadException`. Results are delivered back via a
 * `Handler` on the main looper, matching how `VcasMapRenderer` (and the
 * Car App Library itself) expects UI-adjacent callbacks to arrive.
 */
class AdsbFiClient(
    private val locationProvider: () -> Location?,
    private val onAircraftUpdated: (List<AircraftExtrapolation.Aircraft>) -> Unit
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pollRunnable: Runnable? = null
    private var active = false

    fun start() {
        if (active) return
        active = true
        schedulePoll(0L)
    }

    fun stop() {
        active = false
        pollRunnable?.let { mainHandler.removeCallbacks(it) }
        pollRunnable = null
        executor.shutdownNow()
    }

    private fun schedulePoll(delayMs: Long) {
        val runnable = Runnable {
            pollOnce()
            if (active) schedulePoll(REFRESH_INTERVAL_MS)
        }
        pollRunnable = runnable
        mainHandler.postDelayed(runnable, delayMs)
    }

    /**
     * Centered on the most recent GPS fix (via `locationProvider`, read
     * fresh each tick rather than captured once) — matches the PWA's own
     * `fetchNearby(lat, lon, rangeNm)`, always called with the user's
     * current position, not a fixed one. A tick with no fix yet (before
     * the first location update arrives) simply skips — the next tick
     * tries again, same as `VcasMapRenderer`'s own camera-update path
     * no-ops until both a fix and a ready map exist.
     */
    private fun pollOnce() {
        val location = locationProvider() ?: return
        val lat = location.latitude
        val lon = location.longitude
        executor.execute {
            val aircraft = fetchAndParse(lat, lon)
            if (aircraft != null) {
                mainHandler.post { onAircraftUpdated(aircraft) }
            }
        }
    }

    private fun fetchAndParse(lat: Double, lon: Double): List<AircraftExtrapolation.Aircraft>? {
        val dist = RANGE_NM.coerceAtMost(250.0) // adsb.fi's own documented max radius
        val url = URL("https://opendata.adsb.fi/api/v3/lat/$lat/lon/$lon/dist/$dist")
        var connection: HttpURLConnection? = null
        return try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", "application/json")
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(LOG_TAG, "adsb.fi returned HTTP ${connection.responseCode}")
                return null
            }
            val body = connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            val json = JSONObject(body)
            val rawList = json.optJSONArray("ac") ?: return emptyList()
            val result = ArrayList<AircraftExtrapolation.Aircraft>(rawList.length())
            for (i in 0 until rawList.length()) {
                val raw = rawList.optJSONObject(i) ?: continue
                NormaliseAircraft.normalise(raw)?.let { result.add(it) }
            }
            Log.i(LOG_TAG, "polled ${result.size} aircraft within ${dist}nm")
            result
        } catch (e: Exception) {
            // Mirrors adsbExchangeClient.js's own generic network/timeout
            // handling — a failed poll degrades to "no update this tick,"
            // never a crash; the next scheduled tick simply tries again.
            Log.w(LOG_TAG, "adsb.fi poll failed", e)
            null
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        private const val LOG_TAG = "AdsbFiClient"

        // Matches the PWA's CONFIG.REFRESH_INTERVAL_SECONDS (3) — adsb.fi's
        // own documented rate limit is 1 request/second; this single native
        // client polling alone leaves generous headroom below it.
        private const val REFRESH_INTERVAL_MS = 3000L

        // Matches the PWA's AbortSignal.timeout(8000) in adsbExchangeClient.js.
        private const val TIMEOUT_MS = 8000

        // Matches the PWA's CONFIG.DEFAULT_RANGE_NM.
        private const val RANGE_NM = 50.0
    }
}
