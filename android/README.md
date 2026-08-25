# VCAS for Android Auto

Native Android project, entirely separate from the PWA in the repo root.
See `CLAUDE.md`'s **"Android Auto — native rewrite scoping"** section for
the full context on why this exists, what's portable from the PWA vs. what
needed a genuine rewrite, and the planned phase order. This directory is
phase 1 of that plan: prove the app registers as a car app and actually
launches via Android Auto's Developer Mode sideloading, before investing
in anything real (map, traffic overlay, GPS/ADS-B).

## What this is, honestly

This was written without an Android SDK available, and without network
access to Google's Maven repo (`dl.google.com`, where the Android Gradle
Plugin and the Car App Library itself are hosted) — both confirmed
unreachable from the sandbox this was built in. That means:

- **The overall architecture is on solid ground** — `CarAppService`,
  `Session`, `Screen`, `createHostValidator()`, the manifest's
  `<meta-data>`/`<service>` declarations — these are long-stable,
  well-established parts of the Car App Library, not something likely to
  have drifted.
- **The exact `MessageTemplate` builder calls in `MainScreen.kt` are
  this project's best-confidence reconstruction from documented usage,
  not verified against a live SDK.** This has never been compiled. The
  first real build in Android Studio — with real code completion and real
  compiler errors — is the actual check, not anything done here.
- **Version numbers** (AGP, Kotlin, `androidx.car.app`, `compileSdk`) are
  a reasonable-as-of-writing baseline, not checked against what's
  currently latest. Let Android Studio prompt you to update them.

None of this is a reason not to trust the structure — it's why the next
step has to be opening this in Android Studio and actually building it,
not treating it as already working.

## Building it

1. Install **Android Studio** (this brings the Android SDK, platform
   tools, and everything else needed — none of it is bundled here).
2. Open this `android/` folder as a project (not the repo root — the PWA
   and this native project are unrelated builds sharing one repo).
3. Let Gradle sync. It'll likely prompt to update the AGP/Kotlin/SDK
   versions in `build.gradle.kts` — accept those, they weren't pinned
   against a live check.
4. Build → Make Project. Fix whatever Android Studio flags — expect the
   `MessageTemplate` builder calls in `MainScreen.kt` to be the most
   likely spot needing a small correction, per the caveat above.

## Sideloading it via Android Auto Developer Mode

