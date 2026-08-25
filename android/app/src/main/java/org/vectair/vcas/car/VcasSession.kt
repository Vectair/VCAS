package org.vectair.vcas.car

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.core.content.ContextCompat

/**
 * One Session per car-host connection (roughly: per time the phone
 * connects to a head unit). Phase 2 (2026-08-25) hands back MapScreen,
 * backed by a real VcasMapRenderer — see CLAUDE.md's "Android Auto —
 * native rewrite scoping" note and the phase-2 milestone entry.
 * Real multi-screen navigation (destination picker, active route view)
 * is still phase 3's job — this Session still only ever has one screen
 * of its own (plus LocationPermissionScreen, pushed on top only when
 * needed).
 *
 * VcasMapRenderer is constructed here, needing the Session's own
 * `lifecycle` — its onCreate/onDestroy is what registers/unregisters the
 * car's SurfaceCallback, and that lifecycle genuinely belongs to the
 * Session, not to any one Screen that might be pushed/popped on top of
 * it later. Now retained as a field (2026-08-25, GPS follow-up) — the
 * exact "future step that needs to reach it" flagged when phase 2's map
 * work first left it unretained: LocationPermissionScreen's grant
 * callback needs to tell the renderer to actually start GPS updates once
 * permission is newly granted mid-session.
 *
 * Permission-check-then-push pattern confirmed against BOTH Google's own
 * official navigation sample (`NavigationSession.onCreateScreen()`) AND
 * the MapLibre community sample (`MyCarSession.onCreateScreen()`), which
 * independently agree on the same structure despite disagreeing on the
 * permission-request mechanism itself (see LocationPermissionScreen's
 * own doc comment): push the map screen first as the stack's base
 * regardless of permission state — the map itself needs no location
 * permission to render — then push the permission screen on top only if
 * needed, so granting it can pop back to reveal the already-live map
 * underneath rather than the permission flow gating the map's own
 * existence.
 */
class VcasSession : Session() {
    private lateinit var mapRenderer: VcasMapRenderer

    override fun onCreateScreen(intent: Intent): Screen {
        mapRenderer = VcasMapRenderer(carContext, lifecycle)
        val mapScreen = MapScreen(carContext)

        return if (hasLocationPermission()) {
            mapRenderer.startLocationUpdatesIfPermitted()
            mapScreen
        } else {
            carContext.getCarService(ScreenManager::class.java).push(mapScreen)
            LocationPermissionScreen(carContext) { mapRenderer.startLocationUpdatesIfPermitted() }
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
}
