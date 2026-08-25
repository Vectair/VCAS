package org.vectair.vcas.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

/**
 * One Session per car-host connection (roughly: per time the phone
 * connects to a head unit). Phase 2 (2026-08-25) hands back MapScreen,
 * backed by a real VcasMapRenderer — see CLAUDE.md's "Android Auto —
 * native rewrite scoping" note and the phase-2 milestone entry.
 * Real multi-screen navigation (destination picker, active route view)
 * is still phase 3's job — this Session still only ever has one screen.
 *
 * VcasMapRenderer is constructed here, needing the Session's own
 * `lifecycle` — its onCreate/onDestroy is what registers/unregisters the
 * car's SurfaceCallback, and that lifecycle genuinely belongs to the
 * Session, not to any one Screen that might be pushed/popped on top of
 * it later. Not stored as a field or handed to MapScreen — nothing reads
 * it back yet (see MapScreen's own doc comment on why it doesn't take
 * one); the renderer's constructor registering itself as a lifecycle
 * observer is the only side effect actually needed right now. A future
 * step that needs to reach it (camera re-centering once GPS is wired up,
 * say) is a real, expected reason to start retaining it then.
 */
class VcasSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen {
        VcasMapRenderer(carContext, lifecycle)
        return MapScreen(carContext)
    }
}