1. On your phone, open the **Android Auto** app.
2. Tap the version number in its settings repeatedly (same repeated-tap
   pattern as unlocking Android's own Developer Options) until Developer
   Mode unlocks.
3. In Android Auto's Developer Mode settings, enable **"Unknown sources"**
   for car apps.
4. Build and install the APK onto your phone from Android Studio (USB
   debugging, same as any normal Android app install) — or `adb install`
   the built APK directly.
5. Connect the phone to a compatible head unit (or launch Android Auto's
   phone-screen mode, if your Android Auto version supports testing that
   way without a car).
6. VCAS should appear in the car's app list. Tapping it should show the
   phase-1 message screen — that's the entire goal of this phase, nothing
   more.

## If it doesn't show up

This is genuinely the first time this exact code has run anywhere — if
Android Auto doesn't show it, treat it as real debugging, not necessarily
a sign the whole approach is wrong. Worth checking in order:
1. Did the app actually install successfully on the phone (check the
   normal app drawer, not just Android Auto)?
2. Is "Unknown sources" for car apps definitely enabled in Android Auto's
   Developer Mode settings (easy to toggle the wrong thing)?
3. Does `adb logcat` show anything from `androidx.car.app` or this app's
   package (`org.vectair.vcas.car`) when you try to connect/launch it —
   a validation failure in the manifest or `HostValidator` would show up
   there.
4. Compare `AndroidManifest.xml` and `automotive_app_desc.xml` against
   Google's current official "Get started" sample for the Car App
   Library — these two files are the most likely to have drifted from
   whatever the current exact required syntax is.

## Phase 2: a real MapLibre map (2026-08-25)

Added before phase 1 was ever confirmed working on a real head unit —
the project owner explicitly chose to keep pushing forward on
buildable-but-unverified code rather than wait (see CLAUDE.md's phase-2
milestone entry for the full reasoning). `MainScreen`/`MessageTemplate`
is gone; `MapScreen` now builds a real `NavigationTemplate` showing a
live MapLibre map (`VcasMapContainer`/`VcasMapRenderer`), pan/zoom-
interactive via `Action.PAN`.

This wasn't invented from scratch — it's adapted directly from MapLibre's
own official reference sample for exactly this problem,
`maplibre/MapLibre-Android-Auto-Sample` (cloned and read, not guessed),
cross-checked line-by-line against the same official Google Car App
Library sample phase 1's own manifest fixes came from. See CLAUDE.md's
phase-2 entry for the full mechanism (a real Android `VirtualDisplay`/
`Presentation`, not anything MapLibre-specific) and the two places this
port deliberately deviated from the reference, with reasons.

**Still unverified against a live build or device** — same honest caveat
as phase 1, for the same reason (no Android SDK, no way to reach
`dl.google.com` for the Car App Library's own AAR from this sandbox).
Every non-trivial API call used here (`getCarService(Class)`,
`SurfaceCallback`'s actual required method set, `Action.PAN`) was
additionally cross-checked against Google's own official navigation
sample's real source, not just the community MapLibre sample alone — but
that's corroboration, not compilation. Opening this in Android Studio for
a real build is still the actual check.

The map style is MapLibre's own public demo tiles
(`https://demotiles.maplibre.org/style.json`), same placeholder the
reference sample itself uses — not VCAS's real MapTiler style yet. See
`VcasMapContainer.kt`'s own `TODO` for why that wasn't wired in directly.

## Phase 2 follow-up: real GPS driving the camera (2026-08-25, same day)

The first of the ported logic files actually wired to live device input:
`NavigationCameraEvaluator` now receives real `LocationManager` GPS
fixes, and its pitch/zoom/anchor output drives the real MapLibre camera
via `CameraAnchor.kt` (a small, deliberately pure/Android-independent
helper — the one piece of this follow-up that IS genuinely, fully
verified, with its own real `kotlinc`+JUnit4 test suite same as the six
logic ports). Also adds a real location-permission flow
(`LocationPermissionScreen`), built from Google's own official sample's
pattern rather than the MapLibre community sample's — the two
genuinely disagree on the request mechanism; see CLAUDE.md's entry for
which was followed and why.

Known, honestly-scoped gaps, not silently-left-unstated ones: no AIR-
mode-equivalent UI yet (`mode` is hardcoded `"nav"`), no routing yet
(`routeActive` hardcoded `false`, so `TURN_APPROACH` can never actually
trigger), and no compass-sensor fallback for heading while stationary
(camera bearing just holds its last known GPS heading). See CLAUDE.md's
entry for the full reasoning on each.

Same honest caveat as the rest of this project: `VcasMapRenderer.kt`/
`VcasSession.kt`/`LocationPermissionScreen.kt` have never been compiled,
cross-checked against real source instead. `CameraAnchor.kt` is the
exception — genuinely verified, not just corroborated.

## What's next (not started)

Porting the geo/visibility/relevance/indicators/aircraftExtrapolation/
navigationCameraEvaluator logic to Kotlin is DONE (see CLAUDE.md — all
six files plus the discovered `routeGeometry.js` dependency, each with
its own real `kotlinc`+JUnit4-verified test suite). Real GPS now drives
the camera (see above). Not yet done: real ADS-B polling, drawing
traffic indicators on the map surface, the device-compass heading
fallback, routing, swapping the demo map style for VCAS's real one, and
the foreground-service/background-execution work. See CLAUDE.md for the
full phase list and current status.
