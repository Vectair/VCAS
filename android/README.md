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

## Phase 2 follow-up: real ADS-B polling (2026-08-25, same day)

`AdsbFiClient.kt` polls adsb.fi directly (no CORS relay — that's a
browser-only workaround; a native `HttpURLConnection` has no CORS
restriction to route around, per CLAUDE.md's own "ADS-B data source"
section) on a 3s timer, centered on the live GPS fix. Responses are
normalised via a new port, `NormaliseAircraft.kt` — the second
discovered-along-the-way logic dependency (after `routeGeometry.js`),
with its own real, fully-verified `kotlinc`+JUnit4 test suite (30 tests,
alongside the existing 152). `VcasMapRenderer` starts/stops the client
alongside GPS updates and stores each poll's result — deliberately not
yet fed through `Indicators`/`AircraftExtrapolation` or drawn anywhere;
that's real, observable via a log line, but scoped no further than
"polling" per the explicit ask. See CLAUDE.md's entry for the full
`??`-vs-`||` care this port needed and why the PWA's own multi-provider
round-robin wasn't ported (VCAS's real config only ever has one
provider).

## First real build: one real compile error, fixed (2026-08-26)

The project owner's actual first Android Studio build hit one real
compiler error: `LocationPermissionScreen.kt`'s `.setHeader(Header...)`
call doesn't exist on the real `androidx.car.app:app:1.4.0` VCAS is
pinned to — it was copied from Google's own official sample, which
targets a newer, unreleased `1.9.0-alpha01` internal build. Fixed by
switching to the plain `.setTitle()`/`.setHeaderAction()` pattern the
MapLibre community sample uses (that sample correctly pins `1.4.0`, same
as VCAS). See CLAUDE.md's dated entry for the full root-cause writeup and
the lesson it leaves for future reference-source checks: matching the
actual pinned VERSION matters as much as the source being official.

**The rebuild after that fix succeeded with no further errors** — the
first fully clean compile of all of phase 2 (real MapLibre map, GPS-
driven camera, ADS-B polling), confirmed on a real machine. Next real
checks, not yet done: install the APK on the phone, sideload via
Android Auto Developer Mode, and confirm VCAS actually shows up and
launches in the car's app list (the original phase-1 question, never
yet re-confirmed since those manifest fixes) — then whether the map
renders on the car's Surface and GPS/ADS-B actually flow in at runtime.
A clean compile only proves the code is valid against the real SDK, not
that any of that runtime behavior works yet.

## A real phone-visible app, not just a car-projected one (2026-08-26)

`MainActivity` — previously a bare placeholder screen — is now a real,
independent standalone experience: its own MapLibre `MapView`, real GPS
via `LocationManager`, real ADS-B via the same `AdsbFiClient` the car
side uses, and every currently-tracked aircraft plotted as a real map
marker at its true lat/lon (tap a marker for a built-in info window with
type/altitude/distance/visibility). This is fully native Kotlin, not a
WebView wrapping the PWA — a direct choice, matching the "genuine
rebuild, not a shortcut" standard already set for the car-Surface UI.

One APK, two independent entry points: `VcasCarAppService`/`VcasSession`/
`MapScreen` (the car side) is completely untouched — Android Auto's own
discovery of it was never driven by `MainActivity` existing at all.
Tapping the app icon on the phone now opens a real, useful screen
instead of a redirect message; connecting to a car still launches the
separate native car-app screen. See CLAUDE.md's dated entry for the full
design reasoning (why `mode = "air"` for the camera, why this calls
`Visibility`/`Geo` directly instead of the `Indicators` pipeline, and the
list of deliberately-scoped simplifications — no own-position marker, no
marker diffing/extrapolation yet, foreground-only).

**Never compiled**, same honest caveat as everything else in this
directory — cross-checked directly against the cloned MapLibre Native
Android SDK source, and reusing GPS/lifecycle patterns already confirmed
to compile clean in the just-verified real build.

## Phone screen, real pass 1 (2026-08-26, same day)

First real-device screenshot of the phone screen showed generic red pin
markers on demo tiles under a bare OS action bar — working end to end,
but nothing like VCAS visually. Fixed in priority order (markers, then
map style, then chrome):

- **Real icons**: `PhoneAircraftIcons.kt` draws VCAS's actual TCAS shape/
  colour/direction-arrow (ported from `aircraftSymbol.js`/`map.js`) onto
  a real `Bitmap`, rendered via `SymbolManager` (a new Maven Central
  dependency, `android-plugin-annotation-v9`, version-checked against the
  pinned `android-sdk` before adding it) instead of the classic
  `@Deprecated` `Marker` API, which has no icon-anchor centering at all.
- **Real map style**: MapTiler's own pre-made `streets-v2` style.json,
  reusing the same key `src/config.js` already has (explicit go-ahead
  from the project owner to try it) — not VCAS's own hand-tuned 31-layer
  custom style (`navStyle.js`), which is a real, separate, much larger
  port not attempted here. Falls back to the demo style on a real load
  failure instead of leaving the map blank.
- **Real chrome**: a `Theme.VCAS` (`NoActionBar`) plus a real top bar
  built with VCAS's actual cockpit-panel hex tokens, replacing the bare
  OS action bar — not a port of the PWA's full top bar (no modes/settings
  exist on this screen yet).

See CLAUDE.md's dated entry for the full reasoning on each, including the
version-compatibility check done on the new plugin dependency and why the
map style is a deliberate middle ground, not VCAS's real Hybrid look.

## What's next (not started)

Porting the geo/visibility/relevance/indicators/aircraftExtrapolation/
navigationCameraEvaluator logic to Kotlin is DONE (see CLAUDE.md — all
six files plus the discovered `routeGeometry.js`/`normaliseAircraft.js`
dependencies, each with its own real `kotlinc`+JUnit4-verified test
suite). Real GPS drives the camera and real ADS-B polling is live (see
above). Not yet done: feeding polled aircraft through `Indicators`/
`AircraftExtrapolation` and drawing traffic markers on the map surface,
the device-compass heading fallback, routing, swapping the demo map
style for VCAS's real one, and the foreground-service/background-
execution work. See CLAUDE.md for the full phase list and current
status.
