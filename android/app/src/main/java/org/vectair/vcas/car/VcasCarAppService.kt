package org.vectair.vcas.car

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * Entry point Android Auto binds to. Phase 1 only proves the app registers
 * and launches as a car app at all — see CLAUDE.md's "Android Auto —
 * native rewrite scoping" note. No real VCAS logic (GPS, ADS-B, map) lives
 * here yet; that's phase 2 onward.
 */
class VcasCarAppService : CarAppService() {

    override fun createHostValidator(): HostValidator {
        // ALLOW_ALL_HOSTS_VALIDATOR is Google's own documented
        // debug/development escape hatch — appropriate for Developer Mode
        // sideloading at VCAS's actual scale (see CLAUDE.md), but if this
        // ever moves toward wider distribution, replace with a real
        // allowlist (HostValidator.Builder().addAllowedHosts(...)) before
        // then, not after.
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    }

    override fun onCreateSession(): Session = VcasSession()
}
