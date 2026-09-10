# CLAUDE.md — VCAS working context

Project-specific context for Claude Code sessions. Read this before README.md —
README is end-user/setup documentation; this file is decisions, conventions,
and history that aren't obvious from the code alone. Keep this updated as
things change; it's the main thing that survives between sessions.

## Long-term destination: a standalone, self-sufficient native app

**The project owner has stated this multiple times over the course of the
build — it is a settled decision, not an open question.** VCAS's PWA form
(installable web app, no native build, no app store) is a **deliberate
interim choice for fast iteration** — no build step, edit-and-push-to-deploy,
instant field-testing via a public HTTPS URL (see the Aug 11 2026 commit that
added PWA installability: motivated purely by practical testing needs, GPS/
compass secure-context requirements, nothing more). It is **not** the
intended final form. Don't propose "is this actually meant to be a real app"
as an open question, don't default to PWA-only solutions on the assumption
that's the ceiling, and don't push back on native-track proposals with "not
yet"/"let's keep it simple for now" without first checking whether that's
actually still true — that pattern has already caused real friction once
because a repeated, explicit decision wasn't written down anywhere durable
until 2026-08-20. If in doubt about whether now is the right moment for a
concrete step toward native, ask; don't assume the PWA form is the ceiling.

### The native app's actual destination is Android Auto, specifically (2026-08-24)

Not just "a native app" in the abstract — asked directly, the project
owner's end goal is VCAS displaying on a car's infotainment screen via
**Android Auto** (phone projects into the car's own factory screen), not
Android Automotive OS (a full Android build running natively on the
car's own hardware, a different and separately-variable-by-manufacturer
thing) and not an aftermarket Android head unit. This matters because
the three have very different sideloading stories, and it's worth
staying anchored to the one actually being targeted rather than treating
"native Android app" as if any of the three trivially imply the others.

**Sideloading is solved and low-risk, not the blocker.** Android Auto has
a real, officially-documented **Developer Mode** toggle (unlocked in the
Android Auto app on the phone, repeated-tap style, same spirit as
Android's own general developer options) that enables installing an
unpublished/unreviewed car app directly — no Google Play listing, no
Google review process required. Once a properly-built car app is
sideloaded with Developer Mode on, it shows up and launches in Android
Auto like any other car app the moment the phone connects to a
compatible head unit. Given VCAS's actual scale (project owner + a
handful of testers), this isn't just a testing stepping-stone toward
"real" Play Store distribution later — it can be the permanent
distribution mechanism, the same role PWABuilder plays for the phone app
today.

**The actual prerequisite, and the real work, is that VCAS isn't
eligible for Android Auto at all in its current form** — not because of
anything wrong with it, but because Android Auto only accepts apps built
against Google's **Android for Cars App Library** (`androidx.car.app`), a
native Kotlin/Java API with its own restricted template system
(`CarAppService`/`Session`/`Screen`/`NavigationTemplate`). Critically, a
PWABuilder-generated package — a WebView wrapper, which is what the
current phone-side native-track plan implicitly assumes — is **not**
eligible for this either. Getting onto Android Auto specifically means a
real rewrite of the UI/interaction layer against that library, not just
"package the existing web app differently a second time."

**Scoped breakdown, so this doesn't need re-deriving from scratch next
time it comes up:**

*Cleanly portable — pure logic, no DOM dependency, translates to Kotlin
close to line-for-line:*
- `geo.js` (bearing/distance/polar-projection math)
- `visibility.js` (the 4-tier sightability scoring)
- `relevance.js` (the teardrop relevance filter)
- `aircraftExtrapolation.js` (dead-reckoning between ADS-B polls)
- `indicators.js` (the build/sort/cap orchestration — verified intact
  2026-08-24, see the label-suppression investigation earlier this file)
- Every tuned constant (`CONFIG.*`, `RING_BANDS_NM`, the visibility
  angular-size thresholds, etc.)
- `navigationCameraEvaluator.js` — already a pure state machine with no
  MapLibre-JS-specific calls in it, despite living in the "navigation"
  folder alongside genuinely web-specific code

*Needs a genuine rebuild, not a port:*
- The entire UI layer — `ui.js`/`index.html`/`VCAS.css` are all
  DOM/CSS/SVG with no native equivalent. The traffic-plot rendering
  (icons, labels, decluttering) becomes Canvas drawing on Android's own
  2D APIs instead of positioned `<div>`s.
- The map — MapLibre GL JS → **MapLibre Native Android SDK** (a real,
  actively maintained equivalent; the style/tile concepts carry over
  conceptually since MapLibre's style spec is shared across platforms,
  but `map.js`/`cameraController.js`'s actual API calls are JS-specific
  and need re-implementing against the native SDK's own camera API).
- The car-app shell itself (`CarAppService`/`Session`/`Screen`, wiring a
  `NavigationTemplate` with a custom `Surface` for the map+traffic
  overlay) — zero web equivalent, this is the genuinely new part of the
  project, not a translation of anything that exists today.
- Background execution — a browser tab uses a Wake Lock; Android
  requires a proper foreground `Service` (persistent notification) to
  keep GPS/ADS-B polling alive independent of whether the car screen is
  currently showing VCAS.
- Settings — Android Auto's `Screen` stack is intentionally shallow and
  restricted; the natural pattern is a companion phone-side settings
  Activity that writes preferences the car-app-service just reads, not a
  settings flow inside the car display itself.

*Deleted, not ported — a genuine simplification, not just dead weight:*
`compassHeading.js` and its entire DeviceOrientation-API-fragmentation
fight (see "Compass 'won't settle / settles wrong'" below) is a
web-platform-only problem. Native Android reads the compass/orientation
sensor directly — none of that file's cross-browser workaround logic has
any native equivalent to port, it just stops being needed.

**The real open question is fit, not effort.** Google's Android Auto
templates are built around "one destination, turn-by-turn, minimal
glances" — VCAS's core identification concept (dozens of tappable
traffic icons, detail popups) doesn't map onto that cleanly. The
map/traffic overlay CAN live on the custom `Surface` a `NavigationTemplate`
allows, but how much interactive tap-to-inspect behaviour is reasonable
there, distraction-wise, is a genuinely open design question — Developer
Mode sideloading bypasses Google's formal review requirement, not the
underlying safety question of whether a dense tap-heavy traffic display
is appropriate on a car screen at all. Worth treating as a real design
constraint from the start, not something to discover after the rewrite
is mostly done.

**Reasonable phase order, if/when this is picked up:**
1. Bare-bones `CarAppService` + a static `NavigationTemplate` — confirm
   Developer Mode sideloading actually shows up and launches on a real
   head unit before investing further; validate the mechanism itself
   first.
2. MapLibre Native + port the geo/visibility/relevance/indicators logic;
   get the traffic plot drawing on the `Surface`.
3. Routing + `NavigationTemplate`'s own turn-by-turn step display.
4. Foreground service + Android's background-location permission flow
   (a separate "Allow all the time" grant, Android 10+).
5. Settings companion screen, feature-parity pass — RAW's dense
   instrument-style look specifically may need real redesign to fit
   template constraints, not just a straight port.

Not started — this is a scoping note for when the project owner decides
to pick it up, not a plan currently in motion.

### Phase 1 started (2026-08-24)

Project owner said to go ahead. `android/` (repo root, sibling to the PWA,
entirely separate build) now has a real Gradle/Kotlin project skeleton —
`CarAppService`/`Session`/`Screen`, the manifest's car-app `<meta-data>`/
`<service>` declarations, `automotive_app_desc.xml`, and a `MessageTemplate`
screen (deliberately not `NavigationTemplate` yet — isolates "does the app
launch at all" from "is my NavigationTemplate built correctly," a
materially more involved template; swapping to it is the next small step
once this is confirmed working, not a separate phase).

**Honest status, not glossed over**: this has never been compiled. This
sandbox has no Android SDK, and — confirmed by directly testing it, not
assumed — `dl.google.com` (Google's Maven repo, where the Android Gradle
Plugin and the Car App Library itself are hosted) isn't reachable from it
either, only `repo1.maven.org` and `services.gradle.org` are. So unlike
literally everything else built this session, none of this could be
verified against a real compiler, let alone a real device. The
`CarAppService`/`Session`/`Screen` architecture and the manifest shape are
long-stable, well-established parts of the library and are on solid
ground; the exact `MessageTemplate` builder calls are this project's
best-confidence reconstruction from documented usage, flagged inline in
`MainScreen.kt` and `android/README.md` as the most likely spot needing a
small correction once actually opened in Android Studio — that first real
build, with real code completion and real compiler errors, is the actual
check, not anything done here. Also unverified for the same reason: exact
current version numbers for AGP/Kotlin/`androidx.car.app`/`compileSdk`
(a reasonable-as-of-writing baseline was used, not checked live).

**Still needs, from the project owner**: opening `android/` in Android
Studio to actually build it, and — the real phase-1 goal — sideloading it
via Android Auto's Developer Mode to confirm it shows up and launches on
a real head unit at all. See `android/README.md` for the full
build/sideload/troubleshooting steps. Phase 2 (MapLibre Native + porting
the geo/visibility/relevance/indicators logic) is next, once this is
confirmed working — see the phase list above.

## What VCAS is, and isn't

VCAS is a mobile-first navigation app with an aircraft-identification overlay.
**Two co-equal core pillars: navigation and identification.** Neither is the
"real" app with the other bolted on. This was an explicit correction from the
project owner after the app's focus drifted toward pure aircraft-spotting
features — before adding anything, ask whether it serves navigation,
identification, or both. Features that serve neither (e.g. full METAR/TAF
weather display, engine/flight-instrument readouts) have been explicitly
rejected even when technically interesting, per direct instruction: "we don't
need to display any additional information" beyond what feeds the
navigation/identification pipelines.

## Pre-V1 release checklist

Things that are deliberately fine for now (personal use, single user) but
**must** be addressed before VCAS goes out to anyone else:

- **adsb.fi attribution needs to be more prominent — DONE (2026-08-23).**
  Their usage terms require citing them with a link to their homepage.
  Was satisfied minimally via Settings > Data & Logging
  (`.settings-credit`), buried in a settings sub-screen — explicitly OK'd
  as personal-use-only stopgap on 2026-08-20, with the same instruction to
  move it before release. Moved to a small `#adsb-credit` line in the top
  bar, stacked directly under the `#adsb-status` pill (`#top-right-
  controls` — dead CSS from an earlier design iteration, revived rather
  than writing a fresh wrapper) so it's visible the entire time the app is
  open, not a one-time mention someone has to go find. The Settings
  mention was removed rather than duplicated, to avoid two copies of the
  same credit drifting out of sync. See "Beta test milestone" below for
  why a splash/launch screen was considered and rejected in favor of this
  placement.

- **RAW controls (range selector, and mode switching generally) —
  revisit the interaction design.** Project owner (2026-08-21): current
  tap-to-cycle range button is "acceptable for now" but flagged for a
  design pass before V1. Raised directly by a real A320 EFIS control
  panel reference photo showing physical rotary knobs — one for ND mode
  (ROSE/VOR/ILS/NAV/ARC/PLAN), one for range (10/20/40/80/160/320) —
  asking whether VCAS should replicate literal rotary-knob controls for
  its own Hybrid/Raw/Air mode switch and range selector. Assessed and
  agreed: **not** as literal drag-to-rotate gestures — VCAS is a
  one-handed, glance-while-driving app, and a rotate gesture demands more
  sustained precision/attention than a single tap, a real regression
  against the app's core safety premise (matches how automotive UX
  guidance, and Apple/Google's own driving-mode rules, steer away from
  drag/rotate controls generally). Two different conclusions per control,
  both agreed:
  - **Mode switch (Hybrid/Raw/Air):** keep the flat 3-button row. A
    dial styled to look like the reference hardware (tap-a-label, not
    drag) would cost MORE screen space (labels arranged radially) for
    zero interaction benefit over what's already there — no reason to
    change this one.
  - **Range selector:** the one place a real knob has a genuine
    functional edge a tap-to-cycle button lacks — jumping directly from
    (e.g.) 2nm to 50nm in one action instead of stepping through every
    intermediate value. Worth capturing, but via a tap-based interaction
    (e.g. tap-and-hold fans out all 5 values as flat, directly-tappable
    targets) rather than a literal rotate gesture — same "direct access"
    benefit, none of the drag-gesture safety downside. Not yet built;
    revisit alongside the rest of the range-selector design before V1.

- **Script-load fragility — no error handling on 25+ synchronous
  `<script>` tags.** Seen at least twice now (see "Recurring: blank
  screen / zero interactivity on load" below for the full symptom/root-
  cause writeup): if any one of `index.html`'s script requests hiccups
  (plausible right after a fresh deploy, while GitHub Pages' CDN is still
  propagating), the whole app silently dies — blank map, every button
  dead, no error shown to the user, only a reload fixes it. **Fixed for
  Beta (2026-08-23), both halves:** the crash/error reporter (see "Beta
  test milestone" below) records exactly this failure, including the
  specific script that failed to load; the same fix also now shows the
  tester a visible "VCAS didn't load correctly — Reload" prompt in the
  moment, instead of leaving them staring at a silently-dead screen with
  no explanation. The only thing still not done from the original
  framing here is bundling into fewer requests — not attempted, and
  probably unnecessary now that both symptom and detection are covered.

## Beta test milestone (2026-08-23)

Declared as its own interim goal, distinct from the Pre-V1 checklist
above: "something that looks good and mostly works... isn't polished,
it's essentially just collecting data on usability." Handed to a small
number of people the project owner knows personally, not a public
release — meaning the bar is lower than V1 on polish, but two things
from the Pre-V1 checklist above are still genuinely blocking rather than
deferrable the moment anyone else is using it:

- **adsb.fi attribution** — done, see the Pre-V1 checklist entry above
  and the follow-up write-up immediately below.
- **Script-load fragility** — see the checklist entry above. Both the
  data-collection and the visible reload-prompt halves are now done.

Everything else on the Pre-V1 checklist (RAW controls redesign, etc.)
stays correctly deferred — explicitly not a Beta blocker. Both Beta
blockers are now resolved.

### Follow-up: adsb.fi attribution placement (2026-08-23)

Direct question before implementing: "how do you think this can be
achieved? if it's included as part of the launch screen?" — worth
recording that a launch/splash screen was the project owner's own first
instinct and was talked out of, not silently overridden, since a future
session shouldn't reintroduce it as an obviously-better idea nobody
considered. Reasoning given and agreed: adsb.fi's requirement reads as
an ONGOING "cite them wherever their data is used" obligation, not a
one-time acknowledgment — a splash screen shown once at cold start and
dismissed is arguably LESS durable than even the old buried Settings
mention, since at least that stayed reachable for the whole session. It
would also have introduced a UI pattern VCAS has nowhere else — no other
screen in this app gates the map behind a modal.

Landed on a small `#adsb-credit` line stacked directly under the
`#adsb-status` pill in the top bar (`index.html`, `src/styles/VCAS.css`)
— see the Pre-V1 checklist entry above for the implementation detail.
Chosen specifically because that's the one spot in the chrome already
semantically about "where this live data is coming from," and it's
visible for the app's entire open duration, not gated behind a tap or a
one-time screen. Verified with a real Playwright render at a deliberately
narrow 360px viewport (worst case for crowding) in both Day and Night —
no overflow/wrapping, legible in both themes, the "adsb.fi" text a real
tappable link to their homepage.

A third thing surfaced and fixed the same day, not from the checklist but
from directly asking "does sharing this with multiple people affect fair
use / rate limits anywhere?" — the adsb.fi relay had no protection against
multiple concurrent testers' polling aggregating past adsb.fi's own 1
req/s limit. See "ADS-B data source" below, "Follow-up: server-side
throttling for Beta," for the full fix and verification.

### Follow-up: real launch/splash screen added as a hero placement, ADDITIVE not a replacement (2026-08-23, later the same day)

Direct instruction, once the PWABuilder icon-mismatch incident (see "How
VCAS is actually installed on tester devices" below) had the project
owner looking at what the launch screen actually shows: make the logo
bigger, and add "what VCAS actually stands for" plus credit lines for
adsb.fi and the other open-source tools the app depends on.

**This is not a reversal of the "talked out of a splash screen" decision
two entries above — it's the missing other half of it, made explicit
before implementing rather than assumed.** That earlier decision was
specifically about whether the adsb.fi *citation* should live on a
one-time splash INSTEAD OF the top bar, and concluded no, because the
citation is an ongoing obligation a dismissed-once screen can't satisfy.
Asked directly this session whether adding a splash now reopens that
question: confirmed no — the top-bar `#adsb-credit` line stays exactly as
it is, unchanged, for exactly the reason already on record. The new
splash content is a one-time *hero* moment layered on top of that ongoing
mention, not a substitute for it, so both now legitimately exist for
different reasons rather than one silently overriding the other.

**Implementation** — VCAS previously had no custom splash at all: Android
auto-generates one from the manifest's icon/name/background_color with no
control over subtitle or credit text, and iOS has no manifest-driven
splash mechanism at all (see the still-open, not-yet-built iOS
`apple-touch-startup-image` gap noted earlier the same investigation
thread). A real in-page `#launch-screen` overlay (`index.html`) is what
actually renders the requested content: `icon-512.png` at up to 220px
(`42vw`, up from whatever small size the OS auto-splash was choosing),
the tagline "Visual Contact Awareness System" (VCAS's real expansion —
confirmed directly with the project owner, since nothing in the codebase
spelled it out anywhere before this), and a bottom credit line, "Proudly
powered by adsb.fi, MapLibre and MapTiler" — the project owner's own
exact wording — with each of the three names linking to its real
homepage. A standalone "VCAS" text line was drafted between the logo and
the tagline in the first version, then removed the same day at the
project owner's correction: the name is already legible in the logo
itself (the lime-green "VCAS" wordmark integrated into the artwork, see
the icon-redesign history above), so a second, separate text repeat of it
was redundant rather than reinforcing.

Present in the raw HTML (not injected by JS) so it's on screen the
instant the document parses, same reasoning as the inline crash reporter
a few lines above it in `<head>`: pure inline styles, nothing external to
fail, nothing to wait on. Dismissed by `app.js`'s `init()` — a short
opacity fade, then `.remove()` — gated on the exact same
`window._vcasAppReady` signal the reload-prompt watchdog already reads
(see the two sections above), not a fixed timer, so it can't outlast a
slow load or disappear before a fast one is actually real. Deliberately
placed at `z-index: 2147483000`, one below the crash banner's
`2147483647` (see above) rather than some unrelated arbitrary value — if
`init()` never finishes, the "VCAS didn't load correctly" banner still
needs to render on top of the splash, not be trapped underneath it.

Verified with a real Playwright/Chromium render at both a normal portrait
phone size (412×915) and the deliberately narrow 360px width this project
always checks crowding against: no horizontal overflow at either size, the
credit line's three links all render legibly on one wrapped line width.
Also verified against the real, unmodified `index.html`/`app.js` (not just
the extracted markup) via a local static server: on a normal fast load the
splash is present at `opacity:1` immediately and the SAME dismissal code
`init()` runs (bit-for-bit copied into a scripted `evaluate()` call) was
confirmed to fade it to `opacity:0` and remove it once `_vcasAppReady` is
set; separately, forcing a real script-load failure confirmed the crash
banner renders on top of a still-present splash rather than the two
fighting over the same layer, exactly as the z-index ordering intends.

**Known test-harness artifact, not a real bug, worth recording so it
isn't re-chased later**: artificially slowing the MapLibre CDN/Google
Fonts requests (via `page.route`) to get a clean "still showing"
screenshot before dismissal caused the crash reporter's watchdog to fire
in a couple of early attempts, even at delays well under the real 8s
window — this reproduced regardless of delay length in a way that pointed
at the route-delay mechanism itself interacting badly with Chromium's
script-loading, not at a real problem with the splash or the app. Same
category of finding as the relay throttle's own PHP-dev-server-worker-pool
artifact documented under "ADS-B data source" below — switched to a
standalone harness reproducing the launch-screen markup verbatim instead
of fighting the real page's load timing, which is also the approach
already established for the crash-reporter/reload-banner tests just above.

### Crash/error reporter (2026-08-23)

Built specifically for this milestone: "I would just need a record of
the stuff they can't see or can't describe, as well as the spotability
log" — testers are non-technical friends, not developers; they can tell
the project owner directly what they don't like, but a silent crash with
no error message is something they have no way to describe at all. The
existing LOG panel/central endpoint (see "Central observation log"
above) already covers the spottability side; this covers the other half.

Lives entirely as an inline `<script>` block, the literal first thing in
`index.html`'s `<head>` — deliberately NOT `src/dev/*.js` like everything
else in that folder. Two reasons, both hard requirements, not style
preference:
1. It has to register its `window` error listeners before ANY of the
   25+ script tags below it get a chance to fail — including the exact
   documented "blank screen" bug, where an early script fails to load
   and a LATER one throws a `ReferenceError` using its missing globals.
   A `<script src="...">` for this reporter itself could be the thing
   that fails to load, defeating the entire point — inline HTML has no
   separate network request to fail.
2. `LOG_ENDPOINT`/`LOG_ENDPOINT_KEY` are duplicated here from
   `config.js` rather than read from it, for the same reason — `config.js`
   may not have loaded yet when the exact failure this exists to catch
   happens. **Keep these two values in sync with `config.js` by hand** if
   either ever changes (rotating the shared secret, moving the endpoint) —
   there's no single source of truth here by design, and that's a real
   maintenance cost worth remembering, not an oversight.

**Catches two distinct failure modes, not just one**, found by working
through what `window`'s error events actually carry:
- A **resource load failure** (a `<script>`/`<link>` that never
  downloaded at all — the actual ROOT CAUSE of the blank-screen bug) —
  fires a plain, non-bubbling `Event` on the failing element itself, not
  on `window`. Only visible at all via a **capture-phase** listener
  (`addEventListener("error", fn, true)`) on an ancestor — a bubble-phase
  listener (the default) never sees it. Reports the failing script/
  stylesheet's own URL.
- A **runtime error** (including the documented DOWNSTREAM
  `ReferenceError` symptom, and any other uncaught exception) — a real
  `ErrorEvent` dispatched directly on `window`, message/filename/line/
  stack all included. Distinguished from the resource-failure case by
  checking `event.target === window`.
- Also listens for `unhandledrejection` (uncaught promise rejections) —
  a separate event type, not covered by the `error` listener at all.

**Guards against the reporter itself becoming a new source of
instability**, not just assumed safe:
- **De-duped and capped** (`MAX_REPORTS = 20` per page load, keyed by
  `message@source:line`) — something throwing in a tight loop (every
  animation frame, say) can't flood the endpoint or a tester's mobile
  data with hundreds of copies of the same crash.
- **Cannot self-trigger a report loop.** The reporting `fetch()` call's
  own promise is `.catch()`-handled — if left unhandled, a *failed
  report* (endpoint down, network error) would itself fire the
  reporter's own `unhandledrejection` listener, which would try to
  report the failure to report, forever. `keepalive: true` lets the
  request survive if the tab closes right as it fires; a synchronous
  throw from `fetch()` itself (e.g. a strict CSP) is also caught, for
  the same reason.
- Payloads get a `"kind": "error"` field — spottability observations
  (see "Central observation log") have no such field, so both land in
  the same log/GitHub mirror without needing a second endpoint, fully
  distinguishable when reading it back.

Verified with a real Playwright/Chromium harness reproducing the actual
inline script (extracted verbatim from `index.html`, not retyped) against
a mocked log endpoint (`page.route`), not reasoned through: a genuine
runtime error is caught and reported; the SAME error thrown twice is
reported only once (dedup); an unhandled promise rejection is caught
separately; a real failing `<script src>` is caught via the capture-phase
listener and correctly labelled `resource-load-error` with its own URL;
30 rapid-fire distinct errors hit the 20-report cap exactly, not more;
and — the specific self-trigger risk — pointing the mocked endpoint at a
hard network failure for two full seconds produced exactly one outbound
request, never a runaway retry loop.

### Follow-up: visible reload prompt (2026-08-23, same day)

The crash reporter above only RECORDS a failure — a tester staring at a
dead blank screen still had no idea anything was being captured, or that
reloading would help. Built the other half the same session: a visible
"VCAS didn't load correctly — Reload" overlay, shown at the moment the
app is actually broken rather than left to guesswork.

**Two independent triggers, not one**, since no single signal reliably
covers every way `init()` (app.js) can fail to finish:
- **Immediate**, the instant a `<script>` (not `<link>`) fails to load —
  the same capture-phase listener the reporter already has. Deliberately
  scoped to scripts only: a failed stylesheet degrades the LOOK of the
  app (unstyled chrome) but doesn't break its FUNCTION the way a missing
  script's globals do, so it isn't the same "you need to reload right
  now" signal and doesn't interrupt the tester for it.
- **Watchdog fallback**, 8 seconds after page load, checking a new
  `window._vcasAppReady` flag — set as the LITERAL LAST LINE of `init()`
  (app.js), specifically so that if anything earlier in that function
  throws (a missing global used somewhere inside `init()` itself, not
  just at a bare script's top level — the documented bug's actual
  mechanism), the flag correctly never gets set even though app.js
  itself loaded and ran fine up to that point. Covers failures the
  immediate trigger can't see — nothing 404s, nothing throws
  uncaught, `init()` just never reaches its own last line. Also reports
  a `"watchdog-timeout"` entry to the same log so this failure mode is
  distinguishable from the other three when reviewing it later.

**Pure inline styles, zero dependency on VCAS.css classes** — that
stylesheet could itself be one of the things that failed to load, and
this has to render legibly regardless of what else broke. Two buttons:
**Reload** (`location.reload()`) and a smaller, deliberately
less-prominent **Dismiss** (removes the overlay, no reload) — a
courtesy for the rare false-positive rather than trapping the tester
if it's wrong.

**Self-heals** — after showing (from either trigger), a 500ms poll
checks `window._vcasAppReady` and auto-removes the overlay the moment
it becomes true, so an unusually slow-but-ultimately-successful load
(the watchdog fired a little too eagerly on a bad connection, say)
doesn't leave a stale false-alarm banner sitting over an app that
actually came up fine moments later.

Verified with the same Playwright-harness-against-the-real-inline-script
approach, using `page.clock` to fast-forward the 8s watchdog rather than
actually waiting real time in every test run: a normal successful init
(`_vcasAppReady` set immediately) shows no banner even past the watchdog
window (no false positive); a failing `<script>` shows the banner
immediately; a failing `<link>` correctly shows no banner; a page that
never sets `_vcasAppReady` gets both the watchdog's report AND the
banner at exactly the 8s mark; the self-heal poll correctly removes an
already-shown banner once `_vcasAppReady` becomes true; Dismiss removes
the banner without navigating; Reload actually triggers a real page
navigation. All seven checked against the true DOM/event behavior, not
assumed from reading the code.

## How VCAS is actually installed on tester devices — via PWABuilder, not plain "Add to Home Screen"

**Not previously written down anywhere, and it should have been** — this
came up only because a stale-icon report couldn't otherwise be explained.
VCAS isn't just installed by testers tapping Chrome's "Add to Home
Screen"; the project owner has been using [PWABuilder](https://pwabuilder.com)
to generate an actual installable package from the live site
(`https://vectair.github.io/VCAS/` — confirmed this is the real deployed
URL, see the incident below), then installing that package.

**This matters because a PWABuilder-generated package behaves completely
differently from a browser-native "Add to Home Screen" install.** A
Chrome WebAPK at least periodically re-checks the source site's manifest
in the background (slowly/inconsistently, but it happens). A
PWABuilder-generated package is a **permanent, frozen snapshot** of the
manifest/icons/etc. as they existed at the moment the package was built —
it has no live connection back to the site at all, and will never
self-update no matter how long it's installed or how often it's opened.
**The only way to pick up a manifest/icon/etc. change on a
PWABuilder-installed copy is to rebuild the package and reinstall it** —
this is not optional or a "should eventually" the way a WebAPK's slow
background refresh is.

### Incident: stale placeholder icon on tester's phone (2026-08-23)

Reported directly: "what is the actual app logo and launch screen? right
now I still have the generic blue diamond" — with screenshots showing a
plain solid blue diamond as both the launch screen and app-drawer icon,
on an installed copy of the app. This looked at first like it could be
either a code bug or a live-server problem; it was neither.

**Root cause, found via git history + the PWABuilder job's own log
timestamp** (the project owner shared a PWABuilder screenshot showing the
package build log after being asked to check a diagnostic URL, which
didn't resolve on the first attempt — see the URL-structure finding
below for why): the tester's installed package was built
**2026-08-11T10:09:46Z**. The commit that replaced the placeholder solid
diamond with the real detailed logo (blue diamond outline forming a "V"
into a lime-green "VCAS" wordmark, car silhouette, dashed relevance arcs,
red/amber traffic dots — `041f2ed`, "Update app icons to the new
TCAS-radar/car logo variant") landed **2026-08-11 20:47:30Z**, the same
day but roughly 10.5 hours *later*. The installed package is doing
exactly what a frozen snapshot should do: showing the site exactly as it
was that morning, before the real logo existed. Confirmed the live site
itself is NOT still wrong: `041f2ed` is a git ancestor of the current
deployed HEAD, the icon files are tracked and present, and the branch
that auto-deploys via `.github/workflows/deploy-pages.yml` (triggers on
push, no CNAME/custom domain — plain GitHub Pages project-site hosting)
is fully pushed and in sync — checked via `git merge-base --is-ancestor`
and `git status`, not fetched directly, since `vectair.github.io` is one
of this sandbox's blocked egress domains (see "Sandbox environment
notes" below; confirmed again this session via a 403 from the sandbox's
own proxy, not from GitHub).

**Also resolved along the way: the correct live URL has a `/VCAS/`
subpath, not the bare root domain.** An early diagnostic attempt to have
the project owner check `https://vectair.github.io/assets/icons/icon-512.png`
directly 404'd. The PWABuilder job log line — "Generating app package for
https://vectair.github.io/VCAS/" — settled this: VCAS is a GitHub Pages
*project* site (served under `/<repo-name>/`), not a `<org>.github.io`
root-repo site (which would serve at the bare domain) — the org here is
`vectair`/`Vectair`, the repo is `VCAS`, and only a repo literally named
`vectair.github.io` would get the bare-root behavior. The correct direct
icon URL is `https://vectair.github.io/VCAS/assets/icons/icon-512.png`.

**Fix**: rebuild the package via PWABuilder pointed at the same URL
(`https://vectair.github.io/VCAS/`) and reinstall — no code change
needed, the live site already has the correct icon. Generated a real
mockup screenshot (Playwright, embedding the actual repo `icon-512.png`/
`icon-512-maskable.png` files, not a description) showing what the splash
screen and app-drawer icon should look like once reinstalled, so the
project owner has something to compare the rebuilt package against.

**Lesson, same category as the native-app-destination and
50nm-contrail-cap incidents earlier in this file**: the install method
itself — a fact just as durable as any design decision — went unrecorded
long enough that a symptom it fully explained looked like a mystery bug
for a while. If it's worth remembering that a repeated decision was made,
it's equally worth remembering *how the thing actually gets onto a
device*, since that's exactly the kind of fact a fresh session has no way
to reconstruct from the code alone.

## Architecture map

- `src/app.js` — orchestration/glue: GPS watch, mode state (nav/air,
  hybrid/raw), settings screen wiring, the fetch/refresh loop.
- `src/map.js` (`EosMap`) — MapLibre instance owner. Route line, range rings,
  user marker, air markers all live here as real map layers now (not screen
  overlays — see "Range rings" below).
- `src/map/cameraController.js` (`CameraController`) — owns the anchor-
  preserving camera animation (frame-driven `jumpTo()`+`panBy()`, not
  MapLibre's own `easeTo`/`flyTo`). See "Camera anchor math" below before
  touching this.
- `src/navigation/navigationCameraEvaluator.js` — pure state machine, no DOM,
  computes pitch/zoom/anchorY per driving state (idle/urban/highway/turn/
  raw/air).
- `src/logic/visibility.js` — sightability scoring (angular size, METAR
  cloud/visibility adjustment). `colorRaw` fields are pixel-sampled from a
  real ND reference photo, not approximated — see "RAW mode fidelity" below.
- `src/logic/indicators.js` / `src/logic/relevance.js` — what's shown and
  where (polar/edge projection), independent of the range rings' own
  now-separate real-geo positioning.
- `src/logic/aircraftExtrapolation.js` — dead-reckons aircraft lat/lon
  between actual ADS-B polls using each aircraft's own reported speed/track
  (Geo.destinationPoint), capped at STALE_THRESHOLD_SECONDS. Driven by a
  separate 500ms render-tick timer in app.js (`_extrapolationRenderTick`,
  decoupled from CONFIG.REFRESH_INTERVAL_SECONDS's actual fetch cadence) —
  `_currentAircraftList()` is what NAV indicators and AIR markers read,
  never the raw last-fetched `aircraftList` directly. Added 2026-08-20 so a
  fast/close aircraft glides between the 3s polls instead of visibly
  teleporting; a distant one barely moves either way, which was the whole
  motivation (no benefit to polling a 50nm-away aircraft any more often,
  every benefit to smoothing a 1nm-away one). This is *why*
  `EosMap.renderAirMarkers` diffs markers by hex (reuses/`setLngLat()`s
  existing `maplibregl.Marker` DOM elements) instead of tearing all of them
  down every call, the way it used to — at a 3s cadence full rebuild was
  fine; at 500ms it'd have meant constant marker/click-listener churn.
- `src/data/adsbExchangeClient.js` — ADS-B provider adapter, round-robined.
  See "ADS-B data source" below — this is the most volatile part of the
  app right now.
- `src/ui.js` — indicator DOM rendering, compass tape, popups.
  `renderIndicators`/`renderSuppressedDots` diff by hex and reuse existing
  DOM elements (2026-08-22, see "Power efficiency pass" below) rather than
  tearing the `#indicators-layer` container down every call — same reason
  and same pattern as `EosMap.renderAirMarkers`.

## ADS-B data source — SETTLED, read before touching

**⛔ Airplanes.live is PERMANENTLY EXCLUDED from this project — do not use,
re-integrate, link to, or reference them under any circumstances, even if
their free tier is ever reinstated.** This is an explicit, direct
project-owner directive: VCAS is boycotting them as an organization, not
just avoiding a withdrawn API. All of their code and material was
deliberately removed from the codebase (2026-08-14) — don't restore any of
it, don't add a provider entry for them, don't cite them even for technical
comparison. If they come up in a future request, flag the boycott rather
than acting on it.

**Current:** `CONFIG.DATA_PROVIDERS = ["adsb_fi"]` — free
[adsb.fi](https://adsb.fi) open-data API, no key. `DATA_PROVIDERS` stays a
list — `adsbExchangeClient.js` round-robins across whatever's in it with
same-tick fallback if one errors — so adding a second provider back (e.g.
`adsb_lol`) is just adding another id, no code change needed, but don't add
one unprompted; single-provider is the deliberate current choice, not an
oversight.

**✅ DEPLOYED (2026-08-20): adsb.fi CORS relay.** adsb.fi's API doesn't
send a CORS header, so a browser's own `fetch()` can't read the response
even though the request itself succeeds — confirmed via a real device
test (the exact same URL works fine typed directly into a phone browser;
only VCAS's in-page `fetch()` fails with a generic "network" error) and
independently corroborated by a Windy.com plugin-dev thread hitting the
identical wall. This is not a VCAS bug and not (as far as thorough
doc/issue searching found) a deliberate anti-abuse measure — just an API
that was never given CORS headers. Fix: a small server-side PHP relay
that fetches from adsb.fi server-to-server (no browser restriction
applies there) and re-serves the result with the
`Access-Control-Allow-Origin` header VCAS's browser needs. Built and
fully tested locally (`php -l` + a live `php -S` server exercising auth
success/failure, input validation, CORS preflight, and the
upstream-error path), then handed to the project owner as a deploy
package (`relay.php` + `DEPLOY_INSTRUCTIONS.md`) via `SendUserFile` — the
random shared secret was generated on this side (owner was on a phone)
and baked directly into `relay.php` before handoff rather than asking
them to pick one. Owner deployed it to their existing Bluehost hosting at
`https://vectair.org/adsb-relay/relay.php` (not committed to this repo —
same handoff-file pattern as the now-deployed central log above; ask
whether the owner still has the deploy files if this ever needs touching
again — this session found them still sitting in scratchpad from the
original build, saving a full re-derivation). `src/config.js` now has
`ADSB_RELAY_URL`/`ADSB_RELAY_KEY` filled in with that URL and the
matching secret, and `adsbExchangeClient.js`'s `adsb_fi` provider routes
through it automatically (falls back to calling adsb.fi directly — which
still works outside a browser, e.g. curl/Node, but not in the deployed
app — only if those config values are ever blanked out).

### Follow-up: server-side throttling for Beta (2026-08-23)

Prompted by a direct question — "does multiple people using the app in
multiple locations affect the call rate log etc?" — asked before handing
VCAS to Beta testers, not something that had been considered yet. Read
through the actual deployed `relay.php` to answer it precisely rather
than guessing: it was (and still needed to be) a pure 1:1 pass-through,
no caching, no rate-limiting of its own. Every VCAS client polls
independently every `CONFIG.REFRESH_INTERVAL_SECONDS` (3s), and — the
actual finding — **every tester, wherever they physically are, funnels
through this ONE relay on ONE server IP.** adsb.fi's own documented limit
is 1 request/second; one user alone stays comfortably under that, but a
few concurrent testers with independent, unsynchronized 3s timers can
realistically push the *aggregate* rate the relay presents to adsb.fi
past 1 req/s — arithmetic, not a hypothetical, the moment more than one
person is using the app at once. (Also assessed and flagged as lower-risk
in the same pass: OpenRouteService, shared API key but no polling loop,
only per-user-action calls; MapTiler, a monthly tile quota rather than a
per-second one, so a concurrent-tester risk of exhausting it early rather
than of an instant violation.)

Fixed with two mechanisms in `relay.php`, doing different jobs:
1. **A global rate gate** (`reserve_upstream_slot()`) — the actual hard
   guarantee, never lets the relay call adsb.fi more than once per
   `MIN_UPSTREAM_INTERVAL_S` (1.05s — deliberate headroom over the raw
   1.0s limit, not pacing exactly on the line where clock jitter between
   servers could tip a borderline request over anyway), regardless of how
   many different locations are asking or how many PHP processes are
   handling them concurrently. Ordinary PHP hosting runs each request in
   its own process with no shared memory to lean on, so this is a
   file-locked (`flock()`) timestamp file, not an in-process counter — the
   lock is used only to atomically RESERVE the next slot (read, compute,
   write, release) before sleeping out the wait, not held for the whole
   sleep, so it doesn't itself become a bottleneck.
2. **A short-lived (`CACHE_TTL_S` = 3s) per-location response cache** — a
   pure optimization on top of #1, not what provides the safety guarantee
   (#1 alone already holds regardless of cache hit rate, e.g. every
   tester in a different city). Cache key is lat/lon rounded to ~1.1km and
   dist rounded to the nearest 25nm — coarse on purpose, testers a short
   distance apart land on the same entry without trying to be clever about
   exact overlap.

**A bounded give-up path** (`MAX_WAIT_S` = 6s): if honoring the throttle
would mean holding a request open longer than that, it stops waiting and
either serves a stale cache entry for that exact location (if one exists)
or returns a `429` — a fast, honest "try again shortly" beats a hung
connection once the queue backs up further than a handful of concurrent,
genuinely different locations would ever produce for "a very small number
of people." `adsbExchangeClient.js`'s existing `!response.ok` handling
already treats any non-200 status generically (empty aircraft list for
that poll, retried next 3s tick) — confirmed by reading it, not assumed —
so this needed zero app-side changes to degrade gracefully.

**Known, accepted simplification, not silently swept under the rug:** the
cache does NOT prevent a one-time "cold simultaneous burst to a
brand-new location" — if several requests for the exact same never-before-
cached area arrive at truly the same instant, each independently sees a
cache miss and each queues its own (still safely throttled, still
correctly-answered) upstream call, rather than only the first one calling
and the rest waiting on its result. A per-key lock would close this, but
given the actual scale here (a few known testers, and the gap self-heals
the moment any one of them succeeds and populates the cache within the 3s
TTL), that complexity wasn't judged worth adding.

Verified with real concurrent load against a mocked upstream (a tiny PHP
router logging each call's timestamp+params, standing in for adsb.fi),
not reasoned through — and needed two passes to get a clean signal, worth
noting as its own lesson: the first attempt used PHP's built-in dev
server with a small worker pool (8), which turned out to itself queue
some of the concurrent test requests *before* they ever reached the
throttle logic, masking the exact behavior being tested (the `MAX_WAIT_S`
give-up path never fired, even for bursts that should have exceeded it).
Recognized as a test-harness artifact — not present on real PHP-FPM/
mod_php hosting, which hands out far more concurrent handlers — and fixed
by raising the local worker count, after which the intended behavior was
clean: 6 concurrent requests to the same location all correctly served
(and confirmed via the mock's own call log that only that batch's cache
misses reached upstream); 5 concurrent requests to 5 distinct locations
each got back their own correct data, never another's, with upstream
calls spaced ≥1.05s apart exactly; a 12-request burst against distinct
locations — deliberately far beyond any realistic Beta load — served 11
of them correctly (serialized, ≥1.05s apart, up to ~10.5s for the last)
and gave up cleanly with a `429` in ~25ms for the one request that would
have needed to wait past `MAX_WAIT_S`, rather than hanging.

Shipped as an update, not committed to this repo (same as the relay
itself) — `relay.php` (overwrite the live one), a new `cache/` subfolder
with its own `.htaccess` (same reasoning as `logs/.htaccess`: blocks
direct web access to the rate-limiter's timestamp file and cached
responses), and `UPDATE_INSTRUCTIONS.md`, handed to the project owner via
`SendUserFile`. No `config.js` changes needed — same URL, same secret,
request/response shape unchanged from the app's point of view.

Also worth remembering for whenever the native-app transition (see top of
this file) actually happens: a real native app's HTTP requests aren't
subject to browser CORS restrictions at all, so this whole relay becomes
unnecessary at that point — it's a workaround for the PWA's browser
context specifically, not a permanent architectural requirement.

History, so it isn't rediscovered the hard way:
- Original default was Airplanes.live's free anonymous REST API. It was
  withdrawn in Aug 2026 — confirmed via a direct reply from their team (not
  a guess): they cited AI-agent/bot traffic driving hosting costs
  unsustainable ("Due to bot abuse and Claude code..."), and are asking
  free-tier users to sponsor ($25–50/mo) or run a feeder. The project owner
  decided this warranted a full boycott, not just switching providers — see
  the directive above.
- Briefly round-robined `adsb_fi` + `adsb_lol` together as a stopgap while
  the replacement decision was still open, specifically to avoid
  concentrating the app's whole polling volume on one volunteer-funded
  service again. Once the project owner settled on adsb.fi alone, that
  hedge was dropped — it served its purpose for the interim, not meant to
  be permanent multi-provider architecture.
- **Why not ADSB.lol too:** their own docs reportedly mention a future
  feeder-gated API key requirement, meaning free/anonymous access may not
  last. This claim came from a `WebSearch` tool summary, not a page read
  directly — `api.adsb.lol`/`www.adsb.lol` were both blocked by this
  sandbox's network egress policy when tried via `WebFetch`. Flagged to the
  project owner as plausible-but-unverified; contributed to going with
  adsb.fi alone rather than as a reason to distrust adsb.fi itself.
  Unlike Airplanes.live, ADSB.lol isn't boycotted — its provider code is
  still wired up in `adsbExchangeClient.js` (unused) in case it becomes
  relevant again.
- adsb.fi's usage terms require attribution (a link to their homepage) —
  honored in Settings > Data & Logging (`index.html`, `.settings-credit`).
- `adsb_fi`/`adsb_lol` were both verified to be ADS-B Exchange v2-schema
  compatible (`.ac` array, nautical miles, 250nm max) against their actual
  GitHub docs before shipping — not assumed just because they're in the same
  hobbyist ecosystem.

## Central observation log — DEPLOYED (2026-08-23)

`src/dev/observationLogger.js` posts to a real internet endpoint now, so
phone/PC/whatever all log to the same place automatically instead of each
device only having its own local `logServer.py`/localStorage fallback
(still the fallback when `CONFIG.LOG_ENDPOINT` is blank, e.g. local dev).

The design: a Bluehost-hosted PHP endpoint (`log.php`, not committed to
this repo — handed to the project owner directly, same handoff pattern as
the ADSB relay) that durably appends every observation to a local
`logs/observations.jsonl` file on the server, AND best-effort-mirrors each
one as its own small JSON file into a private GitHub repo
(`github.com/Vectair/vcas-logs`, `observations/<timestamp>-<random>.json`
each) so it's readable directly via GitHub tools with no export/upload
step. The GitHub token lives only in `log.php` server-side, never sent to
the browser — unlike `LOG_ENDPOINT_KEY` below, which does ship in the
deployed app's own JS (see its own comment for why that's fine here).

Deploy history, for when this needs touching again: private repo created
(`Vectair/vcas-logs`) → this session's `add_repo` used to gain read
access to it → a fine-grained GitHub PAT generated (Contents: Read and
write, scoped to just that repo, no expiration — a SHORT expiration was
the default and would have silently broken mirroring once it lapsed,
caught and corrected during setup) → `log.php` uploaded to
`public_html/vcas-log/` on Bluehost, `logs/.htaccess` into a `logs/`
subfolder alongside it (blocks direct web access to the raw
`.jsonl` file — a real gotcha hit during this deploy: cPanel's own
upload silently stripped the leading dot, uploading it as a
non-functional file literally named `htaccess`; caught by checking the
File Manager listing, not assumed to have worked). Verified live via a
plain browser GET to the deployed URL returning
`{"ok":false,"error":"unauthorized"}` — the correct response, confirming
PHP is executing and the shared-secret check is rejecting an unkeyed
request rather than erroring or 404ing.

`CONFIG.LOG_ENDPOINT`/`LOG_ENDPOINT_KEY` now point at the real deployed
URL and shared secret (`src/config.js`) — `observationLogger.js` already
read both and sent the key as the `X-VCAS-Key` header `log.php` expects,
so no code changes were needed on the app side, only filling in config.
If this needs touching again (token rotation, a new endpoint path, etc.)
the deploy files above are still what to hand back to the project owner —
don't redesign from scratch.

## Camera anchor math — read before touching cameraController.js

`_renderAnchoredFrame()` does `jumpTo()` then `panBy()` to place the user's
*true* GPS position at a specific screen fraction (`anchorY`), not MapLibre's
own centering. Two non-obvious facts, both proven against a real MapLibre.js
instance this session (not assumed):

1. `jumpTo({center})` does **not** center on the container's raw geometric
   middle when `map.setPadding()` is active (used to clear top/bottom UI
   chrome) — it centers on the *padded* center instead. The offset math has
   to derive the pan from the actual padded-center MapLibre produces, not
   assume it's the raw center, or anchorY drifts by however much padding is
   set (this was a real, shipped bug — see git history "second anchor/ring
   offset" commit).
2. The frame-driven animation loop (`jumpTo()` called every rendered frame
   for ~400ms after each GPS/heading tick) is invisible to MapLibre's own
   gesture-interrupts-animation behavior — unlike `easeTo`/`flyTo`, it never
   yields to a user drag on its own. `CameraController.cancelFollow()` must
   be called the instant a real user gesture starts (wired in `map.js`'s
   dragstart/zoomstart/rotatestart/pitchstart handlers) or manual panning
   gets fought and effectively does nothing.

**The `anchorY * containerHeight` invariant has more than one consumer — keep
them in sync.** NAV mode's aircraft indicators (`Geo.projectToPolarPosition`
in geo.js, called from `indicators.js`) plot around their own `cy = viewportHeight
* anchorY`, entirely separate code from `_renderAnchoredFrame()` above. Found
and fixed 2026-08-20: `app.js`'s `refreshIndicators()` used to hand
`projectToPolarPosition` a shrunk `viewportHeight` (real height minus the
bottom bar's height minus a flat 45px, meant as a "keep dots off the bottom
chrome" margin) instead of the real full container height the camera
actually anchors against — silently dragging every indicator's origin
upward relative to where the user marker and range rings (which ARE
anchored correctly) really render. On top of that, `userState.anchorY` was
being computed correctly from `CameraController.getLastEvaluated()` but
never actually read by `indicators.js` — masked for RAW specifically only
because RAW's real anchorY (0.80) happens to equal `projectToPolarPosition`'s
own hardcoded default. Fixed by passing the real, un-shrunk viewportHeight
and the real evaluated anchorY through, and moving the "keep dots off the
bottom chrome" concern to the `safeInset` parameter `maxRadiusForBearing`
already had for exactly this, instead of corrupting the anchor's own math.
**The lesson:** any new code that needs to know "where does the user's real
position render on screen" must derive it from the same full-container-
height + real-evaluated-anchorY inputs `_renderAnchoredFrame()` uses, not
recompute its own shrunk/approximated version — the two WILL drift apart
silently, exactly like this did, and it won't be obvious until someone
compares the two on a real screen (in this case: aircraft dots not lining
up with the range rings, reported directly by the project owner testing
the deployed RAW screen).

Same session, same investigation: `Geo.projectToPolarPosition`'s banded
(non-linear, ring-band-based) distance scale for the indicator's radius
was computing `min(bandedFraction * deadAheadRadius, edgeRadius)` — meant
as an off-screen-clipping safety clamp, but at bearings off dead-ahead
this silently substituted `edgeRadius` (which has nothing to do with which
band the aircraft is in) whenever the intended radius exceeded it, so two
aircraft in very different bands could render at nearly the same radius —
confirmed via a Node simulation on a realistic narrow-phone viewport
(bearings ≥60° collapsed a 1.5nm and an 11nm aircraft to within 1px of
each other). Fixed by scaling the banded fraction directly against each
bearing's own `edgeRadius` (`bandedFraction * edgeRadius`) instead of
computing it against dead-ahead and clamping after the fact — keeps the
banded proportion intact at every bearing while still never running
off-screen. Both fixes verified with Node simulations (not just reasoned
through) before shipping — see git history around this date.

Same investigation, a third and independent bug: `EosMap.updateRangeRings`'s
ring **labels** ("2"/"5"/"10"/"15") were placed at true geographic north
(`Geo.destinationPoint(lat, lon, 0, nm*NM_TO_M)`) unconditionally. That's
correct for AIR (always north-up — map bearing is always 0, so true north
always lands at the top of the screen) but wrong for RAW, which is
heading-up: the map itself rotates to the user's current heading, so a
label fixed at true north drifts to whatever screen angle "north" currently
happens to be. Confirmed via a real MapLibre simulation at a 30° heading:
the 5/10/15nm labels all projected 260–500px off the *side* of the screen
(only the small-radius 2nm label happened to stay on-screen) — meaning RAW
mode's ring labels were essentially invisible except when facing very close
to due north, which is exactly why the user reported being unable to tell
which ring was which. Fixed by adding a `labelBearingDeg` parameter
(defaults to 0/true-north, preserving AIR's already-correct behaviour) that
RAW passes `userHeading` for, placing each label along dead-ahead — always
"up" on a heading-up display, matching how a real heading-up ND places
range labels — instead of true north. Re-verified with the same simulation
approach: at the same 30° heading, the 2/5/10nm labels (whichever actually
fit within the frame at all — see the anchor-alignment note above, the
15nm ring's own true geo radius already doesn't fit on a phone screen at
RAW's zoom) now all project correctly along the dead-ahead centreline
regardless of current heading.

**The label-bearing fix above was real but not sufficient on its own** —
after shipping it, labels were STILL completely invisible in RAW, at any
heading. The actual, more fundamental cause, found immediately after by
literally reproducing `NavStyle.getStyle("raw")`'s style object against a
real MapLibre instance: `getStyle("raw")` returns
`{version:8, sources:{}, layers:[...]}` with **no `glyphs` property at
all** (deliberate — RAW has no vector tile source, so the comment reasoned
there was nothing to fetch glyphs for). But MapLibre requires a style-level
`glyphs` URL for ANY symbol layer using `text-field` to validate, full
stop, regardless of whether the style has a tile source — reproduced the
exact `"requires a style glyphs property"` validation failure this
omission causes. `EosMap`'s range-ring-labels layer (added dynamically via
`addLayer()`, so it isn't visible in `NavStyle.getStyle()`'s own returned
JSON) was silently failing to validate under RAW's style the entire time.
Fixed by adding `glyphs: _glyphsUrl()` to the raw style branch too — same
MapTiler glyphs endpoint the day/night styles already use, independent of
whether there's a vector tile layer to go with it. Re-verified: the same
symbol layer that previously threw on `addLayer()` under a glyphs-less
style now adds cleanly once `glyphs` is present.

**Testing convention for MapLibre-related changes:** this sandbox can't reach
MapLibre's CDN or any real tile server (network egress policy blocks them).
Verify camera/projection math with a *locally npm-installed* `maplibre-gl`
package (`registry.npmjs.org` is allowlisted) driven via Playwright/headless
Chromium with a minimal tile-less style
(`{version:8, sources:{}, layers:[{type:"background",...}]}`), not by
reasoning about it or trusting a code comment's claim. This caught four
real bugs this session that pure code review missed — including two (the
label-bearing bug and the missing-glyphs bug) only found by directly
reproducing RAW's actual style/state against a real MapLibre instance
after comparing RAW's behaviour against AIR's already-correct one, not
from reading the code in isolation. Don't assume a single fix resolved a
rendering symptom just because it was a real, verified bug — re-verify
against the actual reported symptom (here: labels still invisible after
the first fix) before considering it closed.

## Range rings — real map layers, not a screen overlay

Rings are drawn as true geodesic circles (`Geo.circleCoordinates`/
`destinationPoint` in `geo.js`, proper spherical math not flat-earth) at
literal real-world nm radii, added as MapLibre line/symbol layers in `map.js`
(`EosMap.updateRangeRings`/`clearRangeRings`) — not a screen-space SVG
recomputed on GPS ticks. That old approach visibly detached from the map
whenever the user panned manually between ticks. Real map layers get
pan/zoom/rotate/tilt correctness for free from MapLibre, same as the route
line. Currently RAW-only in NAV mode (Hybrid's own road/building detail
already gives spatial reference); AIR mode has it as an opt-in setting
(`AirRangeRingsOption`) since real map scale there makes literal nm circles
useful but still optional clutter.

**RAW is a field-of-view-restricted circular display, not a full 360°
plot (2026-08-21).** Prompted directly by the project owner comparing a
real TCAS/ND reference photo (shows only a forward ~150° arc, never a full
sweep) and by VCAS's own rationale for RAW existing at all — "what's ahead
while driving," not a rear picture. `Indicators.FOV_HALF_ANGLE_DEG` (75°,
150° total) is threaded through as `userState.fovHalfAngleDeg`, RAW-only —
Hybrid's edge indicators aren't a round display and keep the full teardrop
`Relevance` already computes. `Geo.projectToPolarPosition` returns `null`
for any bearing outside the FOV; callers filter those out before rendering
(they're still tracked/relevant for Hybrid and the LOG panel, just not
drawable inside RAW's arc). Rings were initially drawn as arcs too
(`Geo.arcCoordinates`, an open `Geo.circleCoordinates` restricted to
`labelBearingDeg ± fovHalfAngleDeg`) as real geo-referenced MapLibre
layers, matching the same reference photo — **superseded later the same
day, see "Rings and dots share one scale" below: this real-geo approach
turned out to be fundamentally incompatible with the banded scale and was
replaced with screen-space rings.**

This also fixed a real, independently-reported "aircraft cluster together
regardless of range" bug: the old per-bearing `maxRadiusForBearing()` scale
(kept for Hybrid, see below) meant a phone's narrow width squeezed anything
even moderately off dead-ahead down to a tiny fraction of the vertical
headroom available dead-ahead — two aircraft in very different distance
bands could end up almost the same radius apart from the anchor just
because they shared a similar off-centre bearing. `Geo.circularPlotRadius`
replaces that with a single, bearing-independent radius for the whole FOV —
`min(maxRadiusForBearing(0,...), maxRadiusForBearing(fovHalfAngleDeg,...))`
— so every aircraft at the same real distance now plots at the same radius
regardless of direction, same as a real round instrument. Verified
numerically (not just asserted) that the minimum really is at those two
endpoints across the full 0–90° sweep before relying on it.

Same investigation surfaced a smaller, adjacent bug in
`maxRadiusForBearing` itself: `safeInset` (the bottom bar's real height,
often 60-100px+) was being reused as the LEFT/RIGHT edge margin too, even
though there's no equivalent chrome on the sides to avoid — just the
screen edge. Since bearings near the FOV's own edge are mostly horizontal
(sin(75°) ≈ 0.97), that margin was often the binding constraint, needlessly
shrinking the whole circular plot for no real reason. Fixed by giving
left/right a small fixed margin (20px) independent of `safeInset`, which
more than doubled the effective plot radius in testing (89px → 193px on a
412px-wide viewport).

**Vehicle/route info strip — done (2026-08-21).** `UI.renderCompassRing()`
takes an optional `vehicleInfo` param (`{ speedMph, route }`) and draws a
compact strip below the heading tape's tick labels — RAW's equivalent of a
real ND's flight-data strip (GS/TAS/ILS APP/arrival time), adapted to what
a car actually has: current speed always shown, plus destination/distance/
ETA when a route is active (reusing `activeRoute`/`routeDestName`, the
same state the bottom route-card already tracks — no new data source).
Folded into the *same* `svg.innerHTML` assignment as the tape itself
rather than a second render call, deliberately — two separate calls would
each overwrite the other's markup on that shared SVG element. Destination
names ultimately come from geocoding search results (free-text user
input), so they're HTML-escaped before going into the innerHTML-built
markup (`UI._escapeHtml`, new) — verified via Playwright that a `<b>`/`&`/
`"`-laced destination name renders as literal escaped text, not live
markup, plus a real long name to confirm truncation (22 chars + `…`)
doesn't break mid-escape.

**Plot scale extended to match relevance's real reach; real label-box
decluttering added (2026-08-21).** Reported directly against the deployed
app: aircraft ranging from 31.6nm to 46.0nm all plotted at the exact same
point (the plot's outer edge), with no visible correlation to the range
rings, and their labels stacked on top of each other/themselves.
Root cause of the first part: `Indicators.POLAR_MAX_RANGE_NM`/
`RING_BANDS_NM` were still capped at 15nm (`Relevance.DEFAULTS.rMaxNm`,
the *base* floor) from before the contrail work above — but relevance
itself can now reach 50nm (`rangeExtensionCapNm`) for high-altitude
traffic, so anything between 15 and 50nm had nowhere meaningful to plot
and all clamped to the identical edge radius, regardless of whether it
was 16nm or 46nm out — hence "no correlation with the rings" and,
with several such aircraft at once, no room to keep their labels apart
either. Fixed by retargeting `POLAR_MAX_RANGE_NM` at
`rangeExtensionCapNm` (50) and adding a 5th band (`[2, 5, 10, 15, 50]`) —
deliberately one wide final band rather than several fine ones, since
that band only ever holds sparser high-altitude/contrail traffic, not
the dense close-in local traffic the fine near bands exist for.

Root cause of the second part: `Indicators.declutter()` only ever pushed
raw x/y *dot centres* apart by a fixed radius, computed before anything
is rendered — it has no way to know how wide a real label box will
measure once actual callsign/type text is in it, so two dots just
outside that fixed gap could still have their (much wider) label boxes
overlap. Fixed by adding `UI.declutterRenderedIndicators()`, a second
pass that runs AFTER `renderIndicators()` and measures each
`.indicator-label`'s real `getBoundingClientRect()`.

**First version of this pass was itself a real, shipped bug, caught the
same day by the project owner re-testing:** it pushed each `.indicator`
freely in x/y (plain AABB minimum-translation separation) to resolve
label overlap — which let an aircraft's RADIUS (distance from anchor)
drift arbitrarily to satisfy a label-spacing constraint, with nothing
keeping distance ordering intact. Confirmed with the literal reported
scenario: a 15.9nm aircraft ended up rendering farther from the anchor
than a 25.9nm and a 33.7nm one — the label pass had silently undone the
exact "does distance correlate with plotted position" property the
band-scale fix above exists to guarantee, immediately reintroducing the
same "no correlation" symptom in a new form. Reworked to re-parametrise
each aircraft as `(radius, angle)` around the anchor and constrain the
separation pass to only ever adjust ANGLE — radius is computed once from
the true `Geo.projectToPolarPosition` output and never touched again, so
no amount of label crowding can invert distance ordering, by
construction (not just by tuning). Re-verified with the same scenario:
every aircraft's final radius exactly equals its pre-declutter value
(bit-for-bit, not just "close"), and no two label boxes overlap.
**Lesson: verify a decluttering/layout fix against the specific property
it must not break, not just against "does the thing it was meant to fix
look fixed" — the first version passed its own overlap check while
silently failing this one.**

**Rings and dots share one scale now — the previous two fixes above
didn't actually fix "no correlation with the rings" (2026-08-21).**
Proven with a screenshot: an aircraft labelled 8.0nm rendered INSIDE the
literal "2" range ring. Root cause, missed by both fixes above: the
aircraft dots (banded/non-linear screen-space scale, see `Geo.
circularPlotRadius`) and the range rings (real geodesic circles at
literal nm radii, reprojected through the map's actual zoom — see
"Range rings" section below) were **two entirely independent coordinate
systems that were never reconciled**, despite superficially sharing the
same nm numbers. Extending the band scale or fixing declutter could
never have touched this — neither change came anywhere near the ring
math. The project owner's own description of the intended design, given
much earlier the same session — "even though the bands themselves are
the same distance apart the range within them changes" — was, in
hindsight, describing the RINGS themselves needing to be evenly/banded-
spaced on screen, not just the dots; the real-geo ring implementation
never actually matched that description, it just happened to ship
without anyone noticing until traffic appeared far enough out for the
mismatch to become obvious.

Fixed by abandoning real geo-referenced rings for RAW specifically and
adding `UI.renderRangeRingsOverlay()` — a screen-space SVG overlay
(new `#nav-range-rings-overlay`, z-index between the map and the
indicators layer) that draws each ring at exactly
`Geo.bandedRadiusFraction(nm, bandsNm) * Geo.circularPlotRadius(...)` —
the *identical* formula `Geo.projectToPolarPosition` uses for the dots,
same anchor, same FOV. This makes a dot's position and its matching
ring's position provably identical by construction, not by keeping two
formulas in sync by convention (which is exactly what silently drifted
apart before). Verified via Playwright: a dot at precisely a band
boundary (2/5/15nm) lands within rounding error of that ring's own
radius; the literal reported case (an 8nm aircraft vs the 2nm ring) now
always renders outside it, at every bearing tested.

This is deliberately RAW-only — `EosMap.updateRangeRings` (the real
MapLibre GeoJSON layer, `Geo.arcCoordinates`/`labelBearingDeg` and all)
is untouched and still exactly what AIR's own opt-in range rings use,
since AIR is real unbanded 1:1 map scale (the project owner's own words:
"air is 1:1 scale and that does appear to be working") — there's no
banding there to stay consistent with, and real geo circles are the
correct choice. Safe to make RAW screen-space specifically because RAW
has no real map texture underneath to visually detach from (pure black
background, no vector tile source at all) — the original "rings must be
real map layers" decision (see "Range rings" below) was about Hybrid/
AIR's real road/building detail, which doesn't exist in RAW.

**Lesson, stacked on top of the two directly above: when a reported
symptom persists after a fix, re-derive the root cause from scratch
rather than assuming the previous fix's theory was right and just needed
another pass.** Both the band-scale extension and the radius-preserving
declutter rework were real, correct fixes for real bugs — and neither
one was what the user was actually describing. Only re-reading their
original "hybrid scale" description against what the ring code actually
does (rather than against what the dots do) surfaced the real mismatch.

**Stage 3: sortable aircraft-list panel — done (2026-08-21).** Fills
whatever side margin the FOV-restricted circular plot's own edge leaves
empty, using the EXACT same anchor/plot-radius math (`Geo.
circularPlotRadius`) the dots and range-rings overlay already use for "how
much room is actually free" — not a separately-guessed layout, for the
same reason the rings-vs-dots coordinate-system mismatch earlier in this
file was worth avoiding twice. `UI.renderAircraftList()` (ui.js) computes
the plot's rightmost edge in px (`cx + plotRadius*sin(fovHalfAngleDeg)`)
and hides the panel entirely — not just empty — below `MIN_PANEL_WIDTH_PX`
(118px) of leftover width: a narrow phone portrait's circular plot already
spans nearly edge-to-edge (see the FOV section above), so there's
deliberately nothing to show there; it only renders on wider phones/
landscape/car-infotainment screens where the plot doesn't use the full
width. Capped at `MAX_PANEL_WIDTH_PX` (220px) on very wide screens rather
than stretching to fill all available leftover space.

Default-sorted by the same visibility-priority order `Indicators.build()`
already produces (score desc, then proximity) — re-sortable via four small
header buttons (PRI/RNG/ALT/TYP) that only reorder the LIST's own display;
sorting never touches which aircraft get plot icons or how they're
paginated (`app.js`'s `_sortForRawList`, called on the full `allRelevant`
set, is a pure display-order concern, kept deliberately separate from the
plot's own relevance-based icon selection/capping). Built from the FULL
relevant set, not the paginated `shown` subset the plot caps to — the
list is the escape hatch for "more relevant traffic than the plot shows
icons for," not a mirror of whichever page is currently up; tapping a row
for an aircraft not on the current icon page still opens its popup (at its
computed, even if currently unrendered, plot position) rather than
auto-advancing pagination.

Tap-to-highlight is bidirectional and persists across renders:
`UI.selectAircraft(hex)` (module-level `_selectedHex` in ui.js, not
per-render state) toggles a `.selected` class on both the matching
`.indicator` and `.raw-list-row` by their shared `data-hex`, called from
both `renderIndicators()`'s and `renderAircraftList()`'s own click
handlers — either side can originate a selection, both reflect it, and
because both render functions re-apply it from `_selectedHex` on every
call, the highlight survives the ~500ms extrapolation re-render tick
(`_extrapolationRenderTick`) instead of vanishing after one frame the way
per-render-only state would. Selecting a row also scrolls it into view.
The on-plot highlight is a glow (`filter: drop-shadow`,
`box-shadow: 0 0 0 2px #ffff00`) rather than fighting `.indicator-label`'s
own inline `border-color` (set per-aircraft by `_borderColor()`), avoiding
a `!important` specificity fight against an inline style.

Incidental fix found while wiring this: switching from NAV to AIR mode
(the `btn-air` click handler) already called `UI.clearCompassRing()` since
`refreshIndicators()` — which normally clears RAW-only screen overlays on
a Hybrid/Raw switch — never runs again once in AIR mode, but was missing
the equivalent `UI.clearRangeRingsOverlay()` call for the screen-space
range-rings overlay (`UI.renderRangeRingsOverlay`, the "Rings and dots
share one scale" fix above) — meaning stale RAW ring content could float
over the AIR map for as long as the user stayed there. Fixed alongside
adding the equivalent `UI.clearAircraftList()` call at the same site,
since it's the identical bug pattern at the same call site, not a
separate issue.

Verified with a real (not headless-shell) locally-installed Chromium via
Playwright, per this project's established convention — including hitting
and fixing a real testing-harness pitfall along the way: `geo.js` uses
Greek-letter identifiers (`φ`, `λ`, `Δ`, `δ`, `θ`), and a minimal test
harness page without its own `<meta charset="utf-8">` silently corrupted
them when the script was fetched externally (Python's `http.server`
doesn't send a charset on its `Content-Type` for `.js`, and a browser's
external-script charset fallback is the *document's* encoding, not
UTF-8) — surfaced as a nonsensical `"Missing initializer in const
declaration"` parse error deep in `geo.js`. Confirmed this is a
test-harness-only artifact, not a real app bug: `index.html`'s actual
`<meta charset="UTF-8" />` is already the very first head tag. Once fixed,
verified: a narrow-portrait viewport (400×800) hides the panel entirely;
a landscape/infotainment-shaped one (1400×500) shows it at the expected
position (clear of both the mocked top-bar and bottom-bar), with correct
row content, correct default-active sort button, and — via real
Playwright clicks, not just reasoning — that clicking an icon selects its
row, clicking a different row moves the selection to its icon, and
clicking a sort button fires the expected callback.

Not yet done: nothing further on Stage 3 itself. Any follow-up (e.g.
letting a row tap auto-advance the plot's own pagination to bring its icon
into view, or a two-sided layout when both left and right margins have
room) should be treated as a new, separately-agreed feature, not an
implied gap in this one.

**Label content correction, same day: type + altitude ONLY, no callsign
on the icon.** A real device screenshot showed `.indicator-label` still
carrying callsign (e.g. "FDX5202 / B752 / 32,100ft") — this was always
wrong per the original Stage 3 spec line ("the basic info that should be
on VCAS label is the type and altitude... if it then displays an aircraft
list... with the callsign"), just never actually implemented that way:
the earlier "type + altitude" label pass (2026-08-21, see above) added
altitude but left the pre-existing callsign div untouched. Fixed by
removing it from both `ui.js`'s `renderIndicators()` markup and the now-
dead `.indicator-label .callsign` CSS rules (VCAS.css) — deliberately NOT
touched: `.air-label-box .callsign` (AIR markers), since AIR has no list
panel to relegate callsign to and would lose its only identifier if
callsign were dropped there too.

**RAW's plot is now a true 1:1 square, not an asymmetric anchor-biased
shape — a significant, foundational rework, same day.** The FOV-restricted
circular plot (Stage 1) computed its radius from whatever headroom a
fixed anchorY (0.8) happened to leave within the FULL viewport — on a
plain portrait phone (the actual common case, not the landscape/
infotainment case used to verify Stage 3 at the time) this reliably used
nearly the full screen width too, leaving no real side margin for Stage
3's list panel to ever show in. Reported directly: a real-device
screenshot showed 5 tracked aircraft on the plot and NO list panel at
all. Root cause wasn't a Stage-3-specific bug — it was that Stage 1 never
actually built what was asked for at the time: "if we do just square off
the display... can we fill the remaining space with additional
information" (the project owner's own original framing, months earlier)
describes the plot ITSELF as a bounded square with genuine leftover
space, not a shape that organically consumes whatever room a full-
viewport anchor leaves. Restated explicitly when the gap was reported:
"the tcas portion will adjust to a 1:1 scale that fits as large an area
as possible within the screen... portrait: the 1:1 will be the maximum
width... placed at the top of the screen (below the compass tape and
info)... below the 1:1 will be the rows... landscape: the 1:1 will be the
maximum height... move to the left and the rows will be on the right."

`Geo.computeSquarePlotLayout(contentWidth, contentTop, contentHeight)`
(new, geo.js) is the single shared implementation: `squareSize = min(
contentWidth, contentHeight)`, pinned to the top (portrait) or left
(landscape), with the complementary rectangle (`rows`) always exactly
"whatever's left" — no separate "is there room" negotiation the way the
old side-margin approach needed. `app.js`'s `_rawChromeInsets()` is the
one place that measures the real DOM chrome (top bar, guidance card,
bottom bar/route card) and adds a fixed `RAW_COMPASS_RESERVED_PX` (80,
worst-case ticks+labels+lubber+digital+info-strip — NOT live-measured,
since the compass tape itself is drawn using the square's own contentTop,
so measuring it first would be circular) to get `squareContentTop`/
`squareContentHeight`; `Geo.projectToPolarPosition` gained `offsetX`/
`offsetY` params so a caller can plot within a sub-region (the square)
rather than the full viewport.

**The harder half of this fix: keeping the REAL map camera's user-marker
anchor aligned with the new square.** The square is purely a screen-space
concept for RAW's dots/rings/list, but the real `.user-marker-halo`
MapLibre marker (map.js) is positioned by the REAL camera's anchorX/
anchorY (`CameraController._renderAnchoredFrame`, driven by
`NavigationCameraEvaluator`'s per-state presets) — if only the screen-
space square moved and the real camera's anchor stayed at its old flat
0.5/0.80 full-viewport fraction, the marker would visibly drift off from
the dots/rings around it, reproducing the exact "camera anchor math"
bug class this file already documents at length, just triggered by new
code instead of old. Fixed by: (1) `NavigationCameraEvaluator.evaluate()`
gained an optional `ctx.viewportWidth`/`viewportHeight`/`squareContentTop`/
`squareContentHeight` — when present and `targetState === "NAV_RAW"`, it
calls the SAME `Geo.computeSquarePlotLayout()` and derives anchorX/anchorY
(full-viewport fractions, its normal external contract) from the square's
own centre/anchorY-within-square, superseding the flat preset and the
phone-p/phone-l/auto viewport-bias overrides for this state specifically
— those coarse per-device-class nudges are redundant once the per-frame
calculation already adapts exactly to the real aspect ratio. (2)
`app.js`'s `_rawChromeInsets()` is the ONE place that measures the real
chrome — passed into BOTH `CameraController.followNav()` (→ the
evaluator, for the real camera) and used directly in `refreshIndicators()`
(→ `Geo.computeSquarePlotLayout`, for the screen-space square) — the same
numbers reach both paths, not two independently-measured versions that
could drift. (3) Incidental but necessary bug found along the way:
`cameraController.js`'s `_renderAnchoredFrame`/`followNav`/`_startAnimTo`
computed `anchorX` (via the evaluator) but then silently DROPPED it —
`_renderAnchoredFrame` only ever panned by a Y offset, never X, so every
state's real anchor was always horizontally centered regardless of what
anchorX said (harmless before, since every state's anchorX really was
0.5 — RAW's square can now be genuinely off-center in landscape, so this
could no longer stay silently broken). Fixed by adding the equivalent X
pan, mirroring the existing Y-pan pattern exactly (including its own
"MapLibre panBy negates internally" gotcha).

Verified two ways, not just one: (1) a pure Node simulation requiring
`geo.js` and `navigationCameraEvaluator.js` directly, comparing the real
camera's derived anchor (px) against the screen-space square's own anchor
(px) across 5 device shapes (portrait phone, portrait with a route active,
landscape phone, wide infotainment landscape, and a near-square tablet
that resolves to landscape with a THIN ~96px rows column) — exact
(0.0000px delta) match in every case, confirming the shared-function
approach makes drift structurally impossible rather than just unlikely.
(2) A real Playwright/Chromium render at the literal reported portrait
phone size (412×915): the square now sits at the top with all 5 tracked
aircraft correctly plotted inside it, and the list panel — previously
absent entirely at this size — renders below it with all 5 rows visible,
no overlap with the mocked top/bottom chrome. Landscape (915×412) verified
the mirror layout: square on the left, list filling the right.

**Lesson, adding to the ones already in this file: a repeated-but-
unrecorded design decision doesn't stay findable just because it was
said once.** The "square off the display, fill the remainder with
information" framing was the project owner's own original description
of Stage 1+3 together — but Stage 1 shipped as an anchor-biased shape
that only coincidentally looked square-ish in the landscape/infotainment
case used to verify it at the time, and nothing caught the mismatch
until a real portrait-phone screenshot months later. Same category as
the native-app-destination and 50nm-contrail-cap incidents earlier in
this file — the fix each time isn't "remember harder," it's writing the
actual number/shape/rule down somewhere durable the moment it's decided,
not just the fact that a conversation about it happened.

## RAW ND-style range selector + suppressed edge dots (2026-08-21)

Explicitly modelled on the real A320-family EFIS control panel — the
project owner's own reference: a physical knob next to the Navigation
Display cycles its displayed range. A touchscreen has no separate hardware
for that, so `UI.renderRangeSelector()` puts a small tappable "10NM"-style
readout in the square plot's own top-right corner instead (matching where
a real ND prints its current range) — tapping it advances
`app.js`'s `selectedRangeIndex` through `Indicators.RING_BANDS_NM`
(`[2, 5, 10, 15, 50]`) and wraps around. Deliberately reuses the SAME
5-value array the range rings already draw at, rather than inventing a
separate preset list — the project owner's own framing ("5 options") maps
onto it exactly, and it means there's only ever one array of "the sizes
this display understands," not two that could drift apart.

**How rescaling works, with zero new geometry:** `app.js` slices
`RING_BANDS_NM` down to `selectedRangeIndex + 1` entries
(`activeBandsNm`) and passes that in place of the full array everywhere —
`Geo.projectToPolarPosition`'s existing `bandedRadiusFraction` logic
already clamps any range at or beyond the LAST band to radius fraction
1.0 (see geo.js). Feed it a shorter array and that clamp point simply
moves inward: dialled to 10nm, an 8nm aircraft now gets plotted using
only 3 bands instead of 5, landing farther out (more of the plot's radius)
than it would on the full scale — exactly the "zoom in" a real ND range
knob does. Verified numerically: the same 8nm aircraft plots at y=165
(near the edge) on `[2,5,10]` vs y=231 (more central) on the full
`[2,5,10,15,50]`.

**Suppressed edge dots — the same clamp, repurposed rather than fought.**
Direct instruction: aircraft beyond the selected range shouldn't just
vanish — they should show as "literally just a dot" in the aircraft's own
visibility colour, at its correct bearing, on the plot's outer edge, so
the user knows something's out there before they dial the range back out.
Because the clamp above already puts anything beyond the selected range's
last band at radius fraction 1.0 regardless of how far beyond it actually
is (a 30nm and a 45nm aircraft at the same bearing land on the EXACT same
pixel, verified: `{x:173,y:140}` for both against a `[2,5,10]` scale),
that IS the edge-dot position — no separate "place it on the boundary"
geometry was needed, just a different renderer
(`UI.renderSuppressedDots()`, ui.js) for items past the cutoff: no shape,
no label box, no direction arrow, just an 8px dot, still tappable (opens
the same popup as a full icon).

**Relevance itself is completely untouched by this.** The range selector
is a pure display-layer concept layered on top of the existing relevance
gate, not a second filter: `Relevance.evaluate()` still decides what's
"trackable" at all (teardrop/overhead/50nm contrail extension, all
unchanged); `app.js`'s `refreshIndicators()` splits that already-relevant
set into `withinRange` (full icon + label, and this is now what
`Indicators.capForViewportWidth`'s pagination applies to — NOT the whole
relevant set, which would have wrongly paginated away suppressed dots
too) and `beyondRange` (edge dot, always rendered in full, never
paginated — a bare dot has no clutter cost the way a label does). The
Stage 3 list panel is untouched in scope — it still shows the FULL
relevant set regardless of range — but rows for `beyondRange` aircraft
now get a `.beyond-range` dimmed style (`raw-list-row.beyond-range`,
opacity .5) so it's visually clear why some rows have no matching full
icon on the plot (a bare edge dot, or if also outside the FOV, nothing at
all) rather than reading as a bug.

Selection cross-highlight (`UI.selectAircraft`) was extended to cover
`.suppressed-dot` elements alongside `.indicator` and `.raw-list-row` —
tapping an edge dot highlights its list row exactly like tapping a full
icon does, and vice versa, using the same shared `data-hex` mechanism.

Verified with a real Playwright/Chromium render: a `[2,5,10]`-scale plot
with 2 aircraft inside 10nm and 2 beyond it correctly rendered 2 full
labelled icons and 2 bare colour-matched dots sitting within ~0.2px of
the plot's own computed radius (rounding only); the list panel showed all
4 rows with the 2 out-of-range ones dimmed; clicking a suppressed dot
selected both it and its matching list row; clicking the range button
fired the cycle callback.

## Label decluttering was moving the whole icon+arrow+label bundle (2026-08-21)

Direct report from the project owner, who correctly named both the bug
and the fix before any code was touched: "the center of the icon is
where the aircraft actually is... the only thing that should be
deconflicting is the label... this should rotate about the icon" — i.e.
the icon (and its direction arrow, which must stay glued to the icon)
has to stay exactly at `Geo.projectToPolarPosition`'s own computed point,
full stop; only the label is allowed to move, orbiting that fixed icon.

**Confirmed by reading the code, not just taking the report at face
value** — two real, independent bugs, both stemming from the SAME root
cause: `.indicator`'s single element wrapped shape+label together and
was itself the thing centred via `transform: translate(-50%,-50%)` and
positioned via `left/top = ind.x/ind.y`.

1. Even at rest (no overlap at all), the icon's own visual centre was
   NEVER exactly at the true plotted point — `.indicator` was a flex
   column (`display:flex; flex-direction:column; align-items:center;
   gap:2px`) containing BOTH shape and label, and `translate(-50%,-50%)`
   centred the WHOLE STACK's bounding box, not the shape alone. Since the
   label's height varies (1 vs 2 text lines) and sits below the shape,
   this silently shifted the icon upward from centre by roughly half the
   label's height — small, but real, and present on every single render,
   not just crowded ones.
2. `UI.declutterRenderedIndicators()` re-parametrised each *entire*
   `.indicator` element as (radius, angle) around the PLOT's shared
   ownship anchor and, to resolve a label overlap, wrote a new `left/top`
   for that whole element — meaning the icon and its direction arrow
   physically slid along with the label whenever decluttering kicked in,
   exactly the "moving as a group" the project owner was suspicious of.
   (This was itself a fix for an EARLIER bug, documented above — that
   version pushed .indicator freely in x/y and could invert distance
   ordering. The radius-preservation part of that fix was correct and is
   still in effect; what was still wrong is that it moved the icon at
   all.)

**Fix: decouple the DOM/CSS so the icon can be a fixed point and the
label an independently-positioned satellite of it.** `.indicator` itself
now carries no transform and no flex layout at all — it's purely an
anchor: `left/top = ind.x/ind.y`, nothing else ever writes to those two
properties again. `.indicator-shape` (icon + arrow) is now itself
`position:absolute; left:0; top:0; transform:translate(-50%,-50%)` —
centred exactly on `.indicator`'s own origin, i.e. exactly on the true
point, permanently. `.indicator-label` is now also independently
`position:absolute`, with a CSS default of `left:0; top:24px;
transform:translate(-50%,-50%)` (24px straight below the icon's centre,
approximating the old stacked look for the common no-overlap case).

`UI.declutterRenderedIndicators()` was rewritten to operate in a
per-aircraft LOCAL polar frame centred on that aircraft's own
already-fixed icon — no plot-anchor argument at all any more (its
signature dropped `anchorX, anchorY` entirely). For each `.indicator` it
reads the label's current on-screen rect, derives `(radius, angle)`
relative to ITS OWN icon (not the distant ownship anchor), and — exactly
as before — only ever adjusts angle to resolve an overlap, never radius,
so a label can't drift toward or away from its own icon either. The
final step writes ONLY `.indicator-label`'s own `left/top/transform`;
`.indicator` and `.indicator-shape` are never touched by this function at
all, structurally, not just by convention.

**Also removed: `Indicators.declutter()`** (`indicators.js`), the
earlier/coarser pre-render pass that nudged raw `x`/`y` dot centres apart
by a fixed gap before anything was on screen. Same root violation as bug
#2 above, just at an earlier stage — it mutated the very
`ind.x`/`ind.y` that becomes the icon's `.indicator` position, so an
aircraft's icon could already be off its true point before
`declutterRenderedIndicators()` ever ran. There's no reason left for it
to exist once labels alone carry all deconfliction duty: two genuinely
coincident aircraft are now allowed to render at (very nearly) the same
icon position, which is actually more correct for a TCAS-style display —
real traffic that's genuinely that close together SHOULD read as
overlapping icons, not be nudged apart into a misleading "these are
further apart than they really are" picture. Deleted the function, its
`app.js` call site, and the now-unused `INDICATOR_DECLUTTER_GAP_PX`
constant; updated the stale README.md paragraph that described the old
behaviour.

Verified with a real Playwright/Chromium render, not just reasoning:
two aircraft placed 40px apart (close enough that their default-position
labels overlap) — after decluttering, both `.indicator`'s own `left/top`
were bit-for-bit unchanged from before the pass, `.indicator-shape`'s own
rendered centre matched the true point to within rounding on all three
test aircraft (including a third, isolated one with nothing to
deconflict), the two crowded labels swung apart to opposite sides with
no overlap remaining, and the isolated aircraft's label stayed exactly
at its default straight-down position, untouched.

**Label content: type + altitude, not type + distance (2026-08-21).**
Explicit instruction, restating an earlier Stage 3 spec line that hadn't
been implemented yet ("the basic info that should be on VCAS label is the
type and altitude"): both NAV/RAW's `.indicator-label` (`ui.js`
`renderIndicators()`) and AIR's `.air-label-box` (`map.js`
`_airMarkerHtml()`) now show callsign + type + altitude
(`Math.round(altitudeFt).toLocaleString()+"ft"`, e.g. "32,000ft"), never a
distance readout — the dot's own plotted radius already encodes range (this
is the whole point of the banded polar scale above), so a redundant text
distance wasn't adding anything a label is actually for. The
`indicator-distance` CSS class was renamed to `indicator-altitude`
(VCAS.css) rather than left as a stale name now holding altitude text.
AIR markers previously showed no altitude or distance at all — this is a
net-new field there, not a rename, so it needed its own
`.air-label-box .indicator-altitude` rule (separate cascade scope from
`.indicator-label`'s, matching the pre-existing `.air-label-box .actype`
split) rather than assuming the renamed `.indicator-label` rule would
reach it. Verified with a local Playwright + the real `VCAS.css` (not a
hand-copied stylesheet) rendering both label markups standalone: RAW's
`#f0f0f0` override applies correctly to the renamed class, AIR's
`--text-secondary`/8px rule applies correctly to its own scope, both show
the right altitude text.

## Contrail visibility — Relevance range + Visibility score (2026-08-21)

Real, independently-verified gap: an aircraft at ~32,000ft, ~20-25nm ground
distance (~12-15° elevation, ~21-26nm slant range) was ADS-B-confirmed on
a third-party tracker (adsbexchange.com) AND visually confirmed via
contrail by the project owner, but VCAS's fixed 15nm `Relevance` cap
excluded it entirely before `Visibility.estimate()` ever got a chance to
score it. This wasn't a new problem to solve from scratch — `README.md`'s
"Ground-Truth Log Panel" section and the log panel's own dedicated
`visible_contrail` (〜) outcome button already existed *specifically* to
collect real observations like this one, for a contrail-visibility model
explicitly flagged as not-yet-built ("this panel is how that gap gets
measured before it gets modelled"). That connection — and the fact a
specific number had already been discussed for it — wasn't written down
anywhere durable, so it took the project owner explicitly saying "I
thought we had a cap at 50nm specifically for this reason" to surface it.
**Lesson repeated from the native-app-destination incident earlier this
project: a real prior decision with no durable record gets silently
re-litigated. That's what CLAUDE.md is for — write down numbers, not just
the fact that a discussion happened.**

The real numbers, confirmed directly from the project owner: **26,000ft**
altitude threshold and **50nm** range cap, both **field experience, not
physically derived** ("no hard work done on this number beyond personal
experience... 50nm was about as far away as identifiable contrails could
be. beyond that they can still be seen but I couldn't definitively say
they were from a certain aircraft") — i.e. 50nm is specifically an
*identification-confidence* range, matching this project's identification
pillar, not a raw-visibility one. Treat these as tuned constants like
`pinchExponent`/`overheadElevationDeg`, not something to "improve" with a
physics model — VCAS has no upper-air temperature/humidity data source,
and adding one would be exactly the kind of weather-display scope this
project has explicitly rejected elsewhere in this file.

**Two coordinated pieces, deliberately mirroring the same threshold/cap so
neither module diverges from the other:**

- `Relevance._effectiveRMaxNm(altitudeFt, opts)`: when altitude ≥
  `contrailMinAltitudeFt` (26,000ft), the teardrop's dead-ahead range
  jumps straight to `rangeExtensionCapNm` (50nm) — a flat threshold+cap,
  NOT a gradual elevation-angle formula. An elevation-angle version was
  built and shipped first (calibrated only to the one reported case) and
  had to be reverted once the real intended model came out: it doesn't
  even reach 50nm until ~54,000ft, well above where airliners actually
  cruise, so it silently undershot the real number for every realistic
  case. Below the threshold, `rMaxNm` is completely unchanged (15nm, or
  whatever's configured) — verified low-altitude traffic at 12/18/30nm
  behaves identically before/after.
- `Visibility.estimate()`: the same altitude+range window (`altitudeFt >=
  CONTRAIL_MIN_ALTITUDE_FT && slantNm <= CONTRAIL_MAX_RANGE_NM`) floors the
  category at "Possibly visible" — never downgrades a case angular size
  alone already scores higher (`Math.min` of the two tier indices), only
  rescues cases angular size alone would underrate. Deliberately folded
  into the existing four tiers rather than added as a new distinct
  tier/symbol — a direct choice from the project owner over giving
  contrail-only sightings their own shape, keeping the existing legend
  unchanged.

Because `_teardropRangeNm`'s pinch formula scales toward `rMinNm`
(unchanged, 3nm) at 180°, the range extension only ever helps bearings
biased toward dead-ahead — it doesn't loosen the "behind" allowance at
all, matching that a high-altitude jet only helps if you'd actually be
looking that way. Verified end-to-end with a Node simulation covering:
the original real case, a smaller narrowbody at 30nm (angular size alone
would drop it — contrail floor correctly rescues it AND makes it
relevant), the same case beyond 50nm (correctly excluded), a close-in
high-altitude case where angular size alone already dominates (correctly
NOT downgraded), and the exact 25,900ft/26,000ft altitude boundary
(correctly excluded/included respectively).

## RAW mode fidelity

RAW is meant to closely resemble a real TCAS/ND cockpit display, matched
against a real reference photo the project owner provided (not a generic
"aviation-style" guess). When the owner says "match the reference exactly,"
**pixel-sample the actual image** (Python/PIL against the uploaded file —
check `/root/.claude/uploads/<session>/` for the most recently modified
matching file if it's been shared before) rather than eyeballing colors from
the chat-rendered thumbnail, which is small and JPEG-compressed. This session
that approach caught real mismatches eyeballing had missed (e.g. the
ownship marker was yellow-*green*, not yellow).

RAW forces its *map content* (background, traffic colors, route line, rings,
compass tape, user marker) dark regardless of Day/Night/Auto — there's no
"day mode" cockpit instrument. This has to be deliberately extended to the
*app chrome* around it too (top/bottom bars, buttons) via CSS custom
property overrides scoped to `body[data-mode="nav"][data-nav-style="raw"]`
(see VCAS.css) — easy to forget, and when forgotten produces a correctly-
black map with Day-theme's pale UI chrome floating on top of it, which reads
as broken/unfinished rather than "instrument display."

**Important scoping gotcha, hit twice this session in different forms:**
`NavDisplayStyle.isRaw()` (the persisted Hybrid/Raw preference) is **not**
mode-scoped — it can still read "raw" after switching to AIR mode. Any code
that should only apply during actual NAV+RAW (not AIR-with-a-lingering-raw-
preference) must check `mode === "nav"` too, not `isRaw()` alone. Bit both
the range-ring color logic and would have bitten the chrome-forcing CSS if
not caught.

## Cockpit-panel chrome rebrand (2026-08-22)

Direct instruction, with an attached A320 cockpit reference photo (MSFS
texture sheet, ND circled): VCAS's three modes had each visually drifted to
resemble whatever inspired them individually (Hybrid → generic Google-Maps
look, RAW → generic "data screen," AIR → generic ADS-B website), with no
unifying brand identity tying them together. Direction: centralize the
app's **chrome** (backgrounds, buttons, panels, bars — everything in
VCAS.css outside the map/RAW/AIR content itself) on the aesthetic of the
real A320 panel RAW mode is already modelled on — "the aesthetic of the
cockpit to directly inspire the app... a person shouldn't look at the app
and think it looks like an airplane, they should think it is functional
and professional. an aviation person should look at the app and absolutely
know what the inspiration was."

**Hard scope constraint, stated explicitly and still binding on any follow-
up work here:** "this should not impact the actual colors and shapes of
the maps themselves, the function is where it should be at this stage,
it's the brand and non essential design that is now being solidified."
Hybrid's map tiles, RAW's already reference-matched TCAS/ND colors/shapes
(traffic symbol colors, range rings, compass tape, user marker — see "RAW
mode fidelity" above), and AIR's marker functional colors are OUT of scope
for this work — only chrome/brand elements (top/bottom bars, buttons,
settings screen, popup, panels) are in scope.

**Palette derivation — pixel-sampled, not eyeballed, per this project's
established convention.** The reference photo was sampled with Python/PIL:
a robust statistical median across ~387k panel-coloured pixels (filtered to
exclude near-black shadow gaps and near-white lit text/displays) came out
to RGB(85,108,122) = HSL(203°, 18%, 41%). Both themes' full neutral ladder
(`--bg-dark`/`--bg-panel`/`--bg-panel-alt`/`--border`/`--text-primary`/
`--text-secondary`/`--text-muted`) is generated from that SAME hue/
saturation, varying only lightness — a deliberate "one material lit
differently" design rather than two independently-chosen palettes, so Day
and Night read as the same physical panel under different ambient light
rather than a dark-mode skin with an unrelated light-mode bolted on.
Contrast-checked via the real WCAG relative-luminance formula (not
eyeballed): every text/background pairing in both themes clears 5.28:1,
comfortably past the 4.5:1 AA minimum for normal text (Day's primary text
reaches 13.9:1).

**Two design decisions confirmed via AskUserQuestion before implementing:**
1. **Accent colors kept as-is.** `--accent` (VCAS logo blue) and
   `--accent-user` (car/crosshair lime green, "you, tracked") stay the
   brand's own colors rather than shifting to the panel's real functional
   switch-lighting colors (green=normal/amber=caution, as real A320 legend
   lighting actually uses). Explicit call: the panel MATERIAL changes,
   VCAS's own brand identity doesn't. **Flagged for a possible later
   trial, not decided against permanently** — the functional-color
   direction was raised and deliberately not taken now; worth revisiting
   rather than re-litigating from scratch if it comes up again. (This is
   the CLAUDE.md cross-reference VCAS.css's own palette comment points to.)
2. **Day theme is a lighter panel variant, not a generic bright/white
   light mode** — same hue/saturation as Night, just lit brighter (light
   blue-grey, never pure white), so Day and Night read as one physical
   object under different lighting rather than two unrelated looks.

**Button "shape and lighting" pass.** `--radius-sm`/`--radius`/`--radius-lg`
reduced from `6px/10px/14px` to `4px/6px/10px` — smaller, more rectangular
corners closer to the reference photo's real switch caps than the
previous pill-leaning radii. New `--btn-shadow`/`--btn-shadow-active`
custom properties (defined per-theme, since Day needs a light-top/dark-
bottom bevel and Night/RAW need the inverse balance to read as physically
lit) add a subtle raised-bevel box-shadow at rest, inverting to a pressed-
in inset look on `:active` — deliberately restrained (reads as
"professional instrument panel," not "3D skeuomorphic plastic"). Applied
to the primary interactive chrome: `#btn-settings`, `.mode-btn` (including
the standalone route-pin button, which reuses the same class),
`#btn-recenter`, `#btn-raw-range`, `.dpb-mode-btn`, `.settings-toggle-btn`,
`.settings-preset-btn`, `#btn-settings-close`, `.theme-btn` (both the
settings-screen `.theme-toggle-group` and the — currently unused, see
below — `#theme-picker`). Segmented-bank controls (`.mode-toggle`,
`.dpb-modes`, `.theme-toggle-group`, `#theme-picker`) put the bevel on the
CONTAINER only, with individual segments going flat (`box-shadow: none`)
and getting their own small inset shadow when `.active` — modelled on a
real switch bank being one recessed housing with individual flush caps,
not several independently-raised buttons glued together.

**Incidental finding, not acted on:** `#theme-picker` (a Day/Auto/Night
picker CSS-styled for the top bar) has no matching element anywhere in
`index.html` or any JS file — dead CSS, presumably superseded by the
settings-screen's `.theme-toggle-group` at some earlier point without the
old rule being cleaned up. Left in place (still themed/bevelled alongside
everything else it shares `.theme-btn` with, so it isn't stale-looking
CSS if ever revived) rather than deleted, since removing dead code wasn't
part of what was asked here — flagging in case it's worth a cleanup pass
later.

**Verification.** Real Playwright/Chromium render (this project's
established convention — reasoning about CSS cascade/specificity has
caused real bugs before, see the RAW-glyphs and label-decluttering
investigations above) of a static harness reproducing the top bar,
mode-toggle row, route card, settings screen, and popup against the real
`VCAS.css`, across three states: Night (default), Day, and RAW-forced-dark
while Day is active. Confirmed: the new palette reads as intended in both
themes, the bevel is visible but restrained on every listed button class,
contrast holds up, and — importantly, since this touches the same
`body[data-mode="nav"][data-nav-style="raw"]` override block documented
above — RAW's forced-dark-chrome override still correctly wins over Day
even after the palette rewrite (no regression to the earlier "Day-theme
pale chrome floating over a black RAW map" bug).

**Not yet done / explicitly out of scope for this pass:** no further
lighting/shape treatment on the RAW-only instrument controls
(`.raw-list-sort-btn`, `#raw-aircraft-list` itself) — left as their
existing dark, RAW-only hardcoded styling, since they're an ND-instrument
readout rather than app chrome and weren't reported as looking
inconsistent. Any broader pass (e.g. reconciling `#theme-picker`'s dead
CSS, or extending the bevel language to popup buttons like
`.pop-suppress-btn`/`.pop-log-btn`) should be treated as a new,
separately-agreed follow-up, not an implied gap in this one.

### Typography: B612 (2026-08-22, same rebrand)

Direct instruction, separate from and after the palette/button work above:
"Google font B612 is used on Airbus flight decks so that is the font we
will use in VCAS." Unlike the rest of the cockpit rebrand — which is
*inspired by* the reference photo's material, deliberately not a literal
recreation (see the rebrand section's own framing above) — B612 is a
literal match: it's the actual Airbus-designed, Google Fonts-hosted
typeface used on real PFD/ND/ECAM displays, not an approximation chosen
for a similar look.

Loaded via Google Fonts (`index.html`'s `<head>`, alongside the existing
MapLibre CSS link) — `preconnect` hints for `fonts.googleapis.com`/
`fonts.gstatic.com` plus the actual stylesheet link, weights 400/700 only
(`family=B612:wght@400;700`). Set as the lead font in the `html, body`
rule (`src/styles/VCAS.css`), ahead of the pre-existing system-font
fallback chain (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
sans-serif`) — kept as a fallback rather than replaced, in case the
Google Fonts request itself fails (e.g. first paint while offline, before
the PWA's cached copy of the stylesheet is available).

**Only 400/700 loaded, not every weight this stylesheet references**
(some rules use 600/800/900 — `grep -n "font-weight:" VCAS.css` for the
full list). Browsers fall back to the nearest *actually loaded* weight
rather than synthesizing an in-between one, so 600 renders at 400 or 700
(whichever the browser's matching algorithm picks) and 800/900 render at
700 — a normal, accepted simplification (most sites ship 2-4 weights, not
every numeric value used in their CSS), not a bug to chase.

**Deliberately NOT applied to the three developer-only debug panels**
(`#viewport-dev-panel`/VIEW, `#speed-sim-panel`/SPD, `#log-panel`/LOG —
all gated behind hidden developer mode per the "Architecture map"'s own
history) — left on their existing `ui-monospace, "Cascadia Code", "Fira
Code", monospace` stack. Same scope boundary the palette/button pass
above already drew: these are developer tooling, not primary app chrome,
and weren't part of what was asked. B612 Mono (below) was later added
specifically to the app's own numeric-readout areas, still deliberately
excluding these three panels for the same reason.

Verified two ways: (1) the Google Fonts CSS endpoint itself, fetched with
a real browser User-Agent (this sandbox's plain `curl` — no UA — gets
served an empty stylesheet; Google Fonts varies its response by UA to
serve the right format, so this matters for verification, not just for
real users) confirms `B612` actually resolves to real `woff2` sources at
400 and 700. (2) A real Playwright/Chromium render of a harness loading
the actual `index.html` font `<link>` tags + `VCAS.css` reports
`document.fonts.status === "loaded"` and `getComputedStyle(el).fontFamily`
resolving to `B612` first in the chain — not just requested, confirmed
actually applied and rendered (the sample screenshot shows B612's
distinctive geometric, open-counter character, matching its cockpit-
legibility design brief).

#### Follow-up: B612 Mono for numeric readouts (2026-08-22, same day)

Direct instruction: "include the monospace for the areas that is utilized
in the Airbus" — i.e. don't apply B612 Mono blanket-wide, apply it
specifically where a real Airbus panel itself renders digits in
monospace (PFD/ND digital tapes, MCDU/data-page numeric columns), mirroring
that same "display face for labels, monospace for digital values"
convention VCAS's own reference photo shows. Added `family=B612+Mono` to
the existing Google Fonts link (`index.html`) — only weight 400 ships for
B612 Mono (no real bold face; a `font-weight:600/700/800` rule on it gets
the browser's own synthesized bold, same accepted simplification as B612
itself) — then scoped `font-family: 'B612 Mono', monospace` to the actual
numeric-readout elements, leaving every label/text element on regular
B612:

- `.route-eta-time` / `.route-eta-arrival` / `#route-dist-text` — the
  ETA card's big time/arrival-clock/distance readouts, VCAS's own
  equivalent of a real ND's flight-data strip (see "Vehicle/route info
  strip" above) — but NOT `#route-dest-name` (a place name) or
  `.route-eta-sub` as a whole, which shares that span with the place name.
- `.indicator-label .indicator-altitude` and `.air-label-box
  .indicator-altitude` — the NAV/RAW and AIR traffic tag altitude figures
  (a real TCAS/ND altitude readout is digital) — but not `.actype`
  (aircraft type text) alongside it.
- `#popup .pop-val` — the aircraft detail popup's Distance/Altitude/
  Bearing/Speed/Updated values, VCAS's own data-page equivalent of an
  MCDU/ND secondary page's aligned numeric columns — but not `.pop-key`
  (the label beside each value) or `.pop-callsign`/`.pop-type` (text, not
  digits).
- `#btn-raw-range` — the ND-style range-selector button's digit readout
  (e.g. "10NM"), matching a real ND's own range annunciation.
- `#nav-compass-ring text` — a single rule covering every raw SVG `<text>`
  element `ui.js`'s `renderCompassRing()` generates (heading tick labels,
  the digital heading box, the speed/route info strip), rather than
  threading `font-family` into each of that function's inline
  `style="..."` strings individually — none of those inline styles set
  `font-family` themselves, so the external rule always wins.

Still deliberately excluded: the three developer-only debug panels (VIEW/
SPD/LOG, see above) and the Stage 3 aircraft-list panel's `.rlr-meta` row
text (mixes type text with alt/range figures inline — "B738 · 5,200ft ·
12.4nm" — rather than being a clean digits-only readout the way the
others above are, so it stayed on B612 rather than being force-split).

Verified with a real Playwright/Chromium render of a harness reproducing
each target element against the actual `VCAS.css`: every listed selector
resolves its computed `font-family` to `'B612 Mono', monospace`, every
adjacent label/text element (destination name, pop-key, actype) correctly
stays on `B612`'s regular display face, and the rendered screenshot shows
B612 Mono's fixed-width digit shapes on the numeric values next to
proportional B612 text on the labels beside them — not just requested,
confirmed actually applied per-element, matching the intended "digital
readout vs. display label" split a real cockpit panel itself uses.

## Power efficiency pass (2026-08-22)

Direct report: "it seems to consume quite a lot of power... can we improve
it's every use?" Read through the GPS/sensor/render loop in app.js,
map/cameraController.js, and ui.js before changing anything, to find real
drains rather than guessing. Findings, roughly biggest-to-smallest:

1. **`refreshIndicators()` runs from two independent, uncoordinated
   triggers** — every single GPS fix (`onGpsSuccess`, in `mode === "nav"`)
   AND a separate 500ms `renderTickTimer` (`_extrapolationRenderTick`,
   added 2026-08-20 for extrapolation smoothing — see the "Architecture
   map" entry for `aircraftExtrapolation.js`) — so the full pipeline
   (camera/square-layout math, `Indicators.build()`, a full
   `container.innerHTML = ""` + rebuild of every indicator element in
   `UI.renderIndicators()`, then `UI.declutterRenderedIndicators()`'s
   `getBoundingClientRect()` layout-thrash across every icon/label/leader
   candidate) can run 2-5×/sec, not the ~2Hz the 500ms tick alone would
   suggest. The two-triggers part itself is unchanged (still deliberate —
   see #4's ADS-B/METAR note) but the expensive full-rebuild half of this
   is now fixed, see the follow-up entry below.
2. **Fixed: the compass/device-orientation sensor listened continuously,
   not just while its readings were used.** `onCompassHeading()` already
   discarded every reading above `CONFIG.GPS_HEADING_MIN_SPEED_MPH`
   (5mph) — GPS course wins once actually moving, see "Compass 'won't
   settle'" above — but `CompassHeading.stop()` (it exists) was never
   called anywhere; `start()` ran once at init and the magnetometer/
   gyro listener stayed live for the entire session regardless of speed,
   waking the JS thread on every sensor reading during the majority of an
   actual drive for data that was immediately thrown away. Fixed by
   toggling `CompassHeading.stop()`/`start()` in `onGpsSuccess` on the
   same speed threshold, gated behind a new `compassPermissionGranted`
   flag so it never races iOS's one-time permission-gesture requirement.
   Both calls are idempotent (compassHeading.js's own `_listening` check),
   so calling on every GPS fix is safe/cheap.
3. **Fixed: `Indicators.buildAll()` — a full relevance/visibility pass over
   every tracked aircraft, not just the ones NAV shows — ran unconditionally
   on every `refreshIndicators()` call, purely to feed the LOG ground-truth
   panel.** `LogPanel.update()` already no-ops its own DOM render when the
   panel's menu isn't open, but the expensive upstream computation feeding
   it ran regardless — real cost paid every ~500ms-1s for a panel that's
   closed the vast majority of the time (it's a diagnostic/observation
   tool, not primary UI). Added `LogPanel.isOpen()` and skip the
   `buildAll()` call entirely when closed. Trade-off, accepted as fine for
   a diagnostic panel: `_tracked` can be up to one tick (≤500ms) stale
   right after re-opening the panel, self-healing on the next call.
4. **Confirmed NOT an issue, checked rather than assumed:** MapLibre isn't
   forced into continuous repaint anywhere (no `repaint`/`preserveDrawing
   Buffer` overrides in map.js) — it renders on-demand as designed.
   `CameraController`'s frame-driven `jumpTo()`/`panBy()` animation loop
   (see "Camera anchor math" above) is bounded to ~400ms per redirect and
   self-cancels/redirects via a single `_animFrameHandle`, not stacking
   multiple concurrent loops when GPS fixes arrive faster than the anim
   duration. ADS-B polling (3s) and METAR refresh (15min) were left
   untouched — deliberate existing cadences, not identified as the
   dominant cost here relative to #1-#3 above.

**Not done, explicitly out of scope for this pass** (per direct
instruction — this pass covers only the "safe wins," items 2 and 3
above): no attempt to pause GPS/fetch/render loops on Page Visibility
(`document.hidden`) — VCAS is a screen-on navigation app by design
(WakeLock keeps the screen alive while navigating), so background-tab
pausing has limited real-world payoff here and wasn't investigated
further this pass.

### Follow-up: `renderIndicators()` DOM-diffing rework (2026-08-22, same day)

The "single biggest remaining lever" flagged above — applied the same
session, once explicitly asked to go ahead. `UI.renderIndicators()` (the
NAV/RAW full-icon layer) and `UI.renderSuppressedDots()` (the ND
range-selector's bare edge dots, same `#indicators-layer`) both did
`container.innerHTML = ""` + full rebuild every call — exactly the cost
pattern `EosMap.renderAirMarkers` was already rewritten to avoid for AIR
mode (see "Architecture map"), just never applied to NAV/RAW's own
indicators, which are the more DOM-heavy of the two (label decluttering's
`getBoundingClientRect()` reads/writes on top).

Reworked both to diff by hex against two new module-level caches
(`_indicatorEls`, `_suppressedDotEls` — kept separate, not one map, since
a hex can move between "full indicator" and "suppressed dot" tiers
between renders as the range selector changes, and needs a fresh element
of the new type rather than the old one mutated to look like the other).
A reused element gets its position/inner shape+label markup refreshed in
place (those genuinely do change most ticks) and keeps its original click
listener — the listener reads a mutable `el._clickState` box for the
current `ind`/`onClickFn` rather than a stale closure, so it never needs
rebinding, same pattern `EosMap.renderAirMarkers`' `entry` object already
uses. Aircraft no longer present get `.remove()`d and dropped from the
map; new ones get created and appended, same as before.

**A real ordering bug caught before shipping, not just assumed away:**
`declutterRenderedIndicators()` reads `.indicator` elements back out via
`container.querySelectorAll()` and relies on THAT DOM order matching
`indicators`' own priority order (a higher-priority aircraft's label
claims its preferred candidate first — see that function's own doc
comment). The original full-rebuild-every-tick approach got this for
free, since elements were always re-appended in array order. A first diff
draft only appended NEW elements, leaving reused ones parked at whatever
DOM position they were first created at — meaning a reused aircraft's
priority rank could silently drift out of sync with its DOM position over
many ticks as other aircraft's relative priority changed around it,
feeding decluttering a stale processing order. Fixed by having every
element (reused or new) call `container.appendChild(el)` every render —
on a node that already has that same parent this just MOVES it to the
end rather than recreating it, so it stays cheap while keeping the
"DOM order == current priority order" guarantee intact by construction.

`clearIndicators()` (called on switching into AIR mode) now also clears
both caches alongside its existing `container.innerHTML = ""` — without
that, the maps would keep referencing now-detached nodes and the next
NAV/RAW render would try to reuse/reposition elements that were never
re-attached, instead of creating fresh ones.

Verified with a real Playwright/Chromium harness (this project's
established convention) driving the real `ui.js`/`aircraftSymbol.js`
against stubbed `ThemeManager`/`ColorblindMode`/`NavDisplayStyle`, across
two scripts: (1) element identity survives across ticks for an unchanged
aircraft (tagged with a custom property, confirmed still present — proof
of actual reuse, not just "looks the same"), positions update correctly
on reused elements, removed aircraft are actually removed from the DOM,
DOM order matches a reordered `indicators` array after the appendChild
fix, a click always dispatches the CURRENT tick's data rather than a
stale one captured at element-creation time, a full-indicator-to-
suppressed-dot tier swap leaves no stale element of the old type behind,
and `clearIndicators()` correctly forces fresh elements on the next
render rather than reusing stale references; (2) `declutterRenderedIndicators()`
runs cleanly across several diffed ticks with two overlapping-by-default
aircraft, `selectAircraft()`'s `.selected` class survives element reuse
without needing to be re-applied, and final label rects come out
genuinely non-overlapping. All checks passed.

## Sandbox environment notes

Outbound network is policy-filtered; blocked domains seen this session
include `api.airplanes.live`, `airplanes.live` (whole domain), `api.adsb.lol`,
`www.adsb.lol`, `aviationweather.gov`, `api.openrouteservice.org`,
`vectair.github.io` (the deployed site itself). `registry.npmjs.org` and
`github.com` are allowlisted — use npm installs and GitHub-hosted docs/READMEs
as primary sources when a service's own domain is blocked; `WebSearch`
sometimes surfaces content `WebFetch` can't reach directly, but treat its
summaries as secondhand, not verified quotes, and say so when passing that
info along.

## Label decluttering: 8-point candidates + leader-line backup (2026-08-21)

Two real-device screenshots (Hybrid and RAW) showed the same gap the
angle-only rework above didn't close: a label sitting on top of a
*different* aircraft's icon or direction arrow. Root cause: that version
only ever checked a candidate label position against OTHER LABELS — icons
and arrows were never in its obstacle set at all, so a label had no way
to "see" it was covering someone else's traffic symbol.

**A deliberate, agreed departure from real TCAS/ND convention.** A real
TCAS doesn't fight to keep every tag legible — its job is collision
avoidance, and overlapping traffic reads as "these are close together,"
which is itself useful information. VCAS's core purpose is different:
per the project owner, "this app is about identification of aircraft, not
avoiding... for the label information the point is knowing what it is I
can see out the window" — a label you can't read, or can't confidently
match to the right icon, fails that job outright, in a way overlapping
*icons* (still kept, deliberately, from the earlier session's fix) don't.
Justified on safety grounds too: someone will spend far longer parsing a
crowded, ambiguous cluster of labels than a properly separated one — time
much better not spent staring at the screen while driving.

**Design, modelled on real prior art rather than invented from scratch** —
the "point-feature label placement" problem in cartography (NP-hard in
general; real systems score a small set of discrete candidate positions
around each point rather than searching continuously):

- `_LABEL_CANDIDATE_ANGLES_DEG = [0, 45, -45, 90, -90, 135, -135, 180]`
  (ui.js) — 8 compass-direction offsets around each icon, at a fixed
  `_LABEL_RADIUS_PX` (24). Straight down (0°, the old default) is tried
  first, so an aircraft with nothing to avoid doesn't move for no reason.
- Processed in the SAME priority order `Indicators.build()`/
  `renderIndicators()` already used — a higher-priority aircraft's label
  claims its preferred candidate first; already-placed labels become
  obstacles for whoever's processed next, rather than every aircraft
  fighting over the same spot simultaneously.
- Obstacle set per candidate check: every OTHER aircraft's icon+arrow
  bundle (`.indicator-shape`'s own `getBoundingClientRect()`, which
  already encloses the arrow even though it visually overflows the
  shape's own layout box), every suppressed range-selector edge dot, and
  every already-placed label — explicitly EXCLUDING the aircraft's own
  icon, which a label is supposed to sit close against (that's the
  "attached tag" look) and must not be penalised for.
- **Real bug caught by the isolated-aircraft test case specifically**:
  the very first version forgot that exclusion and included every
  aircraft's own icon in its own obstacle set — since the default 24px
  radius doesn't fully clear icon-radius + label-half-height, this made
  even a SINGLE aircraft with nothing else on screen register a false
  self-overlap and escalate straight to a leader line, on every single
  render. Caught immediately by testing "one aircraft, alone" as its own
  case, not just crowded clusters — the same discipline as the earlier
  "verify against the specific property, not just the reported symptom"
  lesson elsewhere in this file, applied prophylactically this time
  instead of after shipping.

**Leader-line backup tier**, for when even the best of the 8 candidates
still overlaps something: keep that candidate's angle (don't restart the
search) and escalate radius in `_LEADER_STEP_PX` (18px) steps, up to
`_MAX_LEADER_STEPS` (5), stopping the moment it clears; a thin
`.indicator-leader` div (1px, the label's own border colour, `opacity:.55`)
is drawn from the icon to the label only for aircraft that actually needed
this tier, so the association stays obvious once the label is no longer
tucked right up against its icon. A fixed radius has a hard ceiling — in a
genuinely dense cluster, no angle around a small fixed circle avoids every
neighbour — so this tier exists specifically to keep the "zero remaining
overlap" guarantee even there, rather than accepting overlap once the
8-point tier runs out of room.

Verified with a real Playwright/Chromium render across four scenarios: an
isolated aircraft (confirms no leader line, default position, after the
self-overlap bug above was fixed), two aircraft 100px apart and a
moderate 3-aircraft cluster ~80px apart (both resolve via the 8-point
tier alone, no leader lines), and a dense 5-aircraft cluster packed
within ~30px of each other (escalates to leader lines for all 5) — in
every case, exhaustively checked ALL pairwise label-vs-label AND
label-vs-other-icon overlaps in the actual rendered DOM: zero remaining,
including in the dense case, and every icon's own rendered centre still
matched its true plotted point exactly.

## Compass "won't settle / settles wrong" while stationary (2026-08-22)

Reported directly: standing still holding the phone, the heading doesn't
settle or settles pointing the wrong way — "when mobile the compass works
much better," which pins this squarely on `compassHeading.js` (the
device-orientation fallback, only ever consulted below
`CONFIG.GPS_HEADING_MIN_SPEED_MPH`/5mph; GPS course takes over entirely
once actually moving, and that path wasn't reported as a problem).

**A real sandbox limitation, stated plainly rather than glossed over**:
unlike the MapLibre geometry bugs earlier in this session, a real
magnetometer/device-orientation reading can't be produced in this
environment at all — there's no hardware here, and no way to fabricate a
physically-meaningful compass value the way a locally-installed MapLibre
instance could be driven with synthetic map state. What COULD still be
verified without a device: the base alpha→heading conversion's
correctness against the actual W3C DeviceOrientation spec (a documentation/
math question, not a hardware one), and the event-handling/smoothing
LOGIC itself, by dispatching synthetic `deviceorientationabsolute`/
`deviceorientation` events with controlled `alpha`/`absolute` properties
at a real Chromium instance via Playwright — this doesn't prove the
compass points the right way on a real phone, but it does prove the code
around the sensor reading is doing what it claims to.

**Finding 1 — re-derived the `360 - alpha` conversion from the spec's own
coordinate frame definition, not just re-asserted it.** Per spec, `alpha`
is a rotation of the device frame around Z (right-hand rule, Z pointing
out of the screen) relative to Earth's frame; alpha=0 means the device's
own "up" edge points at north, and — by the right-hand rule with Z
pointing up — a positive alpha rotation is counter-clockwise as seen from
above, i.e. alpha INCREASES as the device turns toward west. A compass
heading increases turning the OTHER way (toward east). `360 - alpha` is
exactly the flip needed to convert one rotational sense to the other
while keeping the same zero-point. Verified via Playwright: alpha=0 →
heading=0, alpha=90 → heading=270, both matching this derivation exactly.
**This part was NOT the bug** — it checks out independent of any real
device. (The screen-rotation correction two lines below it in the same
function remains genuinely unverified against real hardware — matters
for landscape/dash-mounted use, not this stationary-portrait report.)

**Finding 2 — the actual fix, a real gap**: `_extractHeadingDeg()` never
checked `event.absolute` before trusting a generic `alpha` reading as a
compass heading. Per spec, a NON-absolute `deviceorientation` event's
alpha can be relative to an arbitrary reference (e.g. wherever the device
happened to be pointing when listening started) with NO fixed
relationship to true/magnetic north at all — a documented real-world
gotcha with this API. The dedicated `deviceorientationabsolute` event
always fires with `absolute:true` by construction, so this only actually
matters on the fallback path (plain `"deviceorientation"`, used when a
browser doesn't support the dedicated absolute event) — exactly the
scenario where silently treating a non-earth-referenced alpha as ground
truth would produce a heading that's consistently, but essentially
arbitrarily, wrong. Fixed by requiring `event.absolute === true` before
the alpha branch runs at all (the `webkitCompassHeading`/iOS branch is
inherently absolute and needs no such guard). Verified: a synthetic event
with `absolute:false` now produces zero callback invocations — the
reading is rejected outright, not just ignored downstream.

**Finding 3 — heavier smoothing for stationary noise**: `SMOOTH_FACTOR`
lowered from 0.25 to 0.1. Justified specifically because this module is
ONLY ever consulted in the stationary/slow regime — there's no competing
"must track a fast real turn" responsiveness need the way GPS heading
smoothing has (see `GPS_HEADING_SMOOTH_FACTOR`, deliberately left
untouched), so it's safe to lean hard toward stability. Real magnetometer
noise/interference (nearby metal, electronics — common exactly in the
stationary-indoor-testing scenario this was reported against) is the
likely dominant source of visible "won't settle" jitter that no amount of
correct math alone fixes; heavier damping is the direct mitigation.
Verified via Playwright: after converging to a steady reading, a single
90°-different sample now only nudges the smoothed estimate by ~6°
(vector-EMA math, not a naive linear 9° estimate) instead of snapping
toward it — confirms a single noisy/outlier sample can no longer dominate
one update the way it could at the old factor.

**Status: needs real-device field re-test**, honestly — Findings 2 and 3
are well-reasoned and verified at the logic level, but neither can be
confirmed to actually resolve the reported symptom without the project
owner testing on their own phone again. If it's still wrong after this,
the next things to check in order: (a) whether the fallback event name
resolves to `deviceorientationabsolute` or plain `deviceorientation` on
their specific device (the `event.absolute` guard would then be rejecting
ALL readings on that device if it never fires with `absolute:true`,
which would look like "heading never updates at all" rather than "wrong
direction" — a different, distinguishable symptom worth asking about
specifically); (b) the still-unverified screen-rotation correction, if
they're testing landscape/mounted rather than handheld portrait; (c)
magnetic declination (a few to +15-20° regional offset from true north,
never corrected anywhere in this codebase) if the error is a small,
consistent rotation rather than a wild one.

### Follow-up: it was (a) — the `event.absolute` guard itself (2026-08-24)

Reported back: "it feels like it keeps settling on an approximate
northerly heading even when I'm facing east/west." This is a
distinguishable symptom from the original report, and it's exactly what
hypothesis (a) above predicted — `userHeading` (`app.js`) initialises to
`0` (north) and only ever changes inside `onCompassHeading()`, which only
ever fires from `CompassHeading`'s own internal callback. If
`_extractHeadingDeg()` is rejecting every single reading, the displayed
heading never moves from that `0°` default at all, REGARDLESS of which
way the phone is actually facing — not a compass that's biased-but-
responsive (which is what declination or a screen-rotation sign error
would look like: still swinging as you turn, just consistently offset),
but one that's frozen. That distinction is what pointed at (a) rather
than (b) or (c).

**Root cause**: the 2026-08-22 fix's own `event.absolute === true` check
was correct per spec but too strict against real-world implementations.
The W3C spec says the dedicated `deviceorientationabsolute` event always
carries `absolute:true` "by construction" — but real Android browser
implementations have been inconsistent about actually setting that
property even on that specific event, a documented category of API
fragmentation this module already works around elsewhere (iOS's
non-standard `webkitCompassHeading`, the fallback event name itself).
Requiring the PROPERTY as well as the event TYPE meant a device that
fires `deviceorientationabsolute` but leaves `absolute` `false`/`undefined`
was silently starved of every reading — exactly reproducing "stuck near
the 0° default."

**Fix**: `_extractHeadingDeg()` now trusts alpha as earth-referenced when
EITHER `event.absolute === true` OR the module is listening via the
dedicated `deviceorientationabsolute` event name (`_eventName`, already
tracked internally) — the event type itself is treated as sufficient,
independent evidence, per what the spec actually guarantees about that
event. The plain `"deviceorientation"` fallback path (the one place the
original 2026-08-22 fix was correctly guarding against a real, documented
gotcha — a non-absolute event's alpha having no fixed relationship to
north at all) still requires `event.absolute === true` explicitly, since
the event type alone proves nothing there. Not a reversal of the earlier
fix, a narrowing of it to where the risk it was guarding against actually
exists.

Verified with a real Chromium/Playwright harness dispatching synthetic
events at the actual `compassHeading.js` (not a retyped copy), covering
exactly the regression risk on both sides:
- `deviceorientationabsolute` event with `absolute:false` → now accepted
  (previously silently dropped) — the specific real-world quirk this fix
  targets.
- Same event type with `absolute` genuinely `undefined` (not just
  `false`) → also accepted, since some implementations may omit the
  property entirely rather than set it false.
- A well-formed absolute reading (`alpha:90, absolute:true`) still
  produces the mathematically correct heading (270°, matching the
  already-verified `360-alpha` conversion) — the fix didn't touch the
  math, only the gate.
- The plain `"deviceorientation"` fallback path, forced by deleting the
  `ondeviceorientationabsolute` feature-detection property before
  `start()` runs (matching real iOS Safari, which has no
  `deviceorientationabsolute` support at all): `absolute:false` is still
  correctly REJECTED (zero regressions on the original 2026-08-22 fix's
  own guarantee) and `absolute:true` is still correctly accepted.
- iOS's `webkitCompassHeading` branch unaffected either way.

**Still status: needs real-device field re-test**, same honest caveat as
before — this sandbox has no way to produce a real magnetometer reading,
so this confirms the CODE now does what it's supposed to given the
inputs a real buggy device is suspected to send, not that it's confirmed
fixed on the project owner's actual phone. If it's STILL wrong after
this, (b) the screen-rotation correction and (c) magnetic declination
remain the next things to check, in that order, per the original
follow-up list above — now with (a) addressed rather than still open.

## Navigation-side status check (2026-08-22)

Direct question: "where are we with the navigation side of things?" —
prompted by remembering VCAS has two co-equal pillars (navigation and
identification, see top of this file) and wanting a status read on the
less-recently-touched one, since most of this session's work has been
identification/RAW-mode/chrome-focused. Read through
`requestRouteTo`/`_showRouteCard`/`_updateGuidanceCard` (app.js),
`orsProvider.js`, `maneuverTracker.js`, and `routeGeometry.js` fresh
rather than going off memory, since a real code read is what actually
found the two gaps below — neither was previously written down anywhere.

**Working, not just "built":** destination search (name/address via ORS
geocoding, debounced, position-biased) and tap-the-map, both landing on
the same `requestRouteTo()`; a real 3-layer glow/line/highlight route
polyline; the turn-by-turn guidance card reading ORS's own real
instruction text/street names via `ManeuverTracker.nextManeuver()`, with
a genuinely live distance-to-next-maneuver countdown
(`RouteGeometry.distanceToIndex()` against the user's actual snapped
position, not ORS's static per-step distance); and a real camera state
machine (`NavigationCameraEvaluator`) that follows the actual route
polyline through curves, not straight-line heading.

**Two real gaps found by reading the code, not previously documented:**

1. **No off-route detection or rerouting.** `RouteGeometry.nearestOnLine()`
   always snaps to the nearest point on the ORIGINAL route polyline
   regardless of how far the user actually is from it — there's no
   deviation check anywhere in `app.js`, so straying off the planned route
   leaves every downstream consumer (route line, guidance-card instruction,
   distance-to-maneuver) silently referencing a route the user may no
   longer be on. No automatic recovery; the only "fix" today is manually
   clearing and re-requesting the route. A real feature to build, not a
   quick fix — noted here so it isn't rediscovered from scratch, not
   attempted this session.
2. **Route card ETA/distance/arrival-clock don't count down.**
   `_showRouteCard()` (app.js) writes `route-dist-text`/`route-eta-text`/
   `route-eta-arrival` exactly once, right when the route is first
   calculated, straight from `activeRoute.distanceMeters`/`durationSeconds`
   — the route's full-trip totals from request time. Unlike the guidance
   card's own live per-maneuver countdown, these three numbers are frozen
   for the whole journey. **Fixed the same session, see the follow-up
   entry immediately below** — this bullet describes the bug that
   prompted it.

Both written into README's "Known Limitations" section immediately, per
this file's own repeated lesson about durable memory — a fresh finding
that only exists in conversation history is exactly the kind of thing
that gets silently re-discovered later otherwise.

### Follow-up: live-updating route card (2026-08-22, same day)

Fixed gap #2 above. New `_updateRouteCard()` (app.js) replaces
`_showRouteCard()`'s one-time DOM writes: recomputes remaining distance
via `RouteGeometry.nearestOnLine()` + `RouteGeometry.distanceToIndex()`
against the user's current position and the route's own final coordinate
index (`coords.length - 1`) — the exact same snapping primitives
`ManeuverTracker.nextManeuver()` already uses for the guidance card's
live countdown, not a separately-invented calculation. Remaining duration
is derived by scaling the route's own ORS-declared total duration by the
remaining-distance fraction (`totalDuration * (remainingDistance /
totalDistance)`) rather than summing per-step durations — deliberately
simpler and more robust: it works even when `activeRoute.steps` is empty
(a real, already-documented possibility — see `orsProvider.js`'s own
comment on unexpected response shapes), and ORS's declared total duration
already reflects that route's real mix of road-type speeds, which a
live-GPS-speed-based estimate would not (traffic lights/turns make
instantaneous speed too noisy for a stable countdown). Arrival clock
re-derives from `Date.now() + remainingDurationSeconds*1000` each call,
same formula as before, just fed a live remaining duration instead of the
static total.

Called from the same place `_updateGuidanceCard()` already runs —
`refreshIndicators()`, itself triggered by every GPS fix and the 500ms
extrapolation tick (see "Power efficiency pass" above) — rather than a
new timer. This is deliberately consistent with that pass's own
established principle (don't add an uncoordinated third trigger to an
already-multi-triggered pipeline) and cheap enough not to matter: three
`textContent` writes on leaf DOM nodes, nothing like the indicator-layer
cost that pass was actually built to address. `_showRouteCard()` itself
now just unhides the card and calls `_updateRouteCard()` once for the
initial paint, same function either way — no separate "first paint"
formula to keep in sync with the live one.

Scoped to NAV mode only, matching the guidance card's own existing
`mode !== "nav"` gate — `refreshIndicators()` is never called in AIR mode,
so the route card's countdown simply stops advancing (not incorrectly
frozen-and-wrong, just paused) if the user checks AIR mode mid-route,
resuming correctly the moment they switch back. Not treated as a gap:
route/guidance state has always been a NAV-mode concept in this codebase.

Verified with a Node-level simulation requiring `routeGeometry.js`
directly (no DOM needed for the math itself): a straight 3-point route,
checking remaining distance at the start (~full total), midpoint (~half),
and near the end (small remainder) all matched hand-computed expectations,
and the proportional duration scaling tracked distance proportionally as
designed. README's "Route card ETA/distance don't count down live" bullet
removed now that it's fixed.

### Follow-up: off-route detection + rerouting (2026-08-22, same day)

Fixed gap #1 above too, same session, once explicitly asked to go ahead.
Two new `CONFIG` constants (`config.js`): `OFF_ROUTE_THRESHOLD_METERS`
(50) — a flat perpendicular-distance cutoff from the route polyline —
and `OFF_ROUTE_REROUTE_DELAY_SECONDS` (6) — how long the user has to stay
continuously beyond that threshold before a reroute actually fires, and
also (see below) the retry backoff on a failed reroute.

**Detection** (`_checkOffRoute()`, app.js): measures the user's REAL
perpendicular distance to the route — `RouteGeometry.nearestOnLine()` to
find the nearest point, then `Geo.calculateDistanceMeters()` for the
actual gap — deliberately a different question from what
`_updateRouteCard()`/`ManeuverTracker` already compute (distance-ALONG
the route from a snapped position, which always finds a nearest point
regardless of how far away it really is and says nothing about deviation
by itself). `_offRouteSinceMs` tracks when the user was FIRST found
beyond the threshold, reset to `null` the moment they're back within it —
a real deviation has to persist continuously for the full dwell delay,
not just accumulate on-and-off, before `_rerouteFromCurrentPosition()`
actually fires. Called from the same `refreshIndicators()` cadence
`_updateRouteCard()`/`_updateGuidanceCard()` already run on (every GPS fix
+ the 500ms tick) — not a new timer, consistent with the same principle
the power-efficiency pass and the ETA follow-up above both already
established for this function.

**Rerouting** (`_rerouteFromCurrentPosition()`, app.js): re-requests from
`OrsProvider` using the user's current position as the new start and
`routeDestLat`/`routeDestLon` — new module state, set once in
`requestRouteTo()` and left untouched by a reroute — as the still-unchanged
destination, so the user never has to re-pick anything. Two race
conditions handled deliberately, not assumed away:

- `_rerouteInFlight` guards against firing a second reroute request while
  one's already out (the dwell check re-runs on every tick, including
  while a slow request is still pending).
- `_routeRequestToken` (new module state, same pattern `_destSearchToken`
  already uses for the debounced destination search) guards against a
  STALE reroute response clobbering a route the user has since cleared or
  replaced with a different destination while the old request was still
  in flight — captured before the `await`, checked after; a mismatch means
  a newer request has superseded this one, so the stale result is
  discarded rather than applied.

A failed reroute (network hiccup, ORS error) doesn't retry on the very
next tick — it resets `_offRouteSinceMs` to "now," so `_checkOffRoute()`
only fires again once the same dwell delay has re-elapsed, avoiding
hammering ORS every ~500ms-1s while genuinely off-route and failing.

**UI feedback**: `_updateGuidanceCard()` shows "Rerouting…" (with a ↻
icon) whenever `_rerouteInFlight` is true, overwriting whatever the old
(now-wrong) instruction was for however long the request takes, rather
than leaving stale guidance on screen — reuses the guidance card's
existing DOM, no new UI element. Deliberately does NOT force
`navFollowSuspended = false` or recenter the camera the way the initial
`requestRouteTo()` does — a background reroute triggered mid-drive
shouldn't yank the camera out from under a driver who may have manually
panned away for a reason; only an explicit user action (picking a route)
earns that.

Verified with a Node simulation against the real `geo.js`/`routeGeometry.js`
(not just reasoned through): a point exactly on the route reads as
0m/on-route, a ~200m-offset point clearly exceeds the threshold, a small
~20m offset (GPS-noise-sized) correctly stays within it. The dwell-timer
state machine — reimplemented in the test to the exact same logic
`_checkOffRoute()` uses — was checked against three scenarios: continuous
deviation fires at exactly the dwell delay, a brief on-again-off-again
blip that never sustains the full delay never fires, and a deviation that
briefly returns on-route then goes off again correctly RESTARTS the dwell
timer from the second departure rather than accumulating time across the
on-route gap — all three matched hand-derived expectations exactly.

**Not yet done / explicitly flagged rather than assumed fine:** the 50m
threshold is a flat constant, not mode- or road-type-aware (see README's
Known Limitations) — untuned against real field data, same caveat this
file already carries for the driving-tuned camera speed thresholds. Also
untested against a live ORS response for the same sandbox-network-access
reason `ManeuverTracker`'s own steps parsing carries — worth confirming a
real reroute request/response round-trips correctly once deployed.

## Recurring: blank screen / zero interactivity on load — transient script failure, not a code bug (seen at least twice now)

Symptom, exact both times: map area completely blank (just the themed
background, no tiles/markers), bottom bar shows the raw static
placeholder text from `index.html` itself (`"No aircraft in range"` —
`UI.setAircraftCount()` never ran to overwrite it), ADS-B status pill
neutral/grey (never attempted a fetch), and **every button on screen is
dead** — mode toggle, settings gear, route pin, all unresponsive. HTML/CSS
render fine (they don't need JS); nothing underneath is alive.

**Root cause**: `index.html` loads 25+ separate `<script>` tags
synchronously with zero retry or error handling. If even one request
hiccups — plausible right after a fresh deploy while GitHub Pages' CDN is
still propagating, which is exactly when this has been reported both
times — a later script referencing that missing script's globals throws a
`ReferenceError` immediately, halting execution before `app.js`'s own
`init()` ever gets to wire up event listeners. Confirmed NOT a real code
regression each time by (1) a full syntax sweep across every touched file
and (2) tracing every renamed/new function reference back to a real call
site — both clean both times; a plain reload resolved it both times, which
is the actual signature of a load-order/network-timing issue, not a logic
bug.

**Not yet done, worth doing eventually**: the current mitigation is
"notice the exact symptom pattern, ask for a reload" — works, but this is
the second time it's happened and the underlying fragility (no error
handling on 25+ blocking synchronous script loads) is still unaddressed.
A real fix — bundling into fewer files, or at minimum wrapping the script
tags with load-error detection that shows a "reload" prompt instead of a
silently-dead UI — hasn't been scoped or requested yet. Flag rather than
silently re-diagnosing from scratch a third time if it recurs again.
The reload-prompt half (detection + visible banner) is now done — see
"Beta test milestone" above. The service worker added below (see
"App-shell service worker") also mitigates this from a different angle:
it doesn't reduce the NUMBER of script requests (the "bundling" idea
above, still not done), but on any load after the first, those ~30
requests are served from cache instead of hitting the network at all —
real hardening against the exact failure mode here, just not the same
fix as bundling would be.

- Don't guess at third-party API shapes — verify against real, current docs
  (GitHub READMEs are usually reachable even when the service's own domain
  isn't) before writing an integration.
- Verify UI/rendering fixes against a real instance of the actual library
  when the bug is subtle (projection math, CSS cascade/specificity) rather
  than reasoning it through — this session's real bugs were consistently
  more subtle than the first plausible-sounding hypothesis.
- When a fix touches something with a documented "why" comment already in
  the code, read and update that comment rather than leaving it stale next
  to changed behavior — several bugs this session were partly caused by
  code drifting away from what its own comments claimed.

## App-shell service worker (2026-08-23)

Prompted by a PWABuilder PWA-score screenshot the project owner shared
while working through the icon/launch-screen investigation above — VCAS
scored 17/45 with red flags on "Service Worker" (VCAS had none at all)
and "App Capabilities." Rather than chasing the score itself, walked
through what each flagged gap would actually buy the app and recommended
only the one with real value: an app-shell service worker. Explicitly
**not** pursued: offline "mode" (VCAS's core function is live GPS/ADS-B,
which can't work offline regardless), push notifications/background sync
(no real infra for it and nothing this glance-while-driving app should be
notifying about when closed), and manifest metadata fields like
`screenshots`/`categories`/`shortcuts`/`id` (only matter for a Play/
Microsoft Store listing, which isn't the current plan — see the top of
this file on the PWA-vs-native question). `share_target` (letting another
app share an address into VCAS as a destination) was flagged as a
genuinely interesting *feature* idea, but a new feature, not a scoring
fix — not built.

**What it actually does**: `sw.js` (repo root, so its default scope
covers everything under `/VCAS/`, matching the manifest's own `scope`)
caches the app shell — the ~30 local `<script>`/`<link>` tags plus the
document itself — using three different strategies depending on what's
actually safe to cache and for how long:
- **The document/navigation itself**: network-first, falling back to the
  last cached copy only if the network genuinely fails. It has no
  cache-busting query and must stay live on a normal connection.
- **Same-origin assets carrying the `?v=<build-id>` query** (every local
  script/stylesheet/manifest/icon link — stamped by `deploy-pages.yml`'s
  existing `sed` step) — cache-first, safe to keep forever: a new deploy
  is a new URL, automatically a cache miss. A same-path-different-`?v=`
  entry gets evicted the moment its replacement is cached, so old
  deploys' assets don't accumulate forever without needing a per-deploy
  cache-name bump or a real generation-tracking scheme — an accepted
  simplification given VCAS's actual scale (a handful of testers,
  roughly-daily deploys), not a hidden gap.
- **Third-party CDN assets** (MapLibre JS/CSS from jsdelivr, the B612/
  B612 Mono Google Fonts stylesheet) — stale-while-revalidate: serve
  instantly from cache if present, always refresh the cache in the
  background so a copy never gets pinned forever. These aren't versioned
  by URL at all (no `?v=` — jsdelivr's `@4` is a semver range, not an
  exact pin), so cache-first-forever would risk staleness the way it
  wouldn't for the build-id-stamped local assets.

**No install-time precache list, on purpose** — that would need this file
regenerated per deploy with an exact file manifest, real complexity for
what's meant to be a *minimal* shell cache. Entries populate lazily as the
app actually requests them, starting from the very first successful load.

**Real, direct benefit tied to an existing documented bug, not just a
generic "PWAs should have one" box-tick**: see "Recurring: blank screen /
zero interactivity on load" above — that bug is triggered by one of the
~30 synchronous script tags hiccuping on a fresh network fetch. Once
they're cached from a prior successful load, a flaky connection on a
later open has far less surface to fail on. This doesn't replace the
crash reporter/reload-prompt (still the right response to the bug WHEN it
happens) — it reduces how often the underlying network hiccup gets a
chance to trigger it in the first place.

**Registered from inside `app.js`'s `init()`, deliberately NOT as its own
`<script>` tag** (`_registerServiceWorker()`, called as the first line of
`init()`): the crash reporter's capture-phase listener (`index.html`)
shows the "VCAS didn't load correctly" reload banner for ANY failed
`<script>`/`<link>` load, unconditionally — adding a new script tag for
this would mean a failed *registration* (a pure enhancement miss, not an
app crash) could false-trigger that banner. Calling it as a plain function
from inside `init()` keeps registration failures out of that listener's
reach entirely; `.catch(() => {})` on the registration promise means a
failure here is silent by design, not surfaced as an error report either
— there is genuinely nothing actionable a tester could do about it, unlike
the failures the crash reporter exists to catch. Registered with
`updateViaCache: "none"` so the browser always fetches `sw.js` itself
fresh (bypassing any GitHub Pages CDN caching) when checking for updates,
matching the project's existing "always get the freshest deploy"
philosophy already established via the no-cache meta tags and build-id
query strings elsewhere.

**Verified two ways**, since this sandbox's network reachability to
third-party domains is inconsistent run-to-run (a direct `fetch()` to
`fonts.googleapis.com` failed outright mid-session — a sandbox limitation
per "Sandbox environment notes" below, not a bug in the caching logic):
1. **Real Chromium via Playwright**, browser HTTP cache explicitly
   disabled via CDP (`Network.setCacheDisabled`) so any cache hit could
   only be coming from the service worker's own Cache Storage, not the
   browser's ordinary disk cache masking the result. Confirmed: the very
   first page load can't be intercepted by a service worker that doesn't
   exist yet when those requests fire (expected — registration happens
   near the end of `init()`, after every other script already loaded via
   plain network); a SECOND real navigation, with the worker now active
   and having called `clients.claim()`, populates the cache with all ~30
   local assets plus the navigation document itself; going fully offline
   after that and reloading still returns a real 200 and reaches
   `_vcasAppReady` correctly — genuinely served from the service worker,
   confirmed by the disabled browser cache eliminating the other
   explanation.
2. **A Node-level unit pass** against the real `sw.js` source (loaded via
   `vm.runInContext`, not a retyped copy) with a mocked `caches`/`fetch`,
   specifically to cover the third-party stale-while-revalidate path this
   sandbox's own flaky reachability couldn't verify live: cache-first
   miss-then-hit with no re-fetch on a hit; the same-path eviction on a
   new `?v=`; network-first serving fresh on success, falling back to a
   cached copy on failure, and correctly re-throwing when neither network
   nor cache have anything; and stale-while-revalidate serving the
   EXISTING cached body instantly on a hit while a background fetch still
   fires and updates the cache for next time (confirmed by checking a
   subsequent request got the newer body). All passed against the actual
   shipped file.

## First-launch onboarding screen (2026-08-23)

Direct request: a quick explanation of how to use the app and the
symbology, shown when the app is first opened after being installed —
distinct from both the ADS-B credit line (ongoing, every session, top
bar) and the launch screen above (hero moment, every cold start). This
is a THIRD thing, shown exactly once ever, per install.

**Trigger and gating**: `app.js`'s `_maybeShowOnboarding()` checks a
versioned localStorage flag, `vcas-onboarding-seen-v1` — versioned (not
just a bare boolean) so a future symbology/UI change that genuinely
warrants re-showing it can bump the key deliberately, without needing a
real migration. Called right where the launch screen's fade-out already
starts, not after a separate delay: `#onboarding-screen` sits at a normal
app z-index (250, same family as `#settings-screen`), far below the
splash's `2147483000`, so it's already present underneath but visually
hidden by the splash — it simply becomes visible the instant the splash
finishes its 300ms fade and removes itself. Two overlays, one clean
handoff, no timer coordinating them.

**Deliberately built as a normal app overlay, not inline-styled like the
splash/crash-reporter.** Those two exist specifically to survive VCAS.css
or app.js failing to load — this one only ever shows from inside a
successfully-completed `init()`, by which point everything has already
loaded fine, so there's no reason to duplicate that self-contained
pattern here. Styled via real `VCAS.css` classes (`#onboarding-screen` /
`.onboarding-*`) using the same custom-property palette (`--bg-panel`,
`--accent`, `--btn-shadow`, etc.) as `#settings-screen`, so it reads as
the same physical app rather than a bolted-on separate design.

**The legend is generated from the app's real code, not hand-copied
approximations** — a direct instruction was "a quick explanation of...
the symbology," and the fastest way for that to silently go stale is to
retype the four tiers' shapes/colours/labels as static markup that then
drifts from `src/logic/visibility.js`'s actual `CATEGORIES` table the
next time someone tunes it. Instead, `Visibility` gained a small new
export, `getCategories()` (a shallow copy of the real table, read-only,
touching nothing about `estimate()`'s scoring logic), and
`_renderOnboardingLegend()` (`app.js`) builds each legend row by calling
the exact same `AircraftSymbol.svg()` function every real indicator/
marker on screen already uses — same shape paths, same fill-opacity
steps, same colour values. If the real tier colours or shapes ever
change, this legend changes with them automatically; it structurally
cannot drift the way a hand-copied legend would. Plain-language one-line
descriptions per tier (`ONBOARDING_LEGEND_COPY`, keyed by the same
`label` string the popup badges already show) are the one piece of
display-only copy that isn't pulled from existing code — deliberately
non-technical (no angular-degree thresholds), matching the Beta test
milestone's own framing that testers are "non-technical friends, not
developers."

**Content scope, kept deliberately short per "quick explanation"**: the
three view modes (Hybrid/Raw/Air) in one line each, how to set a
destination (search or tap-the-map), tap-for-detail on any aircraft, the
four-tier sightability legend with real icons, and a one-line note on the
two symbol modifiers (dashed = predicted entry, chevron = overhead) —
matching `AircraftSymbol.js`'s own documented secondary-modifier scheme
rather than inventing new wording for it. Deliberately does NOT re-explain
range rings, the RAW range selector, the Stage 3 aircraft list, or
relevance filtering — real features, but a first-launch primer covering
every mechanic in this file would stop being "quick."

**Verified with a real Playwright/Chromium render** against the actual
`index.html`/`app.js`/`VCAS.css` (not extracted markup, since — unlike
the splash — this only ever runs after a real successful `init()`, so
there's no self-containment reason to test it in isolation): a fresh
context with empty localStorage shows the onboarding screen after
`_vcasAppReady`, with all 4 legend rows rendering real `<svg>` icons and
the correct labels; a context pre-seeded with the seen-flag does NOT show
it on a repeat launch; tapping "Got it — let's go" hides the screen and
persists the flag; a narrow 360×640 viewport (this project's standing
worst-case check) shows no horizontal overflow, the footer CTA stays
fully on-screen, and the body content scrolls independently rather than
being clipped. Also screenshotted in both Day and Night (Night forced
manually post-load, since `ThemeManager`'s Auto mode resolves by local
time-of-day, not `prefers-color-scheme` — confirmed by reading
`themeManager.js`, not assumed, after an initial screenshot came back
unexpectedly light and needed explaining) — legible and correctly
themed in both, reading as the same panel family as Settings.

## LOG button overlap + top-of-screen consolidation, RAW as default (2026-08-24)

Reported directly, from a real device screenshot: the LOG button
(`src/dev/logPanel.js`) sat fixed at bottom-left and obscured the RAW
aircraft-list panel's own rows when they appeared. Root cause: LOG's
fixed `bottom:14px; left:14px` position was never coordinated with
`Geo.computeSquarePlotLayout()`'s `rows` region, which in portrait fills
the space below the square and — being genuinely "whatever's left,"
not a fixed height — can reach down far enough to land right where LOG
was floating. Same category of bug as the rings-vs-dots coordinate-system
mismatch earlier in this file: two independently-positioned things that
happened to share screen real estate with nothing keeping them apart.

**Fix, not a patch on the old position — moved LOG's toggle into the
real, persistent top bar** (`#top-bar-right`, between the ADS-B status
column and the settings gear) instead of giving it a new fixed-position
formula of its own to keep in sync. This is a structural fix, not a
coordinate tweak: `#log-panel`'s old wrapper div is gone entirely, and
`#lp-toggle` is now a normal flex child of `#top-bar-right`, so its
position is correct by construction in every mode, with nothing to drift.
Only the expanded `#lp-menu` (too big to live inline in the bar) is still
`position:fixed`, anchored below the top bar. **Confirmed via Playwright
that this actually fixes the overlap**, not just moved it somewhere that
looked plausible: the `#raw-aircraft-list` panel now renders with nothing
else drawn over its top-left corner, at the exact device size (412×915)
the original report came from.

**LOG's own explicit context, worth restating since it's easy to assume
otherwise**: `LogPanel.init()` runs unconditionally in `init()`, NOT
gated behind `DevMode.isEnabled()` the way VIEW/SPD are — it's the
spottability-logging tool every tester uses (see "Central observation
log" above), not a hidden developer-only panel. This bug was affecting
every tester's actual screen, not just the project owner's dev-mode
device.

**The RAW range-selector button also moved**, same session, per direct
request to consolidate LOG, the range button, and the SPD readout nearer
the top rather than scattered across the screen: `UI.renderRangeSelector`'s
Y coordinate changed from `square.squareTop + 8` (the square plot's own
top-right corner, well down the screen) to `insets.chromeTopInset + 48` —
the same row `ui.js`'s own `stripY` formula already places the compass
tape's SPD text on. X is unchanged (still anchored to the square's own
right edge, which is already correct in both portrait and landscape).
**Not pixel-identical to LOG's new top-bar position** — LOG sits in the
literal top bar row, range/speed sit just below it, still RAW's own
chrome — but Playwright confirmed both are now genuinely consolidated
near the top with clear visual grouping, not the top bar and a stray
button 500px further down the screen.

**Default RAW range is now 10nm**, not the widest (50nm) — direct
instruction. `app.js`'s `selectedRangeIndex` now computed via
`Indicators.RING_BANDS_NM.indexOf(10)` rather than a hardcoded index, so
it can't silently point at the wrong band if `RING_BANDS_NM`'s own values
ever change.

**RAW is now the default NAV display style, not Hybrid** — direct
instruction, `navDisplayStyle.js`'s `_style` default flipped from
`HYBRID` to `RAW` (only affects a fresh install with no stored
preference; anyone who's already touched the toggle keeps their own
choice, same as any other localStorage-backed preference in this app).
**The three main-screen buttons were also reordered** (`index.html`) from
HYBRID/RAW/AIR to **RAW/AIR/HYBRID**, matching the new default — the
`active-mode` class moved to the RAW button in the static HTML too, so
there's no flash of the wrong button highlighted before JS corrects it
on load. The onboarding screen's own "Three views" section (added
2026-08-23) was updated to match both the new order and the "Your
default view" callout, which had been sitting on HYBRID's row — and
gained a line mentioning the range-readout tap-to-cycle interaction,
which the onboarding content never covered before.

Verified with a real Playwright/Chromium render (mocked GPS fix so RAW's
full render path actually runs, not just a cold load): confirms
`document.body.dataset.navStyle === "raw"` on a fresh session, the mode
button DOM order is `[btn-raw, btn-air, btn-hybrid]` with `active-mode`
on `btn-raw`, the range button reads "10NM" on first render, the old
`#log-panel` wrapper element no longer exists, `#lp-toggle` is a real
child of `#top-bar-right`, and the onboarding legend/copy reflects the
new order and mentions range-cycling. Also screenshotted with the LOG
menu open and closed to confirm no visual collision with the aircraft
list panel below it.

## Labels obscuring their own direction arrow (2026-08-24)

Reported directly from a real device screenshot, same day as the LOG
overlap report above: several aircraft labels visibly covered part of
their own direction-of-travel arrow — a real, previously-undetected gap
in the label decluttering system documented at length earlier in this
file. Distinct from every earlier decluttering bug (icon+arrow moving
together, labels covering OTHER aircraft's icons, an isolated aircraft
falsely registering self-overlap) — this one is specifically about an
aircraft's own arrow.

**Root cause, found by re-reading `declutterRenderedIndicators()`'s own
obstacle-gathering code**: it treated `.indicator-shape` — the icon AND
its direction arrow together — as ONE combined obstacle, entirely exempt
from an aircraft's own label check ("a label is SUPPOSED to sit close
against its own icon," per that function's own long-standing comment).
That exemption is correct for the icon — the "attached tag" look
genuinely wants the label right next to it — but was never actually
correct for the arrow, which carries its own real glanceable information
(which way that aircraft is heading) that a label sitting on top of it
straightforwardly defeats. The exemption was just never split from the
icon's own exemption, since the original decluttering work only ever
tested against OTHER aircraft's icons/arrows and other labels, not this
specific "own arrow" case.

**Fix**: `renderIndicators()` (`ui.js`) now wraps the icon SVG in its own
`.indicator-icon` element, separate from the sibling `.direction-arrow`
it was already rendered alongside inside `.indicator-shape`.
`declutterRenderedIndicators()`'s obstacle set now tracks icon and arrow
as two independent obstacles per aircraft, and only the icon carries the
self-exemption (`ownIconExemption: true`) — the arrow is a real obstacle
for every label's placement check, including that same aircraft's own.
Every other aircraft's icon and arrow remain full obstacles either way,
exempt or not, unchanged from before.

Verified with a real Playwright/Chromium harness (this project's
established convention for this exact class of bug) driving the actual
`ui.js`/`aircraftSymbol.js` against stubbed `ThemeManager`/`ColorblindMode`/
`NavDisplayStyle`: a single isolated aircraft with its track pointing
its arrow directly into the label's own default position (the literal
reported scenario) now shows zero overlap between the label and its own
arrow, where the same setup reproduced the bug before the fix; a dense
5-aircraft cluster with varied tracks (modelled on the real screenshot's
layout) was exhaustively checked pairwise — every label against every
arrow (own and others'), every label against every other aircraft's
icon, and every label against every other label — zero violations found.
Icons stayed exactly at their true plotted points throughout, confirming
the fix only changed the obstacle SET, not the icon-never-moves guarantee
every earlier decluttering fix in this file already established.

## LOG button gated to stationary/walking speed (2026-08-24)

Direct instruction, same session as the overlap fix above: the LOG
button should only be interactive at or below `CONFIG.
GPS_HEADING_MIN_SPEED_MPH` (5mph) — a distraction/safety measure, since
logging an observation means reading a list and tapping a specific
outcome button, real sustained screen attention this app shouldn't
invite while actually driving. Reuses that existing config constant
rather than a second, separately-tuned threshold — same "stationary or
walking" cutoff this app already applies elsewhere (GPS heading
trust/compass listener), not a new number to keep in sync with it by
hand.

`LogPanel.setSpeedMph()` (new) is called from `app.js`'s
`applySpeedOverrideIfActive()` — the one place both the real GPS path
(`onGpsSuccess`) and the dev speed override (`onSpeedSimChanged`, SPD
panel) already converge on a final effective `userSpeedMph`, so both
stay in sync from a single call site rather than two that could drift.
Above the threshold, the toggle gets a dimmed, `cursor:not-allowed`
`.lp-toggle-disabled` state (reads as "temporarily unavailable," not
broken or gone) and its click handler no-ops; **at or below** the
threshold it's fully interactive again, immediately. If the panel is
already open when speed crosses the threshold, it force-closes rather
than waiting for a manual close — that manual tap is exactly the
distracting interaction this exists to prevent, so it can't be the only
way out once moving.

Verified with a real Playwright harness driving the actual `logPanel.js`
against real `config.js`: stationary (0mph) is interactive and a click
opens the menu; moving (30mph) is visually disabled AND force-closes an
already-open menu; a click while disabled does not reopen it; exactly at
the 5mph threshold is still interactive (`<=`, not `<`); just above it
(5.1mph) is disabled; slowing back down to 0mph restores full
interactivity immediately. All eight checks passed against the real,
shipped logic.

## LOG button row-alignment follow-up, tap-to-deselect, popup action gating (2026-08-24, later the same day)

Direct follow-up, from a real device screenshot hand-annotated with a
yellow circle around the SPD/range row and a red arrow at LOG's
top-bar position: "the log button is in the wrong spot. it should be on
the same row as speed and range (yellow circle area) / also can you
have it so that once a label is highlighted (like in the picture) of
you then tap on an empty area of the screen it removes the highlight. /
as a side note has the rule of logging vs 5mph been applied to the
options of the label is selected?" Three separate, concrete asks in one
message.

**1. LOG moved onto the literal SPD/range row, not just "near the
top."** The earlier same-day fix (see "LOG button overlap + top-of-
screen consolidation" above) moved LOG into `#top-bar-right` — this
correctly fixed the original overlap with the RAW aircraft-list panel,
but put LOG on ITS OWN row, separate from the RAW-only SPD/range
readouts one row below the bar. The screenshot showed exactly this: LOG
sitting in the persistent top bar while the user wanted it on the same
row as the circled SPD/range content. Reverted `#lp-toggle` back to
`position:fixed` (`VCAS.css`) and gave `LogPanel` a new
`setPosition(x, y)` export (`logPanel.js`) — `app.js`'s
`refreshIndicators()` now calls it in the exact same spot it already
positions the range selector (`insets.chromeTopInset + 48`, the same Y
`ui.js`'s own compass-tape SPD readout uses), left-aligned
(`square.squareLeft + 8`) to mirror the range button's own right
alignment — `[LOG] … SPD … [range]`, genuinely one row, not two
independently-computed positions that happen to look close. This
directly follows this file's own repeated lesson about two
independently-positioned things silently drifting apart (the rings-vs-
dots mismatch, the LOG-vs-aircraft-list overlap itself) — a single
shared Y value read by both call sites structurally prevents it here
rather than relying on two constants staying in sync by convention. The
expanded `#lp-menu` still opens just below the toggle's current
position (`setPosition`'s own `y + 36`), so it's unaffected by exactly
where on screen the row ends up.

**2. Tap-on-empty-area now clears the aircraft cross-highlight.**
`UI.selectAircraft(hex)` (see "Stage 3: sortable aircraft-list panel"
above) already applies/removes a `.selected` class bidirectionally
between an aircraft's plot icon and its list row, but had no path back
to "nothing selected" short of tapping a *different* aircraft — exactly
what the screenshot showed (a label still highlighted with nothing else
tapped). Fixed with a single module-level `document` click listener in
`ui.js`, registered once at load (selection state is itself module-level,
not per-render): any click NOT landing on `.indicator`, `.suppressed-
dot`, `.raw-list-row`, or `#popup` calls `selectAircraft(null)`.
`selectAircraft` already handled a `null` hex correctly (clears
`.selected` everywhere, since no real element's `dataset.hex` equals
`null`) — no changes needed there. Deliberately implemented via
`e.target.closest(...)` rather than adding `e.stopPropagation()` to the
three existing element click handlers (none of which call it today) —
touches one new listener instead of three existing ones, and avoids the
same tap that just SET a selection immediately undoing it via bubbling.
The popup is explicitly exempted too, so tapping its own buttons
doesn't clear the highlight underneath it mid-interaction.

**3. Popup log/suppress buttons were NOT covered by the 5mph gate —
now they are.** Direct question, answered by reading the code rather
than assuming: `showPopup()`/`_logButtonsHtml()`/`_wireLogButtons()`
and the Suppress button's own handler had no speed check at all — a
completely separate, previously-ungated interaction path from the main
LOG panel toggle, reachable by tapping any aircraft indicator instead
of the LOG button. Extended the same rationale (real screen attention
this app shouldn't invite while driving, "read a list and tap a
specific outcome button") to these buttons specifically, via a new
`UI.setSpeedMph(mph)` (mirroring `LogPanel.setSpeedMph`, deliberately
NOT sharing state with it — the two modules stay decoupled rather than
one importing the other, matching how the rest of the app is
structured) and a new `_actionsInteractive()` helper gating both the
initial render (`pop-action-disabled` class added conditionally in
`_logButtonsHtml()`/the Suppress button markup) and each button's click
handler (a no-op if now above the threshold, in case the popup was
opened while stationary and the vehicle started moving before a button
was tapped). **Deliberately does NOT gate the popup's existence or its
read-only info** (distance/altitude/bearing/vis badge) — glancing at
that is core identification functionality this app is FOR, not the
distraction risk being mitigated; only the buttons that record/suppress
something disable. `app.js`'s `applySpeedOverrideIfActive()` — the
single convergence point for both the real GPS path and the dev SPD
override, already feeding `LogPanel.setSpeedMph()` — now also calls
`UI.setSpeedMph()` alongside it, so an already-open popup's buttons
live-update the moment effective speed crosses the threshold, not just
on the next tap.

**Verification, and a real sandbox limitation worth recording honestly
rather than glossing over:** a full real-app Playwright run (mocked
geolocation + a mocked ADS-B relay response) confirmed fix #1 directly
— LOG and the range button both resolved to the same computed row
(`{"logTop":103,"rangeTop":103,"logLeft":8}`) — but could NOT exercise
fixes #2/#3 the same way: MapLibre's CDN script failed to load in that
run (`ERR_TUNNEL_CONNECTION_FAILED` against jsdelivr, confirmed via a
`pageerror` listener reporting `maplibregl is not defined`), so
`EosMap.init()` never completed and no aircraft indicator ever
rendered to click on — a sandbox connectivity issue, not a code
regression (reproduced identically on a retry). Per this project's own
established convention for exactly this situation (see "Testing
convention for MapLibre-related changes" above), pivoted to a
standalone harness loading the real `ui.js`/`aircraftSymbol.js`/
`config.js`/`observationLogger.js` against stubbed `ThemeManager`/
`ColorblindMode`/`NavDisplayStyle` (no MapLibre dependency at all) with
synthetic `.indicator`/`.raw-list-row` elements. All 8 scripted checks
passed against the real, shipped `ui.js`: click-to-select, popup-opens-
on-click, deselect-on-outside-tap, interactive-while-stationary,
disabled-while-moving-30mph, click-no-ops-while-disabled, still-
interactive-exactly-at-the-5mph-threshold, and interactivity restored
after slowing back down.

## "Double load screen" + background colour inconsistency — stale pre-rebrand hex values (2026-08-24)

Reported directly: "I'm now getting a strange double load screen. the
first one is just the VCAS logo which then disappears and it's replaced
by the acronym definition and the hero line. these should all be in the
same 1 screen. I also think there's some background colour inconsistency
where parts are black and parts are dark blue."

**Two screens is real, and only partly fixable from this codebase.** The
"logo only" screen is Android's own OS-generated auto-splash — rendered
from `manifest.json`'s icon + `background_color`, entirely before
`index.html` even starts parsing, with no subtitle/credit capability of
its own (already documented under "Follow-up: real launch/splash screen
added as a hero placement" above). The "acronym + hero line" screen is
VCAS's OWN in-page `#launch-screen` overlay, which only exists once the
HTML document itself parses — a few hundred ms to a couple of seconds
later depending on load speed. These are always going to be two
sequential screens; nothing in this repo can suppress or skip the OS
splash, and PWABuilder-generated packages have no source in this repo to
add subtitle text to it even if the timing could be collapsed.

**What WAS a real, fixable bug: the two screens' background colours never
matched, and neither matched the app's own real chrome colour.** Grepped
every hardcoded dark-splash-adjacent hex in the repo and found three
different values, none of them the actual current app colour:
- `manifest.json`'s `background_color`/`theme_color` — `#0a0e17`
- `index.html`'s `<meta name="theme-color">` and `#launch-screen`'s own
  inline `background` — both `#0a0e17`
- `app.js`'s `_applyThemeToDom()`, which live-updates that SAME meta tag
  on every theme change (not just at splash) — `#0a0e17` (night) /
  `#f5f3ee` (day)
- The ACTUAL app chrome background, `VCAS.css`'s `--bg-dark` custom
  property (the 2026-08-22 cockpit-rebrand palette — see "Cockpit-panel
  chrome rebrand" above) — `#12181c` (night) / `#d4dde2` (day)

All four splash/meta-tag values were still the PRE-rebrand navy-blue
(`#0a0e17`)/off-white (`#f5f3ee`) colours from before that rebrand ever
happened, never updated when `--bg-dark` was repalletted to the real
pixel-sampled cockpit-panel colour. This is exactly the "two
independently-set values silently drift apart" bug class this file
already warns about repeatedly (the rings-vs-dots mismatch, the
LOG-vs-aircraft-list overlap, several others above) — just with plain
hex literals instead of computed layout, and going unnoticed for two
days because a colour drift is far less obviously "broken" than a
misaligned button. **This is also what the "parts black, parts dark
blue" report was describing directly, at every point in the session, not
just at launch** — `_applyThemeToDom()` updates the OS status-bar tint
live on every theme resolution, so the mismatch between that tint
(navy `#0a0e17`) and the actual chrome around it (`#12181c`, closer to
neutral dark grey) was visible for the whole time Night/Auto was active,
not only during the splash sequence.

**Fix**: all five hardcoded locations now use the real, current
`--bg-dark` values — `#12181c` (night) everywhere a single fixed dark
value is needed (`manifest.json`, `index.html`'s static meta tag and
`#launch-screen` background — RAW/the splash have always used a single
fixed dark look regardless of Day/Night by design, so night's value is
the correct universal pick here, not a Day/Night split), and `app.js`'s
live `_applyThemeToDom()` now uses the real per-theme pair
(`#12181c`/`#d4dde2`) instead of the stale `#0a0e17`/`#f5f3ee`. Since a
manifest field, a meta tag, and an inline pre-CSS-load `<style>` can't
read a CSS custom property, this duplication is unavoidable, not an
oversight this time — but each site now carries an explicit comment
naming `--bg-dark` as the value to keep it in sync with by hand, the
same guard-rail pattern this file already uses for the crash reporter's
duplicated `LOG_ENDPOINT`/`LOG_ENDPOINT_KEY` — so the next repalette
doesn't drift silently for two days again before anyone notices.

**Net effect**: Android's OS-generated auto-splash (built from
`manifest.json`'s `background_color`) now renders on the EXACT same
colour as VCAS's own in-page `#launch-screen` takes over with — the
handoff between the two screens is now a same-colour continuation, not a
colour flash, even though the icon itself still visibly grows into place
and the tagline/credit still fade in a beat later (the OS splash's own
behaviour, not something this app's code drives). The persistent
"parts black, parts dark blue" chrome inconsistency during ordinary use
is fully fixed, not just narrowed to the splash moment.

Verified via a real Playwright/Chromium render (412×915, this project's
usual worst-case check size): `getComputedStyle` on `#launch-screen`,
`document.body`, the `theme-color` meta tag, and a live `fetch()` of
`manifest.json` all resolved to the identical `rgb(18,24,28)`/`#12181c`
— confirmed bit-for-bit equal, not just "look the same." Could not verify
the OS-level auto-splash itself the same way — that's rendered by the
Android/PWABuilder shell entirely outside this HTML document, with no
DOM this sandbox (or any web-only tooling) can inspect — so the "no
colour flash at handoff" claim rests on the now-matching manifest value
feeding it, confirmed correct, rather than a direct screenshot of the
OS splash itself.

## Android Auto phase 1: first real-device test, and the actual first real bug (2026-08-25)

The project owner did the actual first-ever build/sideload of the
`android/` skeleton (see "Phase 1 started" above) on their own Windows
machine + real OnePlus Nord 2T 5G + real Kia head unit — the genuine
first time any of this code has run anywhere, exactly as the honesty
notes in `android/README.md` anticipated. Worth recording the real
obstacles hit along the way, since several were generic Windows/Android
dev environment friction that has nothing to do with VCAS's own code but
will recur if this ever needs setting up again on a different machine:

- **Stale local clone.** The project owner already had an old
  `C:\Users\dmshs\VCAS` folder from early in this project's history (no
  `android/`, no `CLAUDE.md`, pre-dates most of this file) — opening it
  directly in Android Studio silently showed that old, unrelated project
  tree instead of anything resembling the current repo. Fixed with a
  plain `git fetch`/`checkout`/`pull` in that same folder, 118 commits
  behind. **Lesson for next time this comes up**: always confirm
  `git branch --show-current` / `git log -1` in an existing local clone
  before assuming it's current, rather than trusting that a folder with
  the right name is actually up to date.
- **Kotlin compile daemon crashes, twice, in two different ways**
  (`DaemonCrashedException` with RMI/serialization errors, then later a
  bare `CompileService$CallResult$Error` with no further detail) on the
  very first real compile. Very likely Windows Defender's real-time
  protection interfering with the daemon process/file writes — Android
  Studio's own "Microsoft Defender may affect IDE" notification, with
  specific folder-exclusion suggestions
  (`.gradle`, the Android SDK path, the Android Studio install path, and
  the project folder itself), was sitting unactioned the whole time.
  Fixed two ways together: actually clicking "Exclude folders" on that
  notification, and adding `kotlin.compiler.execution.strategy=in-process`
  to `android/gradle.properties` (compiles Kotlin inside the main Gradle
  daemon's own JVM instead of spawning a separate out-of-process Kotlin
  daemon at all — sidesteps the whole failure class, negligible cost for
  a 3-file phase-1 project). Once both were in place, the daemon issue
  never recurred.
- **USB driver hell, real and time-consuming.** The phone's USB mode was
  defaulting to "No data transfer"/"Charging" (fixed by switching to
  File Transfer/Android Auto or MTP explicitly — a very common root cause
  of "nothing happens when I plug in a phone," worth checking first next
  time before assuming a driver problem). Once that was fixed, Windows
  still only recognised the phone as a generic "MTP USB Device," not a
  debuggable Android device — a real missing-ADB-driver problem, not
  fixed by Android Studio's own Google USB Driver SDK package
  (installed but didn't resolve it) nor by OnePlus's own downloadable
  driver (turned out not to register anything with Windows Device
  Manager at all — possibly a bad/non-functional download, never
  diagnosed further since the next option worked). **What actually
  worked: Android's built-in wireless (Wi-Fi) debugging** — Developer
  options → Wireless debugging → "Pair device with QR code", paired from
  Android Studio's Device Manager panel. Zero drivers needed, and this is
  worth trying FIRST next time a phone doesn't show up over USB on
  Windows, rather than as a last resort after exhausting driver options —
  it would have saved real time here.
- **The actual first real code bug, found via a real head unit**: once
  the build/install/sideload mechanics all finally worked, VCAS still
  didn't appear anywhere on the Kia's Android Auto launcher — not in the
  visible list, not even in "Hidden apps" (checked directly via the
  head unit's own "Customise Launcher" screen, which lists every
  installed car-compatible app either way) — meaning Android Auto never
  registered it as a valid car app candidate at all, not merely a
  visibility/settings problem. Root cause, confirmed against Google's own
  Car App Library docs (`developer.android.com/training/cars/apps/
  navigation`, fetched via `WebFetch` since `dl.google.com` itself is
  blocked from this sandbox — see "Sandbox environment notes"):
  `AndroidManifest.xml` was missing a manifest-level permission that's
  specifically required for the `NAVIGATION` category (VCAS's own
  category, correctly declared elsewhere in the same manifest):
  ```xml
  <uses-permission android:name="androidx.car.app.NAVIGATION_TEMPLATES"/>
  ```
  This is distinct from, and in addition to, the existing
  `<category android:name="androidx.car.app.category.NAVIGATION"/>`
  intent-filter entry and the `com.google.android.gms.car.application`
  meta-data — none of those alone are sufficient for the `NAVIGATION`
  category specifically; other categories (POI, IoT, etc.) don't carry
  this same extra requirement. Added the missing `<uses-permission>` line
  to `AndroidManifest.xml`.

  **Follow-up, same day: that permission fix alone didn't do it either.**
  Rebuilt, reinstalled, confirmed via `adb shell dumpsys package` that
  `NAVIGATION_TEMPLATES` really was `granted=true` on the installed APK —
  and VCAS still never appeared, in either list. Two more real-device
  `adb logcat` captures (one immediately after, one after a full phone
  reboot to rule out Android Auto's own app-registry cache or OnePlus's
  aggressive `OsenseKillAction` background-process killer) both came back
  the same way: **zero lines anywhere referencing `androidx.car.app`,
  `CarAppService`, or VCAS's package from Gearhead's (Android Auto's real
  process name) own side** — every mention of `org.vectair.vcas.car` in
  both captures was Android Studio's own install/debug routine, not
  Android Auto querying it. That ruled out both a validation rejection
  and a stale-cache/battery-killer theory — the real signature was "never
  even considered a candidate," not "considered and rejected."

  Root cause, found by cloning Google's actual official sample repo
  (`github.com/android/car-samples`, not just reading docs pages —
  `dl.google.com` is blocked from this sandbox but plain `git clone`
  over HTTPS isn't) and diffing VCAS's manifest against
  `car_app_library/navigation/mobile/src/main/AndroidManifest.xml`
  directly: VCAS was missing the
  **`androidx.car.app.minCarApiLevel`** meta-data tag entirely —
  ```xml
  <meta-data android:name="androidx.car.app.minCarApiLevel" android:value="1" />
  ```
  declared right alongside the existing `com.google.android.gms.car.
  application` meta-data in every real sample manifest checked. Without a
  declared minimum Car API level, Android Auto apparently has no basis to
  even attempt negotiating a session — consistent with the "zero
  interaction at all" signature both real-device log captures showed,
  unlike a rejected/invalid app which would at least show up in a binding
  attempt or a validation-failure log line.

  **A related dead-end worth recording so it isn't re-chased**: partway
  through this a `WebFetch` summary of the Car App Library's
  navigation-category doc page reported that `com.google.android.gms.car.
  application`/`automotive_app_desc.xml` looked like a "legacy,
  superseded" requirement, since that particular page didn't mention it.
  That was wrong — re-checked directly against the real official sample's
  actual `AndroidManifest.xml` and `automotive_app_desc.xml` (both files,
  full contents, not a docs summary): both are alive, current, and
  byte-for-byte identical to what VCAS already had. **Lesson: a `WebFetch`
  summary reporting something doesn't appear on ONE doc page is not
  equivalent to confirming it's obsolete** — Google's docs are split
  across many pages that each assume context from others; the actual
  official sample source is the authoritative check when something this
  consequential is on the line, not one page's summary.

  Added the missing `minCarApiLevel` meta-data to `AndroidManifest.xml`;
  updated `automotive_app_desc.xml`'s own comment from "unverified" to
  confirmed-correct now that it's been diffed byte-for-byte against the
  real sample.

  **Follow-up, same day: a full systematic diff, not another guess.**
  Direct pushback from the project owner after two rounds of single-lead
  guesses: "I feel like we are flailing about at the wrong end of the
  problem... can you do a thorough comparison of what the build is vs
  what android auto needs... is anything else missing?" Right call — did
  a real file-by-file diff of every file in `android/` against Google's
  actual official sample (`android/car-samples`, cloned locally, both the
  `navigation/mobile` app module AND `navigation/common` library module
  it depends on, since the sample splits across two modules where VCAS is
  one flat module) rather than continuing to chase one lead at a time.

  **One more real, confirmed gap found this pass: VCAS had ZERO icon
  resources anywhere in the project, and the manifest declared no
  `android:icon` at all.** Every real sample app declares
  `android:icon="@drawable/ic_launcher"` pointing at a real drawable.
  Android Auto's own app-grid UI has to render an icon per listed app;
  a car-app candidate with literally no icon resource to draw is a
  plausible mechanism for silently never being listed, consistent with
  the "zero interaction, not a rejection" signature every log capture
  has shown. Fixed by adding `android:icon="@drawable/ic_launcher"` to
  the manifest and copying VCAS's own real `assets/icons/icon-192.png`
  (already exactly the standard xxxhdpi launcher-icon size, 192px) into
  `android/app/src/main/res/drawable/ic_launcher.png` — reusing the
  actual brand icon rather than inventing a placeholder, consistent with
  how it's used everywhere else in this project.

  **Full comparison results, for the record — not silently dropping the
  things that turned out fine or don't apply yet:**
  - `automotive_app_desc.xml` — byte-identical to the real sample.
    Confirmed correct, not the issue.
  - `compileSdk`/`minSdk`/`targetSdk` (34/23/34) — exact match against
    the real sample's `build.gradle`. Not the issue.
  - `CarAppService`/`Session`/`Screen` shape, the `HostValidator`
    (`ALLOW_ALL_HOSTS_VALIDATOR`, correct for dev sideloading), the
    `CarAppService` intent-filter's action + `NAVIGATION` category — all
    match the expected/real API shape. Not the issue.
  - **No launcher `<activity>` (MAIN/LAUNCHER intent-filter)** — every
    real sample has one (the phone-tap-icon entry point, typically a
    setup/info screen). VCAS has none, which is also the direct cause of
    the earlier, already-known-harmless "Default Activity not found"
    Android Studio warning. Best understanding: this is NOT required for
    Android Auto's own discovery of the `CarAppService` (that's driven by
    the service's own intent-filter, independent of any phone-side
    launcher activity) — flagging it honestly as a real difference from
    every working reference sample, not dismissing it, but not chasing it
    as a phase-1 blocker either. Worth adding for polish once the app is
    confirmed showing up, not before.
  - `androidx.car.app.ACCESS_SURFACE` permission + `FEATURE_CLUSTER`
    category — present in the real sample, genuinely needed for apps
    that render to a custom `Surface` (real map/traffic overlay) or
    support instrument-cluster displays. Correctly NOT needed for
    phase 1's plain `MessageTemplate`, which uses neither. Deferred to
    phase 2, not a current gap.
  - `androidx.car.app` library version — VCAS pins the real, published
    Maven Central stable release `1.4.0`; the sample's version catalog
    pins `1.9.0-alpha01`, which appears to be AndroidX's own internal
    monorepo build rather than a publicly published release most external
    developers would consume — not a fair like-for-like comparison, and
    VCAS's own build already compiles clean against the public release
    (confirmed by the earlier `BUILD SUCCESSFUL` in Android Studio), so
    this was not flagged as a likely cause.
  - `common` module's own manifest (`POST_NOTIFICATIONS`, `RECORD_AUDIO`)
    — permissions for real notification/voice features VCAS doesn't have
    yet. Not applicable to phase 1.

  Both the icon fix and the earlier `minCarApiLevel` fix are now pushed
  together. **Still not yet re-verified against the real head unit** —
  update this entry with the outcome once confirmed either way, and if
  it's STILL not showing up after this, the next real diagnostic step
  (rather than a fourth guess) should be pulling the actual APK's merged
  manifest via `aapt2 dump badging` or Android Studio's own "Merged
  Manifest" view, to rule out anything the Gradle manifest merger itself
  might be silently dropping or altering — a class of failure this
  file-by-file source comparison can't see.

## Android Auto phase 1, continued: launcher MainActivity + first Kotlin logic port (2026-08-25, same day)

The project owner can't vehicle-test right now, so rather than sit idle
on the still-unconfirmed manifest fixes above, agreed to push forward on
two things that don't need a car at all: the missing launcher activity
flagged (but not fixed) in the systematic-diff writeup above, and
starting the Kotlin port of the "cleanly portable" pure-logic files
listed under "Long-term destination" at the top of this file — begun
with `geo.js`, the smallest and most self-contained of the group,
explicitly as a first case rather than a commitment to port everything
in one sitting.

**`MainActivity.kt`** (new, `android/app/src/main/java/org/vectair/vcas/car/`) —
the phone-side tap-the-icon entry point every real Car App Library sample
has and VCAS didn't (the direct cause of the earlier, already-known-
harmless "Default Activity not found" Android Studio warning noted in
the systematic-diff writeup above). Deliberately minimal: a plain
`android.app.Activity` (not `androidx.activity.ComponentActivity` — no
reason to pull in a new Maven dependency whose current version this
sandbox can't verify live, for a placeholder with no real content yet)
showing a single centred `TextView` pointing the user at Android Auto.
**Not** what drives Android Auto's own discovery of the car app — that's
entirely `VcasCarAppService`'s own manifest intent-filter, independent of
any launcher activity existing — added for sample parity and to clear the
warning, not as a fifth guess at the still-open visibility bug.
`AndroidManifest.xml` gained the matching `<activity>` declaration with a
`MAIN`/`LAUNCHER` intent-filter, placed ahead of the existing car-app
meta-data with a comment making the "not the fix for car-side visibility"
distinction explicit, so a future read doesn't mistake it for a fourth
attempted root-cause fix.

**`geo.js` → `Geo.kt`, the first native logic port (`android/app/src/main/
java/org/vectair/vcas/car/logic/Geo.kt`).** A structural, near line-for-
line translation of `src/logic/geo.js`'s 379 lines — `calculateBearing`,
`calculateDistanceMeters`/`calculateDistanceNm`, `calculateRelativeBearing`,
`bandedRadiusFraction`, `maxRadiusForBearing`, `projectToPolarPosition`,
`projectPosition`/`destinationPoint`, `circleCoordinates`/`arcCoordinates`,
`circularPlotRadius`, `computeSquarePlotLayout` — as a Kotlin `object Geo`
with small data classes (`Point`, `LatLon`, `Rect`, `SquarePlotLayout`)
standing in for the JS versions' plain object returns. Confirms the
"cleanly portable... translates to Kotlin close to line-for-line" claim
made about this file at the top of this document was correct, not just
assumed. Greek-letter JS identifiers (φ/λ/Δ/δ/θ) spelled out as ASCII
(`phi`/`lambda`/`delta`/`theta`) — a deliberate choice, not an oversight,
referencing this project's own earlier documented incident where an
external test harness silently mangled those exact characters over a
charset mismatch (see the Stage 3 aircraft-list verification note
earlier in this file); no reason to carry that fragility into a second
language when ASCII names cost nothing here.

**Verified by actually compiling and running real tests against real
`kotlinc`/JUnit4 — not just read for correctness — despite this sandbox
having no Android SDK, Gradle, or emulator at all.** Assembled a
standalone Kotlin 2.0.0 compiler + JUnit4 toolchain directly from raw
Maven Central jars (`kotlin-compiler`, `kotlin-stdlib`,
`kotlin-script-runtime`, `kotlin-daemon-embeddable`,
`org.jetbrains.intellij.deps:trove4j`, `org.jetbrains:annotations`,
`junit:junit:4.13.2`, `org.hamcrest:hamcrest-core:1.3`, all fetched via
plain `curl` against `repo1.maven.org` — reachable from this sandbox even
though `dl.google.com` isn't, same asymmetry already noted elsewhere in
this file for the `androidx.car.app` dependency itself), invoked directly
via `java -cp <jars> org.jetbrains.kotlin.cli.jvm.K2JVMCompiler`. Two real
compile failures were hit and fixed along the way (`NoClassDefFoundError`
for `kotlin.jvm.internal.Intrinsics`, then for
`org.jetbrains.annotations.NotNull` during backend codegen) — both
resolved by getting `kotlin-stdlib`/`annotations` jars onto the compiler's
own **launch** classpath, not just the inner `-cp` used to resolve source
symbols, a distinction that wasn't obvious until the second failure
pointed at it. This is the same "verify against real execution, not code
review" discipline this file already establishes at length for JS (Node
simulations, real MapLibre/Playwright renders) and RAW mode's projection
math — applied here to a brand-new language/toolchain rather than skipped
because the obvious tools (Android Studio, Gradle) aren't available in
this environment.

`GeoTest.kt` (new, `android/app/src/test/java/org/vectair/vcas/car/
logic/`) — a real JUnit4 suite, 34 `@Test` methods across every ported
function, deliberately split into two verification styles rather than
one applied uniformly: analytically-exact expected values for functions
with a clean closed form (cardinal bearings; equatorial/meridian
great-circle distance = `6371000 * radians(1°)` exactly; nm-per-degree ≈
60.0; `bandedRadiusFraction`'s clamp/boundary behaviour, including a
direct cross-check against this file's own documented real case — an 8nm
aircraft against `[2,5,10]` bands must equal `2.6/3.0`, per the "RAW ND-
style range selector" section above; `destinationPoint` exact round-trips;
`computeSquarePlotLayout`'s portrait/landscape/exact-square/degenerate
arithmetic) versus relational/invariant assertions for the harder polar-
projection trig where a hand-derived literal would be brittle and easy to
get subtly wrong (`maxRadiusForBearing` dead-ahead equals the exact
Y-headroom formula; FOV-edge radius must be strictly less than dead-ahead
on a narrow viewport; `circularPlotRadius` exactly equals the `min` of
its two defining bearings, mirroring the numerical proof already done for
the JS version per "RAW is a field-of-view-restricted circular display"
above; `projectToPolarPosition` returns `null` outside the FOV, non-null
at its edge, `x` exactly equal to center X at bearing 0, and a farther
range within the same band produces a strictly smaller `y` since screen Y
is inverted). **Result: all 34 tests passed on first clean compile+run** —
zero transcription bugs found between `geo.js` and `Geo.kt`, a genuinely
verified port rather than an assumed-correct one.

Not yet done, and explicitly not implied by this entry: no further pure-
logic files (`visibility.js`, `relevance.js`, `aircraftExtrapolation.js`,
`indicators.js`, `navigationCameraEvaluator.js`) have been started —
`geo.js` was agreed as the first case specifically to prove the
translate-and-verify approach works at all, not as the start of an
uninterrupted porting sprint through the rest of the list.

### `visibility.js` → `Visibility.kt`, second logic port (2026-08-25, same day)

Direct instruction to continue: "Port visibility.js next." A structural
port of `src/logic/visibility.js`'s sightability estimator — the
wingspan/category size tables, the 4-tier TCAS-symbology `CATEGORIES`
table (colours/shapes/scores/minAngle thresholds preserved byte-for-byte,
including the RAW-display pixel-sampled `colorRaw` values and the
Okabe-Ito colourblind-safe palette), `estimate()`'s full branch order
(very-close override → contrail floor → plain 40nm cap → angular-size
lookup → staleness degrade → METAR adjustment), and `getCategories()`.
As `object Visibility` in `android/app/src/main/java/org/vectair/vcas/
car/logic/Visibility.kt`, depending on `Geo.calculateDistanceNm` from the
first port the same way the JS original depends on `geo.js`.

**Two deliberately-preserved quirks, called out explicitly in the file's
own doc comment so a future reader doesn't "fix" them into a mismatch
with the JS source**: `_sizeForType` never actually returns a falsy
value, so the JS original's `||`-chained fallback to
`_categoryFallbackFromLabel(category)` is dead code in practice — ported
as literally-present-but-unreachable code, not simplified away. And the
plain 40nm cap and the 50nm contrail cap are two intentionally different
numbers (see "Contrail visibility" above), not a mismatch to reconcile.

**Verified the same way as the `Geo.kt` port — real `kotlinc`+JUnit4
execution, not a read-through** — `VisibilityTest.kt` (new, `android/
app/src/test/java/org/vectair/vcas/car/logic/`), 32 `@Test` methods,
using the same standalone Maven-Central-jar toolchain the `Geo.kt` port
already established. Two styles, matching `GeoTest.kt`'s own split:

- **Exact-boundary tests** for the three `minAngle` tier cutoffs
  (0.5°/0.167°/0.05°): each aircraft is placed via `Geo.destinationPoint`
  at the precise geodesic distance the tier threshold implies (solved
  from the same `57.3 * sizem / slantM` formula `estimate()` itself
  uses), then nudged ±0.01nm — comfortably clear of the ~1.3e-6nm
  floating-point/Earth-radius noise between `Geo.kt`'s `R_NM` constant
  and `R_M`-derived nautical miles (checked, not assumed) — to land
  cleanly on either side of the `>=` cutoff and confirm the tier flips
  exactly where it should, not off-by-one.
- **Scenario tests**, each checked against the true branch logic (worked
  through by hand for every scenario, not just plausibility-checked)
  rather than an assumed label: the contrail floor rescuing a small
  aircraft to "Possibly visible" without ever downgrading a large one
  already scoring better within the same window; the contrail branch
  correctly NOT firing beyond 50nm or below 26,000ft (in both cases
  falling through to whichever branch — the plain 40nm cap or plain
  angular-size lookup — actually governs at that input, not a guessed
  label); the very-close override requiring BOTH its conditions
  (proximity alone, or altitude alone, isn't enough); staleness
  degrading exactly one tier and never past the worst one, and the
  `>20` (not `>=20`) boundary; every METAR path (OVC/VV full block, BKN
  partial cap, a cloud layer above the aircraft's own altitude having no
  effect, only the LOWEST of several qualifying layers governing,
  reduced reported visibility capping only when slant range actually
  exceeds it, and the `<10SM` — not `<=10SM` — boundary); and
  `getCategories()` returning all 4 tiers in order as a fresh, distinct
  copy each call.

**Two scenario tests' first-draft expected values were themselves wrong,
caught only by actually working through the real branch arithmetic
before finalizing them, not by running the suite and hoping** — worth
recording since it's a real instance of this project's own repeated
"verify against real execution, don't assume" lesson applying to the
verification code itself, not just the ported logic: an initial "40nm
cap, large aircraft not capped" scenario picked a distance/altitude/size
combination whose angular size alone landed exactly on the 33-score
"Possibly visible" tier already — making the intended ">33" assertion
false by construction, not a bug in `Visibility.kt`. Recomputed with a
closer range so the angular-size branch clearly clears the next tier up
before asserting against it. Similarly, a "contrail floor doesn't apply
below the altitude threshold" scenario picked a distance beyond the
*plain* 40nm cap too, so that cap — not the intended absence of the
contrail floor — was what actually produced the expected label,
testing the wrong thing despite superficially passing; moved inside 40nm
so only the contrail-threshold behaviour is actually exercised. **Result
after both corrections: all 32 tests pass against the real, shipped
`Visibility.kt`, alongside the pre-existing 34 `Geo.kt` tests (66 total,
zero failures).**

Not yet done: `relevance.js`, `aircraftExtrapolation.js`, `indicators.js`,
and `navigationCameraEvaluator.js` remain unported — same standing note
as the `geo.js` entry above, each addressed only on further explicit
instruction, not assumed as an implied next step from this one.

### `relevance.js` → `Relevance.kt`, third logic port (2026-08-25, same day)

Direct instruction to continue: "Port relevance.js next." A structural
port of `src/logic/relevance.js`'s teardrop relevance filter — the
`DEFAULTS` tuned constants (rMaxNm/rMinNm/pinchExponent/
overheadElevationDeg/lookaheadSeconds/lookaheadSamples/
stationarySpeedMph/contrailMinAltitudeFt/rangeExtensionCapNm, all
preserved byte-for-byte), `_effectiveRMaxNm`'s high-altitude range
extension (mirroring Visibility's own contrail floor exactly, same
threshold/cap), the teardrop shape formula (`_teardropRangeNm`'s
pinch-exponent cosine falloff), and `_predictedEntrySeconds`'s
forward-lookahead sampling loop. As `object Relevance` in `android/app/
src/main/java/org/vectair/vcas/car/logic/Relevance.kt`, depending only
on `Geo` (for bearing/distance/position-projection), matching how
relevance.js has no dependency on visibility.js at all — the `vis`
parameter's `slantRangeNm`/`elevationDeg` are precomputed and passed in
by the caller, so `Relevance.kt` defines its own small `VisInput` type
rather than importing `Visibility.EstimateResult`.

**Kept the same public-surface discipline `Visibility.kt` already
established**: only `evaluate()` and `DEFAULTS` are public, mirroring
relevance.js's own `{ evaluate, DEFAULTS }` export — every internal
helper (`effectiveRMaxNm`/`teardropRangeNm`/`inTeardrop`/
`predictedEntrySeconds`) stays private, tested indirectly through
`evaluate()` only.

**Verified the same way as the two prior ports — real `kotlinc`+JUnit4
execution** — `RelevanceTest.kt` (new, `android/app/src/test/java/org/
vectair/vcas/car/logic/`), 17 `@Test` methods, using the same standalone
Maven-Central-jar toolchain. Three verification styles:

- **Exact-boundary tests** for the teardrop shape at 0°/180°/60°, solved
  analytically from the same closed-form formula (`teardropRangeNm(0) ==
  rMaxNm == 15.0`, `teardropRangeNm(180) == rMinNm == 3.0`,
  `teardropRangeNm(60) == 9.75` exactly) — since `evaluate()` accepts
  `relativeBearing`/`vis.slantRangeNm` directly as plain numbers, these
  need no real coordinates at all, unlike the geodesic-distance-based
  boundary tests the two earlier ports needed.
- **Scenario tests** worked through by hand against the real branch
  order: the overhead override's strict `>` (not `>=`) boundary at
  70°; the contrail range extension letting a 40nm dead-ahead aircraft
  at 30,000ft register as in-view (base rMaxNm alone would exclude it);
  the same case NOT extending below the altitude threshold or with a
  null altitude; and a custom `rMaxNm` (60) larger than the default
  `rangeExtensionCapNm` (50) confirmed to survive the extension logic
  unshrunk (`max(rMaxNm, cap)`, not a blind clamp to the cap).
- **Predicted-entry tests**, which do need real coordinates since
  `predictedEntrySeconds()` calls `Geo` internally: rather than trusting
  hand-picked timing margins (a first-draft attempt at hand-deriving
  which of the 3 lookahead samples should trigger convergence turned out
  fragile — small arithmetic slips in a multi-step manual projection are
  easy to make and hard to catch by eye), a small helper
  (`independentEntrySeconds`) *independently* replicates the same
  per-sample projection using `Geo`'s own already-verified primitives
  (`GeoTest.kt`, 34/34 passing) — freshly written from the documented
  algorithm, not copied from `Relevance.kt` — to determine which sample
  should trigger, then checks `Relevance.evaluate()`'s actual
  `enterInSeconds` against it. This isn't circular (it doesn't re-test
  `Geo`, and it doesn't blindly trust `Relevance.kt`'s own loop) — it's
  checking `predictedEntrySeconds()`'s specific sampling behaviour
  (step size, sample count, early-return-on-first-match) against an
  independently-derived ground truth, the same principle as using
  `Geo.destinationPoint` to build exact-input aircraft positions in the
  `Visibility.kt` port's own boundary tests. Covers: an aircraft
  converging on a stationary user (exercises the `userIsMoving=false`
  branch), a user moving toward a stationary aircraft (exercises
  `userIsMoving=true`, not covered by the first case), a diverging
  aircraft that must never trigger, and both `trackDeg`/`groundSpeedKt`
  null-data early-return paths.

**Result: all 17 new tests pass against the real, shipped `Relevance.kt`,
alongside the pre-existing 66 `Geo.kt`/`Visibility.kt` tests (83 total,
zero failures).**

Not yet done: `aircraftExtrapolation.js`, `indicators.js`, and
`navigationCameraEvaluator.js` remain unported — same standing note as
the `geo.js`/`visibility.js` entries above, each addressed only on
further explicit instruction.

### `aircraftExtrapolation.js` → `AircraftExtrapolation.kt`, fourth logic port (2026-08-25, same day)

Direct instruction to continue: "Port aircraftExtrapolation.js next." A
structural port of `src/logic/aircraftExtrapolation.js`'s dead-reckoning
logic — the two early-return guards (missing track/speed data, on-ground
traffic held at its last fix rather than projected across taxiway turns),
the `elapsedSeconds` clamp to `maxElapsedSeconds`, and the
`Geo.destinationPoint`-based projection itself. As `object
AircraftExtrapolation` in `android/app/src/main/java/org/vectair/vcas/
car/logic/AircraftExtrapolation.kt`, depending only on `Geo`.

**The one real design decision this port needed that the first three
didn't: what `Aircraft` actually is.** Unlike `Visibility.kt`'s
`AircraftInput` or `Relevance.kt`'s `AircraftState` — each a narrow
per-function subset of fields, matching how those JS files only ever
read a few fields off a duck-typed object — this file's whole job is to
hand back a copy of the WHOLE aircraft with only lat/lon changed (JS:
`{ ...aircraft, lat, lon }`). A narrow subset type would silently drop
every other field on that spread, so `Aircraft` here is instead a
full-fidelity data class mirroring `src/data/normaliseAircraft.js`'s
real output shape (hex, callsign, type, lat, lon, altitudeFt, onGround,
trackDeg, groundSpeedKt, verticalRateFpm, lastSeenSeconds, category,
registration, isGroundVehicleOrObstacle) — read directly from that file
rather than guessed, since it's the actual normalizer every aircraft
object in the app flows through. `.copy(lat = dest.lat, lon = dest.lon)`
is then a genuinely faithful equivalent of the JS spread, not an
approximation.

**Verified the same way as the three prior ports — real
`kotlinc`+JUnit4 execution** — `AircraftExtrapolationTest.kt` (new,
`android/app/src/test/java/org/vectair/vcas/car/logic/`), 11 `@Test`
methods, same standalone Maven-Central-jar toolchain. Given how small and
branchy this file is, the emphasis differs from the previous three ports:
- **Reference-identity checks** (`assertSame`, not `assertEquals`) for
  every early-return guard — missing `groundSpeedKt`, missing
  `trackDeg`, `onGround == true`, `elapsedSeconds == 0`, and a negative
  `elapsedSeconds` clamping to 0 — confirming Kotlin's `return aircraft`
  hands back the exact same instance the JS original's bare
  `return aircraft;` does, not a reconstructed copy that merely looks
  equal.
- **Exact numeric cross-checks** against `Geo.destinationPoint` directly
  (not a relational/margin style) for normal extrapolation, since the
  real formula is a thin wrapper around it with identical double
  arithmetic in the same order — an exact match is the correct
  expectation here, not a looser one. Covers un-clamped extrapolation, a
  case far beyond `maxElapsedSeconds` (confirmed to use the CAPPED
  distance, and confirmed to genuinely differ from what the uncapped
  distance would have produced — proves real clamping, not a
  coincidental match), and the exact-at-the-cap boundary.
- **Field-preservation test** confirming every other field (hex,
  callsign, type, altitudeFt, category, registration, etc.) survives
  extrapolation completely untouched, only lat/lon actually changing —
  the direct check that the full-fidelity `Aircraft` type decision above
  actually holds in practice, not just in principle.
- **`extrapolateAll`** tested for correct per-element independent
  handling and order preservation across a mixed list (no-track,
  on-ground, and normally-flying aircraft together), plus the trivial
  empty-list case.

**Result: all 11 new tests pass against the real, shipped
`AircraftExtrapolation.kt`, alongside the pre-existing 83 `Geo.kt`/
`Visibility.kt`/`Relevance.kt` tests (94 total, zero failures).**

Not yet done: `indicators.js` and `navigationCameraEvaluator.js` remain
unported — same standing note as the entries above, each addressed only
on further explicit instruction.

### `indicators.js` → `Indicators.kt`, fifth logic port (2026-08-25, same day)

Direct instruction to continue: "Port indicators.js next." A structural
port of `src/logic/indicators.js` — the orchestration layer over all four
prior ports at once (`Geo`, `Visibility`, `Relevance`,
`AircraftExtrapolation`), not a new independent algorithm: the
viewport-tiered NAV display cap, the `POLAR_MAX_RANGE_NM`/`RING_BANDS_NM`/
`FOV_HALF_ANGLE_DEG` constants (byte-for-byte, `POLAR_MAX_RANGE_NM` still
derived from `Relevance.DEFAULTS.rangeExtensionCapNm` rather than a
second hardcoded 50), the shared per-aircraft `computeAll()` pass
(bearing/distance/visibility/relevance/polar position/direction-of-
travel), and the two public entry points (`build()` — relevance-filtered,
suppression-filtered, sorted by score-then-distance; `buildAll()` —
unfiltered, distance-only, for the ground-truth log panel). As `object
Indicators` in `android/app/src/main/java/org/vectair/vcas/car/logic/
Indicators.kt`.

**Reused `AircraftExtrapolation.Aircraft` as the aircraft type here**,
rather than inventing a sixth per-file subset type — this is the first
port whose job is genuinely "read almost every field off the real
aircraft object at once" (hex for suppression, lat/lon/altitudeFt/type/
category/lastSeenSeconds for `Visibility`, lat/lon/altitudeFt/trackDeg/
groundSpeedKt for `Relevance`), matching why that type was built
full-fidelity in the first place (see the `aircraftExtrapolation.js`
entry above). `computeAll()` adapts it into each dependency's own
narrower input type at the call site — the same thing the JS original
does implicitly by handing the same duck-typed object to both `Visibility.
estimate()` and `Relevance.evaluate()` without either module needing to
know about the other's exact field list.

**The one real design decision this port needed: how to represent
`userState`'s many optional/fallback-chained fields (`anchorY`,
`safeInset`/`plotSafeInset`, `plotWidth`/`plotHeight`/`plotOffsetX`/
`plotOffsetY`, `plotBandsNm`).** JS relies on `undefined` silently
falling through to a callee's own default parameter (e.g.
`projectToPolarPosition`'s own `anchorY = 0.8`) — Kotlin has no
equivalent implicit passthrough, so each of these is a nullable field on
`Indicators.UserState`, resolved explicitly inside `computeAll()` with a
comment naming which `Geo.kt` default it must stay in sync with (`0.8`
for anchorY, `60.0` for safeInset) — preserving the exact same effective
fallback behaviour as the JS original's implicit-undefined chain, just
made explicit rather than implicit.

**Verified the same way as the four prior ports — real `kotlinc`+JUnit4
execution** — `IndicatorsTest.kt` (new, `android/app/src/test/java/org/
vectair/vcas/car/logic/`), 18 `@Test` methods, same standalone
Maven-Central-jar toolchain. Since `Indicators.kt` is purely an
orchestration layer over four already-independently-verified modules
(`GeoTest` 34/34, `VisibilityTest` 32/32, `RelevanceTest` 17/17,
`AircraftExtrapolationTest` 11/11, all still passing), the tests split
differently from the prior four ports:
- **Pure filtering/sorting checks** needing no cross-verification at all,
  since they're plain boolean/comparator logic: `build()`'s relevance
  filter excluding an aircraft dead behind the user with no convergence
  data; `build()`'s suppression filter excluding a hex regardless of
  relevance; `build()`'s sort (visibility score descending, then distance
  ascending on ties, verified with three real distinct-score aircraft and
  a tied-score pair); `buildAll()` including an irrelevant aircraft and
  sorting purely by distance; the hard staleness cutoff (`< threshold*3`)
  excluding an aircraft entirely at the exact boundary; the `isStale` flag's
  own separate `> threshold` boundary; and `relativeTrackDeg` being present/
  null depending on whether the aircraft transmits a track.
- **Position cross-checks against an independent direct call to
  `Geo.projectToPolarPosition`** using the same already-verified
  primitives, for the plumbing that can't be checked by boolean logic
  alone: a plain dead-ahead case (which, using `userState()`'s default
  null `anchorY`/`safeInset`, simultaneously proves the 0.8/60.0 fallback
  resolution works); a full RAW-style case with every plot-region override
  set to values deliberately different from the plain viewport (`plotWidth`/
  `plotHeight`/`plotOffsetX`/`plotOffsetY`/`plotSafeInset`/`plotBandsNm`
  all at once), confirmed to differ from what the plain-viewport values
  would have produced (proving the override path is genuinely used, not
  coincidentally matching); and `plotSafeInset=null` correctly falling
  back to `safeInset` rather than jumping straight to Geo's own default.
- **A decoupling check**: an aircraft nearly overhead (steep elevation)
  at a relative bearing well outside a 75° FOV half-angle is confirmed
  `relevant=true, reason="overhead"` (Relevance's overhead rule doesn't
  care about the FOV at all) while `x`/`y` are both null (Geo's FOV
  restriction is a separate, purely geometric concern) — proving the two
  mechanisms are correctly independent, matching how indicators.js's own
  comments describe them as unrelated by design.

**Result: all 18 new tests pass against the real, shipped
`Indicators.kt`, alongside the pre-existing 94 `Geo.kt`/`Visibility.kt`/
`Relevance.kt`/`AircraftExtrapolation.kt` tests (112 total, zero
failures).**

Not yet done: `navigationCameraEvaluator.js` remains unported — same
standing note as the entries above, addressed only on further explicit
instruction. With this port, every pure-logic file the top-of-file
"Long-term destination" scoping note called "cleanly portable" except
`navigationCameraEvaluator.js` itself has now actually been ported and
verified.

### `navigationCameraEvaluator.js` → `NavigationCameraEvaluator.kt`, sixth and final scoped logic port (2026-08-25, same day)

Direct instruction to continue: "Port navigationCameraEvaluator.js
next." The last file on the original "cleanly portable" list at the top
of this document. Two things made this port meaningfully different from
the five before it, both handled deliberately rather than glossed over:

**1. A genuinely new dependency was discovered mid-port: `RouteGeometry.
kt`.** `navigationCameraEvaluator.js` calls `RouteGeometry.nearestOnLine()`
directly — `src/routing/routeGeometry.js` was never on the original
scoping list (only geo/visibility/relevance/aircraftExtrapolation/
indicators/navigationCameraEvaluator were named), but it's equally pure
logic with zero DOM dependency, so it got ported the same way, as a
necessary prerequisite rather than a scope creep nobody asked for. All
three of its functions (`nearestOnLine`, `projectAlong`,
`distanceToIndex`) were ported, not just the one this file actually
calls — a small, cohesive module, and CLAUDE.md already documents the
other two as used elsewhere (off-route detection, maneuver tracking)
that may get ported later. Route coordinates use the same `[lon, lat]`
`DoubleArray` convention `Geo.kt`'s own `circleCoordinates`/
`arcCoordinates` already established, matching how real route geometry
(OpenRouteService responses) actually arrives as arrays of `[lon, lat]`
pairs.

**2. `NavigationCameraEvaluator.kt` is a `class`, not an `object` — the
first structural departure from every prior port.** Geo/Visibility/
Relevance/AircraftExtrapolation/Indicators are all genuinely stateless
pure functions, ported as Kotlin `object`s mirroring their JS IIFE-module
pattern. This file is different in the JS original too: real persistent
state lives in its own module-level closure (`lastEvaluatedState`,
`stateDwellTimestamp`, `smoothedSpeedMph` — the hysteresis/dwell-lock/
speed-smoothing memory that makes the camera state machine work frame to
frame). A Kotlin `object` singleton would still technically work for one
real car-app session (same lifetime as the JS module persisting for a
page load) — but a `class` is more faithful to what the state actually
IS (per-session camera memory), and critically, it's what let each JUnit
test start from a genuinely clean `NavigationCameraEvaluator()` instance
instead of fighting cross-test state leakage through a shared singleton.
A second, smaller adaptation for the same reason: `evaluate()` takes an
explicit `currentTimeMs: Long` parameter (defaulting to
`System.currentTimeMillis()`, behaviourally identical to the JS
original's internal `Date.now()` for any real caller) rather than
reading wall-clock time unconditionally — the seam that makes
`MIN_STATE_DWELL_MS` hysteresis actually testable with deterministic
synthetic timestamps instead of real `Thread.sleep()` calls.

**A real, verifiable discrepancy between the JS source's own comment and
its actual code, found while writing the tests — not assumed away, and
preserved faithfully rather than "fixed."** The dwell-lock block's
comment claims NAV_RAW bypasses the hysteresis timer "(like AIR)" — but
the literal code condition is
`targetState === "NAV_RAW" || lastEvaluatedState === "NAV_RAW" || ...`,
which never mentions AIR at all. This means switching into/out of AIR
mode is, in the actual shipped JS behaviour, subject to the exact same
3500ms dwell lock as any automatic urban/highway/turn transition —
contradicting what the comment claims. This port is faithful to the
real code (already ported that way correctly, verified against it) — the
same "verify against real execution, not what a comment says" discipline
this project has hit before (the compass `event.absolute` finding, the
RAW-glyphs finding), just this time surfacing a comment/code mismatch
rather than a comment/behavior one. Not treated as a bug to fix here —
flagged in the test suite's own doc comment so it isn't mistaken for a
transcription error if it's ever revisited.

`_dist`/`_segBearing` are deliberately duplicated inside
`NavigationCameraEvaluator.kt` rather than reused from `Geo.kt`/
`RouteGeometry.kt`, mirroring the JS original's own local duplication of
mathematically-identical haversine-distance/true-bearing formulas — same
"translate the structure that's actually there, don't DRY it up"
discipline `Visibility.kt`'s deliberately-preserved dead code already
established.

**Verified the same way as every prior port — real `kotlinc`+JUnit4
execution**, using the same standalone Maven-Central-jar toolchain.
Two new test files:

- `RouteGeometryTest.kt` (18 `@Test` methods) — `nearestOnLine()`'s
  empty/null/single-point/degenerate-zero-length-segment edge cases,
  correct perpendicular snapping and segment/`t` identification,
  clamping before the route start and beyond its end; `projectAlong()`'s
  null/too-short-coords guard, zero/negative-meters early return,
  within-segment interpolation (cross-checked against
  `distanceToIndex()`'s own output for the full segment length),
  crossing into the next segment, and clamping at the route's final
  vertex; `distanceToIndex()`'s target-at-or-before-segIdx zero case,
  and its result matching the sum of `Geo.calculateDistanceMeters()`
  over the same segments (an independent cross-check, not a re-test of
  its own formula).
- `NavigationCameraEvaluatorTest.kt` (13 `@Test` methods) — the AIR/
  dwell-lock discrepancy above (blocked within the window, succeeds once
  elapsed); NAV_RAW bypassing the lock in both directions; single-call
  speed-smoothing and the URBAN/HIGHWAY zoom-delta formula (exact EMA
  arithmetic, not approximated); a constructed sharp-turn route
  (east-then-north) correctly triggering `TURN_APPROACH` with the right
  signed bearing delta (left turn = negative) and distance (cross-checked
  against `Geo.calculateDistanceMeters()`); the HIGHWAY ENTER/EXIT dual-
  boundary hysteresis — entering above 53mph, STAYING in HIGHWAY_GUIDANCE
  while the smoothed speed drifts down through the 46-53 band (proving
  the lower EXIT gate, not the upper ENTER gate, governs once already in
  that state), then genuinely reverting once it drops below 46; the
  `"auto"` viewport bias's `anchorXOverride`/`anchorYOverride` winning
  over the preset's own values and its `maxPitch` clamp; the `"phone-l"`
  bias's plain pitch/anchorY additive bias; the pitch clamp's lower bound
  (AIR's pitch-0 preset pushed negative by `phone-l`'s bias, clamped back
  to 0); NAV_RAW's 9b square-anchor branch cross-checked exactly against
  a direct `Geo.computeSquarePlotLayout()` call, its fallback to the flat
  preset when viewport dimensions aren't yet available, and — a real
  asymmetry preserved from the JS source and deliberately tested, not
  just implemented — the branch still firing when `squareContentHeight`
  is exactly `0.0` (an explicit `!= null` check, unlike `viewportWidth`/
  `viewportHeight`'s truthy checks which DO exclude 0) rather than
  silently falling back to the flat preset the way a naive read might
  expect.

**Result: all 31 new tests (18 + 13) pass against the real, shipped
`RouteGeometry.kt`/`NavigationCameraEvaluator.kt`, alongside the
pre-existing 112 tests from the five prior ports (143 total, zero
failures).**

Every pure-logic file the top-of-file "Long-term destination" scoping
note called "cleanly portable" is now ported and verified: `geo.js`,
`visibility.js`, `relevance.js`, `aircraftExtrapolation.js`,
`indicators.js`, `navigationCameraEvaluator.js` — plus the one genuinely
necessary dependency discovered along the way, `routeGeometry.js`. Not
yet started, and not implied by this milestone: the "needs a genuine
rebuild" half of that same scoping note (the UI layer, the MapLibre
Native map integration, the `CarAppService`/`Session`/`Screen` shell
itself, background execution, settings) — each still a separate,
substantially larger body of work, addressed only on further explicit
instruction.

## Android Auto phase 2: a real MapLibre map on the car's Surface (2026-08-25)

Asked directly whether to port the camera evaluator's UI wiring next or
start the MapLibre integration — since camera wiring has nothing to
target without a map surface to control first, recommended MapLibre
integration as the real next step and the project owner confirmed. Still
unverified on a real head unit from the earlier phase-1 debugging session
(the owner said they couldn't vehicle-test right now, back when the
logic-porting work began) — proceeding anyway on buildable-but-
unverified code was already the established pattern for the six logic
ports, and applies the same way here.

**The core open technical question, stated honestly rather than assumed
away going in**: MapLibre's `MapView` is a normal Android `View` —
Android Auto's `Screen`/template system doesn't allow arbitrary Views at
all, only a raw `Surface` handed to the app via `AppManager.
setSurfaceCallback()`. Whether/how a real `MapView` could be gotten onto
that `Surface` at all was a genuine unknown, not something to improvise
without checking — MapLibre itself has zero built-in Android Auto
integration anywhere in its own source tree (checked directly, cloned
`maplibre/maplibre-native` and grepped for `CarAppService`/
`NavigationTemplate`/`SurfaceCallback`: zero hits).

**Found real, official prior art before writing a line of integration
code — MapLibre publishes `maplibre/MapLibre-Android-Auto-Sample`
specifically for this exact problem.** Cloned and read directly (not
summarized from search results or the sample's own README, which turned
out to itself be stale — see below). The actual, current, working
mechanism it uses: a real Android framework API most developers reach
for a completely different reason (a second physical display, e.g.
Chromecast), `DisplayManager.createVirtualDisplay()` backed directly by
the car's own `Surface`, showing a plain `Presentation` whose content
view is an ordinary, unmodified `MapView`. Android's own compositor does
the actual work of getting that View hierarchy onto the target Surface —
nothing MapLibre-specific, no manual bitmap-blitting, no reaching into
MapLibre's internal texture/renderer classes at all. This is
dramatically simpler and more robust than the alternative this session
initially expected to need (MapLibre exposes low-level `MapRenderer`
hooks — `onSurfaceCreated(Surface)` etc. — that a determined caller
could technically drive manually; the VirtualDisplay/Presentation
approach sidesteps needing any of that entirely).

**A real, confirmed instance of "the README doesn't match the actual
code," same lesson this project has hit before (the `automotive_app_desc.
xml` doubt from phase 1) — worth remembering, not just re-noting.** The
sample's own `README.md` describes an OLDER approach: render the MapView
offscreen in texture mode, extract a `Bitmap` from its `TextureView`,
draw it onto the Surface via a `Canvas`, 30 times a second. The ACTUAL
current source (`CarMapContainer.kt`/`CarMapRenderer.kt`, read directly)
does no such thing — it uses the VirtualDisplay/Presentation approach
described above, with no bitmap-blitting code anywhere. The repo clearly
evolved to a better approach after the README was last updated. Built
VCAS's own integration from the real current source, not the README's
prose description of an approach the code no longer uses.

**`VcasMapContainer.kt`/`VcasMapRenderer.kt`** (new,
`android/app/src/main/java/org/vectair/vcas/car/`) — a close adaptation
of the reference's `CarMapContainer.kt`/`CarMapRenderer.kt`, including
its pan/zoom gesture handling (`onScale`/`onScroll`, the double-tap-to-
zoom convenience) since that's genuine, cheap-to-include interactivity
from the same verified source, not custom-written. Two deliberate,
individually-documented deviations from a pure line-for-line port, both
flagged inline in the code rather than silently diverging:
- `cleanUpMap()` does NOT port the reference's own
  `carContext.windowManager.removeView(this)` call — the reference's
  `setupMap()` never adds the MapView via `WindowManager` at all (it
  becomes a `Presentation`'s content view instead), so that call looks
  like a real leftover from the same older approach the stale README
  describes, not something that would actually work if ported (calling
  `removeView()` on a View never added via that `WindowManager` would be
  expected to throw).
- `onDestroy()` explicitly dismisses the `Presentation` and releases the
  `VirtualDisplay` — the reference doesn't, a real if minor resource-
  cleanup gap in a demo app that doesn't need to care about app-exit
  leaks the way VCAS's own codebase should.

**`MapScreen.kt`** (new, replaces phase 1's `MainScreen.kt`/
`MessageTemplate` entirely — deleted rather than left as unused dead
code) — a real `NavigationTemplate` with `Action.PAN` in its map action
strip (confirmed, independently, against BOTH the MapLibre reference AND
Google's own official navigation sample, that this alone is what enables
interactive pan/zoom gestures on the Surface — no other wiring needed).
Deliberately minimal beyond that, matching the reference sample's own
scope: no zoom in/out buttons (no icon drawables exist for them yet), no
routing/travel-estimate info (no real route exists yet — that needs
`RouteGeometry.kt`/`NavigationCameraEvaluator.kt`, already ported, wired
to real GPS, a later step). `setMapActionStrip()` is gated behind
`carContext.carAppApiLevel >= 2`, matching how both real references gate
the same call rather than assuming every host supports it.
`VcasSession.kt` now constructs `VcasMapRenderer(carContext, lifecycle)`
— the renderer needs the *Session's* own lifecycle (its `onCreate`/
`onDestroy` is what registers/unregisters the `SurfaceCallback`), not
any one `Screen` that might later be pushed on top of it. Not stored as
a field or handed to `MapScreen` — nothing reads it back yet, since
`MapScreen` has no zoom buttons to wire it to and gesture handling
already flows straight from the host to the renderer's own
`SurfaceCallback` methods independent of any `Screen`. A later step that
genuinely needs to reach it (camera re-centering once GPS is wired up,
say) is a real, expected reason to start retaining it then — not a gap
being left now.

**Cross-validated every non-trivial Car App Library call against TWO
independent real sources, not just the MapLibre sample alone** — since
the MapLibre sample is a third-party community project (Flitsmeister, not
Google), each API call it relies on was separately checked against
Google's own official navigation sample (`android/car-samples`, already
cloned from phase 1's systematic-diff work) before trusting it:
- `carContext.getCarService(AppManager::class.java).setSurfaceCallback(...)`
  — the exact same `getCarService(Class)` pattern, found independently in
  Google's own `SurfaceRenderer.java`.
- `SurfaceCallback`'s actual required method set — grepped Google's own
  `SurfaceRenderer.java`'s anonymous implementation: exactly the same six
  methods this port implements (`onSurfaceAvailable`/
  `onVisibleAreaChanged`/`onStableAreaChanged`/`onSurfaceDestroyed`/
  `onScroll`/`onScale`), with `onClick`/`onFling` NOT overridden there
  either — confirming these two are genuinely optional/default-
  implemented in the real interface, not an omission.
- `androidx.car.app.ACCESS_SURFACE` — required by both samples'
  manifests for exactly this purpose.
- `androidx.car.app.MAP_TEMPLATES` — declared by the MapLibre sample's
  manifest but NOT by Google's own official sample, which achieves the
  identical `setMapActionStrip()`/`Action.PAN` functionality without it.
  Followed the official sample's leaner manifest where the two disagreed
  rather than including a permission that isn't demonstrably needed.

**Manifest/build changes**: `AndroidManifest.xml` gained
`android.permission.INTERNET` (genuinely needed now for map tile
loading — phase 1's manifest comment explaining why it was absent was
updated, not left stale) and `androidx.car.app.ACCESS_SURFACE`.
`build.gradle.kts` gained `org.maplibre.gl:android-sdk:11.7.0` — this
dependency IS `mavenCentral()`-hosted (unlike `androidx.car.app`), so
this exact version was verified reachable by actually downloading its
`.aar` from `repo1.maven.org`, not merely assumed. **11.7.0 specifically,
not the newer 13.5.1 latest as of writing** — deliberately matching the
version the real, working reference sample itself pins, on the reasoning
that "confirmed compatible with this exact VirtualDisplay/Presentation
approach in a real project" beats "latest," which nothing here could
verify is still compatible. Also checked directly (downloaded and
inspected the AAR's own embedded manifest, not assumed): MapLibre's SDK
itself declares `minSdkVersion 21`, well under VCAS's existing `minSdk
23` — no minSdk bump was needed for this dependency, despite the
reference sample itself using `minSdk 29` (that appears to be the
sample author's own baseline choice, not a MapLibre requirement).

**The map style is MapLibre's own public demo tiles**
(`https://demotiles.maplibre.org/style.json`), the same placeholder the
reference sample itself ships with — deliberately not VCAS's real
MapTiler style (`src/config.js`'s `MAPTILER_KEY`) yet. That key is
scoped to the PWA's own web usage (likely referrer/domain-restricted,
metered against the web app's own traffic) and reusing it for a native
app without checking is a real product decision, not something to just
wire in silently — flagged as a `TODO` in `VcasMapContainer.kt` rather
than decided unilaterally here.

**Honest status, same caveat as phase 1, for the same reason**: this has
never been compiled. This sandbox still has no Android SDK and still
can't reach `dl.google.com` (where the Car App Library's own AAR is
hosted, so its exact `getCarService`/`SurfaceCallback`/`NavigationTemplate`
signatures couldn't be checked against a live artifact — only
cross-referenced against two independent real *source* samples, which is
corroboration, not compilation). Opening this in Android Studio for a
real build — and, once that succeeds, sideloading it via Android Auto's
Developer Mode the same way phase 1 was — is still the actual check, not
anything done here.

Not yet done, and not implied by this milestone: wiring any of the
already-ported-and-verified logic (`Geo`/`Visibility`/`Relevance`/
`AircraftExtrapolation`/`Indicators`/`NavigationCameraEvaluator`) to this
real map — real GPS, real ADS-B polling, drawing traffic indicators on
the map surface, driving the camera via `NavigationCameraEvaluator`'s
own output. Each is a separate, substantially larger step, addressed
only on further explicit instruction.

## Android Auto phase 2 follow-up: real GPS driving the camera (2026-08-25, same day)

Direct instruction to continue: "Wire up real GPS to drive the camera
next." The first of the "not yet done" items listed just above this
entry. Real location fixes now flow into the already-ported
`NavigationCameraEvaluator`, and its output drives the real MapLibre
camera — the first time any of the six ported logic files is actually
wired to live device input rather than just unit-tested.

**Location permission flow — researched against two real, disagreeing
references, followed the more authoritative one where they conflicted.**
Both `android/car-samples` (Google's own official sample) and
`maplibre/MapLibre-Android-Auto-Sample` (already cloned for phase 2's map
work) implement a location-permission screen, but via genuinely different
mechanisms: the MapLibre sample assumes a phone-projected Android Auto
session can't show a system permission dialog at all and routes around it
by launching a separate phone-side `Activity`
(`PhonePermissionActivity.kt`); Google's own official sample
(`RequestPermissionScreen.java`) calls `CarContext.requestPermissions()`
directly with no such workaround, asserted working. Followed Google's
simpler, more authoritative approach — `LocationPermissionScreen.kt` is
adapted from `RequestPermissionScreen.java`, not the community sample's
more elaborate version. Both references independently agree on the
surrounding structure regardless — `VcasSession.onCreateScreen()` pushes
`MapScreen` first (as the screen stack's base, since the map itself needs
no location permission to render) and pushes `LocationPermissionScreen`
on top only if permission is missing, with a grant callback popping back
to the already-live map underneath (`ScreenManager.popToRoot()` —
confirmed against Google's own sample; the MapLibre sample's `popTo(
"ROOT")` uses a marker string that isn't how the real API actually
works).

**A real, previously-unverified API mismatch caught by checking real
source instead of trusting phase 1's own never-independently-verified
code**: phase 1's original (now-deleted) `MainScreen.kt` used
`MessageTemplate.Builder().setTitle(...).setHeaderAction(...)` — but
Google's own `RequestPermissionScreen.java`, building the exact same
`MessageTemplate`, uses `.setHeader(new Header.Builder().setTitle(...)
.setStartHeaderAction(...).build())` instead — a newer, unified `Header`
object bundling both, not the older separate calls. `LocationPermissionScreen.kt`
was written against the confirmed-current pattern.

**GPS itself**: plain `android.location.LocationManager` (`GPS_PROVIDER`,
`LocationListenerCompat` from `androidx.core` for the SAM-lambda-friendly
listener), not Play Services' `FusedLocationProviderClient` — confirmed
against Google's own sample using the identical API for the identical
purpose (`NavigationSession.java`'s `requestLocationUpdates()`). Needs no
extra dependency at all, unlike Play Services location (`dl.google.com`-
hosted, unverifiable from this sandbox the same way `androidx.car.app`
already is). `VcasMapRenderer.startLocationUpdatesIfPermitted()` is
called from three places — `VcasSession` (immediately, if already
granted), `LocationPermissionScreen`'s grant callback, and
`onSurfaceAvailable()` itself (defensively, in case the surface becomes
ready before either of the other two paths runs) — deliberately
idempotent (a `locationUpdatesActive` guard) so calling it redundantly
from all three costs nothing.

**Driving the real camera — `CameraAnchor.kt`, the one piece of this
follow-up kept as pure, independently-verified logic.** `Navigation
CameraEvaluator.evaluate()` returns `anchorX`/`anchorY` as *fractions of
the viewport* — where the user's real position should render on screen —
exactly the concept CLAUDE.md's own "Camera anchor math" section
documents at length for the PWA's `CameraController`, which achieves it
via a manual per-frame `jumpTo()`+`panBy()` animation loop specifically
because that was the tool available in a browser. MapLibre Native's
Android SDK exposes the same underlying padded-center convention as a
first-class, declarative part of `CameraPosition` itself (a `padding`
array alongside target/zoom/tilt/bearing — confirmed by reading
`CameraPosition.kt`/`MapLibreMap.java` directly in the cloned
`maplibre-native` source), so this follow-up uses that native support
directly rather than porting the PWA's own frame-loop workaround.
`CameraAnchor.paddingForAnchor(anchorFraction, dimension)` derives the
`(low, high)` padding pair placing MapLibre's padded-center at exactly
`anchorFraction * dimension`, always leaving whichever side needs less
padding at exactly zero rather than splitting padding across both sides.
Deliberately kept in `org.vectair.vcas.car.logic` with zero Android/
MapLibre imports specifically so it could be verified the same way as
every other file in that package — `CameraAnchorTest.kt`, 9 `@Test`
methods, checking the actual padded-center invariant
(`low + (dimension-low-high)/2 == anchorFraction*dimension`) rather than
just hand-picked output numbers, including a sweep across 9 fractions ×
4 realistic viewport dimensions. **All 9 pass against the real, shipped
`CameraAnchor.kt`, alongside the pre-existing 143 tests from the six
prior logic ports (152 total, zero failures)** — same standalone
`kotlinc`+JUnit4 toolchain used throughout this project's Android work.

**A real, load-bearing native-SDK constraint found by reading
`MapLibreConstants.java` directly, not assumed**: the evaluator's own
pitch clamp is `[0, 85]` (a value that reads as a web-MapLibre-GL-JS-era
convention, already documented as-is in `NavigationCameraEvaluator.kt`'s
own port) — but MapLibre Native's Android SDK declares its OWN, stricter
`MAXIMUM_TILT = 60`. `HIGHWAY_GUIDANCE`'s own base preset pitch (60) sits
exactly at this native ceiling with zero headroom, meaning this isn't a
defensive formality: `VcasMapRenderer.applyCameraResult()` clamps
`result.pitch` to MapLibre's real `MAXIMUM_TILT` before building the
`CameraPosition`, since building one with `tilt > 60` would throw
(`CameraPosition`'s own constructor javadoc, read directly, documents
this as an `IllegalArgumentException`).

**Known, honestly-scoped simplifications, documented inline rather than
silently left as unstated gaps**: `mode` is hardcoded `"nav"` (no
AIR-mode-equivalent UI exists in the native app yet) and `routeActive` is
hardcoded `false` (no routing wired up yet — phase 3's job, and without
it `TURN_APPROACH`/`DECOUPLED_MANEUVER` can never actually be reached, so
that bearing mode isn't specially handled either). Camera bearing always
follows the GPS fix's own reported heading, holding the last known value
while stationary — there's no compass-sensor fallback yet. CLAUDE.md's
own native-rewrite scoping note already correctly flags `compassHeading.js`
as NOT needing a port at all (native Android reads a real orientation
sensor directly instead of fighting browser API fragmentation) — but
actually wiring up `SensorManager`/`Sensor.TYPE_ROTATION_VECTOR` for the
stationary case is itself still real, separate, not-yet-done work, not
something this pass silently completed.

**Honest status, same caveat as the rest of this native project**:
`VcasMapRenderer.kt`/`VcasSession.kt`/`LocationPermissionScreen.kt` have
never been compiled — no Android SDK, no `dl.google.com` access, same
limitation as everything else in `android/`. Every non-trivial API call
used here was cross-checked against real source (Google's official
sample, the MapLibre community sample, and MapLibre Native's own actual
SDK source read directly for `CameraPosition`/`CameraUpdateFactory`/
`MapLibreMap`/`LatLng`/`MapLibreConstants`) — corroboration, not
compilation. `CameraAnchor.kt` is the one piece of this pass that IS
genuinely, fully verified, being pure Kotlin with no platform
dependency. Opening this in Android Studio is still the actual check for
everything else.

Not yet done: real ADS-B polling, drawing traffic indicators on the map
surface (`Indicators.kt`'s own output has nowhere to render yet), the
device-compass fallback for stationary heading, and routing (needed
before `TURN_APPROACH`/`DECOUPLED_MANEUVER` can ever be exercised) — each
a separate, substantially larger step, addressed only on further explicit
instruction.

## Android Auto phase 2 follow-up: real ADS-B polling (2026-08-25, same day)

Direct instruction to continue: "Wire up ADS-B polling next" — the next
item off the "not yet done" list the GPS-wiring entry just above this one
left behind. Real HTTP polling against adsb.fi now runs on a timer,
producing a live, normalised aircraft list — deliberately scoped to just
polling + parsing, not rendering (see "Deliberately scoped" below).

**Calls adsb.fi directly — no CORS relay involved, and none needed.**
CLAUDE.md's own "ADS-B data source" section already establishes exactly
why: the relay exists because a *browser's* `fetch()` can't read adsb.fi's
response (no CORS header) and because *many concurrent PWA testers*
funneled through one shared relay could exceed adsb.fi's 1req/s limit in
aggregate — and separately notes "a real native app's HTTP requests
aren't subject to browser CORS restrictions at all, so this whole relay
becomes unnecessary at that point." This is that point: `AdsbFiClient.kt`
uses plain `HttpURLConnection` (no CORS concept exists for it at all) and
polls at the same 3s interval the PWA itself uses
(`CONFIG.REFRESH_INTERVAL_SECONDS`) as a single client, nowhere near the
aggregate-load scenario the relay's throttle was built for.

**`normaliseAircraft.js` → `NormaliseAircraft.kt`, a second discovered
dependency (after `routeGeometry.js`).** Not on the original "cleanly
portable" scoping list, but pure logic all the same — the actual field-
name/parsing knowledge that turns a raw ADS-B JSON record into VCAS's
internal aircraft shape. Takes a real `org.json.JSONObject`: Android's
own SDK bundles that class at runtime (so the shipped app needs no extra
dependency for it), and — usefully — the standalone `org.json:json`
Maven Central artifact implements the identical public API, which is
what makes this file's own test suite genuinely runnable in this
sandbox (no Android SDK here either), the same trick that already made
every other logic port possible.

**The one subtlety worth real care in this port: JS's `??` vs `||`, used
deliberately differently per field in the source, and easy to blur
together if translated carelessly.** The numeric-ish fields (`alt_baro`,
`seen_pos`, `track`, `gs`, etc.) chain with `??` (nullish coalescing) —
falls through ONLY on null/undefined, so a real `0` (an aircraft at 0ft
barometric altitude, or seen 0 seconds ago) must survive intact. The
string fields (`hex`, `flight`, `category`, etc.) chain with `||` — falls
through on an empty string too, not just absence. `NormaliseAircraft.kt`
gives these two chains separate helpers (`firstPresent` for `??`,
`firstNonBlank` for `||`) rather than one generic "first non-null" helper
that would have silently collapsed the distinction. `NormaliseAircraftTest.kt`
(30 `@Test` methods) specifically exercises the boundary case each
distinction exists for — `altBaroRealZero_isNotTreatedAsGround_and
SurvivesTheNullishChain`, `seenPosRealZero_survives_notTreatedAsAbsent`,
`blankCallsign_isTreatedAsAbsent_null` — plus JS `parseFloat`'s own
lenient-leading-numeric-token behaviour (`"250kt"` parses as `250`, not
NaN), replicated faithfully via a small regex rather than
`String.toDoubleOrNull()` (which would reject the whole string outright).
**All 30 pass against the real, shipped `NormaliseAircraft.kt`, alongside
the pre-existing 152 tests (182 total, zero failures)** — same standalone
`kotlinc`+JUnit4 toolchain used throughout this project's Android work,
now additionally using a real downloaded `org.json:json` jar rather than
just `kotlin-stdlib`.

**`AdsbFiClient.kt`** (new) — the actual Android-specific polling class:
a self-rescheduling `Handler.postDelayed` timer (matching
`VcasMapRenderer`'s own Handler-based patterns already established),
each tick reading the *current* GPS fix via a `locationProvider` lambda
(not a position captured once at construction — matches the PWA's own
`fetchNearby(lat, lon, ...)` always being called with the user's live
position) and dispatching the actual network call onto a background
single-thread executor (`HttpURLConnection` on the main thread throws
`NetworkOnMainThreadException`), delivering results back via the main
`Handler`. Mirrors `adsbExchangeClient.js`'s `adsb_fi` provider's own
constants — `dist` capped at 250nm (adsb.fi's documented max), an 8s
timeout (matching the PWA's `AbortSignal.timeout(8000)`), a 3s poll
interval, 50nm default range (matching `CONFIG.DEFAULT_RANGE_NM`). A
failed poll (network error, non-200 status, malformed JSON) degrades to
"no update this tick" via a logged warning, never a crash — the next
scheduled tick simply tries again, matching the PWA's own generic
error-handling philosophy in `_fetchFromProvider()`.

**Deliberately NOT ported in this pass: the PWA's multi-provider round-
robin/fallback machinery.** `adsbExchangeClient.js` round-robins across
`CONFIG.DATA_PROVIDERS` with same-tick fallback to the next provider on
error — but VCAS's actual current config is `DATA_PROVIDERS: ["adsb_fi"]`,
a single provider, and CLAUDE.md's own "ADS-B data source" section is
explicit that this is "the deliberate current choice, not an oversight."
Porting a round-robin abstraction for a list that only ever has one
real, currently-usable entry (`adsb_lol`'s own docs flag a likely future
feeder-gated key requirement; `adsb_exchange` needs a paid key VCAS
doesn't have) would be speculative generality with nothing to actually
select between right now — closer to over-engineering than a faithful
port. If a second provider is ever added back to the PWA's own config,
extending `AdsbFiClient.kt` (or generalising it into a real multi-
provider client) is a reasonable, real, separately-scoped follow-up.

**Deliberately scoped to polling + normalising only, not indicators or
rendering.** `VcasMapRenderer` now owns an `AdsbFiClient`, started/
stopped alongside GPS updates (the same lifecycle
`startLocationUpdatesIfPermitted()`/`stopLocationUpdates()` already
manage), and stores each successful poll's result in `latestAircraft` —
but nothing yet feeds that list through `Indicators.build()`/
`AircraftExtrapolation.extrapolateAll()` (the already-ported, already-
tested pipeline that exists for exactly this), and nothing draws
anything on the map surface. This isn't an oversight — matching the
user's own exact phrasing ("wire up ADS-B polling," not "...and
indicators" or "...and rendering"), and matching how GPS wiring itself
was scoped to driving the camera without also drawing a user marker.
Real polling is independently observable/verifiable right now via a log
line (`Log.i("VcasMapRenderer", "ADS-B: N aircraft in range (...)")`),
not a placeholder. Feeding `latestAircraft` through `Indicators`/
`AircraftExtrapolation` and actually drawing traffic markers on the
MapLibre surface remains a separate, larger follow-up.

**Honest status, same caveat as every other Android-integration file in
this project**: `AdsbFiClient.kt` and `VcasMapRenderer.kt`'s new wiring
have never been compiled against a real Android SDK — no way to verify
that here. `NormaliseAircraft.kt` is the one piece of this pass that IS
genuinely, fully verified (real `kotlinc`+JUnit4 execution against a real
`org.json:json` implementation), the same distinction `CameraAnchor.kt`
already established for the GPS-wiring follow-up.

Not yet done: feeding `latestAircraft` through `Indicators.build()`/
`AircraftExtrapolation`, drawing traffic markers on the map surface, the
device-compass heading fallback, and routing — each a separate,
substantially larger step, addressed only on further explicit
instruction.

## First real Android Studio build, first real compile error — a reference-source VERSION mismatch, not a mistake in the API shape (2026-08-26)

The project owner did the actual first-ever real build attempt of all
the phase-2/GPS/ADS-B work above, in Android Studio on their own
machine. Real compiler output, not another sandbox-side corroboration
pass: `LocationPermissionScreen.kt:68:14 Unresolved reference: setHeader`.

**Root cause**: `LocationPermissionScreen.kt` was originally written
against `.setHeader(Header.Builder().setTitle(...).setStartHeaderAction(...)
.build())` on `MessageTemplate.Builder`, copied from Google's own
official `android/car-samples` repo's `RequestPermissionScreen.java` —
this project's own established "verify against real reference source"
discipline, applied as it has been throughout every logic port and
manifest fix in this file. But that specific API call doesn't exist on
the real, public `androidx.car.app:app:1.4.0` release VCAS's
`build.gradle.kts` is actually pinned to — because `car-samples`' own
`libs.versions.toml` pins `androidx-car = "1.9.0-alpha01"`, a newer,
unreleased AndroidX-internal monorepo build. This exact discrepancy had
already been flagged once before, during phase 1's systematic manifest
diff ("not a fair like-for-like comparison... VCAS's own build already
compiles clean against the public release") — but that earlier flag was
about a dependency version number, not about individual API calls
differing in shape between versions, so it didn't prevent this file from
being written against the newer, unavailable API shape.

**Fix**: MapLibre's own community reference sample
(`maplibre/MapLibre-Android-Auto-Sample`, already cloned and used for
phase 2's map work) correctly pins `carApp = "1.4.0"` — the SAME version
VCAS actually uses — and its own `CarPermissionScreen.kt` uses the
plain, older pattern instead: `.setTitle(...)` and `.setHeaderAction(...)`
called directly on `MessageTemplate.Builder`, no separate `Header` object
at all. This also matches phase 1's own original (now-deleted)
`MainScreen.kt`, which used the same direct-builder pattern. Rewrote
`LocationPermissionScreen.kt`'s `onGetTemplate()` to match: removed the
`Header` import and the `.setHeader(Header.Builder()...)` block, added
`.setTitle("Location Permission").setHeaderAction(Action.APP_ICON)`
directly on the `MessageTemplate.Builder` chain instead.

**The real lesson, sharpened from what was already on record**:
cross-checking an API call against real reference source only protects
against a mistake if that source targets the SAME LIBRARY VERSION
actually pinned in the project — not just "the same library, from an
authoritative/official source." Google's own sample is entirely
legitimate and correctly-written for the version IT targets; the bug was
using it as a stand-in for a different, older version's API surface
without checking whether that specific call was even present at 1.4.0.
Going forward, when both an official sample and a community sample of
the same library are available and their pinned versions genuinely
differ from what VCAS uses, prefer whichever one's pinned version
actually matches VCAS's own dependency line — that match matters more
than which source is more "official." This is the first real compile
error from an actual Android Studio build across all of this project's
Android Auto work to date; everything else built so far compiled clean
on the first attempt, per the project owner's own confirmation.

Fixed, committed, and pushed; not yet re-confirmed by a fresh build —
that's the immediate next step once the project owner retries it.

**Confirmed (2026-08-26, same day): the rebuild succeeded with no
further errors.** This is the first clean, full compile of all of phase
2's work — the real MapLibre map integration, the GPS-driven camera
(`VcasMapRenderer`/`CameraAnchor`), and the ADS-B polling
(`AdsbFiClient`/`NormaliseAircraft`) — confirmed against a real Android
Studio build, not sandbox corroboration. Only one real error surfaced
across this entire body of work (the `setHeader` version mismatch
above), and it's now fixed. **Still not yet done/confirmed**: installing
the built APK onto the phone, and — the actual open question left over
from phase 1, never yet re-confirmed after phase 1's own manifest fixes
— whether VCAS shows up and launches in Android Auto's car-side app
list at all. A clean compile says the code is syntactically/type valid
against the real SDK; it says nothing yet about runtime behavior (does
the map actually render on the car's Surface, does GPS/ADS-B actually
flow in, does Android Auto register the app as a candidate). Those are
the next real checks, in that order, once the project owner installs
and sideloads.

## A real phone-visible app, independent of Android Auto (2026-08-26, same day)

Direct instruction: VCAS should work like Google Maps — a real,
independently-useful standalone app when tapped directly on the phone
(walking, no car involved), not just a car-projected experience via
Android Auto. Since phase 1, `MainActivity` had existed only as a
placeholder ("Open Android Auto while connected to your car") — real
content for the phone-tap case had never been built. Asked directly
whether the fastest path (a `MainActivity` hosting a `WebView` around the
already-deployed, already-tested PWA) or a fully native Kotlin phone UI
was wanted, since the two differ hugely in scope; the project owner chose
**fully native** — no shortcut through the web UI, matching the same
standard CLAUDE.md's own scoping note already set for the car-Surface UI
layer ("needs a genuine rebuild," not a WebView wrapper).

**One APK, two independent entry points — neither stands in for the
other.** `VcasCarAppService`/`VcasSession`/`MapScreen` (the whole car
side, phases 1-2 above) is completely untouched by this work.
`MainActivity` — previously a bare placeholder — is now a real, separate
screen: its own `MapView`, its own GPS wiring, its own `AdsbFiClient`
instance, its own camera-driving logic. Android Auto's own discovery of
the car app was never driven by `MainActivity` existing or not (that's
`VcasCarAppService`'s own manifest intent-filter, independent of any
launcher activity — established back in phase 1's own systematic diff),
so making `MainActivity` real doesn't touch or risk the car-side path at
all.

**New files**: `PhoneMapContainer.kt` (a plain-Activity sibling to
`VcasMapContainer.kt`, genuinely simpler in three ways: no `CarContext`,
no manual gesture math since a MapView added to a real Activity view
hierarchy already receives real touch/pinch/pan gestures itself — unlike
Android Auto's `SurfaceCallback`, which only delivers synthetic
scroll/scale calls — and real `onCreate(Bundle?)`/`onSaveInstanceState
(Bundle)` lifecycle calls wired up, which the car-Surface `Presentation`
path has no equivalent for). `MainActivity.kt` is a full rewrite: real
`LocationManager` GPS wiring (identical pattern to `VcasMapRenderer.kt`'s
already-established one), the same `AdsbFiClient` instance type reused
completely unchanged (it has zero `CarContext` dependency, confirmed
before reusing it), and `NavigationCameraEvaluator`/`CameraAnchor` reused
exactly as the car side uses them — but with `mode = "air"` rather than
`"nav"`, since the evaluator's flat, centred, low-pitch `AIR` preset
(pitch 0, zoom 10, anchor 0.5/0.5) is the right camera geometry for
"glance at what's around you while walking," not the driving-oriented
urban/highway/turn state machine `mode = "nav"` drives on the car side.

**Deliberately calls `Visibility.estimate()`/`Geo.calculateDistanceNm()`
directly, not the `Indicators.build()`/`buildAll()` pipeline** — those
two entry points exist for the PWA's NAV/RAW polar-projection display
(screen x/y around a forward-looking anchor, relevance-gated, FOV-
restricted), concepts that only mean something for that specific
display. This screen is a real geographic map: every currently-tracked
aircraft is plotted at its own true lat/lon via a MapLibre `Marker`,
matching how the PWA's own AIR mode works (unfiltered by relevance, not
polar-projected) rather than NAV/RAW's teardrop-gated display. Routing
through `Indicators` here would compute a polar x/y this screen never
uses and imply a relevance gate real map markers don't have —
`Visibility`/`Geo` (the same two dependencies `Indicators` itself is
built from) are called directly instead, just without the parts specific
to the other display.

**Real-source-checked, not guessed, the same discipline this project's
whole Android history is built on** — cross-referenced directly against
the cloned `maplibre-native` source rather than assumed from the car-side
code's own success: `MapView.java`'s own doc comments (read directly)
confirm the real Activity-lifecycle contract (`onCreate(Bundle?)` from
`Activity#onCreate`, `onSaveInstanceState(Bundle)` from
`Activity#onSaveInstanceState`, plus `onStart`/`onResume`/`onPause`/
`onStop`/`onDestroy`/`onLowMemory`) — a contract the car-Surface
`Presentation` path never needed since a `Presentation` has no
`Activity`-style save/restore lifecycle to hand a `Bundle` through.
`MapLibreMap.addMarker(MarkerOptions)`/`removeMarker`/`clear()` and
`BaseMarkerOptions.position()/title()/snippet()` were all confirmed
present in the real SDK source before use — `OnMarkerClickListener` is
real too but deliberately NOT wired up, since `MapLibreMap.java`'s own
javadoc confirms tapping a marker with `title()`/`snippet()` set already
shows a built-in info window with that text with no listener needed at
all, the simplest possible "tap for detail" implementation. Also
confirmed directly: this classic `Marker`/`addMarker()` API is itself
marked `@Deprecated` in the real source (in favour of a separate
Annotation Plugin Maven artifact) — noted, not chased; migrating to that
plugin is real, separate follow-up work, not something silently glossed
over, and the deprecated-but-present API is a reasonable choice for a
first pass over pulling in a new, `dl.google.com`-unrelated but still
unverified dependency.

**Permission flow uses plain `Activity#requestPermissions()`/
`onRequestPermissionsResult()`** (framework API since API 23, matching
this project's `minSdk`) rather than `androidx.activity`'s
`registerForActivityResult` — consistent with `MainActivity`'s original
phase-1 choice to stay on plain `android.app.Activity` rather than
`androidx.activity.ComponentActivity` specifically to avoid a new
`dl.google.com`-hosted dependency this sandbox can't verify live.

**Known, deliberately-scoped simplifications for this first pass, stated
plainly rather than left as silent gaps**: no own-position marker (the
camera already centres on the true GPS fix every update via AIR's
0.5/0.5 anchor, so the user's position is always screen-center); markers
are fully cleared and rebuilt on every ADS-B poll (3s) rather than
diffed by hex the way the PWA's own `EosMap.renderAirMarkers` already
is — a real, later optimization opportunity, not a correctness gap; no
`AircraftExtrapolation` smoothing between polls (already ported and
verified, just not wired in here yet); no per-visibility-category marker
icon tinting (the tier's own colour/label is plain text in the marker's
info-window snippet instead of a coloured icon bitmap); foreground-only
by design (GPS/ADS-B start in `onResume()`, stop in `onPause()`) since
this activity only holds foreground-scoped `ACCESS_FINE_LOCATION`, not
`ACCESS_BACKGROUND_LOCATION` — real background tracking needs the
already-scoped-but-undone "phase 4" foreground-`Service` work, not
something an Activity alone can correctly provide.

**Honest status, same caveat as every other Android-integration file in
this project**: never compiled — no Android SDK in this sandbox, same
limitation as everything else in `android/`. Every non-trivial API call
was cross-checked against the real MapLibre Native Android SDK source
(cloned locally), and the GPS/permission/lifecycle wiring reuses patterns
already established and JUST confirmed to compile clean in a real
Android Studio build (`VcasMapRenderer.kt`'s own GPS wiring, the plain
`Activity` base class choice) — corroboration plus reuse of
already-verified patterns, not compilation of this exact new code. The
real check is still opening this in Android Studio and building it.

## Phone screen, real pass 1: real icons, real map style, real chrome (2026-08-26, same day)

First real-device feedback on the phone screen above: a screenshot
showing generic default red pin markers on MapLibre's own demo tiles,
with a bare "VCAS" label in the OS's default black action bar —
technically working (54 real aircraft polled and plotted) but visually
nothing like VCAS. Correct reaction, and a fair one — the "known
simplifications" note above undersold how far a functional pipeline
still was from looking like the app. Asked directly what to prioritize;
project owner chose all three, in order: real marker icons/colours, real
map style, real chrome.

### 1. Real TCAS-style aircraft icons, via `SymbolManager` not classic `Marker`

The very first cut used `MapLibreMap.addMarker(MarkerOptions)` — found,
while building this, to be marked `@Deprecated` in the real SDK source
in favour of a separate Annotation Plugin artifact, and — the actual
reason it had to go, not just the deprecation notice — to have **no icon-
anchor customisation at all**. A custom (non-pin-shaped) bitmap icon
would be pinned by a fixed corner instead of centred on the true point,
exactly backwards for a TCAS-style symbol that has to sit centred on the
aircraft's real position, not dangle from it like a map pin.

Added `org.maplibre.gl:android-plugin-annotation-v9:3.0.2`
(`SymbolManager`/`SymbolOptions`, GL-rendered — not a per-marker View the
way the plugin's sibling MarkerView variant works, which matters at 50+
aircraft). **Version-compatibility checked before pinning it, learned the
hard way from the `androidx.car.app` 1.4.0-vs-1.9.0-alpha mismatch that
caused this project's one real compile error so far** (see above): the
plugin's own POM (downloaded and read directly from `repo1.maven.org`)
declares a dependency on `android-sdk:11.3.0` — a same-major-line minor
version behind the `11.7.0` this project already pins, not a cross-
major/pre-release jump. Its real API (`SymbolManager`'s constructor/
`create()`/`addClickListener()`, `SymbolOptions`' builder methods,
`Property.ICON_ANCHOR_CENTER`) was cross-checked against the actual
plugin source, cloned and checked out at the matching `v3.0.2` git tag
(`maplibre/maplibre-plugins-android`) — not guessed from the older
Mapbox-derived API's general shape, same discipline as every other
dependency in this project.

`PhoneAircraftIcons.kt` (new) draws the real shape (diamond/circle/
square, ported from `aircraftSymbol.js`'s own SVG paths) plus a
direction-of-travel arrow (ported from `map.js`'s `_directionArrowSvg()`)
onto a real Android `Bitmap` via `Canvas`/`Path`. The arrow's rotation
was worked out by re-reading the PWA's actual CSS transform order on
`.direction-arrow` (`translate(-50%,-50%) rotate(trackDeg)
translateY(-16px)`) rather than guessing: the arrow orbits the ICON's own
centre point at a fixed radius (drawn at a fixed offset "above" the icon,
THEN rotated by `trackDeg` around the icon's centre), not rotating in
place while floating above it — the base shape itself is never rotated,
matching `aircraftSymbol.js`'s own doc comment that position alone
carries bearing.

**Bitmap layout is a square with the shape dead-centre, specifically so
`Property.ICON_ANCHOR_CENTER` genuinely centres the TRUE aircraft
position on the shape's own visual centre** — not some point compromised
by the arrow's variable position, which (unlike the earlier assumption
that it always sits "above" the icon) can orbit to ANY angle depending on
`trackDeg`. The bitmap's radius is sized to always contain the arrow at
any rotation, and the shape is drawn at the exact geometric centre either
way.

**Icon images are deliberately named and reused, not regenerated per
aircraft per poll** — `Style.addImage(name, bitmap)` with an
already-used name updates that image in place rather than accumulating a
new one, so `PhoneAircraftIcons.iconNameFor()` derives a deterministic
name from the actual shape/colour/fillOpacity/track values (track
quantized to 15° buckets, not the exact float) rather than a unique ID
per call — bounding the real distinct-image count to a few hundred at
most, reused across every poll, instead of leaking a new bitmap into the
style's image cache every 3 seconds forever.

`SymbolManager`'s `OnSymbolClickListener` has no built-in info window
(unlike the classic `Marker` API's title/snippet bubble) — tapping a
symbol now shows the same title/visibility-label/altitude/distance text
via a plain `Toast` instead (`MainActivity.kt`'s `symbolInfoById`, keyed
by each poll's own `Symbol.id`).

### 2. Real map style — MapTiler's own pre-made `streets-v2`, not VCAS's custom 31-layer style

**A real scope distinction, stated plainly rather than glossed over**:
`src/map/navStyle.js` builds the PWA's actual Hybrid look layer-by-layer
against raw OpenMapTiles vector tiles with VCAS's own tuned colour
palette (31 layer definitions, day/night variants) — porting THAT whole
thing to Kotlin `Style.Builder` calls is a real, separate, substantially
larger undertaking, comparable in scope to the rest of the "genuine UI
rebuild" work this project has already flagged elsewhere, not something
folded into this pass. What's wired in instead is MapTiler's own
pre-made `streets-v2` style — a single `style.json` URL swapped in for
the demo-tiles URL, same shape, same `MAPTILER_KEY` `src/config.js`
already has (duplicated in `PhoneMapContainer.kt` — no build-time bridge
between this native project and the PWA's own JS config, same reasoning
already established for the crash reporter's duplicated `LOG_ENDPOINT`/
`LOG_ENDPOINT_KEY`). Real streets/imagery now show instead of demo
tiles — not VCAS's own hand-tuned Hybrid palette, an honest middle
ground.

**Explicit confirmation asked before reusing the key**, since it's a
real decision touching the project owner's MapTiler account/quota, not
just code: try the existing key first (low risk — if MapTiler's
dashboard has it domain/referrer-restricted for web use, native tile
requests simply fail visibly rather than silently overcharging
anything), rather than holding off for a separate native-specific key.
Confirmed: try the existing key. A real `MapView.
OnDidFailLoadingMapListener` falls back to the demo style once if the
real key does turn out to be rejected, rather than leaving the map
permanently blank — a load failure is now visible/recoverable, not
silently fatal.

### 3. Chrome pass — VCAS's real cockpit-panel palette, not the OS default action bar

New `res/values/styles.xml` (`Theme.VCAS`, `parent="android:Theme.
Material.NoActionBar"`) removes the bare black OS action bar showing
just "VCAS" with no other styling — the exact thing the reported
screenshot showed. Plain framework theme, not AppCompat/Material
Components, same "avoid a new `dl.google.com`-hosted dependency this
sandbox can't verify" discipline `MainActivity`'s own plain `Activity`
base class and `requestPermissions()` permission flow already
established. `MainActivity` now builds its own two-line top bar (title +
live status) styled with the SAME `--bg-panel`/`--text-primary`/
`--text-secondary`/`--accent` hex tokens `VCAS.css`'s Night theme
actually uses (duplicated as literals for the same "no build-time bridge
to CSS" reason as the MapTiler key above) — plus a thin `--accent`-
coloured rule under the bar, echoing how the cockpit-panel rebrand
elsewhere in this project uses that colour as a distinct brand line
rather than the panel's own neutral material colour (see "Cockpit-panel
chrome rebrand" above).

**Deliberately NOT a port of the PWA's full top bar** (mode buttons,
ADS-B status pill, settings gear, the `#adsb-credit` line) — this is
still a single-view walking screen with no modes or settings yet, so
only the material/typography language was applied, not every element
that bar carries. **Flagged, not silently dropped**: the adsb.fi credit
line specifically is a real Pre-V1-checklist obligation (see that
section above — "their usage terms require citing them... for as long as
their data is used") that this screen doesn't yet satisfy, and would
need to before this screen could ever ship beyond personal use, same as
every other adsb.fi-consuming surface in this app. Always-dark palette
only, no Day/Night toggle — matching RAW mode's own "no day mode for a
cockpit instrument" precedent, and consistent with the still-open
"icons always use `vis.color`, not day/colourblind variants" gap already
noted in `MainActivity.kt`'s own doc comment.

**Honest status, same caveat as the rest of this file**: none of this
compiled here either — cross-checked against real MapLibre/plugin source
(the plugin cloned fresh at its matching git tag specifically for this
pass) and reusing patterns already confirmed to compile clean in the
real Android Studio build. The actual check is still building and
running this on a real device — which is exactly how the gap this whole
entry addresses was found in the first place.

### Follow-up: `styles.xml`'s own comment broke the build (2026-08-26, same day)

The real second build attempt (the very first XML resource this project
has ever added) failed with `The string "--" is not permitted within
comments` — a real, easy-to-forget XML rule: an XML comment body can
never contain two consecutive hyphen characters anywhere inside it, not
just at the delimiters. `styles.xml`'s own doc comment referenced the
CSS custom-property names it was duplicating with their real leading
two-hyphen prefix (as literally written in `VCAS.css`, e.g. the
background-dark and background-panel tokens) — which is exactly that
forbidden sequence, twice. Fixed by rewriting the comment to name those
tokens without their two-hyphen prefix, and added an explicit note
inside the same comment (itself carefully written with no two-hyphen
sequence anywhere) warning that this is the reason, so a future edit
doesn't reintroduce it. Every other `.xml` file already in `android/`
was re-checked the same way (`grep` for a literal `--` outside a
comment's own opening/closing delimiters) and came back clean — this was
new to `styles.xml` specifically, not a latent issue elsewhere. The
`.kt` files' own `--bg-panel`/`--accent`-style comments are unaffected —
Kotlin's `//`/`/* */` comments have no such restriction, only XML's do.

## Phone screen, real pass 2: the three-mode structure, RAW mode built (2026-08-26, same day)

Direct correction from the project owner after "phase 1" of the phone
screen (real icons/map style/chrome, above) still didn't read as VCAS:
"I want you to build this: https://vectair.github.io/VCAS/... I insist
that we use where that part of the project had reached before the move
to an apk based app as the starting point." A prior attempt to scope
this as "which single thing should I improve next" (map style vs.
chrome vs. typeface) was the wrong framing entirely — the real gap
wasn't polish on one screen, it was that the phone app only had ONE
screen (what phase 1 built was actually just AIR mode) when VCAS has
always been three separate screens with three different use cases:

- **RAW** — "I'm on the move but don't need navigation assistance and if
  something crosses my path I want the ability to quickly identify what
  it is" — passive identification, the PWA's actual dark TCAS-style
  plot, no map underneath at all.
- **HYBRID** — "I'm getting navigation assistance but it also gives me
  the option to identify what's flying past" — real navigation with
  aircraft data superimposed. Explicit permission to let the map's
  appearance diverge from the PWA's own hand-tuned Hybrid style if the
  native build calls for it ("I don't mind if the Hybrid map appearance
  changes due to the way it's built") — unlike RAW, which should
  function "essentially like it is now."
- **AIR** — "I'm not moving so can get a 360 view so am just interested
  in what's nearby" — stationary, stripped-back, unfiltered ADS-B view.
  This is what the phase-1 pass already built, just never correctly
  understood as one of three rather than the whole app.

**A full design review was done before writing any code, per direct
instruction** ("please go back and fully review the design and style
choices made") — the ENTIRE current `src/styles/VCAS.css` (2141 lines)
and `src/ui.js` (1216 lines, every RAW-mode rendering function:
`renderIndicators`/`declutterRenderedIndicators`/`renderCompassRing`/
`renderRangeRingsOverlay`/`renderRangeSelector`/`renderAircraftList`/
`renderSuppressedDots`/`showPopup`) were read in full this session — not
worked from memory or from this file's own summaries of past sessions,
matching the project's own repeated "verify against real source" rule
applied here to design/CSS, not just code logic. `src/aircraftSymbol.js`
and `src/map/navStyle.js` were already read in earlier sessions (see
above) and re-confirmed still current.

### RAW mode: built this pass, a faithful Canvas port

New files: `RawPlotView.kt` (a custom `View` — Canvas-drawn compass
tape, banded range rings, aircraft shapes/direction-arrows/decluttered
labels, the ND-style range-selector button) and
`RawAircraftListView.kt` (a real Android view — header sort-button row +
scrollable rows — for the Stage 3 aircraft-list panel, deliberately NOT
Canvas-drawn since it's a genuinely scrolling list widget, same
"use the real platform widget" reasoning already established for
`SymbolManager`/`MapView` elsewhere in this app).

**Reuses the already-ported, already-tested `Indicators.build()`
pipeline exactly as designed** — this is the first native consumer that
actually calls it the way `indicators.js` intends (screen x/y around a
forward-looking, FOV-restricted anchor), unlike AIR/HYBRID's map
markers, which deliberately bypass it (see the phase-1 entry above for
why). `MainActivity.kt`'s new `refreshRawMode()` builds the exact same
`Indicators.UserState` shape `app.js`'s `refreshIndicators()` does for
RAW — `plotWidth`/`plotHeight`/`plotOffsetX`/`plotOffsetY` from
`Geo.computeSquarePlotLayout()`, `anchorY` read from
`NavigationCameraEvaluator.STATE_PRESETS["NAV_RAW"].anchorY` (not a
second constant, so it can't drift from the value a real camera would
derive its own anchor from, matching the JS original's own explicit
reasoning for doing exactly this), `plotBandsNm` as a slice of
`RING_BANDS_NM` up to the selected range index. Every constant matches
the real PWA source, not approximated: `RAW_COMPASS_RESERVED_PX`=80,
`SQUARE_EDGE_MARGIN_PX`=16, default range index = position of 10nm in
`RING_BANDS_NM`, `STALE_THRESHOLD_SECONDS`=15 (read from
`src/config.js`, not guessed).

**Label decluttering is the one piece that couldn't be a literal
translation, and is called out as such in `RawPlotView.kt`'s own doc
comment**: the PWA's `declutterRenderedIndicators()` measures REAL
rendered DOM boxes via `getBoundingClientRect()` after painting; Canvas
has no such pass. Label width/height instead comes from
`Paint.measureText()` on the actual two label lines (type, altitude),
computed before the declutter pass runs rather than after — but the
algorithm itself (8 compass-direction candidates scored by total
obstacle overlap, first-clear-candidate wins, leader-line escalation up
to 5 steps for a still-crowded aircraft) is the same one, including the
"own icon exempt, own arrow NOT exempt" distinction the PWA's own
2026-08-24 fix established (see "Labels obscuring their own direction
arrow" above) — ported directly into the obstacle-gathering code
(`ownIconExemption` on each `Triple`), not re-derived from scratch.

**Range rings share the exact same `Geo.circularPlotRadius`/
`bandedRadiusFraction` formula the dots use** — the same "one shared
source, not two independently-computed values" fix this file already
documents at length for the PWA's own "8nm aircraft inside the 2nm ring"
bug (see "Rings and dots share one scale now" above) — ported as the
starting design here rather than something to rediscover a second time
in Kotlin. The compass-tape/rings/dots/range-selector/list-panel all
derive from the exact same `Geo.SquarePlotLayout` computed once per
frame, matching the PWA's own "one shared source" discipline for the
same reason.

**A real ambiguity in the PWA's own CSS was resolved by re-deriving,
not guessing**: the direction-arrow's `translate(-50%,-50%) rotate(deg)
translateY(-18px)` transform order has two plausible readings — "rotate
in place while floating above the icon" vs. "orbit the icon's own centre
point." Re-derived from CSS's actual composition order (rightmost
transform function applies first, to the element's own local
coordinates, before earlier ones) rather than assumed: the arrow orbits
the icon's centre at a fixed radius, pointing outward in the track
direction — the intuitively-correct "TCAS chevron indicating heading"
reading, and consistent with how the same ambiguity was already resolved
for AIR/HYBRID's own `PhoneAircraftIcons.kt` bitmap arrows earlier this
session. RAW's own `-18px` offset (not AIR's `-16px` — confirmed by
reading `renderIndicators()` in `ui.js` directly rather than assuming
the two match) is used here, not the value already baked into
`PhoneAircraftIcons.kt`'s bitmaps.

### Mode switcher + HYBRID's honest placeholder

`MainActivity.kt` gained a RAW/AIR/HYBRID segmented control (bottom bar,
`VCAS.css`'s `.mode-toggle` styling ported: flat segments in one
bevelled bank, active segment gets `--btn-active-bg`), RAW default,
matching the PWA's own button order and default (see "RAW as default"
above) rather than inventing a new one. GPS and ADS-B polling now keep
running continuously regardless of which mode is showing — only the
RENDERING branches on `currentMode` (`refreshRawMode()` vs. the
pre-existing AIR camera/marker code, now named `updateAirCamera()`/
`renderAirMarkers()`) — matching how the PWA's own data polling is mode-
independent, only its display isn't.

**HYBRID is a deliberate, explicit placeholder, not a distinct broken
screen** — it reuses the exact same AIR rendering path (`mode="air"`
camera, `SymbolManager` markers) for now, since real routing/turn-by-
turn doesn't exist anywhere in this native project yet (car side or
phone side) and a fake "Hybrid" screen that's really just AIR-with-a-
different-label would be worse than an honest reuse. `switchMode()`'s
own doc comment flags exactly this and how to find the fallback
(`currentMode` still tracks "hybrid" distinctly for the toggle's own
highlight, even though rendering is identical to AIR right now) —
building the real thing (real nav camera state machine already ported
and working on the car side; real map-based routing/turn-by-turn does
not exist anywhere yet) is next, per the project owner's own stated
priority order (RAW first, Hybrid last).

### Real B612/B612 Mono fonts, real palette

`VcasFonts.kt`/`VcasPalette.kt` (new) — the actual B612/B612 Mono `.ttf`
files (downloaded directly from `fonts.gstatic.com`, the same CDN the
PWA's own Google Fonts `<link>` ultimately resolves to — confirmed
reachable from this sandbox and downloaded for real, not assumed) are
bundled in `res/font/` and loaded via `ResourcesCompat.getFont()`
(back-fills to this project's real `minSdk` 23, unlike the plain
framework `Resources.getFont()` which is API 26+) — not Android's
Downloadable Fonts API, which depends on Google Play Services being
present, an extra runtime dependency this project has otherwise
consistently avoided. Only 400/700 weights for B612 and 400 for B612
Mono are bundled, matching the PWA's own `family=B612:wght@400;700`
and B612 Mono's real absence of a published bold face (synthesized via
`Typeface.create(base, Typeface.BOLD)`, same fallback behaviour the
PWA's own CSS comment already documents for the browser). `VcasPalette.kt`
carries the real Night-theme hex values from `VCAS.css`'s `:root` block
as Kotlin constants, plus RAW's own forced-dark values (pixel-sampled
from a real ND reference photo per the PWA's own history, not
re-sampled here — the same hex values already in `VCAS.css`).

### Honest scope, stated plainly

**Not built this pass, and explicitly not implied by it**: HYBRID's real
navigation experience (routing, turn-by-turn, a genuine nav-state-machine
camera distinct from AIR's flat one); RAW's real popup card (`#popup`,
with its own log/suppress buttons) — aircraft taps currently show a
plain `Toast` instead; the PWA's own "tap to cycle to the next page" of
plot icons when more aircraft are relevant than fit (this pass always
shows the top-priority page via the same viewport-tiered cap, `Indicators.
capForViewportWidth()`, but never advances past it); Day/Night theming
anywhere in the native app (always-dark, matching RAW's own "no day mode
for a cockpit instrument" precedent, extended app-wide since there's no
settings screen yet to host a toggle). Each is real, separately-scoped
follow-up work — the project owner's own stated priority order (RAW,
then Hybrid, AIR already done) is what's being followed, not a plan
invented here.

**Honest status, same caveat as every other Android-integration file in
this project**: never compiled — no Android SDK in this sandbox.
`RawPlotView.kt`/`RawAircraftListView.kt`/the `MainActivity.kt`
restructuring all reuse the already-verified `Indicators`/`Geo`/
`Visibility`/`Relevance` Kotlin logic (143+ tests passing via the
standalone `kotlinc`+JUnit4 toolchain) for their math, but the
Canvas-drawing/View/touch-handling code itself is new and unverified
against a real compiler — cross-checked against real Android SDK API
signatures (`Paint`/`Canvas`/`RectF`/`GradientDrawable`/
`ResourcesCompat` method shapes) where non-obvious, not guessed. The
real check is still opening this in Android Studio and building it.

## Phone screen, real pass 3: real HYBRID navigation (2026-08-27)

Direct instruction, following on from real pass 2's RAW-mode build and
a status check on "where's the navigation function": "ok keep working
then. the starting point for the apk version is the current state of
the pwa." — the same standing constraint from earlier the same day
("I insist that we use where that part of the project had reached
before the move to an apk based app as the starting point") now applied
to HYBRID specifically. Before writing any code, did the same full
design-review discipline already established for RAW mode: read
`src/routing/orsProvider.js`, `src/routing/orsGeocoder.js`,
`src/navigation/maneuverTracker.js` in full, and the relevant sections
of `app.js` (`requestRouteTo`, `clearActiveRoute`, `_showRouteCard`/
`_updateRouteCard`, `_checkOffRoute`, `_rerouteFromCurrentPosition`,
`_updateGuidanceCard`, `_fmtDistance`/`_fmtDuration`).

**Three new pure-logic Kotlin ports, verified the same way as every
prior logic port in this project — real `kotlinc`+JUnit4 execution, not
a read-through:**
- `OrsProvider.kt` — structural port of `orsProvider.js`'s
  `getRoute()`/response parsing (`profileFor`, `directionsUrl`,
  `parseRouteResponse`), same real-`HttpURLConnection`-on-a-background-
  executor shape `AdsbFiClient.kt` already established. `OrsProviderTest.kt`,
  7 tests: real ORS response-shape parsing (geometry/distance/duration/
  steps), missing-steps degrading to an empty list rather than crashing,
  no-features/malformed-JSON/too-few-coordinates all returning `null`
  rather than throwing, `profileFor()`'s mode→ORS-profile-id mapping
  (with an unknown mode falling back to `driving-car`), and
  `directionsUrl()`'s lon/lat-ordering + URL shape.
- `OrsGeocoder.kt` — structural port of `orsGeocoder.js`'s
  `search()`/`parseSearchResponse()` (Pelias-shaped GeoJSON,
  `features[].properties.label`/`features[].geometry.coordinates`).
  `OrsGeocoderTest.kt`, 7 tests: label/lon-lat-swap parsing, a missing
  label falling back to the query text, a feature with no coordinates
  being skipped rather than crashing the whole parse, empty-features
  returning an empty list, `MIN_CHARS`(3)/blank-API-key both short-
  circuiting `search()` without attempting a real network call (which
  would hang/fail in this sandbox anyway — the actual behavioural
  guarantee the test checks), and `searchUrl()`'s focus-point param only
  appearing when both lat/lon are provided. **Not yet wired to a search
  box UI** — see this pass's own "not yet done" list below.
- `ManeuverTracker.kt` — structural port of `maneuverTracker.js`'s
  `nextManeuver()`: finds the user's snapped position via
  `RouteGeometry.nearestOnLine()` (already ported/tested), locates the
  current step by `way_points` indexing, and targets the NEXT step
  (or stays on the current one if already on the last). `ManeuverTrackerTest.kt`,
  7 tests: targeting the second step from the route start (distance
  cross-checked against `RouteGeometry.distanceToIndex()` directly, not
  a hand-computed literal — same discipline `GeoTest.kt`/`RelevanceTest.kt`
  already established), correctly landing on the arrival step at the
  route's own end (remaining distance ≈0), staying on the same target
  mid-step, and four degrade-to-`exists=false` guards (no steps, null
  steps, too few coordinates, null coordinates).

**Full regression run after adding these three files: 203 tests total
(the pre-existing 182 + 21 new), zero failures** — confirmed via the
same standalone Maven-Central-jar `kotlinc`+JUnit4 toolchain used
throughout this project's Android work, re-run again after this pass's
`MainActivity.kt`/`PhoneMapContainer.kt` changes to confirm no
regression (the UI-layer changes don't touch this toolchain's pure-logic
files at all, but re-running costs nothing and this project's own
discipline is to verify rather than assume).

**Route line — a real `GeoJsonSource`+`LineLayer`, not a screen
overlay** (`PhoneMapContainer.kt`'s new `updateRouteLine()`), matching
the PWA's own "range rings/route line are real map layers" discipline
(see "Range rings" above) — real pan/zoom/rotate correctness for free
from MapLibre, deliberately simpler than the PWA's own 3-layer glow/
line/highlight polyline (`src/map.js`'s `_showRouteCard()`) — one plain
line, an honest simplification for this first pass. Every non-trivial
API used (`GeoJsonSource(id, geoJson)` constructor + `setGeoJson(String)`,
`LineLayer(layerId, sourceId)` + `withProperties()`, `Style.addSource`/
`addLayer`/`getSource`/`getLayer`/`removeLayer`/`removeSource`,
`PropertyFactory.lineColor`/`lineWidth`/`lineCap`/`lineJoin`,
`Property.LINE_CAP_ROUND`/`LINE_JOIN_ROUND`) was cross-checked directly
against the cloned `maplibre-native` SDK source before use, same
discipline as every other MapLibre call in this project — not assumed
from the general shape of a web-MapLibre-GL-JS-style API. Re-applies
itself after a style reload (the demo-tiles fallback path) via a
`lastRouteCoordinates`-remembering wrapper, so a route survives the rare
case of the MapTiler key getting rejected mid-session.

**Tap-to-set-destination**, not the PWA's full debounced name/address
search box — a deliberate first-pass scope decision, not an oversight:
`OrsGeocoder.kt` is ported and tested specifically so wiring a real
search UI later is a small, self-contained follow-up, not a new logic
problem. `PhoneMapContainer.kt` gained a small `onMapReady()` queue (a
real MapLibreMap doesn't exist yet at `onCreate()` time, so a listener
registered there has to be deferred) so `MainActivity.kt` can call
`map.addOnMapClickListener { point -> onMapTapped(point) }` once. The
real `MapLibreMap.OnMapClickListener` interface shape (`boolean
onMapClick(@NonNull LatLng point)`) was confirmed directly against
`MapLibreMap.java` before writing this, not assumed to mirror
`OnSymbolClickListener`'s own Boolean-consumed pattern just because it
looked similar. `onMapTapped()` only acts in HYBRID mode with no route
already active — cancel via the guidance card's own ✕ button first,
matching the PWA's own "one destination at a time" shape.

**Guidance/ETA card** (`buildGuidanceCard()`) — a Kotlin-chrome
equivalent of the PWA's `#guidance-card`+`#route-card`, collapsed into
one card: a top row (next-maneuver instruction via `ManeuverTracker`, or
a "tap the map to set a destination" hint, + a ✕ cancel) and a mono-font
ETA/distance/arrival-clock line below it, structural port of `app.js`'s
`_updateGuidanceCard()`/`_updateRouteCard()` — remaining distance/
duration/arrival-clock computed the exact same way the PWA does
(`RouteGeometry.nearestOnLine()` + `distanceToIndex()` to the route's
own final coordinate, duration scaled by the remaining-distance
fraction of the route's own ORS-declared total, matching `_updateRouteCard()`'s
own reasoning for why a proportional-scaling estimate is more robust
than summing per-step durations). Hidden entirely outside HYBRID mode —
a route started in HYBRID keeps running (GPS updates, off-route checks)
in the background while RAW/AIR are showing, it just isn't displayed
until the user switches back, matching how the PWA's own route/guidance
state has always been a NAV-mode-only concept (see "Navigation-side
status check" above).

**Camera wiring — `updateHybridCamera()`, `mode="nav"` (not `"air"`)
with `routeActive`/`routeCoordinates` fed from `activeRoute`.** This is
the first place in EITHER native project (car side or phone side) the
already-ported `NavigationCameraEvaluator`'s urban/highway/turn state
machine actually engages off a real route rather than `routeActive=false`
always forcing the flat `NAV_IDLE` preset — the car side's own GPS-
wiring follow-up (see above) never had a real route to drive
`TURN_APPROACH`/`HIGHWAY_GUIDANCE` with. With no active route yet,
`NAV_IDLE`'s own preset still evaluates (a reasonable "just show me the
map" default before a destination is picked), matching the PWA's own
pre-route behaviour.

**Off-route detection + reroute** (`checkOffRoute()`/
`rerouteFromCurrentPosition()`/`performRouteRequest()`) — a structural
port of `_checkOffRoute()`/`_rerouteFromCurrentPosition()`: the user's
real perpendicular distance to the route polyline
(`RouteGeometry.nearestOnLine()` + `Geo.calculateDistanceMeters()`,
deliberately a different question from what `ManeuverTracker`'s own
distance-ALONG-the-route always answers regardless of how far away the
nearest point really is), `offRouteSinceMs` tracking when the deviation
FIRST started (reset to null the moment the user's back within
threshold) so a real deviation has to persist continuously for the full
dwell delay before a reroute fires — `OFF_ROUTE_THRESHOLD_METERS`/
`OFF_ROUTE_REROUTE_DELAY_MS` duplicated from `src/config.js`'s
`CONFIG.OFF_ROUTE_THRESHOLD_METERS`(50)/`OFF_ROUTE_REROUTE_DELAY_SECONDS`(6)
exactly. `performRouteRequest()` is shared by both the initial
`requestRouteTo()` and `rerouteFromCurrentPosition()` — a real
background network call via a single-thread `Executors` pool (same
`NetworkOnMainThreadException`-avoidance reasoning `AdsbFiClient.kt`
already established), with `routeRequestToken` captured before dispatch
and checked after the response lands on the main-looper `Handler` — the
same stale-response guard `app.js`'s own `_routeRequestToken` provides,
so a slow, now-superseded request (the route was cleared, or a
different destination tapped, while this one was still in flight) can't
clobber newer state. A failed reroute doesn't retry the very next tick —
`offRouteSinceMs` resets to "now," restarting the dwell delay, matching
`_rerouteFromCurrentPosition()`'s own reasoning for not hammering ORS
every ~1s while genuinely off-route and failing.

**Duplicated config, same reasoning as `MAPTILER_KEY`**:
`ORS_API_KEY` is copied from `src/config.js`'s `CONFIG.ORS_API_KEY` as a
`MainActivity.kt` companion constant — no build-time bridge between this
native project and the PWA's own JS config exists, same "keep in sync by
hand" caveat already established for `MAPTILER_KEY`/`LOG_ENDPOINT`.

**Known, deliberately-scoped simplifications for this pass, stated
plainly rather than left as silent gaps** (folded into `MainActivity.kt`'s
own class-level doc comment too, not just here): destination picking is
tap-the-map only, not the PWA's full debounced search UI; the route line
is one plain line, not the PWA's 3-layer glow/line/highlight; `TURN_APPROACH`'s
`DECOUPLED_MANEUVER` bearing mode is computed by
`NavigationCameraEvaluator` but not yet consumed by
`applyCameraResult()` — camera bearing always follows the raw GPS fix
bearing, same as AIR, not yet the route-bearing-decoupled behaviour a
real turn approach should show; no destination pin/marker on the map
(the route line itself is the only visual indication of where it leads);
no off-route camera behaviour beyond the reroute itself firing (the PWA
has none either beyond the reroute, so this isn't a regression, just
worth naming). Each is real, separately-scoped follow-up work.

**Honest status, same caveat as every other Android-integration file in
this project**: never compiled — no Android SDK in this sandbox. Every
non-trivial MapLibre API call used in this pass (`GeoJsonSource`/
`LineLayer`/`Style` source-and-layer methods/`PropertyFactory`/
`MapLibreMap.OnMapClickListener`) was cross-checked directly against the
cloned `maplibre-native` SDK source before use, same discipline as every
prior MapLibre integration in this project. `OrsProvider.kt`/
`OrsGeocoder.kt`/`ManeuverTracker.kt` (the pure-logic layer this pass's
UI wiring depends on) ARE genuinely, fully verified — real
`kotlinc`+JUnit4 execution, 203/203 tests passing — the same distinction
`CameraAnchor.kt`/`NormaliseAircraft.kt` already established for earlier
passes: pure logic gets real test execution in this sandbox, platform/
UI code gets source cross-referencing instead, and the real remaining
check for the latter is still opening this in Android Studio and
building it.

## Native phone screen: adsb.fi attribution (2026-08-27, same day)

Direct follow-up to a status question ("have we reached the starting
point yet?") — flagged as the one gap that's a hard requirement, not
polish: this screen had been polling and displaying adsb.fi's data since
the very first phase-1 pass with zero citation anywhere, unlike the PWA,
which has satisfied its "cite adsb.fi with a link to their homepage, for
as long as their data is displayed" obligation since 2026-08-23 (see the
Pre-V1 checklist and "How VCAS is actually installed" sections above).

`MainActivity.kt`'s `buildAdsbCreditLine()` adds a small, persistent line
to the top bar — visible for the app's entire open duration, not gated
behind a settings screen or a one-time splash, same reasoning the PWA's
own `#adsb-credit` placement is built on (an ongoing citation obligation
can't be satisfied by something dismissed once). Exact wording matches
the PWA's real markup (`Data: adsb.fi`, only the name itself underlined/
tappable), opened via a plain `ACTION_VIEW` intent to `https://adsb.fi`
rather than a paraphrase or a different link target.

Deliberately narrow in scope — this is the ONE piece of the PWA's top
bar (ADS-B status pill, settings gear, this credit line) pulled forward
on its own, not a first step toward porting the rest of the top bar.
The status pill and settings gear stay correctly deferred (there's no
settings screen to gate a settings gear behind yet); this one specific
piece couldn't wait because it's the only one that's a hard external
requirement rather than a design choice.

**Honest status, same caveat as every other native UI file in this
project**: never compiled — no Android SDK in this sandbox.
`SpannableString`/`UnderlineSpan`/`Intent(ACTION_VIEW)` are long-stable,
basic framework APIs, not cross-checked against a cloned SDK source the
way the MapLibre-specific calls elsewhere in this project are — same
"ordinary Android SDK usage doesn't need the same level of external
verification as a third-party library's API surface" judgment already
applied to `LocationManager`/`requestPermissions()` elsewhere in
`MainActivity.kt`.

## Native phone screen: destination search box (2026-08-27, same day)

The other real gap from the "have we reached the starting point yet?"
status check: HYBRID's destination picking was tap-the-map only —
`OrsGeocoder.kt` was ported and fully tested in the same pass that built
real HYBRID navigation, but never wired to a search UI. That follow-up
now, structurally porting `app.js`'s `_searchDestination()`.

**`buildGuidanceCard()` now has two mutually-exclusive groups**, toggled
by `updateGuidanceCard()` on whether a route is active — a structural
mirror of the PWA's own destination-picker-vs-active-route split
(`#dpb-search-input` vs `#guidance-card`/`#route-card`): a search box +
results list when there's no route, the existing guidance/ETA row once
one exists. Tap-the-map (`onMapTapped()`) still works alongside the
search box, unchanged — both converge on the same `requestRouteTo()`.

**Debounce/staleness handling matches the PWA's own exactly, not a
simplified version**: `scheduleDestSearch()` uses `Handler.postDelayed`/
`removeCallbacks` as the direct equivalent of `app.js`'s `setTimeout`/
`clearTimeout` (same mechanism `AdsbFiClient.kt`'s poll scheduling
already established), at the same 350ms delay and `OrsGeocoder.
MIN_CHARS`(3) short-circuit. `destSearchToken` is the same monotonic-
token pattern this class's own `routeRequestToken` already uses (and
`app.js`'s `_destSearchToken` itself mirrors) — a slow response to an
earlier keystroke can't clobber a faster response to a later one. The
IME's own search action (`EditorInfo.IME_ACTION_SEARCH`) forces an
immediate lookup, cancelling any pending debounced one first, matching
the PWA's own Enter-key behaviour (`destSearchInput`'s `keydown`
handler in `app.js`).

**A small addition beyond a literal port**: a `destSearchStatusText`
line shows "Finding route…" while a route request from a selected
search result is in flight — the PWA's own `_searchDestination()`/
`_onDestSearchResultSelected()` don't have an equivalent status text at
this exact spot (their loading state lives on the route-request button
itself, `#btn-test-route`, which nothing in the native card structure
maps to 1:1) — added because leaving the search UI showing nothing at
all while an actual network request is in flight would read as
unresponsive, not because the PWA has a matching element to mirror.

Selecting a result (`onDestSearchResultSelected()`) clears the input
text and search results, dismisses the soft keyboard
(`InputMethodManager.hideSoftInputFromWindow`), and calls the same
`requestRouteTo()` the tap-to-map path already uses. `clearActiveRoute()`
now also clears any leftover search text/results, so cancelling a route
returns to a genuinely fresh search box rather than one still showing a
stale prior query.

**Honest status, same caveat as the rest of this native project**: never
compiled — this sandbox has no Android SDK at all (not even for basic
framework classes like `EditText`/`TextWatcher`/`InputMethodManager`,
unlike the pure-`logic/` package files this project can genuinely
compile+test standalone). Verified by careful manual re-reads of the
diff plus a brace/paren balance check, not a real compiler pass —
`EditText`/`TextWatcher`/`InputMethodManager`/`EditorInfo` are long-
stable, basic framework APIs, not cross-checked against a cloned SDK
source the way the MapLibre-specific calls in this project are (same
judgment already applied to the adsb.fi attribution line above). The
real check is still opening this in Android Studio and building it.

## Native phone screen: settings screen + real traffic filtering (2026-08-27, same day)

The last item from the "have we reached the starting point yet?" gap
list tackled this session: the PWA's `#settings-screen` had no native
counterpart at all, and — a real, previously-undocumented finding from
reading `app.js`'s own fetch loop while building this — **this native
app had never filtered aircraft by anything**: no ground-vehicle/
obstacle exclusion, no stale-aircraft removal, no ground-aircraft hide,
no low-altitude suppression. Every one of those is unconditional or
settings-driven filtering `app.js`'s own `aircraftList = result.aircraft.
filter(...)` pass has always applied, at the single point BOTH NAV and
AIR read from — genuinely new behaviour for this native app, not just a
missing UI for existing logic.

**`VcasSettings.kt`** (new) — a single `SharedPreferences`-backed object
combining the PWA's `colorblindMode.js` and `altitudeSuppressPanel.js`
(no reason for three separate near-empty files' worth of ceremony
natively) — `isColorblindSafeEnabled()`/`toggleColorblindSafe()`,
`isGroundHidden()`/`setGroundHidden()` (default `true`, matching the JS
default's own reasoning: ground aircraft usually have no usable altitude
at all, so the numeric threshold can't catch them), `isAltSuppressEnabled()`/
`altSuppressThresholdFt()`/`setAltSuppressThreshold()` with the same
`[200, 500, 1000, 2000, 3000]` ft preset list.

**`onAircraftUpdated()` now filters, matching `app.js`'s exact four
checks and their order** — ground-vehicle/obstacle exclusion and stale
removal (`CONFIG.REMOVE_THRESHOLD_SECONDS`, 30s) unconditionally, ground-
hide and altitude-suppression gated on the new settings — applied once,
before `latestAircraft` is set, so both RAW and AIR/HYBRID inherit it
for free exactly like the PWA's own single filtering point.

**`buildSettingsScreen()`** — a full-screen modal `FrameLayout` overlay
(not a separate `Activity` — no reason for this small a feature to need
its own lifecycle/back-stack entry), added last in `onCreate()` so it
draws on top of everything, opened via a new settings gear in the top
bar (`buildTopBar()`, restructured from a vertical stack into a
horizontal row so the gear can sit at the right edge). Two of the PWA's
three sections are ported, one deliberately isn't — stated in the
function's own doc comment, not silently dropped:
- **Display & Accessibility** → only the colour-blind-safe toggle. The
  PWA's Theme (Day/Auto/Night) row and "Range rings in Air view" toggle
  are both skipped — this app has no Day/Night theming at all yet
  (`VcasPalette.kt` has no day-variant colours to switch to) and AIR mode
  has no range-rings map layer built yet either. Shipping a toggle with
  no real effect behind it would be exactly the kind of half-finished
  control this project's own conventions reject.
- **Traffic Filtering** → both rows, in full, wired to the real filtering
  pass above.
- **Data & Logging** → not included at all. The PWA's "Export buffered
  observations" button exists because `ObservationLogger`/the LOG
  ground-truth panel exist — neither has been ported to this native app,
  so there's nothing for an export button to export. A real, separate,
  much larger follow-up, not a settings-screen gap.

**Colour-blind palette is wired into every mode's colour selection, not
just stored as a flag** — `RawPlotView.kt`/`RawAircraftListView.kt`
gained a `displayColorHex()`/inline equivalent matching `ui.js`'s own
`_displayColor()` priority exactly: colourblind-safe wins over RAW's own
reference-matched `colorRaw` whenever the setting is on ("accessibility
wins over reference-fidelity," per that function's own comment,
faithfully preserved here), falling back to `colorRaw` then plain
`color`. `MainActivity.kt`'s `renderAirMarkers()` does the simpler AIR/
HYBRID equivalent (no `colorRaw` concept there — just `color` vs
`colorblindSafe`). Toggling the setting re-renders immediately (RAW via
`refreshRawMode()`, AIR/HYBRID via `renderAirMarkers(latestAircraft)`)
rather than waiting for the next GPS/ADS-B tick, matching `app.js`'s own
`onColorblindToggleClick()` exactly, including which two branches it
re-renders.

**A real bug caught and fixed before it shipped, not after**: the first
draft of `refreshSettingsScreen()`'s toggle/preset-button active-state
update used `setBackgroundColor()` — which replaces a `View`'s entire
background with a flat `ColorDrawable`, silently discarding the rounded
`GradientDrawable` every one of these buttons is actually built with.
Caught by re-reading the diff rather than assumed fine; fixed with a
`setToggleActive()` helper that mutates the existing `GradientDrawable`'s
colour in place (`(view.background as? GradientDrawable)?.setColor(...)`)
instead of replacing it.

**Honest status, same caveat as every other native UI file in this
project**: never compiled — no Android SDK in this sandbox.
`SharedPreferences`/`ScrollView`/`GradientDrawable` are long-stable,
basic framework APIs, not cross-checked against a cloned SDK source the
way the MapLibre-specific calls elsewhere in this project are — same
judgment already applied to `EditText`/`TextWatcher` for the destination
search box. Verified by careful manual re-reads of the diff plus a
brace/paren balance check, not a real compiler pass. The real check is
still opening this in Android Studio and building it.

## Native phone screen: first-launch onboarding screen (2026-08-27, same day)

The next item off the "have we reached the starting point yet?" gap
list: the PWA's `#onboarding-screen` (shown once per install, distinct
from a splash — see the PWA's own "First-launch onboarding screen"
entry above for why a launch splash and a one-time explanation screen
are deliberately two different things) had no native counterpart.

**`VcasSettings.kt`** gained `isOnboardingSeen()`/`markOnboardingSeen()`,
backed by a versioned key (`onboarding_seen_v1`, mirroring `app.js`'s own
`ONBOARDING_SEEN_KEY = "vcas-onboarding-seen-v1"`) — versioned, not a
bare boolean, so a future symbology change that genuinely warrants
re-showing it can bump the key deliberately, same reasoning the PWA's
own key already documents.

**`buildOnboardingScreen()`** — a full-screen modal overlay, same
structural approach as `buildSettingsScreen()` (a real in-app screen,
not a separate `Activity`), added last in `onCreate()` — even above the
settings screen — so it's never accidentally hidden on a fresh install.
Shown via `maybeShowOnboarding()` (gated on the seen flag, called once
right after `setContentView()`), dismissed via a bottom CTA button
(`dismissOnboarding()`) that marks the flag and hides the overlay.

**Content mirrors the PWA's four sections, three carried over close to
verbatim, one genuinely reworded**: "Welcome to VCAS," "Three views"
(RAW/AIR/HYBRID tag rows + the range-readout tap-to-cycle note), and
"What the symbols mean" (the real legend) all still accurately describe
this native app's actual behaviour, so their copy is kept close to the
PWA's own wording. "Getting somewhere" is genuinely reworded, not just
copied — the PWA's own text references tapping a 📍 button to arm a
dedicated destination-picker mode; this native app's HYBRID guidance
card shows its search box directly whenever no route is active (see the
"destination search box" entry above), with no separate arm/disarm
button to describe, so the copy was rewritten to match what's actually
there rather than describing a UI element this app doesn't have.

**The legend is generated from the app's real code, not hand-copied
approximations** — same discipline the PWA's own `_renderOnboardingLegend()`
already established, applied natively for the first time: `Visibility.
getCategories()` (the real tier table) drives both the label text and
`PhoneAircraftIcons.bitmapFor()` — the SAME icon-drawing function every
real AIR/HYBRID map marker already uses (`trackDeg=null` so no direction
arrow is drawn, just the bare shape) — for the icon itself. If the real
tier colours/shapes ever change, this legend changes with them
automatically; it structurally cannot drift the way a hand-copied legend
would, exactly the property the PWA's own version is built to guarantee.

**A real, honest difference from the PWA's own legend footnote, not
silently glossed over**: the PWA's note also describes a "dashed
outline = predicted entry" modifier. This native app has never
implemented that modifier anywhere — `PhoneAircraftIcons.kt`'s own doc
comment already flags this (only the "overhead" chevron shape is
ported, RAW-only, matching `RawPlotView.kt`'s actual `relevance.reason
== "overhead"` check) — so the native footnote only mentions the
chevron, not a feature that doesn't exist yet. Claiming the dashed
modifier existed here would have been describing the PWA, not this app.

**Honest status, same caveat as every other native UI file in this
project**: never compiled — no Android SDK in this sandbox.
`ScrollView`/`ImageView`/`GradientDrawable` are long-stable, basic
framework APIs, not cross-checked against a cloned SDK source the way
the MapLibre-specific calls elsewhere in this project are — same
judgment already applied to the settings screen and destination search
box. `PhoneAircraftIcons.bitmapFor()` itself is reused unchanged (no new
API surface), so the only genuinely new platform code here is the
`ScrollView`/`LinearLayout`/`TextView`/`ImageView` layout tree itself.
Verified by careful manual re-reads of the diff plus a brace/paren
balance check, not a real compiler pass. The real check is still
opening this in Android Studio and building it.

## Native phone screen: RAW popup card + real aircraft suppression (2026-08-27, same day)

The last item off the original gap list this session worked through:
RAW's aircraft-tap detail was a plain `Toast` (`onRawAircraftTap()`),
not the PWA's real popup card. Replaced with a structural port of
`ui.js`'s `showPopup()`/`hidePopup()`.

**Read-only info, matching the PWA's own field set and formatting**:
callsign (falls back to hex), type, distance (`%.1f NM`), altitude
(thousands-grouped, `"%,d ft"`, matching `toLocaleString()`), bearing
(a straight port of `_bearingLabel()` — ahead/behind/left-front/right-
rear/etc., or "overhead"), last-updated seconds, and the visibility-tier
badge — same colour-selection priority the RAW plot icons already use
(colourblind-safe first, then RAW's own `colorRaw`, then plain `color`).

**A real Suppress button — the first time this native app has ever
actually suppressed an aircraft.** `Indicators.build()`'s Kotlin port
has carried a `suppressedHexes: Set<String>?` parameter since it was
first ported, faithfully mirroring the JS original — but every native
call site had always passed `null`. `MainActivity.kt` gained
`suppressedUntilMs: MutableMap<String, Long>`, a direct port of
`app.js`'s own `suppressedUntil` Map, pruned every `refreshRawMode()`
call (mirroring the JS original's own prune loop) and fed as the live
key set. Tapping Suppress sets a 180-second expiry
(`CONFIG.SUPPRESS_DURATION_SECONDS`, matched exactly) and immediately
re-renders, so the aircraft actually disappears from the plot/list
right away rather than waiting for the next poll.

**The same 5mph distraction gate this project has applied everywhere
else this kind of interaction exists** (the LOG button, the PWA's own
popup buttons) — `updateRawPopupInteractivity()` dims the Suppress
button whenever effective speed exceeds `CONFIG.
GPS_HEADING_MIN_SPEED_MPH` (5), checked both when the popup is first
shown AND on every subsequent `refreshRawMode()` call (which every GPS
fix and ADS-B poll already re-runs in RAW mode) — so an already-open
popup's button disables live the moment speed crosses the threshold,
matching `setSpeedMph()`'s own "update an already-open popup" behaviour,
without needing a second, separately-wired call site the way the PWA's
`applySpeedOverrideIfActive()` convergence point provides. The click
handler itself also re-checks speed before acting, the same double-
guard (`_actionsInteractive()` checked both at render time and at click
time) the PWA's own `_wireLogButtons()`/Suppress handler use.

**Deliberately excludes the PWA's ground-truth log-outcome buttons** —
`showPopup(ind, onSuppressClick, onLogOutcome)` itself already supports
omitting them when `onLogOutcome` isn't passed (used for exactly this
reason wherever the PWA doesn't have a log-observation context), so the
native popup is a real, already-designed-for variant of the PWA's own
popup, not a half-finished one. They'd need `ObservationLogger`/the
central-log system, which hasn't been ported to this native app at all
— same reasoning `buildSettingsScreen()`'s own doc comment already gives
for excluding "Data & Logging" from the settings screen.

**Positioned near the aircraft's true plotted point** (`item.x`/
`item.y` — the exact coordinates `RawPlotView` draws the icon at),
clamped to stay on screen, using a fixed estimated card size rather than
truly measuring the real view before layout — matching `showPopup()`'s
own `popW`/`popH` estimate (an honest simplification the PWA's own
implementation already makes, not a native-specific shortcut). Auto-
dismisses after 4 seconds (`POPUP_DISMISS_MS`, matched exactly) via the
same `mainHandler`/token-free `Runnable` pattern already established
elsewhere in this class; tapping empty plot space (`onEmptyTap`) also
hides it immediately, alongside clearing `selectedHex`.

**AIR/HYBRID's marker tap stays a plain `Toast`, deliberately, not an
oversight** — neither mode runs `Indicators`/`Relevance` at all (see
this class's own top-level doc comment on why AIR/HYBRID call
`Visibility`/`Geo` directly instead of the `Indicators` pipeline), so
there's nothing for a Suppress button to suppress FROM on that screen —
porting the popup card there would mean building a button with no real
target, the same "half-finished control" this project's conventions
already reject elsewhere (see the settings screen's own AIR-range-rings-
toggle exclusion).

**Honest status, same caveat as every other native UI file in this
project**: never compiled — no Android SDK in this sandbox.
`GradientDrawable`/`Handler.postDelayed` are long-stable, basic
framework APIs already used elsewhere in this file, not newly cross-
checked against a cloned SDK source. `Indicators.build()`'s
`suppressedHexes` parameter itself IS genuinely, fully verified — real
`kotlinc`+JUnit4 execution as part of `IndicatorsTest.kt`'s existing
suite (this pass didn't change that file, only finally passed it a real
value from the platform side). Verified by careful manual re-reads of
the diff plus a brace/paren balance check, not a real compiler pass. The
real check is still opening this in Android Studio and building it.

## PWA: split "not visible" ground-truth log outcome into obstruction/weather/no-reason (2026-08-27)

Direct instruction: the LOG panel/popup's `not_visible_missed` outcome
was conflating three genuinely different reasons for not seeing an
aircraft — a physical obstruction (building, trees), weather (aircraft
above an overcast layer, or obscured by cloud/precipitation), and "no
identifiable reason at all." Stated motivation: recording the weather
case specifically will build a real, correlatable dataset against METAR
conditions at observation time, which is exactly the kind of evidence
`README.md`'s own "Ground-Truth Log Panel" section already describes
this tool as existing to collect ("this panel is how that gap gets
measured before it gets modelled") — but the old two-way split couldn't
distinguish "the METAR-driven visibility model was wrong about this
specific cloud/precipitation case" from "the underlying angular-size
model was wrong for some other, unidentified reason," which is a much
weaker signal for calibrating the METAR adjustment specifically.

**`ObservationLogger.OUTCOMES`** (`src/dev/observationLogger.js`) is the
single source both the LOG panel (`logPanel.js`'s `_buildRow()`) and the
NAV/AIR popup's log buttons (`ui.js`'s `_logButtonsHtml()`) already build
their button rows from dynamically — adding `not_visible_weather` here
was the only code change needed; neither consumer hardcodes a button
count. Verified both are genuinely dynamic by reading them directly
(`ObservationLogger.OUTCOMES.forEach(...)`/`.map(...)`) rather than
assumed. Also relabelled `not_visible_missed`'s title from "just not
seen" to "no other reason" — same code, but the old wording read as a
catch-all that could still include a weather-caused miss; the new
wording matches the exact framing the split exists to make true ("if I
can't see it but there is no other reason").

**Layout checked, not just hoped fine**: both consumers already handle a
variable-length outcome list without a fixed-width assumption — the
popup's `.pop-log-actions` uses `display:flex` with `flex:1` per button
(evenly redistributes width regardless of count), and the LOG panel's
`.lp-actions`/`.lp-row` already combine `flex-shrink:0` on the button
group with `min-width:0` + ellipsis truncation on the row's info text
(`.lp-meta`), which was clearly already designed to absorb a variable-
width sibling. Read both stylesheet rules directly (`src/styles/
VCAS.css`) before concluding a 5th fixed-24px `.lp-btn` wouldn't break
the LOG panel's row layout, rather than assuming a flex row is
automatically fine.

`☁` was chosen for the new button (matching the existing glyph-only
button convention — ✈/〜/▨/✕ — and README's own icon-table format) over
a symbol that could be confused with either ▨ (obstruction) or the
existing aircraft-shape legend glyphs elsewhere in the app.

**Not done, and deliberately out of scope for this instruction**: the
observation payload itself (`buildObservation()`) still doesn't snapshot
the actual METAR conditions in effect at the time of the sighting — only
`item.vis`'s already-computed label/score/angularSizeDeg/elevationDeg/
slantRangeNm. Recording the outcome category is what was asked for;
actually correlating it against METAR data (either by snapshotting METAR
state into each observation, or joining against station data
after-the-fact using the observation's timestamp/lat/lon) is a real,
separate follow-up for whenever this dataset is actually analysed, not
assumed as an implied part of this change.

**Honest status**: not verified against a live render this pass (no
Playwright run) — this is a small, mechanically-verified addition to an
existing, already-dynamic button-building pattern in both consumers,
not new rendering logic. `README.md`'s own outcome table was updated to
match. The server-side mirror (`log.php`, not in this repo — see
"Central observation log" above) is a generic JSON passthrough as far as
this session could determine from its own description; it has no known
outcome-code allowlist to update, but wasn't independently re-verified
this pass since it isn't part of this repo.

## PWA: add a "visible — lights only" ground-truth log outcome (2026-08-27, same day)

Direct instruction, same session as the not_visible_weather split above:
add a "Lights" outcome, useful at night or in inclement weather —
i.e. the aircraft's nav/strobe/beacon lights were what was actually
spotted, not the airframe itself. Added `visible_lights` (`✦`) to
`ObservationLogger.OUTCOMES`, positioned alongside `visible_airframe`/
`visible_contrail` in the "visible" group rather than after them,
matching the button order the LOG panel/popup render in (array order =
render order, both consumers iterate it directly).

**Same underlying reasoning as `visible_contrail`, not a new pattern**:
`Visibility.estimate()`'s own doc comment states its assumptions include
"daylight" — this model has no night/lights-based visibility concept at
all today. A lights-only sighting logged under the old plain
`visible_airframe` code would silently overstate how visible the
*airframe's shape* actually was after dark; recording it as its own
outcome is what would let a real future night/lights-aware adjustment be
built on genuine evidence, the same way `not_visible_weather` now can be
for the METAR adjustment. `✦` (Black Four Pointed Star) was chosen to
read as "a point of light in the dark" at a glance, distinct from the
existing ✈/〜/▨/☁/✕ glyph set.

Both dynamic consumers (`logPanel.js`'s `_buildRow()`, `ui.js`'s
`_logButtonsHtml()`) needed no changes — same as the weather-split entry
above, this was purely an `OUTCOMES` array addition. `README.md`'s
outcome table was updated to match, including a note on the same
"informs a not-yet-built model adjustment" framing already established
for the weather split, so a future reader doesn't have to re-derive why
these two additions exist from two separately-worded rationales.

**Honest status**: same as the weather-split entry immediately above —
not verified against a live render this pass, mechanically confirmed via
a direct `require()`/`OUTCOMES` dump rather than a Playwright screenshot,
since this is the same already-dynamic button-building pattern already
verified to handle a variable outcome count. `log.php`'s own passthrough
behaviour (not in this repo) is assumed unaffected for the same reason
already given for the weather split, not independently re-checked.

## PWA: real bug — the app-shell service worker was silently serving stale ADS-B data (2026-09-01)

Reported directly: "the plots are stuck in a loop where they show 4ish
refreshes then revert back to the first of those 4. then occasionally
they plot back to a state from 5/10 minutes ago." A real, confirmed bug
in `sw.js`, not the relay, not the client-side render/diffing logic —
found by reading `sw.js`'s own fetch handler rather than starting from
`adsbExchangeClient.js`/`ui.js`/`map.js` (all read first and confirmed
clean: round-robin/fallback logic, extrapolation's `maxElapsedSeconds`
clamp, and the hex-diffing render code in both `ui.js` and `map.js` all
behave as documented, nothing there could produce a multi-minute revert).

**Root cause**: `sw.js`'s fetch handler (added 2026-08-23, see
"App-shell service worker" above) routed EVERY cross-origin GET request
through `staleWhileRevalidate()` — written and verified against its
intended target (MapLibre's jsdelivr JS/CSS, Google Fonts), but the
condition itself (`url.origin !== self.location.origin`) doesn't
distinguish "a static CDN asset" from "a live-data API call." The ADS-B
relay (`https://vectair.org/adsb-relay/relay.php?lat=...&lon=...
&dist=...`) is ALSO cross-origin relative to `vectair.github.io`, so it
was silently caught by the same rule. `staleWhileRevalidate()` returns
whatever's already in Cache Storage for that EXACT URL **instantly**,
with no expiry of its own — so whenever the GPS fix repeated (parked/
slow-moving, or just `watchPosition`'s own `maximumAge: 3000` reusing a
fix — see the geolocation options in `app.js`), the relay URL repeated
too, and the service worker handed back a stale aircraft snapshot from
whenever that exact lat/lon/dist combination was first seen, instead of
hitting the network. This is NOT the relay's own server-side cache
(`CACHE_TTL_S = 3s`, see "Follow-up: server-side throttling for Beta"
above) — that's far too short to explain minutes of staleness; it's the
browser-side Cache Storage entry, which had no TTL at all and could sit
there indefinitely until evicted or overwritten.

**Fix**: replaced the "any cross-origin request" condition with an
explicit `STATIC_CDN_HOSTS` allowlist (`cdn.jsdelivr.net`,
`fonts.googleapis.com`, `fonts.gstatic.com` — matching `index.html`'s
actual third-party `<script>`/`<link>` hosts exactly, re-confirmed by
grepping it, not assumed from memory). Everything else cross-origin —
the ADS-B relay, OpenRouteService routing/geocoding, MapTiler tiles,
adsb.fi's own direct fallback — now falls through with no
`event.respondWith()` call at all, so the browser handles those requests
exactly as if this service worker didn't exist, live every time. Same
"keep this list in sync by hand" caveat this file already carries for
`LOG_ENDPOINT`/`MAPTILER_KEY` and the other intentionally-duplicated
config values — flagged directly in `sw.js`'s own updated file-level
comment, not left implicit.

**Verified with a real Node/`vm` harness against the actual shipped
`sw.js` source** (not a retyped copy) — mocked `self`/`caches`/`fetch`,
dispatched synthetic `fetch` events for 9 URLs and asserted whether
`event.respondWith()` was called: the ADS-B relay, the log endpoint,
ORS routing, MapTiler tiles, and adsb.fi's direct fallback all correctly
did NOT get intercepted (5/5); MapLibre's jsdelivr JS, both Google Fonts
hosts, and a same-origin `?v=`-stamped local asset all correctly DID
(4/4) — 9/9 passed. Not verified: an actual before/after Playwright
repro reproducing the reported symptom end-to-end (stationary GPS +
mocked relay + real Cache Storage) — the routing-logic test above is
what actually proves the fix, and this bug's own mechanism (Cache
Storage entries persisting across page loads) makes a full live repro
significantly more setup than the routing check already covers.

**Not done, and worth flagging rather than assuming this alone fully
resolves what was reported**: this fixes the mechanism going forward —
once a tester's browser picks up the new service worker (automatic on
next load, `updateViaCache: "none"` already means `sw.js` itself is
always fetched fresh), no NEW stale relay responses will ever be cached.
It does NOT proactively clear any relay responses already sitting in a
tester's Cache Storage from before this fix — those entries simply
become unreachable dead weight (the fetch handler no longer reads them
for that URL), not something that could still be served, so no cleanup
step is actually needed; noting this only so a future session doesn't
wonder whether stale entries could somehow still surface. If the
reported symptom persists after this deploys, the next things to check,
in order: (a) whether the relay itself (`relay.php`, not in this repo)
has its own bug independent of this one — its documented `MAX_WAIT_S=6s`
give-up path and `CACHE_TTL_S=3s` cache could theoretically compound
with a genuinely bad connection, though neither explains a 5-10 minute
gap on their own; (b) a real device's OS-level network stack or carrier
proxy caching the relay's GET responses, outside anything VCAS's own
code controls.

### Follow-up: still happening after the service worker fix — added a cache-busting nonce (2026-09-01, same day)

Reported directly: "it's still doing it" after the `sw.js` fix above
deployed. Two real, independent explanations for why that fix alone
might not be enough, neither ruled out and both addressed together
rather than picking one to chase first:

1. **The new service worker may not have taken over yet.** `skipWaiting()`/
   `clients.claim()` mean a newly-activated worker takes control of
   already-open pages immediately, but the BROWSER still only checks
   `sw.js` itself for changes on navigation/periodically — an already-open
   tab/PWA session from before this deployed could still be running the
   OLD worker (with the old, buggy "any cross-origin request" rule) until
   the app is actually closed and reopened, not just left running.
2. **A second, independent URL-keyed cache may exist outside anything
   this repo controls.** `relay.php` (not in this repo) sends no known
   explicit `Cache-Control: no-store` — if the plain browser HTTP cache
   (honoring whatever headers, or lack of them, `relay.php` actually
   sends) or a CDN/proxy sitting in front of the Bluehost hosting is
   caching GET responses by exact URL, that would reproduce the identical
   symptom completely independent of the service worker fix, since it
   doesn't go through Cache Storage at all.

**Fix, in `adsbExchangeClient.js`'s `_fetchFromProvider()`**: two additions,
both defensive rather than targeted at one specific layer, since neither
of the two explanations above could be confirmed from this repo alone:
- `cache: "no-store"` added to the `fetch()` call itself — bypasses the
  plain browser HTTP cache regardless of what `relay.php` does or doesn't
  send, independent of the service worker entirely.
- A cache-busting `_=<Date.now()>` query param appended to EVERY provider's
  URL (relay, direct adsb.fi fallback, adsb_lol, adsb_exchange — all four,
  not just the relay path, since all four are live polls) — this is the
  one fix that would defeat literally any URL-keyed caching layer, known
  or not (a CDN in front of the relay being the leading remaining
  suspect), since a unique URL every request can never hit a stale cache
  entry regardless of who's holding it or why. Deliberately does NOT
  affect `relay.php`'s own intentional short-lived (3s) per-location
  server-side cache — that's keyed off the PARSED `lat`/`lon`/`dist`
  values server-side, not the raw query string, so an extra unrecognised
  `_` param has no effect on it.

Verified the URL construction itself (not the network behavior, which
this sandbox can't exercise against the real relay) via a real Node
check building all four providers' URLs through the actual nonce-append
logic and parsing each with `new URL()` — all four are well-formed
(correctly using `&` vs `?` depending on whether the provider's own
`buildUrl()` already included a query string).

**If this still doesn't resolve it**, the next real diagnostic step is
confirming which of the two explanations above was actually the cause —
concretely, checking (from a real device) whether `relay.php`'s response
headers include any caching directive at all, and whether the Bluehost
account has any CDN/caching layer (e.g. a Cloudflare integration)
enabled in front of it — neither of which this sandbox has any way to
check itself, since `relay.php` isn't in this repo and the live domain
isn't reachable from here.

### Follow-up: the real root cause of "hard refresh doesn't fix it" — the service worker's OWN registration URL never actually changed between deploys (2026-09-01, same day)

Reported directly: "I've done a ctrl shift r and it's not fixed. but in
incognito it is working correctly." That single fact is a clean,
decisive signal, worth recording as a diagnostic technique on its own —
incognito starts with zero pre-existing Service Worker registration or
Cache Storage for the site, so if the bug is gone there but persists in
a normal profile even after a hard reload, the cause has to be
something specific to an ALREADY-INSTALLED service worker refusing to
hand over control — not the CDN/proxy-in-front-of-relay.php theory
flagged as the remaining open possibility in the entry above (that would
still reproduce identically in incognito, since it's entirely
server-side and has nothing to do with per-browser-profile storage).
This ruled that theory out and pointed squarely back at the service
worker itself.

**The actual bug, found by re-reading `deploy-pages.yml`'s own cache-
busting step rather than the service worker code again**: every local
asset gets a `?v=<commit-sha>` query string stamped in at deploy time via
`sed -i "s/__BUILD_ID__/${GITHUB_SHA}/g" index.html manifest.json` — but
`app.js`'s own `_registerServiceWorker()` ALSO contains a
`sw.js?v=__BUILD_ID__` placeholder (needed so each deploy registers a
genuinely different service-worker scriptURL, the same reason every
other asset gets this treatment) — and `src/app.js` was never in that
sed command's file list. This means the placeholder there has been
silently un-substituted since the service worker was first added
(2026-08-23) — every single deploy has registered the exact same,
byte-for-byte-identical literal string `"sw.js?v=__BUILD_ID__"`, forever.

**Why this explains "hard refresh doesn't fix it" precisely**: a normal
user-triggered hard reload (Ctrl+Shift+R) bypasses the browser's plain
HTTP disk cache for that navigation — it does NOT force an
already-controlling service worker to be replaced. Since the
registration's scriptURL genuinely never changes between deploys, the
browser has no strong signal that anything is different and falls back
entirely on its own background update-check cadence for that
registration — which is real, but can leave a stale, already-active
worker (running whatever buggy caching logic was in place when it was
first installed) in control for a long, unpredictable time regardless of
how many times the page itself is reloaded. A fresh incognito context has
no prior registration to contend with at all, so it always installs
whatever the CURRENTLY deployed `sw.js` actually is — explaining exactly
why incognito worked immediately while the normal profile didn't, even
after the two service-worker-side fixes above had already shipped and
were entirely correct on their own terms.

**Fix, two parts**:
1. `deploy-pages.yml`'s sed step now also covers `src/app.js` — every
   deploy from here on registers a genuinely new `sw.js?v=<sha>`
   scriptURL, the same reliable cache-busting every other asset already
   gets, closing the actual gap rather than working around it.
2. `_registerServiceWorker()` (`app.js`) now also listens for
   `controllerchange` and reloads the page exactly once the moment a new
   worker actually takes control — belt-and-suspenders alongside fix #1:
   even with a guaranteed-fresh scriptURL forcing a real install/activate
   cycle, an already-open tab from before that finishes has no reason to
   start USING the new worker without some kind of reload; this makes
   that handoff automatic rather than relying on the tester noticing and
   manually reloading again. A `_reloadedForSw` guard prevents a reload
   loop if `controllerchange` were ever to fire more than once in one page
   lifetime.

**Verified**: `grep` confirms the string `__BUILD_ID__` appears exactly
once in `app.js` now (the intended placeholder itself — a second
occurrence briefly existed in this fix's own explanatory comment during
drafting, which would have been silently rewritten by the same sed step
it was describing; reworded to avoid that before finishing), and
`node --check src/app.js` confirms the file is still syntactically valid
after the edit. Not verified: an actual live deploy-and-reload cycle
(this sandbox can't reach `vectair.github.io` or run GitHub Actions) —
the real check is the project owner's next deploy actually resolving the
issue without needing a manual service-worker unregister.

## Visibility model calibration pass #1: METAR fetching was very likely completely broken (2026-09-01)

Direct instruction: "Lets work on improving the model" → "Calibrate
against real log data." Pulled the full `Vectair/vcas-logs` mirror
(grown from 26 files at the last pull to 80 — 73 real observations, 7
crash/watchdog reports) and grouped by outcome vs. what `Visibility.
estimate()` actually predicted for each:

| Outcome | n | Predicted |
|---|---|---|
| visible_contrail | 39 | Possibly visible (38/39) — contrail floor working as designed |
| visible_airframe | 17 | mostly Likely visible (12/17) — reasonable |
| not_visible_missed | 8 | Possibly (5) / Likely visible (3) |
| not_visible_obstruction | 5 | Likely (4) / Possibly (1) — expected, no building/terrain data |
| **not_visible_weather** | **4** | **Likely visible (3) / Certainly visible (1) — every single one** |

That last row is the finding: **4 for 4**, the model was at high-to-
maximum confidence and the METAR-based weather cap (`_applyMetarAdjustment()`
in `visibility.js`) never once brought it down. `metarProvider.js`'s own
header comment had already flagged this as unverified ("built in a
sandbox with no network path to aviationweather.gov... worth confirming
against a real fetch once deployed") — and a web search confirmed the
suspicion directly: **aviationweather.gov's `/api/data/metar` endpoint
sends no `Access-Control-Allow-Origin` header**, so a browser `fetch()`
can't read the response — the exact same failure class already hit and
fixed for adsb.fi (see "ADS-B data source" above). `_fetchNearest()`'s
own try/catch means this fails completely silently: `MetarProvider.
getCached()` almost certainly has never returned real data in the
deployed app, `Visibility.estimate()`'s `metar` parameter has always been
null, and the entire weather-adjustment branch has likely never executed
once in production. Four independent real-world misses, one clean
mechanical explanation — not treated as proven beyond doubt (no direct
server log access to confirm), but strong enough to act on.

A secondary, much weaker signal from the same pull: 3 of the 8
`not_visible_missed` cases were high-altitude/moderate-range aircraft
(34,650ft/8.7nm, 39,625ft/13.2nm, 13,400ft/2.8nm) scored "Likely visible"
by angular size alone with no contrail reported — possibly angular size
alone overrating non-contrailing high-altitude traffic, but n=3 is too
thin to retune anything from; logged here as a watch-item only, not
acted on.

### Fix: METAR CORS relay, same pattern as the ADS-B relay

Confirmed with the project owner before building (this is a real,
deployable piece of infrastructure, not a quick code tweak — asked via
`AskUserQuestion` rather than assumed). Built `relay.php` — same shape
as `adsb-relay/relay.php`: shared-secret `X-VCAS-Key` header auth (new,
separately-generated secret — never reuses the ADS-B relay's own key),
strict `bbox` input validation (exactly 4 sane-range floats via regex —
matters here specifically because the value is forwarded into a
server-side outbound URL, a real SSRF surface if not validated tightly),
a file-locked global rate gate (`reserve_upstream_slot()`, ported
directly from the proven ADS-B relay implementation) and a short-lived
per-area response cache (bbox rounded to 1 decimal place — ~11km — for
the cache key, both for locality across nearby testers and so a small
amount of rounding doesn't meaningfully change which stations a query
returns), with a bounded give-up path serving stale cache or a `429`
rather than hanging.

**Deliberately lighter throttling posture than the ADS-B relay**, stated
explicitly in the file's own comment: aviationweather.gov has no
documented hard 1req/s-style ceiling the way adsb.fi does, METARs
themselves only update roughly hourly, and `MetarProvider` itself only
refreshes every 15 minutes client-side regardless — so
`MIN_UPSTREAM_INTERVAL_S` (1.0s) and `CACHE_TTL_S` (300s) exist mainly to
be a considerate API citizen under concurrent testers hitting overlapping
areas, not to satisfy a hard external limit.

**Tested locally against a mocked upstream** (this sandbox can't reach
aviationweather.gov either), same discipline as the ADS-B relay and
`log.php` before it: `php -l` syntax check, then a live `php -S` server
exercising — missing/wrong auth key (401 both), malformed and
out-of-range `bbox` (400 both), a valid request round-tripping the mock's
real JSON body, an immediate repeat hitting cache (confirmed via the
mock's own call log staying at 1), cache expiry correctly triggering a
second upstream call, and — the one piece worth a dedicated concurrency
check rather than just trusting the reused pattern — 3 simultaneous
requests to 3 distinct areas correctly serialized to the configured
interval (0.003s/0.303s/0.603s spacing against a test-tuned 0.3s
interval, i.e. exactly on schedule). All passed against the actual
shipped file.

**App-side wiring**: `metarProvider.js`'s `_fetchNearest()` now routes
through `CONFIG.METAR_RELAY_URL`/`METAR_RELAY_KEY` when set (mirroring
`adsbExchangeClient.js`'s own `ADSB_RELAY_URL` pattern exactly — same
"leave blank to fall back to calling the real API directly, which still
works outside a browser" fallback), falling back to the direct
aviationweather.gov call otherwise. `config.js` has both values filled in
now, pointing at `https://vectair.org/metar-relay/relay.php` with a
freshly generated shared secret.

**Also added while investigating**: `observationLogger.js`'s
`buildObservation()` now snapshots `MetarProvider.getCached()` into every
observation's `computed.metar` field — a real, previously-flagged gap
(see the "not_visible_weather" split entry above: "the observation
payload itself still doesn't snapshot the actual METAR conditions in
effect at the time of the sighting"). Without this, the 4 real
not_visible_weather cases pulled during this investigation couldn't be
definitively diagnosed (unavailable METAR vs. present-but-insufficient
METAR) — this closes that gap for every observation logged from here on,
regardless of which theory was actually correct in the deployed app at
any given moment.

**Not committed to this repo**: `relay.php` + `cache/.htaccess` +
`DEPLOY_INSTRUCTIONS.md`, same handoff pattern as the ADS-B relay and
`log.php` — sent to the project owner via `SendUserFile`, needs manual
Bluehost deployment (`public_html/metar-relay/`) before it does anything;
`config.js` already points at the URL this deploy will bring live.
`DEPLOY_INSTRUCTIONS.md` explicitly calls out the same cPanel
leading-dot-stripping `.htaccess` gotcha hit during the original ADS-B
relay deploy, so it isn't rediscovered a second time.

**Honest status**: the CORS-missing-header diagnosis is strongly
supported (real log data pattern + independent web confirmation) but not
100% certain without direct access to aviationweather.gov's response
headers from a real browser session, which this sandbox can't produce.
If METAR still isn't visibly affecting scores after this relay is
deployed, the next thing to check is whether `_parseVisibilitySm`/
`_parseClouds`'s assumed response shape actually matches
aviationweather.gov's real JSON (same never-verified-against-a-live-
fetch caveat the file's own header comment already carries) — the relay
fixes the CORS transport problem specifically, not any possible parsing
mismatch underneath it.

### Deploy follow-up: relay went live, two real snags along the way (2026-09-01, same day)

Neither was a bug in `relay.php` itself — both were deploy-mechanics
gotchas, worth recording since they cost real back-and-forth to diagnose
and neither was visible from the code:

1. **Folder name mismatch**: the project owner created the folder as
   `metar_relay` (underscore) in cPanel File Manager, but `config.js`
   (and every instruction/URL) says `metar-relay` (hyphen) — matching
   `adsb-relay`'s own naming. Apache correctly 404'd (the account's own
   themed 404 page, confirming it was really reaching the vhost, just
   the wrong path) since no folder by that exact name existed. Fixed by
   renaming the folder in File Manager — contents moved with it
   automatically. **Lesson for next time a folder-based deploy happens
   here**: state the exact folder name with its exact punctuation
   up front, not just "create a folder for this," since cPanel won't
   warn about a hyphen/underscore mismatch and the resulting 404 gives
   no hint which one was expected.
2. **A red herring, not a real bug**: after the rename, testing the
   *bare* folder URL (`vectair.org/metar-relay/`, no filename) 403'd —
   this looked alarming but is actually correct, expected Apache
   behaviour (no `index.php`, directory listing disabled, so a bare
   folder request is properly refused). It has nothing to do with
   whether `relay.php` itself works. Worth remembering as a diagnostic
   pitfall: a bare-directory 403 is a *good* sign (the folder is
   correctly locked down), not a symptom to chase — the only URL that
   actually matters is the one hitting `relay.php` directly.

**Confirmed live**: `https://vectair.org/metar-relay/relay.php?bbox=51,-1,52,0`
now returns the correct `{"ok":false,"error":"unauthorized"}` response
for an unkeyed request — PHP is executing, the shared-secret check is
working, and the app's already-pushed `config.js`/`metarProvider.js`
wiring means the very next real GPS fix in the deployed app should start
actually feeding METAR data into `Visibility.estimate()` for the first
time. Worth watching the ground-truth log data over the next
week or two — a `not_visible_weather` observation with a genuinely
lower/capped predicted label (instead of the 4-for-4 "high confidence,
no adjustment applied" pattern that prompted this whole investigation)
would be the real confirmation the fix is working end-to-end, not just
that the relay itself responds correctly.

## Visibility model calibration pass #2: two real METAR correctness bugs, plus a documented gap (2026-09-02)

Direct instruction: "Lets work on improving the model" continued into a
second round, this time reviewing two independent design proposals from
a different LLM (a full weather-subsystem rearchitecture, and a
local-obstruction feature) submitted for cross-review. Full details of
that review process — including why the larger multi-station/confidence
weather rearchitecture was deliberately NOT adopted (too many new tuned
constants for how sparse this project's ground-truth log data actually
is) — live in this session's own transcript; this entry covers what
actually shipped: two narrow, verified correctness fixes to the
*existing* METAR adjustment, plus one gap documented but deliberately
left unfixed.

### Fix A — AGL/MSL cloud-base datum mismatch

`_lowestOccludingLayer()` (`visibility.js`) used to compare a METAR cloud
layer's reported base directly against the aircraft's ADS-B altitude —
but METAR cloud bases are reported AGL, relative to the REPORTING
STATION, while ADS-B altitude is MSL-referenced. At an elevated station
this could misjudge whether a layer was actually below the aircraft.

Confirmed real via a third-party-documented live METAR JSON example
(KORD/O'Hare) before fixing it — this sandbox can't reach
aviationweather.gov directly:
```json
{ "icaoId": "KORD", "elev": 202, "clouds": [{ "cover": "BKN", "base": 11000 }] }
```
`elev: 202` only makes sense as **metres** (O'Hare's real elevation is
~672ft/205m — 202ft would be wrong for that airport); `clouds[].base:
11000` matches the raw METAR text's own `BKN110` (11,000ft AGL),
confirming both the field's existence/unit and that `base` really is
AGL, not MSL.

Fixed: `metarProvider.js` now parses `best.elev` (metres → feet,
`elevationFt`) and `_parseClouds()` computes `baseMslFt = elevationFt +
baseAglFt` alongside the original `baseFt` (kept, for backward
compatibility). `visibility.js`'s `_lowestOccludingLayer()` now compares
against `baseMslFt`, falling back to raw `baseFt` if elevation was ever
unavailable — degrades gracefully rather than dropping the whole check.

### Fix B — horizontal vs. slant range for prevailing visibility

`_applyMetarAdjustment()` used to compare the aircraft's **slant range**
against reported prevailing visibility — a horizontal/surface
measurement, not a spherical radius around the station. This could
wrongly penalize a high, near-overhead aircraft purely for its vertical
distance, which the METAR gives no actual basis for judging.

Fixed: `_applyMetarAdjustment(cat, altitudeFt, horizNm, metar)` now takes
horizontal distance (already computed in `estimate()`, just not
previously threaded through this call) instead of slant range for the
reported-visibility check. The cloud-occlusion check is unaffected — it's
altitude-based, not distance-based.

**Both verified with real Node execution against the actual shipped
code, not just reasoning through it**: a synthetic elevated-station case
(cloud AGL base 4000ft, station elevation 3000ft, aircraft at 6000ft MSL)
confirmed the old AGL-only comparison would have wrongly occluded the
aircraft (4000 < 6000) while the fixed MSL comparison correctly does not
(7000 ≥ 6000); a horizontal-vs-slant case confirmed a near-overhead
aircraft (small horizontal offset, large slant range from altitude) is no
longer wrongly capped by reported visibility, while a genuinely
horizontally-distant aircraft in the same low-visibility METAR still
correctly gets capped (Likely visible → Possibly visible only when
`horizNm`, not slant, actually exceeds the reported figure); and
`metarProvider.js`'s own parsing was directly tested against a mocked
fetch returning the real KORD example — `elevationFt`/`baseMslFt` come
out numerically exact.

**Logging**: `observationLogger.js`'s `computed.metar` snapshot (added in
calibration pass #1) already captures the *entire* `MetarProvider.
getCached()` object verbatim — `elevationFt`/`baseMslFt` now flow through
automatically into every future logged observation with zero additional
logging code, so future `not_visible_weather` entries can be checked
against real MSL-corrected cloud data, not just the final tier.

### A related, real gap — documented, not fixed

A third weather-review note correctly identified that "no METAR cloud
reported" (including CAVOK) was being read by `_applyMetarAdjustment()`
as "confirmed clear all the way to the aircraft's altitude" — but METAR
only actually characterizes the surface-to-~5,000ft column and prevailing
visibility; it says nothing about an unreported mid/upper-level layer
(e.g. a jet at FL320 could be sitting above a real but unreported OVC
deck at FL180-230). Confirmed this really is what the current code does:
`_lowestOccludingLayer()` returns `null` when no BKN/OVC/VV is reported,
and the cloud check silently no-ops in that case.

**Deliberately not patched here.** Unlike Fixes A/B, there's no single
unambiguous correct fix without an actual upper-air data source (a
separate, reviewed-but-not-adopted proposal recommends Open-Meteo/ECMWF
IFS for this — genuinely global, no key, and — per a web search this
sandbox can't verify directly against the live API — reportedly sends
`Access-Control-Allow-Origin: *`, meaning it might be the first weather
source in this project that doesn't need a relay built for it, if it's
ever actually implemented). An interim confidence cap without real
upper-air data would be an uncalibrated guess risking a fight with the
existing contrail-rescue logic (which specifically exists to give
high-altitude aircraft *more* confidence, not less) — exactly the kind of
speculative complexity this calibration pass has otherwise been pushing
back on. Left as a named, documented gap (this comment, plus
`_applyMetarAdjustment()`'s own inline comment) rather than a silent one,
for whenever the upper-air provider work actually happens.

## Local obstruction (buildings + wooded landcover) signal (2026-09-02)

Direct follow-up: "What can you tell me about factoring location vis a
vis infrastructure and vegetation into this?" A true line-of-sight model
(ray-casting against a real surface model) was scoped and explicitly
rejected as disproportionate infrastructure for VCAS today — no free
global high-resolution building+vegetation elevation data, and no GIS
backend to do the ray-cast even if there were. Per-user ground-truth log
data was also ruled out as a basis for this specifically (the project
owner's own words: logging is opportunistic, from only 1-2 people, too
sparse to be "substantially informative").

Instead: VCAS already loads real building-footprint and landcover
(including wooded/forest) vector-tile data for its Hybrid map style
(MapTiler/OpenMapTiles, `src/map/navStyle.js`) — reusing that instead of
sourcing anything new. The result is a coarse, **non-directional** prior:
when the observer is in a densely built or wooded area, low-elevation
aircraft score lower, matching the real, previously-undocumented
systematic gap between "aircraft A at 5° elevation over an open field"
and "aircraft B at the same 5° elevation in dense buildings/woodland" —
angular size alone can't distinguish these, but the aggregate probability
of spotting B is plainly lower.

This design was cross-checked against an independent proposal (a second
LLM's own design document, reviewed in full) covering the same feature —
strong convergence on the core approach (reuse MapLibre's loaded tile
data, no new dependency), plus several genuine improvements folded in:
the overlap-safe combined-density formula, movement-triggered refresh
over a flat timer, and — the one interaction neither this session's own
first pass nor most reviews would think to check — exempting the
existing `<1nm && <500ft` "very close" override from this cap, so a
coarse non-directional prior can't undermine an already-high-confidence,
effectively-directional rule.

### Two real constraints found during research, not assumed

1. **No bundler, no npm, no package.json anywhere in this repo.**
   Everything loads via plain `<script src="...">` tags in `index.html`,
   cache-busted with `?v=__BUILD_ID__`, deployed as a static site. This
   ruled out fetching raw vector tiles directly and decoding them with
   `pbf`/`@mapbox/vector-tile` (real npm packages, but no mechanical way
   to consume them here without a bundler) — reusing MapLibre's own
   already-loaded source via `querySourceFeatures()` was the only real
   option, not just the simplest one.
2. **RAW mode's style had zero tile sources by design** (`navStyle.js`)
   — a single persistent `maplibregl.Map` instance swaps styles via
   `setStyle(style, {diff:true})`, and since RAW's style declared no
   sources, switching into RAW actively dropped any building/landcover
   tile data Hybrid had loaded. RAW is the app's default mode and the
   primary target for this feature.

### The open technical question, resolved by real testing — and the answer was NOT what was assumed going in

The design going in assumed a layer with `layout: {visibility: "none"}`
would be the right way to give RAW an invisible-but-queryable source
(present in the style, painting nothing). **Built a real
`maplibre-gl@4` + Playwright harness (this project's established
convention) and confirmed the opposite**: `visibility: "none"` suppresses
tile *loading* entirely, not just rendering — 0 network requests, 0
features ever returned by `querySourceFeatures()`, even with a real,
valid MVT tile available at the exact URL the map would request. A
genuinely rendered but **zero-opacity** layer (`paint: {"fill-opacity":
0}`) is what actually works — 1 real tile request fired, and
`querySourceFeatures()` correctly returned the real feature geometry.
Proven two ways: first with an empty mock tile response (request-count
only), then with a real MVT tile generated via `geojson-vt`/`vt-pbf`
containing an actual test polygon, confirming both that the request
fires AND that the returned feature data is genuine and correctly
parsed. This is exactly the kind of non-obvious MapLibre behavior this
project has been burned by skipping before (see "Camera anchor math"
and the RAW-glyphs investigation above) — glad this one was checked
before shipping, not after.

`navStyle.js`'s RAW branch (`getStyle()`/`_layers()`) now declares the
same MapTiler vector source Hybrid uses, plus two real (zero-opacity)
layers: `raw-obstruction-building` (source-layer `building`) and
`raw-obstruction-landcover-forest` (source-layer `landcover`, filtered
to `["wood", "forest"]` — the exact class values already proven against
this tile source by the real, visible `landcover-forest` layer in the
day/night styles, read directly rather than assumed from generic
OpenMapTiles docs). Confirmed **zero visual change** to RAW two ways:
against an unreachable-tiles harness (nothing loads, still solid black)
and — the stronger, more conclusive check — against a harness serving a
real building+forest tile with real feature data flowing through both
layers, still solid black. `NavStyle.SOURCE_ID` is now exported from its
public API specifically so `map.js` never needs a second hardcoded
`"omvt"` string that could drift from the real one.

### `EosMap.queryLocalDensity(lat, lon, radiusM)` (`src/map.js`)

Queries both layers via `querySourceFeatures()` (confirmed to return real
geographic lon/lat coordinates, not tile-local units — checked directly
rather than assumed, since that's a real, well-known category of
MapLibre/Mapbox gotcha), then for each returned polygon: computes its
centroid (plain vertex average — a coarse "is this polygon within the
search radius" inclusion test, not a true area-weighted centroid), keeps
it only if the centroid is within `radiusM` of the observer, and sums
its area via the shoelace formula on a flat equirectangular projection
centred on the observer (a deliberate simplification — spherical error
is negligible at this 250-750m scale). Returns building/vegetation
densities separately plus a combined figure using the overlap-safe
formula `1 - (1-buildingDensity)(1-vegetationDensity)` (not a naive sum,
which could exceed 1 where a wooded area contains buildings) — folded in
from the independent review, a real gap in this session's own first
design pass.

**v1 deliberately skips true circle-clipping of polygons** — a
centroid-in-radius test gives one clean in/out decision per polygon
rather than exact geometric intersection with the sampling circle. The
actual requirement is a *stable relative* density that behaves sensibly
across reference locations, not geometrically exact covered square
metres — matches the independent review's own conclusion on this point.

**Verified end-to-end against a real, generated MVT tile** (via
`geojson-vt`/`vt-pbf`, not a mock): a known 80×80m building polygon and a
known 150×100m forest polygon, both placed within a 300m query radius of
a known centre point. Computed `buildingDensity` came out 0.0226 vs. an
independently hand-computed expected 0.0226 (0.2% off), `vegetationDensity`
0.0530 vs. expected 0.0531 (0.1% off) — this is the real `map.js`/
`navStyle.js` code, run through a real MapLibre instance with real served
tile data, not a synthetic stand-in for either.

### `src/logic/localObstruction.js` — new module, mirrors `MetarProvider`'s shape

`refresh(map, lat, lon)` + synchronous `getCached()`. Unlike
`MetarProvider` (a pure network fetch, no DOM dependency), this needs the
live `EosMap` instance, so it's passed in rather than imported.

**Movement-triggered refresh, not timer-driven** (folded in from the
independent review — cleaner than this session's own first-pass flat
interval): re-queries once the observer has moved >150m from the last
query point, or the cached result is >60s old (a fallback guarding a
stuck/error state, not the primary trigger) — local building/vegetation
density doesn't change meaningfully while stationary or crawling, so
there's no reason to re-query on a clock the way METAR's own real
weather data needs to.

**A failed/unavailable query must resolve to "no data," never to a
default density value** — silently reading a failure as "confirmed open
terrain" would make traffic look *easier* to see exactly when the module
knows the least, which is backwards. Implemented simply: a failed
`refresh()` call just leaves `_cached` untouched (still `null` if nothing
has ever succeeded, or still the last known-good value if one exists) —
no separate "available" flag needed, the existing `null`-means-no-data
convention (already established by `MetarProvider.getCached()`) already
encodes this correctly. Verified with 10 checks against the real module,
including specifically confirming a throwing `queryLocalDensity()` never
overwrites a valid cache with a default/null value, and that a
never-succeeded module correctly stays `null` (not some fallback) after
a failed query.

### Wired into `Visibility.estimate()` — 5th parameter, same shape as `metar`

New constants next to the existing contrail constants (this file's own
established precedent for its own field-tuned numbers, not `CONFIG.js`):
`LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG` (12°) and
`LOCAL_OBSTRUCTION_DENSE_THRESHOLD` (0.45) — both genuine field-tuned
guesses, same honesty-about-provenance as the contrail numbers, pending
real calibration once real density data accumulates across known
reference locations.

`_applyLocalObstructionAdjustment(cat, elevationDeg, localObstruction,
veryClose)` — gated on BOTH conditions together, not either alone (dense
surroundings shouldn't penalize a high aircraft; a low aircraft over
open terrain shouldn't be penalized just because the elevation is low).
Binary and downward-only for v1, same `_capAtPossiblyVisible` discipline
already established for the METAR stage, runs immediately after it.
**`veryClose` is explicitly exempted** — a coarse, non-directional prior
shouldn't override the existing high-confidence close-range rule.

A second, independent proposal (reviewed but not adopted in this
session — see the weather-calibration entries above) separately wants to
rearchitect `Visibility.estimate()`'s own signature into a named options
object. Deliberately not coordinating with that here: kept the plain 5th
positional parameter, matching what that proposal's own document already
recommended as the compatible interim shape — any signature refactor is
a separate follow-up gated on whether that proposal is actually adopted,
not a prerequisite for this feature.

Verified with 8 Node checks against the real `estimate()`: null
obstruction is a no-op; high density + high elevation is unchanged
(elevation gate blocks it); low density + low elevation is unchanged
(density gate blocks it); high density + low elevation correctly caps at
"Possibly visible"; an already-"Very unlikely" result stays there (cap
never raises); "Possibly visible" is idempotent under the cap; and the
`veryClose` override stays "Certainly visible" even under dense
obstruction, confirming the exemption actually works.

### Wiring: `indicators.js` / `app.js` / `index.html`

`indicators.js`'s `_computeAll()` destructures `localObstruction` from
`userState` and passes it through, mirroring `metar` exactly.
`app.js`'s two `userState` object literals (`refreshIndicators`,
`refreshAirMode`) both add `localObstruction: LocalObstruction.getCached()`.
The actual `LocalObstruction.refresh(EosMap, userLat, userLon)` call
lives in `fetchAircraft()`, right alongside the existing
`MetarProvider.refresh()` call — same "safe to call every tick,
internally self-throttles" contract. `index.html` loads
`src/logic/localObstruction.js` right after `metarProvider.js` (both are
environmental-scoring-input providers consumed by `visibility.js`, a
more natural pairing than "after map.js" despite this module needing an
`EosMap` reference at call time — it has no dependency on `map.js` at
parse time, only `Geo`, already loaded earlier).

`observationLogger.js`'s `buildObservation()` now also snapshots
`LocalObstruction.getCached()` verbatim into every logged observation
(same "raw context, not a derived flag" pattern already established for
the `metar` snapshot) — so future `not_visible_obstruction`/
`visible_airframe` entries can be checked against real density data, not
just the final tier.

### Runtime cost — measured as a hard acceptance criterion, not assumed

Per the plan, this was treated as something to actually verify, not
just claim: profiled `queryLocalDensity()` against a synthetic
dense-urban scene (1024 small buildings in a tight ~22m grid pitch,
comfortably denser than a real city block within a 300m radius) —
`querySourceFeatures()` itself: 2.8ms; the full call including both
layers' queries and all centroid/area math: 10.9ms. Comfortably within
a single frame budget even at a strict 30fps threshold (~33ms), and this
only ever runs on the movement-throttled cadence `LocalObstruction`
already provides (not every render tick), so there's real headroom
beyond even that. Density math sanity-checked at this scale too: 0.302
computed density against an independently-derived expected ~0.30 from
the grid geometry.

### Explicit v1 scope

Non-directional (matches exactly what was asked — not "a building blocks
this bearing," but "this area is generally hostile to spotting low
aircraft"). No terrain elevation, no individual building/tree heights,
no true polygon clipping, no continuous (non-binary) response curve, no
separate building-vs-vegetation thresholds, no interaction term with the
weather adjustment. None of these should get silently added later
without a real, separate decision to do so.

**Honest status**: every piece above was verified with real execution —
real MapLibre+Playwright for the MapLibre-specific behavior (tile
loading, style validity, visual fidelity, density math against real
served tiles), real Node execution for the pure-logic pieces
(`LocalObstruction`'s throttling, `_applyLocalObstructionAdjustment`'s
gating). What's genuinely NOT yet verified: real-world density numbers
across actual known locations (open airfield vs. suburb vs. city centre
vs. woodland) — that needs a real device with a real MapTiler key this
sandbox can't provide, and is exactly the input `LOCAL_OBSTRUCTION_DENSE_THRESHOLD`
needs before it can move past "reasonable starting guess."

## RAW-mode redesign, round 1: car ownship icon + list reverted to priority-only (2026-09-06)

Prompted by a 3-panel comparison image the project owner shared: their own
hand-drawn RAW-mode design draft, a screenshot of the current deployed web
app's RAW mode, and a real Microsoft Flight Simulator A320 ND reference
photo. Their own framing, given directly, matters for how to read the
whole comparison: **"I haven't thrown out our previous work but taken
what currently exists and reworked it into a style/theme that I find
preferable."** i.e. this is a restyling of the existing RAW mode, not a
replacement design — read every one of the four feedback points below
against that framing, not as "build a new screen."

Four pieces of feedback came in together; this entry covers the two
scoped as quick/low-risk and implemented immediately. The other two (a
route/flight-plan line for RAW+Hybrid nav, and a bottom-bar restyle) are
real, separate, larger pieces of work — deliberately sequenced after
this pair per the project owner's own explicit choice ("small ones
first, then the nav line") and not started yet.

### 1. Ownship symbol switched from a chevron to a car

Direct instruction: "the ownership symbol should be switched to the car
symbol. Long term this will be switchable between whichever the app is
being used with. Car, bike or pedestrian." Only "car" was asked for now
— per this project's own "don't design for hypothetical future
requirements" convention, no vehicle-type switch/setting was built; the
long-term plan is noted only as a comment at the change site
(`_createUserMarker` in `map.js`) naming the natural extension point
(a `_vehicleIconMarkup(vehicleType)` lookup) for whenever that's actually
requested.

This marker is the one real `maplibregl.Marker` shared by every mode
(NAV/RAW/AIR all render the same real map instance/marker under
different styles/cameras — see "Range rings" above) — replacing its SVG
in `map.js`'s `_createUserMarker()` therefore changes the icon
everywhere at once, not just in RAW. The previous shape was a plain
directional triangle/chevron (`<path d="M10 1 L19 27 L10 21 L1 27 Z">`,
`fill="var(--accent-user)"`). The new shape is a small top-down car
silhouette — a rounded body path, four small wheel-bump rects at the
sides, and a separate dark semi-transparent windshield path — built and
visually iterated in a real Playwright/Chromium harness (this project's
established convention) before touching the real file, since a
hand-authored SVG path is easy to get looking wrong (a first draft
genuinely looked like a ghost, not a car, and was redrawn).

**A real, non-obvious CSS coupling had to be fixed at the same time, not
just the shape swapped in-place**: RAW mode force-colours the ownship
pure yellow (`(255,255,0)`, pixel-sampled from the real ND reference's
own ownship symbol — see "RAW mode fidelity" above), and the old CSS
rule did this via `.user-marker-nav path { fill: #ffff00; }` — a
selector that only ever matched the single `<path>` the old chevron was.
The new car icon is a mix of `<rect>` (wheels) and `<path>` (body,
windshield) elements, so that same selector would have left the wheels
stuck lime-green in RAW mode while the body turned yellow — a real,
easy-to-miss inconsistency if the CSS had been left as-is. Fixed by
switching the body+wheels group to `fill="currentColor"` and retargeting
the RAW override to set `.user-marker-nav { color: #ffff00 }` instead of
a `path`-specific fill rule — the override now cascades correctly
regardless of which element types make up the icon, robust to a future
bike/pedestrian icon swap using a different shape mix. The windshield
keeps its own explicit dark fill in both cases, so it still reads as
glass against either body colour.

Verified with a real Playwright/Chromium render of the actual new
markup against the real `VCAS.css`, across all three states the CSS
distinguishes: plain NAV/Hybrid (lime-green body, halo glow, as before),
RAW (`body[data-mode="nav"][data-nav-style="raw"]` — confirmed the whole
body+wheels group forces to yellow while the windshield stays dark), and
AIR (same lime-green as Hybrid, confirming the AIR-specific CSS path
wasn't accidentally affected). All three matched the intended design
before this was considered done.

### 2. Aircraft-list panel reverted to always-priority order — resorting removed

Direct instruction: "I have decided to revert back to just ordering it
based on most visible. Because this is for android auto there should
initially be less interaction and rearranging the list is not
necessary." This reverses the Stage 3 list panel's own 2026-08-21
"sortable via PRI/RNG/ALT/TYP header buttons" feature (see "Stage 3:
sortable aircraft-list panel" above) — not a bug fix, a deliberate
interaction-surface reduction for the platform this screen is actually
headed toward (Android Auto's own distraction-minimization posture,
already the reasoning behind the 5mph interaction gates elsewhere in
this app).

Removed, not just hidden behind a flag — matching this project's own
"if you're certain it's unused, delete it, don't leave a disabled shell
behind" convention: `ui.js`'s `RAW_LIST_SORT_MODES` constant and the
header-button markup/click-wiring inside `renderAircraftList()`;
`app.js`'s `rawListSortMode` state, `_sortForRawList()`, and
`onRawListSortClick()`; the now-dead `.raw-list-header`/
`.raw-list-sort-btn` CSS rules. `renderAircraftList()`'s signature
dropped the now-meaningless `sortMode`/`onSortClick` parameters
entirely rather than keeping them as unused holes. The call site in
`app.js` now passes `allRelevant` straight through — it was already
arriving in `Indicators.build()`'s own priority order (visibility score
descending, then proximity), the exact same order that governs which
aircraft get plot icons/pagination at all, so "most visible first" was
already the underlying data order; only the ability to leave it were
being removed, not any actual sorting logic.

Verified with a real Playwright/Chromium harness driving the actual,
now-edited `ui.js` against stubbed `ThemeManager`/`ColorblindMode`/
`NavDisplayStyle` (this project's established pattern for this file):
confirmed the panel renders with no header row at all, the two test
aircraft render in the exact order passed in, and the pre-existing
beyond-range dimming (`.raw-list-row.beyond-range`) still applies
correctly — that feature is unrelated to sorting and had to keep working
unchanged.

### Not done in this pass, and not implied by it

The flight-plan/route line for RAW+Hybrid nav (with the turn/junction
name shown where the ND would show a waypoint name, and the top ND-style
info strip replaced with car-relevant info) and the bottom-bar Airbus-
switch-bank restyle are both real, separately-scoped work the project
owner explicitly deferred to a follow-up pass, not overlooked here.
Neither has been started.

**Also not touched, and worth flagging rather than letting it go stale
silently**: the native Android Auto port's own Stage-3-list Kotlin
port (`RawAircraftListView.kt` — see "Phone screen, real pass 2" above)
still implements the PRI/RNG/ALT/TYP sort buttons this entry just
removed from the web app, and `MainActivity.kt`'s comments still
reference `_sortForRawList()` by name. The native port has always lagged
the web app and been synced in dedicated passes (per this file's own
established pattern for that project), not kept in lockstep on every
change — carrying this forward into the native code is real, separate
follow-up work for whenever that port's next sync pass happens, not
something this round of edits silently included.

## RAW-mode redesign, round 2: screen-space flight-plan line + merged nav-status card (2026-09-06, same day)

The second, larger piece from the same 3-panel-comparison feedback,
explicitly sequenced after round 1 above ("small ones first, then the nav
line"): **"The flight plan line is actually something I would like to
incorporate if navigation is on... a rudimentary line like appears on the
actual ND screen [with] the name of the road or junction where the turn
will be made... in place of the various airborne based information
displayed on the top of the ND I've replaced it with relevant
information."**

**A real architectural risk found during investigation, not assumed —
the same bug class this file already documents once, almost reproduced a
second time.** Hybrid and RAW share the exact same MapLibre map instance
(RAW is just a different style/theme applied to it, not a second map),
and the real geo-referenced route line (`map.js`) already recolours
green for RAW via `_effectiveRouteColors()` — so it technically already
rendered in RAW before this pass, just never noticed because no one had
looked at RAW with an active route yet. But RAW's aircraft dots/range
rings plot on a *screen-space banded scale*
(`Geo.bandedRadiusFraction`/`circularPlotRadius`), deliberately not the
map's real geographic zoom — exactly the "two independent coordinate
systems" mismatch already fixed once for the range rings themselves (see
"Rings and dots share one scale now" above: an 8nm aircraft rendering
inside a literal 2nm ring, because real-geo rings and banded dots never
agreed). Leaving the real route line visible in RAW would have
reproduced that same mismatch for the route line instead — a turn 2km
away would not line up with wherever the dots/rings put "2km." Caught
before shipping by reasoning from the existing rings precedent, not by
building it wrong first and finding the bug in the field a second time.

**Fix, applying the same precedent already established for rings**:
`map.js` gained `_applyRouteVisibility()` — sets the three route layers
(`route-glow`/`route-line`/`route-highlight`) to `visibility:"none"`
whenever `NavDisplayStyle.isRaw()`, `"visible"` otherwise — called from
both `setTheme()`'s `styledata` handler (covers switching into/out of
RAW) and `showRoute()` (covers requesting a route while already in RAW).
A small adjacent gap was fixed in the same pass, not a scope creep but a
one-line fix sitting right next to what was already being touched:
`_applyRouteColor()` (new) re-applies `_effectiveRouteColors()` to an
*already-existing* route layer on a style switch — `_initRouteLayer()`
only ever read that function once, at creation time, the same gap
`_applyRangeRingColor()` already exists to close for the range rings,
just never extended to the route layer until now.

**RAW's own replacement: `UI.renderRouteLine()`/`clearRouteLine()`
(`ui.js`), modelled directly on `renderRangeRingsOverlay`/
`clearRangeRingsOverlay`** — same file, same section, same discipline.
For each route coordinate ahead of the user (in order): compute
`Geo.calculateBearing`/`calculateRelativeBearing`/`calculateDistanceNm`,
then project via the *exact same* `Geo.projectToPolarPosition(...)` call
the aircraft dots already use — confirmed via direct code read that this
function is fully generic (bearing/range in, x/y out, zero
aircraft-specific coupling) despite today having only ever been called
from `Indicators._computeAll()`. Stop appending points the moment one
projects to `null` (outside the 75° FOV) — "rudimentary" per the project
owner's own wording, no attempt at exact edge-clipping — with a hard cap
(30 vertices) against a pathological dense route geometry. Colour
`#00c800`, the same RAW route green already established in `map.js`'s
`ROUTE_COLORS.raw.line` (duplicated as a literal with a comment, same
"keep in sync by hand" caveat this codebase already carries for
`LOG_ENDPOINT_KEY`/`MAPTILER_KEY` and others). New `#nav-route-line-overlay`
SVG sibling to `#nav-range-rings-overlay` in `index.html`, same z-index
but later in DOM order — paints over the dashed rings (a real ND's
flight-plan line is a bold foreground line over a subtle dashed
background) while staying under the indicator icons/labels above it.

**Turn/junction label**: `ManeuverTracker.nextManeuver()` gained one new
returned field, `targetCoordIndex` (the route-coordinate-array index of
the upcoming maneuver — already computed internally as `targetIdx`, just
not previously surfaced). `app.js`'s `refreshIndicators()` now computes
the maneuver **once** per tick (`_computeRouteManeuver()`, hoisted out of
`_updateGuidanceCard()`, which now takes the result as a parameter
instead of deriving its own copy) — the same "one shared computation, not
two that could silently drift" discipline this file already applies to
anchorY and the rings/dots scale, here guaranteeing the route line's
label and the guidance card's own text can never disagree about which
maneuver is "next." The on-plot label uses `routeManeuver.name` (the
plain street/junction name ORS returns) — deliberately NOT
`.instruction` (the full sentence, e.g. "Turn right onto Example
Street — 200 m") the guidance card shows — matching the project owner's
own explicit distinction: "the name of the road or junction... should go
there instead [of a waypoint name]."

**Verified the specific risk this pass called out, not just that
something renders**: a Node/Playwright harness driving the real `geo.js`+
`ui.js` placed a synthetic route point at a known 5nm distance dead
ahead and confirmed `renderRouteLine`'s projected radius
(`54px`) matched `renderRangeRingsOverlay`'s own 5nm ring radius
(`53.83px`) to within `Math.round()`'s own rounding error (0.17px) — the
exact class of check that would have caught the old rings-vs-dots bug,
run here proactively instead of after a field report.

### Part 2 — merged top nav-status card, RAW only

Direct instruction, same message: replace RAW's various pieces of
navigation text with "relevant information" at the top, matching the
reference ND's own top data row (GS/TAS/ILS APP) — but positioned to
show turn-instruction + ETA together, per the project owner's own
hand-drawn draft.

**Reuses the two DOM elements that already exist and already work
correctly — zero new guidance/ETA computation logic.** Investigation
found `#nav-guidance-card` (top banner, turn instruction) and
`#route-card` (today pinned to the bottom, ETA/distance/dest) are
**already populated identically in Hybrid and RAW** — neither
`_updateGuidanceCard()` nor `_updateRouteCard()` nor `_checkOffRoute()`
has ever gated on `NavDisplayStyle.isRaw()`, only on `mode !== "nav"`
(which Hybrid and RAW both satisfy). The gap was never "RAW has no
guidance data," it was "RAW never gave that data anywhere resembling ND
styling or layout."

Fixed as a position + colour override, not new logic:
- `#route-card` is CSS `position:fixed; bottom:0` in its default
  (Hybrid) styling — no way to attach it directly under
  `#nav-guidance-card` with CSS alone, since the guidance card's own real
  height depends on `#top-bar`'s real height, both dynamic. `app.js`'s
  `_rawChromeInsets()` — which already measures both for the square
  plot's own layout — now also sets `#route-card`'s inline `top`/
  `bottom:auto` directly (RAW only; reset to CSS defaults for Hybrid) at
  the exact same call site, rather than inventing a second "where's the
  chrome" measurement living in a different function.
- `_rawChromeInsets()`'s own `chromeTopInset`/`bottomInset` split was
  updated to match — RAW adds `#route-card`'s height to `chromeTopInset`
  (it's now up there) instead of `bottomInset` (where Hybrid still keeps
  it, completely unchanged).
- New `VCAS.css` rules, scoped to `body[data-mode="nav"][data-nav-style="raw"]`
  (this codebase's own established pattern for RAW-specific chrome
  overrides): both cards forced to the same dark panel colour
  (`rgba(14,17,23,.85)`, matching `#raw-aircraft-list`'s own background so
  every RAW-only panel reads as one material), the seam between them
  removed (no border/gap, `#route-card`'s top corners squared off against
  the guidance card sitting flush above it), Google-Maps-blue
  `.route-active` background override neutralised for RAW (an ND has no
  "route active = blue banner" concept), the turn-instruction text
  switched to B612 Mono (a digital readout, matching the ETA row's own
  monospace face rather than the display face other RAW text uses).
- `UI.renderCompassRing()`'s own info strip lost its `vehicleInfo.route`
  branch (the destName·distance·ETA second line it used to draw below
  the compass ticks) — that content now lives in the merged top card, so
  keeping both would just duplicate it. Always a single "SPD {mph} MPH"
  line now, matching the passive (no route) case exactly as it already
  rendered. `app.js`'s own `vehicleInfo` object simplified to
  `{ speedMph }` — the `route` field it used to build is no longer read
  anywhere.

Hybrid mode is untouched by any of this — every new CSS rule is scoped to
`[data-nav-style="raw"]`, `_rawChromeInsets()`'s Hybrid branch
(`routeCardAtTop = false`) is exactly its old behaviour, and neither
`_updateGuidanceCard()` nor `_updateRouteCard()`'s own population logic
changed at all.

**Verified with a real Playwright render** of a harness reproducing the
actual top-bar/`#nav-guidance-card`/`#route-card` markup against the
real `VCAS.css`: Hybrid renders exactly as before (blue banner,
bottom-pinned ETA card, confirmed via a tall viewport showing the ETA
card still anchored to the bottom); RAW renders the two merged into one
continuous dark panel directly under the top bar with no visible seam,
confirmed via `getComputedStyle` (not just a screenshot's visual
impression) that `#nav-guidance-card`'s background and both text
colours resolve to the intended values (`rgb(240,240,240)` text,
`rgba(14,17,23,.85)` background) despite the pre-existing
`.route-active` blue-banner rule sharing the same CSS specificity in one
of the two override forms — confirmed the higher-specificity
`.route-active`-inclusive variant is what actually wins, not fragile
source-order luck.

### Part 3 — confirmed "navigation on/off, independent of Hybrid/Raw" already works

Investigation confirmed this was **already true architecturally** before
this pass touched anything: `mode` (nav/air), `NavDisplayStyle`
(hybrid/raw), and `activeRoute` (null/set) are three fully independent
state variables — `requestRouteTo()`/`clearActiveRoute()` never touch
`mode` or `NavDisplayStyle`, and none of the guidance/route-card/
off-route functions gate on Raw-vs-Hybrid. No code change was needed for
"navigation should be on both RAW and Hybrid, with the ability for both
to be passive" — every new code path in Parts 1-2 above is gated on
`activeRoute` being non-null, so the passive (no route) RAW view is
provably unchanged by this pass, not just assumed to be.

### Not done in this pass, and not implied by it

The bottom-bar Airbus-switch-bank restyle (the project owner's 4th
feedback point from the original 3-panel comparison) remains
separately-scoped and untouched. Hybrid's own route-line
rendering/appearance is untouched (still the real MapLibre 3-layer line,
now just correctly hidden while RAW is active instead of silently
mismatched with it). The native Android Auto port is untouched — same
"synced in dedicated passes, not every change" standing note as round 1
above; its own RAW screen (`RawPlotView.kt`) has no flight-plan-line or
merged-nav-card equivalent yet.

## RAW-mode redesign, round 3: bottom-bar switch-bank labels (2026-09-07)

The last piece from the original 3-panel-comparison feedback, explicitly
deferred until rounds 1-2 above shipped. Direct instruction, with an
important scope-limiting clarification: **"The bottom bar is just a
redesign of the buttons used already to make them stylistically similar
to the airbus theme. The division with navigation is again a style
choice, not an actual redesign. The current version of this is the
Pin."** — i.e. no new controls, no behaviour change; the existing
HYBRID/RAW/AIR toggle and the existing route-pin button just needed to
read as two labelled switch groups on a real EFIS panel, the way the
project owner's own hand-drawn draft showed them ("SCREEN" over the
mode toggle, "NAVIGATION" over a nav-related control — which, per their
own clarification, is just the existing pin button wearing a caption,
not a new feature).

**Zero behaviour change, confirmed before touching anything**: grepped
`app.js` for every reference to the bottom-bar buttons —
`btn-test-route`/`btn-raw`/`btn-air`/`btn-hybrid` are all looked up by
`getElementById`, nothing relies on `#mode-row`'s direct-child structure
— so wrapping the existing elements in two new grouping `<div>`s was
safe with no JS changes needed at all. The buttons themselves already
carry the cockpit-panel bevel treatment from the 2026-08-22 rebrand
(`.mode-toggle`'s recessed-housing shadow, individual flush segments,
`.route-btn` reusing the same `.mode-btn` base) — that work already gave
this row its "Airbus switch" material; this pass only adds the
labelling/grouping structure around it.

**`index.html`**: `#mode-row` restructured from a flat
`[.mode-toggle] [#aircraft-count] [.route-btn]` row into
`[.mode-row-group: "SCREEN" caption + .mode-toggle] [#aircraft-count]
[.mode-row-divider] [.mode-row-group: "NAV" caption + .route-btn]` — new
wrapper `<div class="mode-row-group">`/`<div class="mode-row-label">`
elements and one `<div class="mode-row-divider">`, no existing element
removed or given a new id/class that anything else depends on.

**`VCAS.css`**: `.mode-row-group` (column flex, centres a caption over
its button/toggle), `.mode-row-label` (small, muted, letter-spaced,
uppercased via CSS rather than hardcoded caps in the markup), `.mode-row-
divider` (a 1px `var(--border)` line, `align-self:stretch` so it fills
the row's real height whatever that turns out to be rather than a
guessed fixed value). Both new rules read `var(--text-muted)`/
`var(--border)` — already redefined for RAW's forced-dark palette by the
existing `body[data-mode="nav"][data-nav-style="raw"] { ... }` custom-
property block (2026-08-22 rebrand) — so they pick up the correct RAW
colours automatically, no RAW-specific override needed for this pass at
all.

**The reference draft's exact wording, "NAVIGATION," was shortened to
"NAV" — a deliberate, verified departure, not a rendering shortcut.** A
real Playwright render at this project's standard 360px worst-case width
showed the literal word "NAVIGATION" was wide enough to squeeze
`#aircraft-count` (already flex:1, already wrapping to 2 lines even in
the ORIGINAL unmodified bar at this width) into an awkward 3-line wrap —
confirmed by rendering the true pre-existing bar at the same width for
comparison, not assumed. "NAV" recovers that width and returns
`#aircraft-count` to its original 2-line wrap, with no loss of meaning
in a single-word switch-bank caption.

Verified with a real Playwright/Chromium render of the actual new markup
against the real `VCAS.css` (this project's established convention):
Night at both 360px and 412px, Day at 360px, and RAW's forced-dark
override at 360px — all four show the labelled two-group layout with no
horizontal overflow (`scrollWidth === clientWidth` checked directly, not
just eyeballed) and `#aircraft-count` wrapping the same way it always
did, not worse.

This closes out all four pieces of feedback from the original 3-panel
comparison — ownship car icon and aircraft-list resort removal (round 1),
the flight-plan line and merged nav-status card (round 2), and this
bottom-bar restyle (round 3). Not implied by finishing this list: the
native Android Auto port's own bottom controls remain unrestyled, same
"synced in dedicated passes" standing note as rounds 1-2 above.

## Round 1's car ownship icon didn't survive real-device scale — redesigned (2026-09-08)

Reported directly, with a real device screenshot of the passive (no
route) deployed RAW view: "there is barely any difference from the
previous version." Investigation split this into two separate things,
not one:

**Most of rounds 2-3's own work is legitimately invisible in a passive
screenshot, by design, not a bug.** The flight-plan line and the merged
nav-status card (round 2) only render once a route is active
(`activeRoute` gates both) — a passive RAW view was always going to look
like the old one for those two features specifically, since neither has
anything to draw with no destination set. The bottom-bar SCREEN/NAV
labels (round 3) WERE visible in the reported screenshot, confirming the
deploy itself was current — this wasn't a stale-cache/wrong-branch
problem.

**The one real, confirmed regression: round 1's car ownship icon.**
Cropped and zoomed the actual reported screenshot (Python/PIL, this
project's established "pixel-sample the real image, don't eyeball the
chat thumbnail" convention) and found the icon reading as a plain
capsule/padlock shape, not a car at all — the four wheel-bump `<rect>`
elements from round 1's design were completely invisible at the icon's
real ~18×26 CSS px marker size. **Root cause, confirmed by re-testing
properly rather than assumed**: round 1's own verification screenshot
was taken at 4x zoom in an isolated Playwright harness — real and
correctly showing the wheel bumps AT THAT ZOOM, but never re-checked at
the marker's actual unmagnified render size, which is exactly what a
real device screenshot is. A design element can pass a zoomed-in review
and still not survive real-device scale — the same category of mistake
this file's own "verify against a real instance, not a zoomed/idealized
one" discipline exists to catch, just missed once here by not extending
that discipline all the way to actual output scale.

**Fix**: dropped the wheel bumps entirely — confirmed empirically (not
assumed) they're not a viable design element at 18×26px by testing
several alternatives directly at true scale (`deviceScaleFactor: 3`,
matching a real phone, no artificial zoom) before picking one. Replaced
with a single bold continuous body path with a chamfered/tapered front
(reads as "vehicle facing this direction" through the outline itself,
which survives scaling because it's the whole shape, not a few-pixel
detail) and a large, high-contrast dark windshield rectangle (big enough
as a patch to survive scaling too). `fill="currentColor"` kept on the
body, so the existing RAW-forced-yellow `.user-marker-nav { color }`
override from round 1 still works unchanged.

Verified two ways before shipping: extracted the actual committed
marker markup verbatim from `map.js` (via a small Node regex, not
retyped by hand) into a real-CSS Playwright harness rendered at the
marker's true 18×26 CSS px size with `deviceScaleFactor: 3` (matching a
real phone, not a magnified idealized view) — confirmed legible as a
distinct vehicle-with-windshield shape in both RAW's forced-yellow and
Hybrid/AIR's lime-green colouring, the same two states round 1's own
(insufficient) verification already covered, just finally checked at
the size that actually matters.

**Lesson, adding to this file's own repeated pattern of "the fix isn't
remember harder, it's writing the exact constraint down"**: a UI element
this small needs its OWN verification pass done specifically at 1:1
real-device scale, not inferred from how it looks zoomed in for ease of
review — zooming in to check DETAIL is fine, but the pass/fail judgement
on "does this read clearly" has to happen at the size a real user will
actually see it, or a real regression like this one ships looking
verified.

## RAW-mode redesign, round 4: comprehensive chrome match against the design draft (2026-09-08)

Direct feedback, after rounds 1-3 shipped: "all you are doing is
changing the car icon. I want the whole raw screen to look like this" —
pointing back at the project owner's own hand-drawn design draft.
Rounds 1-3 were real, individually correct changes, but scoped too
narrowly against what was actually wanted: a comprehensive chrome
match, not another incremental slice. Pixel-sampled directly from the
draft (this project's own established convention, not eyeballed): top/
bottom bar background ≈ `rgb(70,92,112)` (a mid slate blue-gray), the
nav-status "good value" text ≈ a saturated green, distance figures ≈ a
saturated cyan-blue. Since this is a hand-drawn sketch, not a photograph
of real hardware, clean representative values in the same hue family
were used rather than chasing exact-hex reproduction.

**One scope decision confirmed with the project owner before building,
not guessed**: the draft shows three top-bar status pills (Open-Meteo,
MAPTiler, ADSB.FI). Searched the codebase directly — VCAS has no
Open-Meteo integration anywhere (reviewed once during the weather-
calibration work, never adopted) and no live MapTiler health tracking
(a static API key only, no tile-load success/failure signal). Building
fake pills for either would be exactly the kind of half-finished/
non-functional control this project's conventions already reject (see
the settings screen's own precedent for not shipping a toggle with no
real effect behind it). Confirmed via `AskUserQuestion`: real pills
only — restyle the existing ADS-B pill, add a genuine new METAR pill,
no MapTiler/Open-Meteo pills.

### Part 1 — Top bar

`src/logic/metarProvider.js` gained `getStatus()` — `"active"` if the
most recent real fetch attempt succeeded, `"stale"` otherwise (never
attempted, or that attempt failed) — deliberately keyed on a new
`_lastFetchOk` flag rather than `_cached` truthiness, since a failed
fetch doesn't clear an existing cache (by design, see that file's own
`refresh()` comment) and `_cached` alone would never show a later relay
outage once the very first fetch had ever succeeded. `ui.js` gained
`setMetarStatus()`, sharing a new `_setStatusPill()` helper with the
existing `setAdsbStatus()` rather than a second near-duplicate
implementation. `app.js` calls it right where `MetarProvider.refresh()`
already runs. `index.html`'s `#top-right-controls` restructured from
"one pill + credit stacked vertically" into a horizontal `#status-pill-
row` (ADS-B + METAR) with the adsb.fi credit line kept directly below —
still always visible, since that's a real legal attribution requirement
(see the Pre-V1 checklist above), not something to demote while
restyling around it. Both pills share one new `.status-pill` CSS class
(bolder, larger, near-white text vs. the original's small muted
uppercase) instead of two id-scoped near-duplicates. New RAW-only
`#top-bar` override: a solid slate background (`--raw-chrome-bg`,
pixel-sampled per above) replacing the near-black gradient every other
mode still uses.

### Part 2 — Nav-status colour coding

`app.js`'s `_updateGuidanceCard()` switched from `.textContent` to
`.innerHTML` so the distance figure (and, on the geometric-fallback
path, the direction word) can sit in their own `<span>`s — coloured
cyan/green respectively via new RAW-scoped CSS rather than one flat
string. ORS's own real instruction text is escaped first (`app.js`
gained its own `_escapeHtml`, mirroring `ui.js`'s), same discipline this
codebase already applies to any interpolated string landing in
`innerHTML`. `#route-card`'s ETA/arrival/distance fields needed zero JS
changes — they were already separate elements (`.route-eta-time`,
`.route-eta-arrival`, `#route-dist-text`), just never coloured; pure CSS
additions cover them. The compass tape's own "SPD {mph} MPH" strip
(`ui.js`'s `renderCompassRing()`) gained a `<tspan>` around the numeric
value, coloured green directly (this function only ever renders for RAW,
so no Hybrid-scoping concern there unlike the guidance/route card). New
shared `--raw-value-green`/`--raw-value-cyan` custom properties (in the
same RAW palette block as `--raw-chrome-bg`) so every one of these rules
draws from one source rather than several independently-typed hex
literals.

### Part 3 — Aircraft list title bar

`ui.js`'s `renderAircraftList()` lost its header entirely when the sort
buttons were removed (round 1). Added back a plain, non-interactive
"AIRCRAFT NEARBY {count}" bar (count in green) — a label, not a control,
so it doesn't reopen the "less interaction" concern that removal was
actually about. `items.length` (the panel's own full relevant-set
count) is used, which can legitimately differ from the bottom bar's own
`aircraft-count` figure — they've always represented different things
(see round 1's own notes on `withinRange` vs `allRelevant`).
`MIN_PANEL_HEIGHT_PX` raised from 70 to 100 — the old threshold could
leave room for a header but no actual row underneath it now that one
exists.

### Part 4 — RAW "rows" region backdrop

The real MapLibre canvas is black everywhere in RAW — a single
`background`-type map layer with no concept of "square" vs "rows"
regions (that split is a purely screen-space, app-level idea) — so the
area behind/around the aircraft-list panel showed through as black
instead of matching the top/bottom bar's slate chrome. New
`#raw-rows-backdrop` div, positioned/sized by `app.js`'s
`refreshIndicators()` from the *exact same* `square.rows` object
already passed to `UI.renderAircraftList()` — confirmed via a direct
Playwright check (not just a screenshot) that the backdrop's real
rendered rect exactly equals the given rows rect, and the list panel's
own rect is that same rect inset by `PANEL_MARGIN_PX` on every side —
the same "one shared source, not two measurements that could drift"
discipline this file documents at length elsewhere (the rings-vs-dots
history, the flight-plan-line/range-ring scale check in round 2). Sits
at a lower z-index than the list panel, so nothing about the panel's own
styling needed to change. The square (compass/rings/dots) itself stays
pure black — only the rows region gets the tint.

### Part 5 — Bottom bar restructure

- **Mode buttons**: `.mode-toggle` reworked from one merged/segmented
  pill (solid blue fill for the active button) into three individually
  bordered boxes with a small gap between them, matching the draft. The
  active button now reads via a coloured border+text
  (`.mode-toggle .mode-btn.active-mode` overridden specifically, not the
  global `.mode-btn.active-mode` rule other buttons like `.route-btn`
  still use) rather than a filled background.
- **Bracket connector**: a small relative-unit SVG (`viewBox="0 0 6
  1.4"`, `preserveAspectRatio="none"`) stretched via CSS width to
  whatever the button row actually measures, with three drop points at
  x=1/3/5 — assumes three roughly-equal-width buttons (already true for
  HYBRID/RAW/AIR) rather than computing real button positions, since
  this is purely decorative. A short `.mode-bracket-stem` div links the
  "SCREEN" label down to the bracket's own horizontal bar.
- **"SCREEN" label**: gained a bordered capsule (`.mode-row-label-
  boxed`) — "NAV" stays plain text, matching the draft's own asymmetry
  between the two labels.
- **Horizontal divider above the row**: `#mode-row` gained a
  `border-top` — confirmed absent before via a direct audit, not assumed.
- **Nav button**: redesigned from a plain pin-emoji circle into a
  road-sign diamond icon (orange, `currentColor`-based so it survives
  the existing `.picking` red-armed state too) + an "OFF/ON"
  rocker-switch-style readout — same `#btn-test-route` element/click
  behaviour, matching the project owner's own framing from round 3
  ("the current version of this is the Pin"). The OFF/ON state reflects
  a REAL existing signal (`body.route-active`, already toggled by
  `requestRouteTo()`/`clearActiveRoute()`) — not a fabricated indicator,
  the same "no fake controls" discipline behind the status-pill scope
  decision above.

**A real, adjacent bug found and fixed while verifying this pass, not
part of the original plan but directly blocking it**: a pre-existing
rule — `body.route-active[data-mode="nav"] #bottom-bar { opacity: 0;
... }` — hides the whole bottom bar whenever a route is active, written
back when Hybrid's `#route-card` was always bottom-pinned and would
otherwise visually collide with it. Round 2 moved RAW's own
`#route-card` to the TOP (merged with the guidance card) but never
revisited this rule, which doesn't distinguish RAW from Hybrid/AIR at
all — meaning RAW's entire bottom bar, including everything this round
just redesigned, was silently vanishing for the whole time a route was
active, with no way to switch modes or cancel the route. Fixed by
excluding RAW from the selector
(`:not([data-nav-style="raw"])`) — Hybrid/AIR keep the original
behaviour (still correct there), RAW's bottom bar now stays visible
throughout navigation. Verified directly: RAW+route-active renders the
bottom bar normally; Hybrid+route-active still hides it exactly as
before.

**Verified end-to-end, not just per-piece**: beyond a real Playwright
render of each individual part (top bar at 360/412px in both RAW and
Hybrid, the colour-coded card, the list title bar, the rows backdrop's
exact rect match, the bottom bar at 360/412px with no overflow), a full
composite render assembling every real extracted piece of markup
against the real `VCAS.css` — top bar, merged nav-status card, aircraft
list, bottom bar — together on one simulated screen, populated with
realistic values (an active route, two tracked aircraft), confirmed the
whole RAW screen reads as one coherent design matching the reference
draft's aesthetic, not just individually-correct fragments that might
not cohere together.

Not done in this pass, and not implied by it: the native Android Auto
port is untouched (same standing "synced in dedicated passes" note as
every prior round); no change to the plot's own compass tape/range
ring/aircraft-dot colours, which were explicitly out of scope (already
reference-matched against the real ND photo in earlier work).

## RAW-mode redesign, round 5: real device follow-up — six small bugs plus one real structural fix (2026-09-08)

A real device screenshot after round 4 shipped prompted a detailed
comparison against the reference draft, then a follow-up message
authorizing the fixes and adding several more specific, itemized
corrections in one go. Handled as six targeted fixes plus one deeper
investigation, not a second full redesign pass — round 4's actual
structure (top bar, merged nav-status card, list panel, bottom bar) was
already right; what shipped had several real bugs sitting on top of it.

**1. Rows-backdrop showing as an empty slate box when the list panel
itself is hidden.** `UI.renderRowsBackdrop()` (`ui.js`) had no size gate
of its own, while `renderAircraftList()` already hides below
`MIN_PANEL_WIDTH_PX`/`MIN_PANEL_HEIGHT_PX` — raising the latter to 100
(for the new title bar) pushed some real device layouts just under that
threshold, leaving the backdrop rendering alone with nothing on it.
Fixed by applying the identical gate to the backdrop.

**2. Bottom bar never actually got RAW's slate-blue chrome background.**
Round 4's own plan said "top/bottom bar background" but only `#top-bar`
was implemented — `#bottom-bar`/`#mode-row` were missed. Added the
matching `body[data-mode="nav"][data-nav-style="raw"] #bottom-bar,
...#mode-row { background: var(--raw-chrome-bg); }` rule.

**3. Top-bar mode-label pill removed entirely, not just restyled.**
Direct instruction: "there is no pill for the view at all in the top
bar. that is now effectively status and settings. whichever button is
highlighted blue in the bottom row is the active view." Removed
`#mode-strip`/`#mode-label` from `index.html` and their CSS. **A real
regression caught before shipping, not after**: `UI.setModeLabel()`'s
original code had `if (!el) return;` guarding the text-write BEFORE the
line that toggles `.active-mode` on the bottom-bar buttons — deleting
`#mode-label` would have silently broken the ONLY remaining mode
indicator the user was explicitly relying on. Restructured so the
text-write is optional (a no-op once the element is gone) but the
active-button toggling always runs regardless.

**4. Bracket connector colour — confirmed intentional, not "pen
colour."** Direct instruction: "assume all colours in the mockup are
intentional." The bracket (`#mode-row`'s SVG connecting "Screen" down to
the mode buttons) was drawn in a neutral `var(--border)` grey on the
theory the draft's green was likely just incidental pen colour — wrong
call, corrected to `var(--raw-value-green)` per direct instruction. This
also surfaced a real cross-scope variable problem: `--raw-value-green`/
`--raw-value-cyan` had only ever been defined inside the RAW-scoped
palette block, but the bracket lives in globally-shared bottom-bar
chrome (rendered in every mode, restyled for its RAW appearance via the
same mechanism every other RAW-only override uses) — a RAW-only
variable referenced there would simply resolve to nothing. Fixed by
promoting both tokens to `:root` (globally available, same values) and
removing the now-redundant RAW-scoped duplicate.

**5. `#aircraft-count` removed from RAW's bottom bar — it duplicated the
list panel's own new title.** Direct instruction: "the flight list...
should be titled with the number of aircraft visible, you currently
have this in the nav bar." Round 4 already added the "AIRCRAFT NEARBY
{count}" title bar to the list panel itself (Part 3) — the bottom bar's
own `#aircraft-count` readout became a second, redundant copy of
essentially the same fact once that shipped, not a fact the user
actually wanted in both places. Hidden in RAW via
`body[data-mode="nav"][data-nav-style="raw"] #aircraft-count { display:
none; }`, left untouched in Hybrid/AIR (which have no separate list
panel to carry the count instead). Hiding a `flex:1` middle child broke
`.mode-row-divider`'s positioning against `justify-content:space-
between` — fixed with `margin-left: auto` on the divider, verified via
Playwright that both the aircraft-count-visible (Hybrid) and -hidden
(RAW) layouts still position the two button groups and the divider
correctly.

**6. Merged nav-status card restructured — ETA to row 1, speed+distance
to row 2.** Direct instruction: "please double check the placement of
all the different text sections as some of them definitely aren't
reflective of where I want them." The arrival-clock time (`#ngc-eta-
text`, new) now sits on the SAME row as the turn instruction, pushed to
the row's right edge by `.ngc-body`'s own `flex:1` — matching the
draft's "ETA {time}" placement next to the turn instruction, not down
in the ETA card where Hybrid keeps it. `#route-card` gained a new
`.route-eta-row-raw` (speed left/green, remaining distance right/cyan,
one line, B612 Mono) replacing Hybrid's own duration+arrival row and
distance+destName sub-line in RAW specifically (both of those are now
covered elsewhere: duration/arrival by the new `.ngc-eta`, destName by
`.ngc-dest` already on the guidance card). Both Hybrid's original rows
and RAW's new one are always populated by the same `app.js` writes
(`_updateRouteCard()`) regardless of which style is active — pure CSS
decides which set is visible, the same "write to all DOM targets
unconditionally, let CSS decide visibility" pattern this codebase
already uses elsewhere. The compass tape's own "SPD X MPH" strip is now
suppressed (`renderCompassRing(..., activeRoute ? null : {speedMph})`)
whenever a route is active, since the same figure now lives in the
merged card's row 2 — showing it in both places at once would be a
duplicate readout, not two different pieces of information. **A real
bug introduced mid-edit, caught before shipping**: the refactor that
made the arrival-clock value reusable for both `#route-eta-arrival` and
the new `#ngc-eta-text` introduced a call to `_fmtClock(...)`, a
function that didn't exist anywhere in `app.js` — would have thrown
`ReferenceError` on the very next tick with an active route. Caught by
re-reading the diff (not by a failing test — `node --check` doesn't
catch a valid-syntax undefined-reference error) before verification;
fixed by adding a small `_fmtClock(ms)` helper next to the existing
`_fmtDistance`/`_fmtDuration` utilities.

### A deeper investigation: the real cause of "radar should push up to the top bar"

The user's message also said: "the radar screen itself should be
pushing right up to the top bar leaving space below it, between the
bottom of the radar and the top of the nav bar for the flight list."
Reproducing the ACTUAL current layout end-to-end (a real Playwright
composite render using the real `index.html`/`ui.js`/`VCAS.css`/`geo.js`
markup, not a hand-typed approximation, with a real active route and
`Geo.computeSquarePlotLayout`'s own real math) — not just reasoning
about the constants — showed the square/rings actually starting at
y=365 on a 915px-tall device with an active route, and the rows region
for the aircraft list computing out to a mere **13px tall** (invisible,
below `MIN_PANEL_HEIGHT_PX`). This is exactly the reported symptom, and
it was NOT a flaw in `computeSquarePlotLayout`'s "square pinned at top,
remainder for rows" design (already established and correct per earlier
work) — it was the merged nav-status card being far taller than it
should be.

**Root cause**: round 4/5's `.ngc-eta` addition put the arrival-clock
figure on the SAME row as the turn-instruction text, but that text
(`.ngc-action`) still carried Hybrid's own oversized banner scale — a
44px direction icon and 26px action text, sized for a full-width
Google-Maps-style banner with nothing else sharing its row — and RAW's
own colour-coding pass (round 4, Part 2) had additionally forced
`.ngc-action` onto `'B612 Mono'`, a WIDER monospace face, for what was
meant as "a digital readout" but is actually a full prose sentence, not
a short digit string. Once `.ngc-eta` claimed real horizontal room on
that same row, a perfectly ordinary instruction ("Turn right onto Rice
Lane — 200 m") wrapped to **three lines**, inflating the guidance card
alone to ~150px tall and eating directly into the exact budget the user
wanted reserved for the radar/list.

**Fix**: added RAW-scoped overrides sizing `.ngc-maneuver`
(22px icon, was inheriting Hybrid's 44px) and `.ngc-action` (16px text,
was inheriting Hybrid's 26px) down to an actual compact instrument-
readout scale, dropped the B612-Mono override on the action text
entirely (kept on B612, the proportional display face — monospace stays
reserved for the genuinely short digit-only readouts elsewhere in this
row: SPD/DIST below, the digital heading tape above), and tightened
`#nav-guidance-card`'s own RAW-scoped padding/gap to match. Verified
with the same real-composite-render approach: the identical instruction
that wrapped to 3 lines and produced a 151px-tall card before the fix
now renders on ONE line at 56px — the square/rings now start at y=270
instead of y=365, and the rows region grows from 13px (invisible) to
108px (a real, visible list). In the passive (no active route) case —
verified separately, since it takes a different code path entirely (no
guidance/route card at all) — the square already started right below
the top bar's compass tape with a generous 239px rows region; that case
was never broken, only the active-route case was. Hybrid's own guidance
card is completely unaffected — every new rule is scoped under
`[data-nav-style="raw"]`, confirmed via a direct Playwright check that
Hybrid still resolves to the original 44px/26px B612 (non-mono) sizing.

**Lesson, in the same vein as this file's other "verify against real
execution, don't extrapolate from the isolated piece" entries**: each
of round 4/5's individual CSS additions (the `.ngc-eta` row, the
colour-coding font-family change) was independently reasonable and
individually verified in isolation — the interaction between the two
(a new element claiming room on a row whose OTHER element was never
resized to make space for it) only showed up once the whole card was
rendered together with realistic content length, which is exactly why
this investigation rebuilt the full composite render from the real
files rather than trusting the per-piece screenshots already taken.

Not done in this pass: no change to the native Android Auto port (same
standing note as every prior round); the second aircraft-list row can
still end up visually tight against the panel's bottom edge in the
active-route case even after this fix (108px comfortably fits a title
bar + one full row, a second row's meta line can crowd the edge) — a
real device with more vertical headroom (a taller phone, or a shorter
turn-instruction/destination string) will show more of it; not treated
as a bug worth a separate fix in this pass, since it was not what was
reported and the actual reported symptom (invisible list, huge gap) is
resolved.

## RAW-mode redesign, round 6: radar flush with the top chrome, SPD moved left, adsb.fi pill-as-link (2026-09-08, later the same day)

Another real device screenshot, hand-annotated (a red circle/arrow
around the SPD readout and a downward arrow toward the range rings; an
orange arrow from SPD's own position curving left toward the LOG
button; two green horizontal bars bracketing the space between the
ownship icon and the bottom nav bar): "the top of the radar should be
almost flush with the menu/status bar, essentially where the top of
the speed indication is (red circle and arrow). the speed should stay
at the same latitude but move to the left of the screen (orange
arrow). this will then free up space for the aircraft list (between
green bars)." A separate, smaller instruction in the same message:
"replace the text of the adsb pill to read adsb.fi so that the small
note beneath the settings cog can be removed."

### The radar/SPD layout fix

**Root cause, re-derived rather than assumed**: `RAW_COMPASS_RESERVED_PX`
(app.js) reserved a fixed 80px band between the real chrome
(top bar/guidance/route card) and the square/rings' own top edge,
specifically so the compass tape's ticks/labels/lubber/digital heading
(and, passively, the SPD strip) had somewhere to render without
overlapping either the real chrome above or the rings below. That
80px was tuned as a genuinely worst-case number, never revisited once
the tape's own content (SPD row at `tickTopY + 48`) turned out to only
need about half of it — the remaining ~30px below the SPD row and
above the square's old start was pure dead black space, which is
exactly what the annotated screenshot's red arrow was pointing at.

**Fix — pull the square up to meet the tape, don't move the tape at
all.** `RAW_COMPASS_RESERVED_PX` dropped from 80 to 31 — chosen so the
square's new top edge (`chromeTopInset + 31`) lands almost exactly at
the SPD readout's own top edge (`stripY - 17` in
`UI.renderCompassRing`, which works out to `tickTopY + 31` — not a
coincidence, solved for). Deliberately did NOT touch
`UI.renderCompassRing`'s own `tickTopY`/`stripY` math at all — the tape
(ticks, digital heading, lubber, SPD row) sits at exactly the same
absolute Y it always has; only the SQUARE's own starting point moved up
to meet it. Since the compass-tape SVG (`z-index:10`) already painted
above the range-rings SVG (`z-index:8`) before this change, the tape
now simply renders ON TOP of the rings' own topmost arc instead of in a
separate reserved band above them — the same "tape rides the rim of
the display" composition a real ND uses, matching the reference draft
directly, not empty dead space with the tape floating above it.

**SPD moved to the left, same row** — direct instruction, illustrated
by an arrow from SPD's current centred position curving toward the LOG
button on the far left. `UI.renderCompassRing`'s info-strip rendering
(previously always `text-anchor="middle"` at the viewport's horizontal
centre) gained a `vehicleInfo.leftX` option — left-aligns the
background plate and text at a given x instead of centring them,
falling back to the old centred behaviour when omitted (no other
caller exists today, but this keeps the change additive rather than a
breaking signature change). `app.js`'s call site passes
`square.squareLeft + 64` — the same `square.squareLeft`-based
coordinate system the LOG button (`square.squareLeft + 8`) already
uses for its own position, so SPD now sits in the same left-hand
column as LOG rather than floating independently in the centre.

**Verified the actual freed space, not just "it looks closer to the
top"** — re-ran the same real-markup composite-render harness this
project's round-5 investigation already built (real
`index.html`/`ui.js`/`VCAS.css`/`geo.js`, not hand-typed markup),
before/after the constant change, both with and without an active
route:
- Passive (no route): rows region grew from 239px to 299px.
- Active route: rows region grew from 108px to 168px.

Both increases land almost exactly on the ~60px the reserved-band
reduction (80→31, a 49px cut, plus a few px from the top-bar itself
shrinking — see below) predicts, confirming the fix does what it
claims rather than just moving pixels around cosmetically. Hybrid/AIR
are structurally unaffected — `RAW_COMPASS_RESERVED_PX` only ever feeds
`_rawChromeInsets()`'s `squareContentTop`, itself only read inside
`if (isRawView)` branches, and `renderCompassRing`'s `leftX` param only
has any effect when the RAW-only call site passes it.

### adsb.fi pill-as-link, credit line removed

`#adsb-status`'s label (previously a plain `<span>` reading "ADS-B",
with state-specific overrides like "Auth error"/"No data (...)" on the
error/stale paths — those are unchanged, still legitimate diagnostic
text, not the branding label) is now a real `<a href="https://adsb.fi"
target="_blank" rel="noopener">` reading "adsb.fi" on its normal/
active/not-configured paths (`ui.js`'s `setAdsbStatus()` fallback and
all three `UI.setAdsbStatus(..., "ADS-B")`/`"adsb.fi"` call sites in
`app.js`, mechanically updated). New `.status-pill-link` CSS rule
(`color: inherit; text-decoration: none;`) resets the browser's default
blue-underlined anchor styling back to plain pill text — visually
identical to the old span, just a real functional link underneath now.

**This is a genuine substitute for the separate `#adsb-credit` line,
not a downgrade of it** — adsb.fi's usage terms require "a link to
their homepage wherever their data is used" (see the Pre-V1 checklist
and "ADS-B data source" sections above), and the pill's label now IS
that link, visible for the app's entire open duration exactly like the
line it replaces was. The old `#adsb-credit` div (and its now-dead CSS)
were removed outright rather than left duplicating the same citation
twice in the same top bar. The splash-screen's own comment referencing
`#adsb-credit` by name (`index.html`, near the top of `<body>`) was
updated to point at the pill instead, so it doesn't describe a since-
removed element.

**Incidental benefit, not the point of the change but worth recording**:
removing the credit line's own row shrank the top bar's real height
(48px vs. 65px in the round-5 harness measurements above) — every RAW
layout number in this entry already reflects that shrink alongside the
`RAW_COMPASS_RESERVED_PX` reduction, not two separate before/after
baselines that would be misleading to compare directly.

Verified with a real Playwright render of the actual extracted
`#status-pill-row` markup against the real `VCAS.css`: the label
resolves to a real `<a>` with the correct `href`/`target`, computed
`text-decoration-line: none`, and a colour matching the pill's own
near-white text (not browser-default blue) — reads identically to the
old span at a glance, confirmed by screenshot, while genuinely being a
clickable link now.

Not done in this pass: no change to the native Android Auto port (same
standing note as every prior round); the LOG button's own position
(`square.squareLeft + 8`, same row as SPD/range) was left untouched —
not mentioned in this round's instructions, and it already sits
correctly at the row's own left edge with SPD now landing just to its
right rather than overlapping it.

## RAW-mode redesign, round 7: the plot box no longer forces a literal square (2026-09-08, later the same day)

Round 6's fix (pulling the plot's box up to sit almost flush with the
chrome above it) turned out not to be what closed the real gap the user
was seeing — a follow-up screenshot, annotated with a blue border around
the plot's own box, showed the SAME dead space still sitting *inside*
that box, between its top edge and the outermost ring, no matter where
the box itself was positioned. Direct question that got to the real
issue: "why is the box extending beyond the rings? the furthest out ring
is the maximum distance we can see so there is no need for there to be
any space past the ring except for aesthetic padding."

**Root cause, confirmed by re-deriving the actual radius math rather
than assuming the box's own shape was innocent**: `Geo.
computeSquarePlotLayout()` forced the plot's box to be a literal 1:1
square — in portrait, height was always set equal to the full available
width, on the assumption a square "looks right" for a radar display.
But the circular plot's own real radius (`Geo.circularPlotRadius`, the
`min` of the dead-ahead vertical constraint and the FOV-edge horizontal
constraint — see "RAW is a field-of-view-restricted circular display"
above) is bound by whichever constraint is TIGHTER. On an ordinary tall
phone in portrait, the horizontal (edge) constraint wins by a wide
margin — the vertical headroom a full-width square provides is never
actually reached by any ring or dot. Confirmed numerically: on a 412px-
wide plot with the real anchorY(0.8)/safeInset(16)/FOV(75°) values, the
true radius comes out to ≈192.5px, while a literal square gives the
dead-ahead direction ≈293.6px of headroom — over 100px of it structurally
unreachable, not a rendering bug, a property of the box's own shape.
This is why round 6's fix (repositioning the box) couldn't close it:
the gap lives *inside* the box, proportional to its own height, and
moving the whole box up just moves the same internal gap up with it.

**Fix: `Geo.computeSquarePlotLayout` → `Geo.computePlotLayout`, no
longer forcing the secondary axis to match the primary one.** In
portrait, the PRIMARY axis (width) still uses the full available
content width, unchanged — that's genuinely what determines how far the
FOV can reach left/right, still worth maximising. The SECONDARY axis
(height) is now solved for directly: compute the plot's true radius
using the full width (via a large placeholder height so the vertical
constraint can't artificially cap it), derive the exact `cy` needed for
that radius (`radius + safeInset + 20`, matching `maxRadiusForBearing`'s
own `topY` formula), and set `plotHeight = cy + markerMarginPx` (a small
fixed 30px allowance below the anchor for the ownship marker itself, not
a proportional margin) — i.e. "aesthetic padding," per the project
owner's own framing, not a second circle's worth of empty space. If
there genuinely isn't enough `contentHeight` to fit this (a real edge
case, not the common one), it falls back to the old "use all of it"
behaviour with the original flat anchor fraction — there's no excess to
reclaim in that case anyway. Landscape mirrors the same idea on the
other axis (height stays primary/full-height, width becomes the solved-
for secondary axis).

**A real, structural consequence: `anchorY` (the "ownship low, room
ahead" fraction) is no longer an input either caller gets to assume —
it's now `computePlotLayout`'s own DERIVED return value.** Feeding it
`desiredAnchorY` (still `NavigationCameraEvaluator.STATE_PRESETS.
NAV_RAW.anchorY`, 0.80) only seeds the computation and is the exact
fallback used when there's no room to trim; the actual fraction in
effect (worked example: ≈0.884, slightly MORE bottom-heavy than 0.80,
since the tight box naturally allocates almost all its height to "room
for the ring" and only a thin marker-sized margin below) is read back
from the function's own result. This matters because the SAME anchor
value also drives the REAL camera (see "Camera anchor math" above and
the round-6-adjacent explanation given directly to the project owner
about why RAW's ownship icon is literally the real MapLibre marker, not
a separate 2D dot) — `NavigationCameraEvaluator`'s own NAV_RAW branch
now calls the exact same `Geo.computePlotLayout()` (with the exact same
`safeInset`/`fovHalfAngleDeg`, threaded through from app.js's own
`_rawChromeInsets()` via two new fields, `plotSafeInset`/
`plotFovHalfAngleDeg`, rather than duplicated literals in a second file)
and reads its `anchorY` back the same way — the two calls are
structurally guaranteed to agree, by construction, not by two constants
that happen to currently match. This is the same "one shared source, not
independently-typed values that could drift" discipline this file's own
history already established for the rings-vs-dots mismatch and every
anchor-math bug since — applied here to a genuinely new piece of shared
geometry, not just repeated as a slogan.

**A real bug in the new function caught before shipping, not after**: a
first version could return a NEGATIVE `plotHeight` for degenerate/zero
content dimensions (no real device produces this, but a Node check
covering it exposed the flaw) — a negative computed radius was
propagating through `neededCy`/`neededHeight` uncaught, which then
trivially satisfied the `<= contentHeight` fallback check even for a
literally-zero content area. Fixed by clamping the radius to `Math.max(0,
...)` before using it. Caught by deliberately testing zero/degenerate
inputs, not just the realistic ones — the same discipline this project
applies to every other pure-logic function, here turned on a function
written in this very session.

**The old field names (`squareLeft`/`squareTop`/`squareSize`) couldn't
survive this change** — a rectangle whose two dimensions can now
genuinely differ has no single "size" to report. Renamed to `plotLeft`/
`plotTop`/`plotWidth`/`plotHeight` (plus the new `anchorY` field) across
every consumer: `app.js`'s own `square` variable and all its downstream
uses (range rings, range selector, LOG button, the flight-plan line, the
SPD readout's `leftX`), and `ui.js`'s `renderRangeRingsOverlay`/
`renderRouteLine`, both of which used to take one `squareSize` for what
was silently assumed to be both width and height — now take `plotWidth`/
`plotHeight` explicitly, matching that they're no longer required to be
equal.

**Verified two ways**: (1) a direct Node check confirming the two
independent `computePlotLayout()` calls (app.js's screen-space plot,
NavigationCameraEvaluator's real-camera anchor) resolve to the EXACT
same absolute anchor pixel position for the same inputs — the concrete
form of the "can't drift apart" guarantee, not just an assertion that it
holds; (2) a real-markup composite render (this project's established
harness pattern) at the literal reported device proportions: the rows
region grew again, on top of round 6's own gain — passive from 299px to
452px, active-route from 168px to 321px — and, visually, the rings now
fill almost the entire plot box top-to-bottom with only a thin margin
below the innermost ring for the ownship marker, matching the "no space
past the ring except aesthetic padding" instruction exactly. Landscape
and the "not enough room" fallback path were also exercised via direct
Node checks (mirror-axis trimming, correct fallback to the flat anchor
fraction, no negative dimensions) rather than assumed correct from the
portrait case alone.

Not done in this pass: no change to the native Android Auto port (same
standing note as every prior round — its own `Geo.kt`/
`NavigationCameraEvaluator.kt` still implement the literal-square
version and would need syncing in a dedicated pass); no change to how
the ownship marker itself is drawn (still the real MapLibre marker, per
the earlier direct explanation to the project owner about why that
couples RAW's anchor to the live camera) — this pass closes the gap
without needing that coupling to change at all.

## Real-device investigation: the aircraft-list panel never appears, despite the code being correct (2026-09-08, later the same day)

Three separate real-device screenshots across this and the prior round
all showed the same thing: rings/dots/SPD render correctly (confirmed,
by round 7, filling the plot box as designed), but the "AIRCRAFT NEARBY"
list panel and its slate backdrop never appear anywhere below it — just
solid black, confirmed via direct pixel analysis of the actual
screenshots (average RGB in that region reads (0,0,0), not the panel's
own `rgba(14,17,23,.85)` composited colour), not assumed from a casual
look.

**Static code review found nothing wrong** — `UI.renderRowsBackdrop()`/
`UI.renderAircraftList()`'s gating (`MIN_PANEL_WIDTH_PX`/
`MIN_PANEL_HEIGHT_PX`), the CSS (`z-index`, `position`, background), and
every line of `app.js` between the rings-rendering block and the
aircraft-list block were re-read multiple times with no discrepancy
found — no missed rename from the `computeSquarePlotLayout` →
`computePlotLayout` rework, no stale field reference, nothing that
would silently skip or clear the render call.

**Built a real, full end-to-end reproduction to settle it — not another
isolated-markup harness.** This project's usual verification approach
(extracted fragments of real markup + stubbed dependencies) can prove
the CSS/layout math is right, but can't prove the actual `app.js`
control flow reaches the render call on a real run — so this pass built
a genuine local static file server for the real repo + a real headless
Chromium via Playwright, driving the ACTUAL unmodified `index.html`
through its real boot sequence (`onGpsSuccess` → `refreshIndicators()`
→ `renderAircraftList()`), with only the unreachable-from-this-sandbox
MapLibre CDN request stubbed out (a minimal fake `maplibregl` global,
just enough surface not to throw) and the ADS-B/METAR relay endpoints
mocked with real-shaped responses.

**Result: the aircraft-list panel renders correctly** — real title bar
("AIRCRAFT NEARBY 0"), real "No traffic" body, real computed position/
size (`{left:8px, top:345.6px, width:396px, height:436.4px}`, matching
round 7's much larger rows region), confirmed both via DOM state
(`listHidden: false`, real `innerHTML`) AND a real screenshot of the
actual running app — see the session's own delivered file for this
exact render. **This is strong, direct evidence the list-rendering code
itself is NOT the bug** — when `refreshIndicators()` genuinely reaches
that point in a real browser, it works exactly as designed.

**A real, separate sandbox-only artifact hit along the way, worth
recording so it isn't mistaken for insight about the real bug**: this
sandbox's own network egress proxy doesn't cleanly and quickly reject
the blocked MapLibre CDN request — it stalls for ~20+ seconds before
finally failing, during which the document's synchronous `<script>` tag
blocks the whole page from reaching `readyState: "complete"`. This
delayed the FIRST `onGpsSuccess`/`EosMap.init()` call long enough that,
once it finally ran and threw (`maplibregl is not defined`, since the
real CDN script never loaded and no route-interception attempt could
intercept a request failing at the proxy/tunnel layer, below where
Playwright's `page.route()` operates), `window._mapInitialised` was
already permanently `true` — meaning `scheduleFetch()` (which starts the
real ADS-B polling loop) never got called for the rest of the session.
This is why the repro's own list shows "0"/"No traffic" rather than real
aircraft — a sandbox-network artifact, not a finding about the real
device, where MapLibre clearly loads fine (the user's own screenshots
show real tiles-free-but-functional RAW rendering with real aircraft).
A second harness quirk from the same investigation: a fresh browser
context always shows VCAS's first-launch onboarding modal (empty
localStorage), which fully covers the screen — pre-seeding the
`vcas-onboarding-seen-v1` localStorage key and reloading did NOT
reliably skip it in this harness (unclear why — not investigated
further, low value); clicking the real `#btn-onboarding-dismiss` button
directly after the page settled worked reliably instead.

**Status: unresolved, root cause still unknown, flagged rather than
quietly dropped.** The list-rendering code is now about as strongly
verified as this project's own tools can manage without direct access
to the failing device. What's left is something specific to the real
device/session that a sandbox reproduction structurally can't surface —
next steps, if this recurs, should probably be: (a) asking directly
whether the panel has EVER appeared, even once, across any of the
testing so far — establishes whether this is "never worked" vs. "works,
then something clears it mid-session"; (b) whether it's worth adding a
short-lived, low-noise console/log-endpoint breadcrumb specifically at
the `renderAircraftList()` call site (e.g. logging `rowsRect` on every
real-device RAW render) so the NEXT real-device report comes with actual
runtime numbers instead of only a screenshot to infer from.

**Resolved (2026-09-08, same day): the panel started working after some
time passed, unrelated to any of the investigation above.** The project
owner reported it back with no further action taken — most likely
explanation, consistent with everything ruled out above, is ordinary
first-fetch/deploy-propagation latency rather than a real rendering bug.
Nothing in this entry needs revisiting unless the symptom recurs.

## RAW-mode redesign, round 8: LOG + range moved to the bottom of the plot, SPD alone at top-left (2026-09-08, later the same day)

Direct instruction with an annotated screenshot, once the aircraft-list
panel above was confirmed working: move LOG and the ND-style range
selector down to the BOTTOM of the plot box (currently sharing the top
row with SPD), and move SPD further left into LOG's old top-left corner
— giving SPD that whole corner to itself, and putting LOG/range right
above the aircraft-list panel instead.

Pure repositioning, no behaviour change: `app.js`'s `bottomRowY =
square.plotTop + square.plotHeight - 40` replaces the old `rawRowY =
insets.chromeTopInset + 48` for both `UI.renderRangeSelector`'s and
`LogPanel.setPosition`'s Y coordinate — X stays at the plot's own left/
right edges exactly as before (`square.plotLeft + 8` / `square.plotLeft
+ square.plotWidth - 8`), just the shared row moved from top to bottom.
40px up from the plot's own bottom edge keeps both buttons comfortably
inside the box, clear of the aircraft-list panel that begins immediately
below at `plotTop + plotHeight`. `UI.renderCompassRing`'s SPD `leftX`
moved from `square.plotLeft + 64` (to the right of where LOG used to
sit) to `square.plotLeft + 8` (LOG's own old position, now vacated).

Verified with the same real-markup composite-render harness this
project's round 5-7 investigations already established, both passive
and with an active route: SPD now sits alone at the top-left, LOG and
"10NM" sit side-by-side at the bottom-left/bottom-right of the plot box
respectively, directly above the aircraft-list panel's own title bar —
matching the annotated screenshot's three arrows exactly (SPD moving
left, LOG and range both moving down).

## RAW-mode redesign, round 9: full mockup-vs-app comparison, ten remaining gaps closed (2026-09-08, later the same day)

Direct instruction, once round 8 was confirmed working: "please now
compare this screenshot of RAW and the Photoshop mockup to assess
differences" — a real device screenshot against the project owner's
Photoshop design mockup (distinct from the earlier hand-drawn draft
rounds 1-8 worked from; this one is a polished digital mockup with
precise, sampleable colours). Ten concrete differences were found and
reported; the follow-up instruction was "make all of the changes for
the differences you have found." Four of the ten involved a real
trade-off against a standing decision elsewhere in this file, so those
were confirmed via `AskUserQuestion` before implementing rather than
guessed — answers below, then what shipped for all ten.

**Four clarifying questions, and the answers that shaped the work:**
1. *Fake status pills for Open-Meteo/MapTiler in the mockup?* — Answer:
   "Pills for all of the services we're using. If they do nothing but
   supply a service we can just show that we're connected to the
   service." Resolved to: a real MapTiler pill (RAW's own style
   genuinely loads MapTiler's vector source for the local-obstruction
   feature — see "Local obstruction" above — so this is a real,
   citable dependency), shown as configured-or-not rather than a live
   health check MapTiler has no per-request signal for; no Open-Meteo
   pill, since VCAS has no Open-Meteo integration anywhere (reviewed
   once during the weather-calibration work, never adopted — a pill
   for it would be citing a service that isn't real, exactly the
   "half-finished/non-functional control" this project's conventions
   already reject).
2. *Mockup shows HYBRID/RAW/AIR button order vs. the app's deliberate
   RAW/AIR/HYBRID default* — Answer: "Leave the organization like we
   currently have but put the ability to customize the sequence in the
   settings menu." The default stays exactly as it is (see "LOG button
   overlap... RAW as default" above for why that default was chosen);
   a new Settings control lets the user reorder it themselves instead.
3. *LOG button absent from the mockup* — Answer: "Keep LOG
   (Recommended)." No change — it's the spottability-logging tool every
   tester uses (see "Central observation log" above), not optional
   chrome a design mockup gets the final say on removing.
4. *Aircraft-list row icon: mockup uses a chevron, app uses a coloured
   dot* — Answer: "Use the Chevron and colour them in the same manner
   as the colored dots." A straight swap, keeping the existing
   per-aircraft colour logic.

**MapTiler status pill** (`index.html`/`ui.js`/`app.js`) —
`UI.setMaptilerStatus(configured)` (mirrors the existing
`setAdsbStatus`/`setMetarStatus` dot-and-label pattern) called once in
`init()` with `!!(CONFIG && CONFIG.MAPTILER_KEY)` — a configured/not-
configured signal, not a fabricated live health check, per the direct
answer above. `#status-pill-row` now shows three real pills:
adsb.fi/METAR/MapTiler.

**Merged nav-status card reformatted to abbreviated ND style**
(`app.js`'s `_updateGuidanceCard()`) — RAW now reads "IN {dist} TURN
{direction}" (e.g. "IN 2.0 KM TURN RIGHT"), matching the mockup's own
compact instrument format, instead of Hybrid's full prose instruction
with street names — a real ND has no room for prose. New
`MANEUVER_DIRECTION_WORD` table maps `ManeuverTracker`'s existing
maneuver `type` codes (the same ones `MANEUVER_ICONS` already keys off)
to a direction word; arrival shows bare "TURN ARRIVE". Branches on
`NavDisplayStyle.isRaw()` — safe to call unconditionally here since
`_updateGuidanceCard()` only ever runs from `refreshIndicators()`,
itself gated to `mode === "nav"`, so the known "`isRaw()` can still read
true in AIR mode" gotcha (see "RAW mode fidelity" above) doesn't apply
at this call site. Hybrid's own full-sentence format is completely
unchanged; both branches reuse the same pre-existing `.ngc-dist-value`/
`.ngc-direction-value` colour-coded spans, no new CSS needed.

**Compass tape curved into a real arc, tick labels shortened to
tens-shorthand** — the single largest piece of this round.
`UI.renderCompassRing()`'s signature changed from
`(viewportWidth, headingDeg, safeInset, vehicleInfo)` to
`(cx, cy, tapeRadius, headingDeg, fovHalfAngleDeg, vehicleInfo)`: ticks
now radiate outward from the SAME anchor point
`renderRangeRingsOverlay`/`renderRouteLine` already use (clock-hand
style — a tick at relative bearing 0 points straight up, one at +75°
points off to the upper-right) rather than sliding along a flat
horizontal line. This was a real, previously-unnoticed mismatch: the
flat tape sat above a DOME-shaped set of rings (same "rings curve around
the anchor" geometry documented at length elsewhere in this file), so at
the FOV's edges the old flat ticks drifted visibly away from the rings'
own curve — not obvious until compared side-by-side against the
mockup's own genuinely curved tape. `app.js`'s call site derives
`tapeRadius = tapeCy - insets.chromeTopInset`, keeping the dead-ahead
tick at the exact same Y the old flat tape's `tickTopY` used, so nothing
about the tape's overall vertical position moved — only its shape.
Labels shortened from 3-digit (`"030"`) to tens-shorthand (`"3"`),
matching the mockup's own compact digits (070° → "7", 140° → "14") — a
curved tape this tight has no room for 3-digit headings. The digital
heading readout/lubber line's own visibility (hidden behind the opaque
top bar in the passive/no-route case, since there isn't enough chrome
height above them to clear it) is a pre-existing characteristic,
confirmed unchanged before/after this fix by checking the OLD flat-tape
formula produced the identical Y values — not a regression from
curving the tape, and matches a real device screenshot from earlier
this session showing the same thing.

**High-contrast black/white mode buttons, RAW-scoped only.**
Pixel-sampled the mockup's own button colours (`#000` background, pure
white border+text inactive, a bright cyan ~`#38bdf8` — reusing the
existing `--raw-value-cyan` token, not a second hex — border+text for
the active button) and added
`body[data-mode="nav"][data-nav-style="raw"] .mode-toggle .mode-btn`
overrides. Deliberately scoped to RAW, not applied globally — Hybrid/AIR
keep the softer `--btn-bg`/`--accent` cockpit-panel look the 2026-08-22
rebrand gave every mode button, since the mockup being matched is
specifically RAW's own screen and this app's own established precedent
is that RAW forces its own dark instrument look regardless of Day/Night
without extending that forced look to the other modes.

**Nav/route button icon recoloured to a real maroon, pixel-sampled not
guessed.** The diamond+arrow icon's `#e8833a` (road-sign orange, a
round-4 guess made before a precise mockup existed) is now `#9c3b42`,
sampled from the mockup's own icon pixels (brightest cluster averaged
~`rgb(92,38,43)`, nudged slightly for legibility at the icon's real
small size) — `.route-btn-off`'s text colour was also updated to match
(the mockup's "OFF" text shares the same maroon as the diamond; "ON"
stays the existing dimmed/green-when-active treatment, unchanged).

**Ownship marker glow removed in RAW.** The car icon's lime-green
halo/drop-shadow (`.user-marker-halo`, `.user-marker-nav`'s filter) is
now `display:none`/`filter:none` under RAW specifically — the mockup's
own ownship car icon has no glow at all, reading as a flat instrument
symbol rather than a highlighted map pin. Hybrid/AIR keep the glow
unchanged; it's real, useful "this is you" emphasis on an actual map,
just not appropriate for RAW's plain-black instrument background.

**Aircraft-list rows: colored chevron, not a dot.** `UI.renderAircraftList()`'s
`.rlr-dot` (a small filled circle) replaced with `.rlr-chevron` (a `❮`
glyph), coloured via the exact same per-aircraft `_displayColor(ind.vis)`
value the dot used — per the direct answer above, a straight visual
swap with zero change to the underlying colour-selection logic
(colourblind-safe → RAW's own `colorRaw` → plain `color`, unchanged).

**"NAV" reverted to "NAVIGATION".** The round-3 shortening (see "LOG
button row-alignment follow-up" above) was motivated by
`#aircraft-count` sharing the row and nearly wrapping to 3 lines at
360px — but `#aircraft-count` has been RAW-only hidden since round 6
(see "radar flush with top bar, SPD moves left" above), so the crowding
that justified shortening it no longer exists in RAW. Reverted, and
verified — not assumed — at 360px in BOTH states: RAW (aircraft-count
hidden) and Hybrid/AIR (aircraft-count still visible, the scenario the
original round-3 shortening was actually protecting against) — neither
overflows (`scrollWidth === clientWidth` in both, this project's
standard check).

**Settings control to customize the mode-button order** — new
`src/modeButtonOrder.js` (mirrors `ColorblindMode`'s own tiny
persisted-state module shape exactly: `init()`/`get()`, plus `move(index,
direction)` and `reset()`), a new "RAW / AIR / HYBRID button order"
row in Settings → Display & Accessibility with three tap-to-reorder rows
(▲/▼ move buttons, not drag-to-reorder — this app's own established
"no drag gestures on a driving-app control" convention, see the RAW
range-selector interaction-design notes in the Pre-V1 checklist above,
applies just as much to a settings-screen control as an on-screen one).
`app.js`'s `_applyModeButtonOrder()` reorders the real `#btn-raw`/
`#btn-air`/`#btn-hybrid` elements via `container.appendChild()` on
already-existing nodes — the same "move, don't recreate" pattern this
codebase already uses for indicator-layer DOM diffing — so each
button's own click listener stays bound and untouched regardless of
its position. Verified with a real `kotlinc`-equivalent-for-JS check
(a plain Node script against the actual shipped `modeButtonOrder.js`,
not a reimplementation): move/no-op-at-either-end/reset/persist-across-
reload/malformed-storage-fallback all behave correctly, and a Playwright
render confirmed the settings rows and the real bottom-bar buttons stay
in sync after a move and after a page reload (persisted order correctly
re-applied to the live DOM on load, not just remembered internally).

**Brand icon badge added next to the "VCAS" wordmark.** `index.html`'s
`.brand` div gained a small `<img>` using the existing
`assets/icons/favicon-64.png` (the real app icon — no new asset
created, this file was already exactly the right size and artwork) —
kept alongside the existing "VCAS" text rather than replacing it, since
the mockup's own crop didn't clearly show whether it dropped the text
and the text costs nothing to keep as the app's real accessible name.

**Verification, project-wide**: every touched `.js` file passed
`node --check`. `ModeButtonOrder`'s pure logic was verified with real
Node execution against the actual shipped file (this project's
established "verify pure logic with real execution" discipline). Every
visual change was verified with the real-markup Playwright composite-
render harness this round's investigation (and rounds 5-8 before it)
already established — both the passive (no route) and active-route RAW
screens were rendered end-to-end with every round-9 change applied
together, not just per-change in isolation, to catch any interaction
between them a piecemeal check might miss (the same discipline the
round-5 nav-status-card font-size bug was caught by, after a purely
per-piece verification pass had missed it). Both composite renders
match the mockup closely: brand icon, three real status pills, the
curved compass tape, black/white/cyan mode buttons, chevron list rows,
the maroon nav icon, and "NAVIGATION" all present and correctly
positioned together on one screen.

Not done in this pass, and not implied by it: the native Android Auto
port is untouched (same standing "synced in dedicated passes" note as
every prior round) — its own `RawPlotView.kt`/`MainActivity.kt` still
implement the flat compass tape, the dot-based aircraft-list rows, the
old `#e8833a` nav-icon orange, and have no MapTiler-pill or mode-order-
customization equivalent; syncing the native port to this round's
changes is real, separately-scoped follow-up work.

## RAW-mode redesign, round 10: wordmark removed, a real tick-clipping bug fixed (2026-09-08, later the same day)

A real device screenshot after round 9 shipped, with direct feedback:
"the VCAS word mark in the top bar can be removed, the icon replaces
it. the compass needs to be resized or the container of the radar
screen as a whole needs to be brought down in order for it to all fit."
The screenshot also showed the 3rd status pill (MapTiler, added round 9)
pushed off the right edge of the screen — not separately called out by
the project owner, but a real, connected layout bug worth fixing in the
same pass rather than leaving it for a future report.

**Wordmark removed.** `index.html`'s `.brand` div now contains only the
icon (`assets/icons/favicon-64.png`) — the "V<span>CAS</span>" text
next to it is gone. The icon already carries the "VCAS" wordmark baked
into its own artwork (the lime-green wordmark integrated into the real
app icon, see the icon-redesign history above), so the separate text
was a literal duplicate, not a second piece of information. Sized up
24px → 30px now that it's the sole brand mark rather than sharing the
row with text; `alt="VCAS"` carries the accessible name the text used
to provide, and the now-unused `#top-bar .brand span { color: var(
--accent) }` rule was removed alongside it.

**The real, connected bug: 3 status pills with no wrap/overflow
handling at all.** `#top-bar`/`#status-pill-row`/`#top-right-controls`
have never had `flex-wrap` — fine with 2 pills (adsb.fi/METAR, rounds
1-8), but round 9 added a 3rd (MapTiler) without re-checking narrow-
width fit, and the reported screenshot showed exactly the predictable
result: the row overflowing past the right edge of the screen. Fixed
with `flex-wrap: wrap` + `justify-content: flex-end` on
`#status-pill-row` — on a narrow device the 3rd pill now wraps onto its
own right-aligned second line instead of clipping off-screen. Verified
at 360px width: `#top-bar`'s `scrollWidth` no longer exceeds its
`clientWidth` (confirmed `false` directly, not eyeballed), and the
wrapped layout reads cleanly in a real render. Removing the wordmark
text also helps here directly — freed real horizontal room in the same
row the pills live in — but the wrap fix is what actually guarantees no
overflow regardless of device width, rather than relying on how much
room the text removal happened to free.

**The real compass-fit bug, re-derived from the actual tick geometry,
not guessed at.** Round 9's curved tape draws each tick radiating
OUTWARD from `tapeRadius` (`renderCompassRing`'s own "clock hands"
comment) — at dead-ahead (relative bearing 0), "outward" means straight
UP, toward smaller y. A major tick's outer tip reaches `tapeRadius +
14px` (`COMPASS_MAJOR_TICK_H`), i.e. 14px ABOVE `insets.chromeTopInset`
— which is exactly where the real, opaque `#top-bar` sits (same
z-index as the compass SVG, later in DOM order, so it wins and hides
whatever's underneath). This is a real, previously-unnoticed regression
from the round-9 curve: the OLD flat tape only ever drew ticks
DOWNWARD from `tickTopY`, so nothing could ever poke above the chrome —
the curved version's ticks can, and the dead-ahead-most one visibly did
in the reported screenshot, appearing as a jagged, partially-hidden
mark right where the black radar area meets the pill row.

Fixed by giving the tape real clearance for its own tallest tick:
`ui.js` extracted the tick-height magic number into a named, exported
constant (`UI.COMPASS_MAJOR_TICK_H = 14`) rather than a value only
implicitly known inside `renderCompassRing`'s own loop. `app.js`'s
`tapeRadius` derivation now subtracts `COMPASS_MAJOR_TICK_H + 4` (the
`+4` matching this file's own "almost flush, not literally flush"
convention already established for `RAW_COMPASS_RESERVED_PX`) before
computing the tape's radius — one shared constant read by both the
place that NEEDS the tick height (the tick-drawing loop) and the place
that needs to LEAVE ROOM for it (the radius derivation), not two
independently-guessed numbers that could drift apart the way this bug
itself happened (the curve's own geometry changed without anyone
re-deriving how much clearance it now actually needs).

**This directly answers the project owner's own two suggested fixes
("resize the compass, or bring the container down") with a third,
more precise one: neither the compass's overall size nor the plot
box's own position needed to change — only the tape's radius needed a
few more px of margin from its own tallest tick, which is a smaller,
more surgical fix than either alternative and doesn't touch round 7's
own "no space past the ring except aesthetic padding" plot-sizing work
at all.** The rings/dots/plot box are completely unaffected by this
change — `tapeRadius` has always been derived independently of
`plotRadius` (the rings' own radius), so shrinking the tape's radius
slightly to add tick clearance doesn't touch the rings' or dots' own
geometry, sizing, or position in any way.

Verified with the same real-markup composite-render harness this
project's rounds 5-9 investigations already established (both passive
and active-route), rebuilt with the actual fixed `ui.js`/`app.js`
formulas: the digital heading readout and lubber line now render with
clear, visible separation below the top bar (previously touching/
overlapping it), and every tick — including the dead-ahead-most one —
renders as a complete, unbroken mark with no jagged cut-off appearance.
Also re-confirmed the wordmark removal and pill-wrap fix together at
412px (single-line pill row, no wrap needed, icon-only brand mark) and
360px (pill row correctly wraps to two lines, no overflow either way).

Not done in this pass: no change to the native Android Auto port (same
standing note as every prior round).

## RAW-mode redesign, round 11: RAW's chrome extended to Hybrid/AIR (2026-09-08, later the same day)

Direct instruction: "can you now apply the styling from the updated raw
page across the rest of the app." A real, consequential scope question,
so confirmed via `AskUserQuestion` before touching anything rather than
guessed — RAW's own chrome (top/bottom bar backgrounds, mode-toggle
buttons) is *fixed dark regardless of Day/Night* by deliberate design
(see "RAW mode fidelity" above, "there's no day mode for a cockpit
instrument"), while Hybrid/AIR's own chrome has followed the Day/Night
theme since the 2026-08-22 cockpit rebrand gave Day theme its own
distinct lighter panel look. Extending RAW's exact look to Hybrid/AIR
therefore means Day theme stops affecting THIS specific set of chrome
elements — worth confirming, not assuming.

**Two questions asked, both answered toward the simpler/more literal
match:**
1. Should Hybrid/AIR's top/bottom bar + mode buttons become fixed-dark
   like RAW (same in Day and Night), or stay theme-aware while adopting
   RAW's new high-contrast STYLE (bordered boxes) with Day/Night-derived
   colours? — **Answer: fixed dark everywhere.**
2. Should Hybrid's guidance card also switch to RAW's compact colour-
   coded "IN {dist} TURN {direction}" ND format, or keep its own full-
   sentence Google-Maps-style banner (real street names, over a real
   map)? — **Answer: leave Hybrid's banner as-is.** Only shared chrome
   (bars, buttons) gets unified; Hybrid's own navigation UX, which this
   file's own "Navigation-side status check" section already treats as
   working well for what it is, is untouched.

**Scope, precisely**: `#top-bar`, `#bottom-bar`/`#mode-row` backgrounds,
and `.mode-toggle .mode-btn`(`.active-mode`) colours — exactly the
elements the first question named, not a blanket "make everything look
like RAW." The standalone `.route-btn` (the NAV/pin button)'s own
background was deliberately left alone — it was never forced black even
within RAW itself (checked directly: no RAW-scoped override for it
exists anywhere in this file), so leaving it on the theme-following
`--btn-bg` keeps Hybrid/AIR behaving exactly like RAW already does for
that specific control, not introducing a new inconsistency. The compact
ND-style nav-status card, the curved compass tape, range rings, the
aircraft-list panel, and the ownship-glow removal all stay genuinely
RAW-only — none of those are "chrome" in the sense this round's question
was about, and question 2 explicitly kept the nav-status card scoped.

**Mechanism: promoted `--raw-chrome-bg` from a RAW-scoped custom-
property override to a plain `:root` global**, with a new comment
explaining why it deliberately has no Day-theme override anywhere in
this file (unlike `--bg-panel` and every other themed token) — the same
"no day mode for a cockpit instrument" reasoning this file already
applies to RAW's own map content, now extended to this one set of
chrome elements app-wide. `#top-bar`/`#bottom-bar`/`#mode-row`'s base
rules now read `background: var(--raw-chrome-bg)` directly instead of
their old Day/Night-following gradients, and the three now-fully-
redundant `body[data-mode="nav"][data-nav-style="raw"] #top-bar` /
`#bottom-bar` / `#mode-row` override blocks were deleted rather than
left as dead, no-longer-meaningful duplicates. `.mode-toggle .mode-btn`/
`.mode-toggle .mode-btn.active-mode` got the same treatment — the
black/white/cyan colours moved from the RAW-scoped override directly
onto the base rule, and that now-redundant RAW-scoped block was deleted
too. `--raw-value-cyan` (the active-button colour) needed no change —
it already lived in `:root`, promoted globally back in round 5 for the
exact same "shared, all-modes chrome" reason.

Verified with a real Playwright/Chromium render of the actual extracted
`#top-bar`/`#bottom-bar` markup against the real `VCAS.css`, four
scenarios: Hybrid+Night, Hybrid+Day, AIR+Day, and a RAW+Night
regression-recheck. All four resolved to the EXACT same computed values
(`rgb(70,92,116)` for both bars, `rgb(0,0,0)` background with
`rgb(56,189,248)` cyan border+text on the active button, black on
inactive ones) — confirming the fixed-dark look now applies uniformly
regardless of theme or mode, and that RAW's own appearance is bit-for-
bit unchanged, not just visually similar. Also re-ran the existing
round 5-10 real-markup composite-render harness (both passive and
active-route RAW screens) to confirm no regression to anything else on
that screen — identical to the round 10 renders, as expected since none
of this round's edits touch RAW-specific selectors.

Not done in this pass: no change to Hybrid/AIR's own map content,
guidance card, route line, or marker styling — all explicitly out of
scope per question 2's answer and per this file's own long-standing
"chrome vs. map content" scope boundary (see "Cockpit-panel chrome
rebrand" above); the settings screen, popups, and other panels were not
touched, since the two questions asked were specifically about the top/
bottom bar and mode buttons, not every themed surface in the app; no
change to the native Android Auto port (same standing note as every
prior round).

## Visibility model: fresh review of the ground-truth log data (2026-09-08)

Direct instruction: "do a fresh review of the spotting visibility
records" — a pure investigation pass, no code changes made or requested.
Pulled the full `Vectair/vcas-logs` mirror (124 files, up from the 80 at
calibration pass #2's own pull on 2026-09-02 — 108 real observations
after excluding 16 crash/watchdog error reports, vs. 73 real
observations at pass #2) and re-ran the same outcome-vs-predicted-label
crosstab this project's own calibration passes have used twice before.

**Headline finding: the METAR and local-obstruction fixes from
calibration passes #1/#2 still have almost no real-world data to
validate them against.** Of the 108 real observations, only **3** carry
a non-null `computed.metar` snapshot (all dated 2026-09-05 or later —
none of the 10 `not_visible_weather` cases logged so far fall in that
window, so there is still zero real confirmation either way that the
AGL/MSL and horizontal-vs-slant-range METAR fixes from pass #2 are
actually improving predictions) and only **1** carries a non-null
`computed.localObstruction` (2026-09-08). Every record logged before
2026-09-05 shows `metar: null`/`localObstruction: null` even where the
relevant code had already shipped days earlier — consistent with normal
deploy lag plus very low observation volume in that window (most of
2026-09-02 through 2026-09-08 was spent on the RAW-mode redesign passes
above, not field-testing), not evidence of a new bug on its own. Still
the right thing to flag plainly rather than claim either fix is
confirmed working: it isn't yet, one way or the other.

**Crosstab (outcome → predicted label), all 108 real observations:**

| Outcome | n | Predicted |
|---|---|---|
| visible_contrail | 48 | Possibly visible (47/48) — still exactly as designed |
| visible_airframe | 32 | Likely (19) / Possibly (8) / Certainly (5) |
| not_visible_weather | 10 | Likely (6) / Possibly (3) / Certainly (1) — all pre-fix, metar was null on every one |
| not_visible_missed | 9 | Possibly (5) / Likely (3) / Certainly (1) |
| not_visible_obstruction | 9 | Likely (6) / Certainly (2) / Possibly (1) |
| visible_lights | 0 | — (added 2026-08-27, never yet used) |

**visible_contrail remains the best-calibrated category by far** —
47/48 "Possibly visible," matching pass #1's own 38/39 finding almost
exactly. No action needed; the contrail floor is doing its job.

**visible_airframe: real sightings score reasonably, but 8/32 (25%)
sit right at the "Possibly visible" boundary.** All 8 score exactly 33
(the tier's own flat score) with `angularSizeDeg` between 0.064° and
0.152° — below the 0.167° cutoff for "Likely visible" — despite a real
human confidently identifying the airframe (not just a contrail) in
every case. No single confound explains all 8: altitude ranges from
1,400ft (a P28A at 2.5nm) to 35,700ft (a B77L at 14nm), elevation angle
from 1.2° to 43.1°. This is an *underconfidence* pattern (the model is
more cautious than reality warranted), the safer direction of error, and
n=8 — while the largest single signal found in this review — is still
not being treated as grounds to retune the 0.167° threshold unilaterally,
consistent with this file's own established "don't retune from a thin
signal" convention (see the 3-case high-altitude watch-item logged during
calibration pass #1). Flagged here as a slightly stronger version of
that same watch-item, not acted on.

**not_visible_obstruction is the most informative category, and exposes
a real, concrete gap in the local-obstruction feature's own design, not
just a data-volume problem.** Elevation angles across the 9 real cases
range from 8.1° to 48.1° — only 3 of the 9 fall at or below
`LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG` (12°), meaning even with perfect
density data, today's feature could only ever have had a chance at
addressing a third of the real logged misses. The one case with actual
density data (2026-09-08, a helicopter at 16.6° elevation/1.2nm, scored
"Certainly visible" — the model's maximum confidence — but logged as
obstructed) sits *above* that 12° gate anyway, so the elevation cutoff
alone would have excluded it regardless of density. That same record
also caught the local-obstruction feature's own already-documented v1
limitation in the wild for the first time: `vegetationFeatureCount: 6`
but `vegetationDensity: 0` — real vegetation polygons were found within
the query radius, but their centroids fell outside it, the exact
"no true polygon clipping" simplification CLAUDE.md's own design notes
for this feature already named as a deliberate, accepted v1 shortcut.
Seeing it actually bite in a real case doesn't change that trade-off
call, but is worth recording as the first real confirmation it happens
in practice, not just in theory.

**A real, previously-unflagged gap surfaced while investigating the
localObstruction=null pattern: logged observations carry no `mode`
field at all.** `observationLogger.js`'s `buildObservation()` snapshots
user position/heading/speed, the aircraft, and the computed
visibility/relevance/metar/localObstruction — but never which of
RAW/Hybrid/AIR was active when the observation was logged. This matters
for exactly the kind of question this review needed to answer (was a
given `localObstruction: null` because the feature hadn't deployed yet,
or because the map was in a state where the query legitimately couldn't
run?) — confirmed by reading `navStyle.js`/`map.js` directly that mode
itself isn't actually the cause here (AIR reuses the same day/night
style and vector source Hybrid does; only RAW's own zero-opacity layers
are a newer addition, and those were verified working back when the
feature shipped), but the review had no way to rule that out from the
data alone without that source-reading detour. Worth adding `mode` to
the observation payload as a real, low-cost improvement for the next
person who has to interpret this dataset — not done in this pass, since
it's a logging-schema change and this pass was scoped to review only.

**No `visible_lights` observations yet** — added 2026-08-27, zero uses
across 108 real observations since. Not a bug, just unexercised so far
(a night/low-light-specific outcome, and this dataset's logging has
mostly happened in daylight hours per the timestamps).

**Net assessment**: nothing in this pass crossed the bar for a code
change on its own — every genuinely new signal (the airframe
underconfidence pattern, the obstruction-gate elevation-coverage gap,
the vegetation-centroid miss) is a real, worth-remembering data point at
n=8/n=9/n=1 respectively, but this project's own established discipline
is not to retune tuned constants from samples this thin (see pass #1's
own "n=3 is too thin to retune anything from" precedent, and pass #2's
own deliberate choice not to patch the "no upper-air data" gap without
a real data source). The most useful outcome of this review is
knowing what's still unconfirmed (the METAR/local-obstruction fixes
themselves — real validation needs more logging volume in the days
following 2026-09-05, not more analysis of what's already been pulled)
and the one concrete, cheap follow-up worth doing whenever logging is
next touched (add `mode` to the observation payload).

### Follow-up: added `mode` to the observation payload (2026-09-08, same day)

The one concrete follow-up the review above flagged, done the same day
once asked to go ahead. `src/dev/observationLogger.js`'s
`buildObservation()` gained a new top-level `mode` field — `"raw"` |
`"hybrid"` | `"air"`, whichever screen was showing when the observation
was logged — alongside `user`/`aircraft`/`computed`/`outcome`, not
nested under `user` (it's app display state, not the user's own
physical state, even though it's threaded through the same `userState`
object for convenience).

Sourced from `app.js`'s own `_activeDisplayMode()` (line ~950,
pre-existing — the same function that decides which bottom-bar button
shows as active), not a new computation: `mode === "air" ? "air" :
(NavDisplayStyle.isRaw() ? "raw" : "hybrid")`. Threaded into all three
places that ever call `ObservationLogger.buildObservation()`:
`refreshIndicators()`'s `userState` (the RAW/Hybrid path, also what
`LogPanel.update()` receives and later hands to its own direct
`_logObservation()` call), `refreshAirMode()`'s `userState` (AIR,
same relationship to `LogPanel.update()`), and `onLogOutcome()`'s own
minimal `userState` (the NAV/AIR popup path, both converge here).
`logPanel.js` itself needed no changes — it already stores whatever
`userState` object it's handed verbatim and passes it straight through
to `buildObservation()`, so it picks up `mode` automatically once the
object it's given carries it.

Degrades to `null`, not `undefined` or a thrown error, for any caller
that doesn't supply `mode` (`userState.mode || null`) — matters for
every record already sitting in `Vectair/vcas-logs` from before this
change, which will simply read back with `mode: null`, and guards
against a future missed call site doing the same rather than breaking.

**Verified with real Node/`vm` execution against the actual shipped
`observationLogger.js`** (this project's established "verify pure
logic with real execution" discipline, same `vm.runInContext` approach
already used for `sw.js`'s own fetch-routing tests) — 4 checks: a
`userState.mode` of `"raw"`/`"air"`/`"hybrid"` each pass through
unchanged, and a `userState` with no `mode` field at all (simulating
every pre-existing logged record, or a future caller that forgets to
set it) degrades to `null` rather than `undefined` or throwing. All 4
passed. `node --check` on both edited files (`app.js`,
`observationLogger.js`) confirms no syntax regression. Not verified
against a live Playwright render — this is a pure data-plumbing change
with no rendering/layout surface, matching the review entry's own
"mechanically verified" precedent for the two OUTCOMES-array additions
earlier in this file.

Both JSDoc comments describing `userState`'s shape (`observationLogger.js`'s
`buildObservation()`, `logPanel.js`'s `update()`) were updated to list
`mode` alongside `lat`/`lon`/`heading`/`speedMph`, so a future reader
doesn't have to discover it by diffing.

## Open-Meteo upper-air signal — closing the "no METAR cloud reported ≠ confirmed clear above" gap (2026-09-08)

Direct follow-up to a status question: "can you just confirm that the
full redesign of the visibility likelihood has been deployed. I thought
we were getting met information from sources other than aviationweather."
Investigation found the deploy itself was current (confirmed via GitHub
Actions — `deploy-pages.yml` triggers on push to this project's own
working branch, all recent runs succeeded), but only aviationweather.gov
(via the METAR relay) was actually wired into `Visibility.estimate()` —
Open-Meteo had been reviewed as a proposal during calibration pass #2
(see "Visibility model calibration pass #2" above) specifically for the
gap that section documents and explicitly leaves open: METAR only
characterizes the surface-to-~5,000ft column and prevailing visibility,
so "no cloud reported" (including CAVOK) was being read as "confirmed
clear all the way to the aircraft's altitude" even for a jet that could
be sitting above a real, unreported mid/upper-level deck — but that
proposal was never actually built. Confirmed via `AskUserQuestion`-style
direct question, then built the same day once the project owner said to
go ahead.

**API shape verified against real, current source — not assumed, and one
wrong initial assumption caught before writing code.** This sandbox
can't reach `api.open-meteo.com` directly (`curl`/`WebFetch` both
blocked), so — same "verify against real reference source" discipline
this project's entire Android Auto history is built on — cloned
`open-meteo/open-meteo`'s own GitHub repo and read two things directly:
1. `openapi/forecast.yml`'s real response schema. First assumption
   (`current=cloud_cover_low,cloud_cover_mid,cloud_cover_high`) was
   wrong — the `current` block's schema only has a single plain
   `cloud_cover` field; the three per-band fields
   (`cloud_cover_low`/`cloud_cover_mid`/`cloud_cover_high`) are
   `hourly`-only. Caught by reading the spec's actual response schema
   before writing any code, not after a live-call failure.
2. `Sources/App/configure.swift`'s real server config:
   `CORSMiddleware.Configuration(allowedOrigin: .all, ...)` — genuine
   confirmation Open-Meteo needs **no CORS relay**, unlike adsb.fi and
   aviationweather.gov, both of which required a custom PHP relay built
   earlier in this project specifically because they lack this header.
   This is the first weather/data source in VCAS's history that's
   directly callable from the browser with zero server-side workaround.

**`src/logic/upperAirProvider.js`** (new) — mirrors `metarProvider.js`'s
exact shape (`refresh(lat, lon)`/`getCached()`/`getStatus()`,
in-flight-coalescing, 15-minute refresh interval, 10s timeout, same
`"active"`/`"stale"` two-state status vocabulary keyed on a
`_lastFetchOk` flag). Requests `hourly=cloud_cover_low,cloud_cover_mid,
cloud_cover_high` plus `past_hours=1&forecast_hours=2` (a small window
around "now," since Open-Meteo's hourly array is forecast-model output,
not a live observation — the closest-to-now index is picked from
whatever's actually returned) and `elevation` (metres, converted to
feet) for the same AGL correction METAR's own `baseMslFt` fix already
established (see calibration pass #2 above) — Open-Meteo's cloud-cover-
by-band figures are tied to the grid cell's own ground level, not sea
level, so raw aircraft altitude needs the identical MSL→AGL correction
before band-matching.

**Cloud-altitude bands are a documented approximation, not an exact
figure** — WMO-style low/mid/high bands (~2km/~2-7km/~7km+) are a widely
used convention, but no exact pressure-level cutoff specific to
Open-Meteo's own model could be found in its source or docs during this
investigation. Implemented as three named constants in `visibility.js`
(`UPPER_AIR_LOW_BAND_MAX_AGL_FT` = 6500, `UPPER_AIR_MID_BAND_MAX_AGL_FT`
= 23000, `UPPER_AIR_DENSE_THRESHOLD_PCT` = 70) with an honest inline
comment — same "reasonable starting guess, not a physically derived
number" provenance already established for `CONTRAIL_MIN_ALTITUDE_FT`/
`LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG` elsewhere in this file, not a
number to treat as settled.

**`_applyUpperAirAdjustment(cat, altitudeFt, upperAir)`** (`visibility.js`,
new, placed right after `_applyMetarAdjustment()`) — deliberately scoped
to MID/HIGH bands only, explicitly leaving the LOW band (< 6500ft AGL)
untouched: that's METAR's own domain (surface-based cloud/visibility
reports are authoritative there), and touching it here would mean two
adjustments competing over the same altitude range with no clear
precedence. For an aircraft in the MID or HIGH band, if that band's own
reported cloud cover percentage is at/above `UPPER_AIR_DENSE_THRESHOLD_PCT`,
the category is capped at "Possibly visible" via the existing
`_capAtPossiblyVisible()` helper — same downward-only discipline already
established for both `_applyMetarAdjustment()` and
`_applyLocalObstructionAdjustment()` (never raises an already-worse
category, e.g. one already staleness-degraded to "Very unlikely"). Wired
into `estimate()` as a genuine 6th positional parameter
(`estimate(userLat, userLon, aircraft, metar, localObstruction, upperAir)`),
deliberately NOT part of a signature refactor — calibration pass #2's own
proposal to move this whole parameter list to a named options object is
a separate, not-yet-adopted decision, and this stays consistent with the
interim shape that proposal itself already recommended.

**Threaded through the same path `metar`/`localObstruction` already
established**: `indicators.js`'s `_computeAll()` destructures `upperAir`
from `userState` and passes it to `Visibility.estimate()`; `app.js`'s
`fetchAircraft()` calls `UpperAirProvider.refresh(userLat, userLon)`
right alongside the existing `MetarProvider.refresh()`/
`LocalObstruction.refresh()` calls (same "safe to call every tick,
internally self-throttles" contract); both `refreshIndicators()`'s and
`refreshAirMode()`'s `userState` object literals gained
`upperAir: UpperAirProvider.getCached()`; `observationLogger.js`'s
`buildObservation()` snapshots `UpperAirProvider.getCached()` verbatim
into every logged observation's `computed.upperAir` field, same "raw
context, not a derived flag" pattern already established for the
`metar`/`localObstruction` snapshots — so a future `not_visible_weather`/
`visible_airframe` entry involving a mid/high-altitude aircraft can be
checked against the actual Open-Meteo band data in effect, not just the
final tier.

**A real, genuine 4th status pill, not a fabricated indicator** — unlike
the MapTiler pill (round 9, configured-or-not only, no live per-request
signal), Open-Meteo needs no key/relay at all, so
`UI.setUpperAirStatus()` reports the same real two-state
`"active"`/`"stale"` signal adsb.fi/METAR already do, called from
`app.js`'s `fetchAircraft()` right after the `refresh()` call resolves.
`index.html`'s `#status-pill-row` gained a 4th `#upper-air-status` pill;
`sw.js`'s comment listing intentionally-bypassed live-data hosts was
updated to include `api.open-meteo.com` (and, a small pre-existing
documentation gap noticed in passing, the METAR relay itself, which had
been left off that list) — confirmed it was correctly NOT added to
`STATIC_CDN_HOSTS`, the exact bug class already hit once for the ADS-B
relay (see "PWA: real bug — the app-shell service worker was silently
serving stale ADS-B data" above) and worth re-checking explicitly every
time a new live endpoint is added, not just assumed safe.

**Verified with real Node execution against the actual shipped
`upperAirProvider.js`/`visibility.js`, this project's own established
"verify pure logic with real execution" discipline** — 15 checks against
the provider (`vm.runInContext`, mirroring the exact harness pattern
`metarProvider.js`'s own test already established: URL construction,
closest-hour-index selection, timeout/abort handling, malformed-response
handling, in-flight coalescing, status transitions) and 11 checks against
`_applyUpperAirAdjustment()`'s wiring into `estimate()` (low-band
immunity regardless of density, mid/high-band capping, wrong-band
non-interference, the sparse-cloud no-op, the cap-never-raises guarantee,
the veryClose exemption, the AGL/MSL elevation correction) — 26 checks
total, all passing against the real, shipped files.

**Two of the 11 `estimate()` scenario tests needed a real, verified fix
to their own premise before they proved anything — the same "vacuous
test" mistake this project has hit before (see the Kotlin
`Visibility.kt`/`Relevance.kt` port test-writeups), caught here in the
JS test itself before shipping, not after.** Both the mid-band and
high-band capping tests initially picked an aircraft/distance combination
whose PRE-adjustment category was already "Possibly visible" for an
unrelated reason (angular size alone, or — for the high-band case — the
existing contrail floor, since the first draft's 35,000ft/~24nm aircraft
sits above `CONTRAIL_MIN_ALTITUDE_FT` within `CONTRAIL_MAX_RANGE_NM`),
making the "capped at Possibly visible" assertion true regardless of
whether `_applyUpperAirAdjustment` did anything at all. Both fixed by
first probing several `distanceDeg`/altitude combinations against the
real `estimate()` output to find one that genuinely scores better than
"Possibly visible" from angular size alone (mid-band: 15,000ft at
~2nm, scoring "Likely visible"/66; high-band: 24,000ft — still >23,000ft
AGL but deliberately below the 26,000ft contrail threshold — at ~2nm,
also "Likely visible"/66) before asserting the cap actually changes
that. Each test now explicitly asserts the pre-cap baseline first
(`before.score > 33`) so a future edit that accidentally weakens the
baseline back into vacuousness would fail loudly instead of silently
passing.

**Honest status**: the pure logic (`upperAirProvider.js`'s parsing/
throttling, `visibility.js`'s adjustment/capping) is genuinely, fully
verified via real execution. What's NOT verified, for the same sandbox-
network-access reason `metarProvider.js`'s own header comment already
carries for aviationweather.gov: the actual shape of a live
`api.open-meteo.com` response has never been checked against this
parsing code with a real network call — only against the real, current
OpenAPI spec's documented schema. If cloud data still isn't visibly
affecting scores after this deploys, the next thing to check is whether
the live response's real field names/units genuinely match the spec as
read here, the same category of caveat already on record for the METAR
relay's own parsing. Verified deployed the same way the `mode`-field
commit immediately before this one was: pushed to
`claude/project-audit-review-4p0ft2`, confirmed via GitHub Actions that
the triggered `deploy-pages.yml` run succeeded.

## Open-Meteo attribution + METAR pill removed in favour of it (2026-09-08, same day)

Direct follow-up once the Open-Meteo integration above shipped, prompted
by a status question ("is there anything I need to do to better
integrate open-meteo?"): flagged that Open-Meteo's data is CC BY 4.0
licensed, which requires attribution — the same citation-obligation
category adsb.fi's own usage terms already impose (see the Pre-V1
checklist above) — but nothing credited Open-Meteo anywhere in the app.
Direct instruction to fix it, plus two more changes in the same message:
make the Open-Meteo pill function like the adsb.fi pill (tap through to
their homepage), and remove the METAR pill now that Open-Meteo's own
pill covers the app's weather-status indicator.

**Launch screen** (`index.html`'s `#launch-screen`): the credit line
("Proudly powered by...") gained a 4th name — restructured from
"adsb.fi, MapLibre and MapTiler" to "adsb.fi, MapLibre, MapTiler and
Open-Meteo," linking to `https://open-meteo.com`, matching the exact
comma/and pattern the other three already use.

**Open-Meteo pill becomes a real citation link, mirroring adsb.fi's own
pattern exactly.** `#upper-air-status`'s label changed from a plain
`<span>` to a real `<a href="https://open-meteo.com" target="_blank"
rel="noopener" class="label status-pill-link">` — the identical shape
`#adsb-status`'s own label already uses (round 6 above). `UI.
_setStatusPill()` needed no change at all — it only ever writes
`label.textContent` on state transitions, never touches `href`/`target`,
so the link survives every "active"/"stale" pill-state update exactly
like adsb.fi's own link already does.

**`#metar-status` removed outright, not just hidden** — matching this
project's own established "if it's genuinely unused, delete it, don't
leave a disabled shell" convention (see round 1's sort-button removal).
This is a UI-only removal: METAR data itself is completely untouched —
`metarProvider.js` still fetches/caches METAR and
`Visibility.estimate()`'s `metar` parameter still receives it exactly as
before (calibration passes #1/#2's AGL/MSL and horizontal-range fixes
are all still live) — only the dedicated status pill and its supporting
plumbing are gone:
- `app.js`'s `fetchAircraft()` still calls `MetarProvider.refresh(userLat,
  userLon)` (METAR data still needs to keep flowing), just without the
  trailing `.then(() => UI.setMetarStatus(...))` that used to update the
  now-deleted pill.
- `UI.setMetarStatus()` deleted from `ui.js` (function body + export) —
  zero remaining callers once the `app.js` call site above was cut.
- `MetarProvider.getStatus()` and its backing `_lastFetchOk` flag deleted
  from `metarProvider.js` — a real, confirmed-by-grep zero-caller method
  once `setMetarStatus()` (its only consumer) was gone; `getCached()`'s
  own "a failed fetch doesn't clear the cache" behaviour in `refresh()`
  is completely unaffected, since `_lastFetchOk` was tracked purely for
  `getStatus()`'s own benefit and nothing else ever read it.
  `UpperAirProvider.getStatus()` — the module whose pill actually
  survives — is untouched, still the real per-poll "active"/"stale"
  signal it always was; only its own doc comment was updated to stop
  cross-referencing a method that no longer exists.

**Verified with a real Playwright render** of the actual extracted
`#status-pill-row`/`#launch-screen` markup against the real `VCAS.css`:
exactly 3 pills render (adsb.fi/MapTiler/Open-Meteo, no `#metar-status`
element in the DOM at all), the Open-Meteo pill resolves to a real
`<a href="https://open-meteo.com" target="_blank">` alongside adsb.fi's
own equally-real `<a>`, no horizontal overflow at the project's standard
360px check, and the launch screen's 4 credit links (adsb.fi, MapLibre,
MapTiler, Open-Meteo) all resolve to their real homepages. A direct Node
sanity check confirmed `MetarProvider`'s trimmed export surface
(`{refresh, getCached}`, `getStatus` genuinely gone) still behaves
correctly end-to-end: a failing fetch degrades to a `null` cache exactly
as `refresh()`'s own documented "never a crash or a silently wrong
value" contract requires, unaffected by the removed status tracking.

Not done in this pass, and not implied by it: no change to the native
Android Auto port (same standing "synced in dedicated passes" note as
every RAW-mode-redesign round above) — it has no METAR/Open-Meteo status
pills at all today, so there's nothing there to remove or relink.

## Traffic Rules — user-defined filter/highlight by type, category, altitude, military-vs-civil (2026-09-09)

Direct request: "adding a function that allows the user to specify the
type of aircraft... either following the system so it only shows certain
categories like: type, altitude above/below, OAT vs GAT etc. and a
highlight capability where the user requests aircraft with certain traits
are simply highlighted... all aircraft remain visible but ones the user
has a particular interest in get a highlight." Two clarifying questions
confirmed the design before building: (1) whether adsb.fi's specific API
actually carries a military/civil signal at all — answered "I don't know
if .fi specifically supports it but I assume they do since it's built on
the same tar1090 as other ADSB platforms," so this was researched rather
than assumed (see below); (2) filter and highlight share ONE rule-
building UI with a per-rule mode, not two separately-built settings
sections — confirmed, and this is how it was built.

### The military/civil (OAT/GAT) signal — researched, not guessed

adsb.fi's own GitHub repo (`adsbfi/opendata`) documents only usage
examples, not a field-by-field schema, and doesn't mention `dbFlags`
anywhere — so whether their specific v3 API passes it through could NOT
be confirmed live (this sandbox can't reach `opendata.adsb.fi`).
What COULD be confirmed, directly against `wiedehopf/readsb`'s own real
source (the server software both adsb.fi and adsb.lol run) — not
assumed from hobbyist recollection alone, cross-checked against
`README-json.md`, `api.c`'s `filter_dbFlags()`, and `track.c`'s own
`dbFlags & (1 << 0)` military-bit read: `dbFlags` is a bitfield
(`military = dbFlags & 1`), and `json_out.c` only emits the key at all
when non-zero (`if (a->dbFlags) ...`) — a record with no flags omits it
entirely, it's never sent as a literal `0`.

Given the project owner's own reasonable assumption that adsb.fi
inherits this from the shared readsb codebase, `normaliseAircraft.js`
now reads it — but deliberately **tri-state**, not a boolean defaulted
to `false`: `military: typeof raw.dbFlags === "number" ? (raw.dbFlags &
1) === 1 : null`. `null` means "unknown," not "civil" — if adsb.fi
turns out not to send `dbFlags` at all, every aircraft reads `military:
null` and a rule asking specifically for military OR civil traffic
correctly matches nothing (see `TrafficRulesLogic.matchesConditions`'s
own guard: `if (aircraft.military == null) return false` for either
specific value), rather than silently misclassifying real military
traffic as civil. This is the same honest "unverified against a live
response" caveat this file already carries for METAR/Open-Meteo parsing
— the transport/plumbing is real and correct, the live data shape isn't
independently confirmed from this sandbox.

### Shared rule engine — `src/logic/trafficRules.js` (pure) + `src/trafficRules.js` (state)

Same split this project already uses for MetarProvider/LocalObstruction
vs. `visibility.js`: `TrafficRulesLogic` is a pure evaluator (no DOM, no
storage) — `matchesConditions(aircraft, conditions)`,
`evaluateFilter(aircraft, rules)` (OR across enabled filter-mode rules),
`evaluateHighlight(aircraft, rules)` (first enabled highlight-mode rule
to match wins its colour, in list order — deliberately not "layer every
matching rule's colour," since one icon can only usefully carry one
highlight ring). `TrafficRules` is the persisted CRUD/state module
(`init`/`list`/`add`/`update`/`remove`/`toggleEnabled`, localStorage-
backed, mirrors `ModeButtonOrder`'s own shape exactly).

Four condition axes on a rule, AND'd together when more than one is set
(an unset condition never excludes a match — "empty conditions match
everything" is the deliberate base case, letting a rule start broad and
get narrowed):
- **Type** — free-text substring match against the aircraft's ICAO type
  code (`A320`, `B738`, …), case-insensitive.
- **Category** — the ADS-B DO-260B emitter category (`A1`–`C5`), the
  same axis `normaliseAircraft.js`'s own `NON_AIRCRAFT_CATEGORIES`
  (C1-C5) already reads — `TrafficRulesLogic.getCategories()` is the one
  source of category labels for both matching and the settings dropdown,
  so the two can't drift apart the way a hand-copied second table would.
  Cross-validated the label table against the existing code's own
  C1-C5-are-never-aircraft choice (Emergency/Service Vehicle/Point/
  Cluster/Line Obstacle) before trusting it — a real, corroborating
  signal, not just recalled from memory.
- **Altitude** — above/below a threshold in feet; an aircraft with
  unknown altitude can't satisfy either direction (matches the same
  "unknown never satisfies a specific numeric condition" discipline
  `AltitudeSuppressPanel`'s own low-altitude suppression already uses).
- **Traffic type** — Any / Military (OAT) / Civil (GAT), the direct
  request's own aviation terminology (Operational Air Traffic vs.
  General Air Traffic), reading the new `military` field above.

### Filter — the single existing filtering point, not a second one

`app.js`'s `aircraftList = result.aircraft.filter(...)` — already the
one place both NAV and AIR read from (ground-vehicle exclusion, stale
removal, ground-hide, altitude suppression) — gained one more check:
`if (TrafficRulesLogic.evaluateFilter(a, TrafficRules.list())) return
false;`. Highlight-mode rules are explicitly NOT applied here — they
never remove an aircraft from this list, only mark it at render time.

### Highlight — a per-rule-coloured ring, threaded as a CSS custom property

`ui.js`'s `renderIndicators()`/`renderSuppressedDots()` (NAV/RAW) and
`map.js`'s `_airMarkerHtml()` (AIR) each call
`TrafficRulesLogic.evaluateHighlight(aircraft, TrafficRules.list())` and,
when it returns a colour, add a `.rule-highlight` class plus
`--rule-highlight-color` inline custom property to the element — new
`VCAS.css` rules (`.indicator.rule-highlight`, `.suppressed-dot.rule-
highlight`, `.air-marker-inner.rule-highlight`) draw the same glow-ring
shape `.selected`'s own tap-highlight already uses (`filter: drop-
shadow(...)`/`box-shadow: 0 0 0 2px ...`), just reading the colour from
the custom property instead of a hardcoded yellow — a real user-chosen
colour needs to be per-element, not a fixed CSS class, and a custom
property avoids duplicating the whole drop-shadow syntax inline per
aircraft. `.air-icon`'s own existing drop-shadow is combined into ONE
`filter` declaration with the highlight glow (a later `filter` rule
replaces, doesn't merge with, an earlier one) rather than accidentally
dropping the marker's existing shadow. Independent of `.selected` — an
aircraft can be both tap-selected and rule-highlighted at once, the two
rings simply stack.

### Settings screen — one shared rule list + one shared rule-builder form

New "Traffic Rules" section (`index.html`, between the existing "Traffic
Filtering" and "Data & Logging" sections): a compact row per rule
(swatch — a colour dot for highlight rules, ✕ for filter rules — plus a
one-line condition summary, an enable/disable dot, edit, and delete),
"+ Filter rule"/"+ Highlight rule" buttons, and one shared inline form
(type/category/altitude/traffic fields, plus a colour picker shown only
for highlight-mode rules) used for both adding and editing.

**A real footgun caught and fixed before it could ship, not after**: a
freshly-added rule's conditions are all unset by design (the "empty
conditions match everything" base case above) — meaning a brand-new
FILTER rule, if left live even for a moment, would instantly hide the
ENTIRE aircraft list until the user finished configuring it.
`TrafficRules.add()` therefore starts every new rule **disabled**, and
the settings-screen form only actually enables it on Save (once real
conditions have been set) — Cancel on a still-unsaved new rule deletes
it outright instead, tracked via `_trPendingNewRuleId` (`app.js`), rather
than leaving a dead disabled orphan in storage. Editing an EXISTING
rule's Cancel button does NOT delete anything — only discards the
in-form edits — since `_trPendingNewRuleId` is only ever set for a
just-created rule, not an edit of one that already existed. Closing the
whole Settings screen while a new-rule form is still open is treated as
the same implicit Cancel, for the same reason.

Move controls are tap-based (`▲`/`▼`-style row list, matching the
existing mode-order reorder rows), not drag — same established
"no drag gestures on a driving-app control" convention this file already
documents for the RAW range selector and mode-order settings.

### Verified with a real, extracted-verbatim Playwright harness — not a live end-to-end run

The settings screen only initializes from inside `app.js`'s own `init()`,
which also brings up GPS/MapLibre — this sandbox's own documented
MapLibre-CDN flakiness (see "Real-device investigation" above) made a
full live boot unreliable for this specific check. Followed this
project's own established fallback instead: a Node script extracted the
real `#settings-screen` markup verbatim from `index.html` and the real
Traffic Rules functions/wiring verbatim from `app.js` (string-sliced
between exact markers, not retyped), assembled into a standalone
Playwright harness alongside the real, unmodified `trafficRules.js`
files and real `VCAS.css`. 24 checks against the real, shipped code:
empty-state hint text; the +Filter/+Highlight buttons opening the form
with the colour row correctly hidden/shown per mode; a freshly-added
rule existing but disabled; Cancel-on-a-new-rule deleting it outright
and re-showing the empty state; a saved rule persisting enabled with its
real typed condition, its row summary text matching; `evaluateFilter`
actually hiding a matching synthetic aircraft and not a non-matching
one; the row's own enable-toggle flipping `enabled` and disabling the
filter live, with the `.disabled` row class applying; editing an
EXISTING (not new) rule and hitting Cancel correctly preserving the
rule while discarding the in-form edit; a highlight rule's real chosen
colour round-tripping through `evaluateHighlight()` and the row swatch's
own computed background colour; delete removing exactly one rule; and
no horizontal overflow at this project's standard 360px narrow-width
check. All 24 passed, zero page errors. A real screenshot (400×900,
three rules shown together — one highlight, one saved filter, one still-
open draft filter being edited below) confirms the row/form layout reads
correctly, not just that the assertions passed blind.

### Explicit v1 scope, not silently implied to be more

- No true weight-class/wake-turbulence axis beyond the existing DO-260B
  category codes — there's no separate field for it anywhere in the
  ADS-B schema this app already reads (confirmed while researching the
  category table: no `wtc` field exists in the readsb schema at all).
- Highlight is single-colour, first-match-wins — no per-rule priority
  ordering UI beyond "rules earlier in the list win," and no way to
  layer multiple simultaneous highlight rings on one icon.
- No native Android port sync — same standing "synced in dedicated
  passes, not every change" note this file already carries for every
  RAW-mode-redesign round; the native app has no settings-screen
  equivalent for this feature yet, and no `military`/`dbFlags` field in
  `NormaliseAircraft.kt` either.
- The category dropdown includes C1-C5 (surface vehicles/obstacles) even
  though `normaliseAircraft.js` already excludes them from ever reaching
  the app at all — a rule referencing them can simply never match live
  traffic, harmless rather than worth special-casing out of the list.

### Follow-up: multi-value type matching, comma-separated OR (2026-09-09, same day)

Prompted by the project owner describing their own real use case after
the walkthrough above: "I am particularly interested in military
aircraft and Soviet era aircraft so I would leave all aircraft as
viewable but if one was showing up in VCAS that fell into either
category I would want them highlighted." Military is already a single
condition (`traffic: "military"`); "Soviet era" has no equivalent single
axis — it's really "any of MiG/Su/Tu/An/Il/Yak/Mi/Ka/Be/...", which the
original single-substring `typeQuery` condition could only express as
one rule per manufacturer prefix. Confirmed via `AskUserQuestion`
(over "several single-prefix rules" or a curated built-in preset list):
extend `typeQuery` to accept a comma-separated list, OR'd together, as
the minimal change that actually closes the gap.

`TrafficRulesLogic.matchesConditions()` (`src/logic/trafficRules.js`)
now splits `conditions.typeQuery` on `,`, trims/uppercases each term,
drops blanks (a trailing comma, `"a,,b"`), and matches if the
aircraft's type contains ANY term — a plain substring match per term,
same semantics as the original single-value case, which is exactly the
`terms.length === 1` case of the new code (verified explicitly, not just
assumed, so every rule saved before this change keeps working
unchanged). `index.html`'s `#tr-type-query` field's placeholder/
`maxlength` updated (`12` → `120`) to actually fit a real list like
"MiG,Su,Tu,An,Il,Yak,Mi,Ka,Be". `app.js`'s `_trConditionSummary()` reads
back nicer for the multi-value case too — `Type is any of: MiG, Su, Tu`
rather than the raw comma string wrapped in quotes — while a genuine
single-value rule still reads exactly as it did before
(`Type contains "A320"`).

This is still one condition axis, ORed internally, then AND'd with the
rule's other conditions exactly as before — so "Soviet types OR
military" (two independent categories the user wants highlighted, not
one combined condition) is still two separate highlight rules, not one:
a type-list rule (`typeQuery: "MiG,Su,Tu,An,Il,Yak,Mi,Ka,Be"`) and a
traffic rule (`traffic: "military"`), each can carry its own colour or
share one — `evaluateHighlight()`'s existing first-match-wins-in-list-
order semantics already handle two independent rules cleanly, no change
needed there.

Verified with a real Node check against the actual shipped
`trafficRules.js` (this project's own "verify pure logic with real
execution" discipline): a MiG-29 and Su-27 both match a Soviet-list
rule, an F-16 and A320 don't; a spaced/trailing-comma list
(`" MiG , Su ,, Tu "`) still matches correctly; the military-only
condition remains a fully independent axis (an Su-27 with
`military:false` still matches the Soviet-type rule but not a
military-only rule, and vice versa for the F-16); two highlight rules
together correctly assign each aircraft its own rule's colour via
existing first-match-wins; and a genuine single-term rule (`"A320"`)
still matches/excludes exactly as before the change. All checks passed.

Not done: no curated "Soviet-bloc types" preset list (the project owner
picks the actual manufacturer prefixes themselves) — deliberately the
simpler of the two options offered, matching this project's own
"don't build more than what's asked" convention; no native Android port
sync, same standing note as every other Traffic Rules entry.

## Native Android port: RAW-mode/chrome design-sync pass (2026-09-09)

Direct instruction: "the native port is still massively lagging in terms
of design. it effectively looks nothing like the pwa so can you work on
updating that. it should be a like for like comparison." True — the
phone-side native app (`android/`) was still visually frozen at its
2026-08-26/27 state (real pass 2/3: RAW built as a faithful Canvas port,
settings/onboarding/popup added), while the PWA had since gone through
11 full RAW-mode-redesign rounds plus a chrome-unification pass plus the
Open-Meteo/METAR-pill changes — none of which had ever reached the
native code, per this file's own repeated "synced in dedicated passes,
not every change" standing note for that project.

**Phase 1 — the load-bearing logic dependency, ported and verified
first, since the visual work depends on it.** The PWA's own round-7
rework ("the plot box no longer forces a literal square," see above) —
`Geo.kt`'s `computeSquarePlotLayout()`/`SquarePlotLayout` replaced with
`computePlotLayout()`/`PlotLayout`, a structural port of the real,
current `src/logic/geo.js` (read directly, not reconstructed from
memory) rather than a re-derivation: the primary axis (width in
portrait) still uses the full available content dimension, the
secondary axis is solved to just fit the plot's own true circular
radius plus a small marker margin, and `anchorY` is now a DERIVED return
value rather than an assumed flat constant — the same "one shared
source, not two independently-typed values that could drift" discipline
this file already documents at length for the rings-vs-dots mismatch,
now load-bearing for a genuinely new piece of Kotlin geometry rather
than repeated as a slogan.

Every one of `Geo.kt`'s consumers was updated to match, not just
`Geo.kt` itself:
- `NavigationCameraEvaluator.kt`'s NAV_RAW branch (9b) now calls the same
  `Geo.computePlotLayout()` and reads its derived `anchorY` back, rather
  than assuming the old flat preset constant — new `plotSafeInset`/
  `plotFovHalfAngleDeg` fields added to `Ctx` (defaulted to
  `Geo.PlotLayoutOpts`'s own defaults) so a real call site can thread the
  actual values through, mirroring the PWA's `_rawChromeInsets()`
  single-measurement-reaches-both-call-sites pattern. **Honest note**:
  this branch currently has NO live call site in the native app at
  all — `MainActivity.kt`'s `updateHybridCamera()`/`updateAirCamera()`
  never set `navDisplayStyle = "raw"` (RAW mode has no MapLibre camera at
  all, being pure Canvas) — so this fix closes a real latent
  inconsistency (verified via the test suite below) without yet being
  exercised by any production code path; worth remembering if a future
  pass ever wires a real camera into RAW.
- `GeoTest.kt`'s old `computeSquarePlotLayout` tests rewritten against
  the new API, including a new test that directly reproduces geo.js's
  own radius-plus-margin formula (catching the exact class of "vacuous
  test" mistake this project's own port test-writeups have flagged
  before) and a regression test for a real bug class already caught once
  in the PWA's own port (a degenerate/zero-content input producing a
  negative computed radius).
- `NavigationCameraEvaluatorTest.kt`'s two square-anchor tests rewritten
  to cross-check against a direct `Geo.computePlotLayout()` call rather
  than hand-asserted literals — including a genuine BEHAVIOUR change
  caught by this rewrite, not just a rename: the old literal-square
  algorithm forced `plotWidth == plotHeight == 0` for a
  `squareContentHeight = 0.0` degenerate case, while the new algorithm
  correctly keeps the PRIMARY axis (width) at its full size even when
  the secondary axis has no room — the zero-content test's own expected
  anchorX changed from `0.0` to `0.5` as a direct, correct consequence,
  not a mistake.
- `Indicators.kt`'s one stale comment reference updated.

**Verified with the same standalone `kotlinc` 2.0.0 + JUnit4 toolchain
this project's entire Android logic-port history is built on** — jars
freshly re-downloaded from `repo1.maven.org` this session (this
sandbox's own toolchain isn't preserved between sessions, only the
scratchpad's small files are) into the scratchpad, then a real compile +
test run of the FULL `logic/` package (all 12 main source files, all 12
test files): **209 tests, zero failures**, confirming the round-7 port
didn't regress any of the five prior logic ports (`Visibility`/
`Relevance`/`AircraftExtrapolation`/`Indicators`/`RouteGeometry`/
`NavigationCameraEvaluator`/`NormaliseAircraft`/`OrsProvider`/
`OrsGeocoder`/`ManeuverTracker`/`CameraAnchor` all still passing
alongside the rewritten `Geo`/`NavigationCameraEvaluator` tests).

**Phase 2 — `RawPlotView.kt` (the Canvas-drawn RAW plot itself), synced
against the PWA's rounds 1/6/8/9/10, not just the round-7 dependency
fix:**
- **Curved compass tape** (round 9/10), replacing the original flat
  linear-pixel tape entirely: ticks now radiate outward from the SAME
  anchor point the range rings already use — a tick at relative bearing
  0 points straight up, one at the FOV edge points off at that bearing's
  own angle — computed via `sin`/`cos` around `(cx, tapeCy)` rather than
  sliding along a flat horizontal line, so the tape's own curve matches
  the rings' curve at every heading instead of only near dead-ahead
  (exactly the mismatch the PWA's own round-9 entry describes finding).
  `tapeRadius` is deliberately reduced by the tallest tick's own height
  plus a small margin (round 10's real fix for ticks poking above the
  chrome) — implemented as one shared `compassMajorTickHPx()` constant
  read by both the tick-drawing loop and the radius-clearance
  calculation, the same "one number, not two that could drift" pattern
  Phase 1 already established for the plot layout itself. Tick labels
  shortened to tens-shorthand (`"7"` not `"070"`) per round 9.
- **SPD moved to the top-left corner** (round 6), left-aligned rather
  than centred — native has no LOG button to share that row with (never
  ported, see "Not done" below), so this is simply the plot's own left
  edge + a small margin, matching the PWA's own final round-8 position
  rather than round 6's intermediate one. The SPD figure itself is now
  colour-coded green (round 9's colour-coding pass), drawn as three
  sequential text runs since Canvas has no span concept the way the
  PWA's SVG `<tspan>` does.
- **Range-selector button moved to the plot's bottom-right corner**
  (round 8), directly above where the aircraft-list panel begins,
  replacing its original top-right position.
- **A real ownship car icon, drawn for the first time** — native's
  Canvas-only RAW plot had never drawn an ownship marker of any kind
  before this pass (unlike the PWA, whose RAW ownship is the real
  MapLibre marker forced yellow — there is no MapLibre map underneath
  native's RAW Canvas view for an equivalent marker to reuse). A flat
  yellow tapered-body-plus-windshield shape (round 1's redesigned car,
  not the original wheel-bump version that didn't survive real-device
  scale — see the PWA's own follow-up entry on that), always pointing
  "up" (heading-up display), deliberately with no glow/halo (round 9's
  "flat instrument symbol, not a highlighted map pin" RAW treatment).

**Phase 3 — `RawAircraftListView.kt`**: the PRI/RNG/ALT/TYP sort-button
header (round 1's own removal target in the PWA, but never removed
here — the native port had been built AFTER round 1's own PWA date but
apparently from an earlier reference, or simply never resynced) is gone
entirely — `update()`'s `sortMode`/`onSortClick` parameters dropped, not
left as unused holes, matching this project's own "delete unused code,
don't leave a disabled shell" convention. Replaced with a plain,
non-interactive "AIRCRAFT NEARBY {count}" title bar (round 9, brought
back after round 1's removal specifically as a label, not a control).
Each row's leading marker changed from a plain colour dot to a colour-
matched chevron glyph (`❮`, round 9), reusing the exact same
colourblind-wins-over-RAW-fidelity colour selection the dot used.

**Phase 4 — `MainActivity.kt` chrome (top bar + bottom bar).** Read the
real current `buildTopBar()`/`buildModeToggleBar()`/
`buildAdsbCreditLine()` before touching anything, per this project's own
established discipline:
- **Top bar**: the "VCAS" text wordmark is gone — the real brand icon
  (`ic_launcher.png`, the same lime-green-wordmark-integrated artwork
  already used elsewhere in this app) now sits where the text used to,
  matching round 10's "the icon already carries the name, a second text
  repeat was redundant" reasoning. Background switched to the same
  slate-blue `RAW_CHROME_BG` the PWA's own top bar now uses everywhere
  (round 11), not just in RAW. The old, separate `buildAdsbCreditLine()`
  underlined-text-link is gone — folded into a genuine 2-pill status row
  instead (`buildStatusPill()`, a small reusable tappable-link helper):
  **adsb.fi** (the same real citation link, restyled as a pill) and
  **MapTiler** (new). **A deliberate, honest scope decision, not an
  oversight**: the PWA's current top bar carries 3 real pills (adsb.fi/
  MapTiler/Open-Meteo) — this native app has no Open-Meteo integration
  at all, and neither pill here tracks true live "active"/"stale"
  fetch-success state the way `UpperAirProvider.getStatus()`/the PWA's
  own ADS-B status dot do (this native app's `AdsbFiClient` has no
  equivalent success/failure tracking yet either). Building a 3rd pill
  for an integration that doesn't exist, or a live-status dot for a
  signal nothing here actually measures, would be exactly the kind of
  half-finished/non-functional control this project's conventions
  already reject elsewhere (see `buildSettingsScreen()`'s own precedent
  for not shipping a toggle with no real effect behind it) — both native
  pills instead show an honest "configured" state (a real link, not a
  live health check), the same simplification the PWA's own MapTiler
  pill already makes for the identical reason.
- **Bottom bar mode toggle**: reworked from one merged/segmented pill
  (solid blue fill for the active button) into three individually
  bordered black boxes — white border+text when inactive, cyan
  (`RAW_VALUE_CYAN`) border+text when active — matching the project
  owner's own Photoshop mockup the PWA's round 9 was built against.
  Applied app-wide (all three modes share this one bottom bar), the
  honest native equivalent of the PWA's own round-11 "chrome extended
  app-wide regardless of Day/Night" outcome, since this native app never
  had a separate softer per-mode chrome style to preserve in the first
  place.

**Two new palette tokens files needed for the above**: `VcasPalette.kt`
gained `RAW_CHROME_BG`/`RAW_VALUE_GREEN`/`RAW_VALUE_CYAN`/`RAW_NAV_ICON`
(the last currently unused — see "Not done" below), duplicated as
literal hex from `VCAS.css`'s own `--raw-chrome-bg`/`--raw-value-green`/
`--raw-value-cyan` custom properties, same "kept in sync by hand" caveat
this file already carries for `MAPTILER_KEY`/`LOG_ENDPOINT_KEY` and
every other intentionally-duplicated config/palette value in this native
project.

**Explicitly NOT done in this pass — real, scoped-out gaps, not
oversights:**
- **RAW's own merged nav-status card / flight-plan line (PWA rounds 2/5/
  6/9) were not ported.** Native's `refreshRawMode()` has always passed
  `routeInfo = null` to `RawPlotView` ("RAW mode itself carries no route
  info — that's HYBRID's own guidance card," a pre-existing, unchanged
  design choice this pass didn't touch) — the PWA's own ND-abbreviated
  "IN {dist} TURN {direction}" colour-coded card, and the screen-space
  flight-plan line reusing `Geo.projectToPolarPosition()`, are both real,
  substantial pieces of work with no native equivalent yet. A genuine
  next step, not attempted this pass given the size of everything else
  already covered.
- **No nav/route-toggle diamond icon** (PWA rounds 4/9) — this native
  app has no equivalent control to restyle in the first place: HYBRID
  mode's own guidance card already shows its destination-search box
  directly whenever no route is active (see the "destination search
  box" entry above), with no separate arm/disarm button the PWA's own
  pin-button-turned-diamond-icon exists to be. `RAW_NAV_ICON` is defined
  in `VcasPalette.kt` for whenever/if a real use for it is found, but
  nothing references it yet — flagged rather than silently unused.
- **No mode-button-order settings control** (PWA round 9) — a real
  functional feature, not core visual parity; deprioritized in favour of
  the actual "looks nothing like the PWA" visual gaps this pass was
  asked to close.
- **No RAW rows-backdrop** (PWA round 4's Part 4) — the PWA fixed a real
  gap where RAW's rows region (below/beside the plot, where the
  aircraft-list panel sits) showed through as plain black behind/around
  the list panel; native's `rawListView` already carries its own
  `rgba(14,17,23,.85)` panel background covering its own rect, so the
  visible difference is smaller (a near-black panel over a pure-black
  gap, vs. the PWA's slate-blue-tinted gap) but not identical — a minor,
  known gap rather than a fixed one.
- Colour-coding for the Hybrid guidance card, and any change to Hybrid's
  own map-content chrome, were out of scope here exactly as they were in
  the PWA's own round 11 (chrome-only, map content/guidance text
  untouched).

**Honest status, same caveat as every native UI file in this project's
history**: `MainActivity.kt`/`RawPlotView.kt`/`RawAircraftListView.kt`/
`VcasPalette.kt` were never compiled — no Android SDK in this sandbox,
same limitation as everything else in `android/`. Checked via careful
manual re-reads of each diff plus a brace/paren balance script run
against every touched file (clean on all of them; `MainActivity.kt`'s
own naive comment-stripping pass initially flagged a false imbalance,
traced to the script's own line-comment stripper mishandling `//` inside
`"https://..."` URL string literals — not a real code issue, confirmed
by the file's raw, unstripped brace/paren count already being balanced
both before and after this pass's edits). `Geo.kt`/
`NavigationCameraEvaluator.kt` (the pure-logic layer this pass's visual
work depends on) ARE genuinely, fully verified via real `kotlinc`+JUnit4
execution — the same distinction this project has drawn between
pure-logic and platform/UI code in every prior native-port entry. The
real remaining check for the platform/UI code is still opening this in
Android Studio and building it.

## Hybrid manual camera-tilt override (2026-09-09)

Direct request: "since we spent some time refining the camera in Hybrid
this is the screen it can be done in instead of making an entire new
screen" — a small top-right toggle that opens a vertical slider letting
the user set a fixed camera tilt, a top-left Reset button once it's open,
the position persisting across sessions, and the whole thing locked to
the same <5mph gate as the ground-truth log/popup buttons, auto-reverting
above it. Confirmed via `AskUserQuestion` before building, across two
real design forks: (1) pitch/tilt only, not zoom — zoom/anchor/bearing
stay under the automatic camera's control; (2) a HARD override — whatever
pitch `NavigationCameraEvaluator` would otherwise compute for the current
driving state (NAV_IDLE/URBAN_GUIDANCE/HIGHWAY_GUIDANCE/TURN_APPROACH) is
replaced outright the whole time the override is on — with the caveat the
project owner added themselves in the same answer: it "reverts to the
generic driving settings over 5mph."

**A real, previously-latent gap found and fixed while building this, not
assumed away**: `NavigationCameraEvaluator`'s own pitch clamp is `[0,85]`
— but `map.js`'s `maplibregl.Map` constructor never set `maxPitch` at
all, and MapLibre GL JS's own un-overridden default ceiling is 60
(confirmed by downloading the real library from npm and reading its
actual `Transform` class source, not assumed from memory — same
discipline this project's Android work already established for reading
real SDK source before trusting an API). Every existing preset pitch
either sits comfortably under 60 or exactly at it (`HIGHWAY_GUIDANCE`),
so this had never been visibly wrong before — but a slider genuinely
meant to reach the evaluator's own stated 85° ceiling would have silently
flattened out above 60 without this fix, a real UX bug in the making.
Fixed by passing `maxPitch: 85` explicitly to the `Map` constructor —
confirmed against the library's own `maxPitchThreshold` constant that 85
is the real hard ceiling MapLibre itself allows, not an arbitrary new
number.

**`src/manualTilt.js`** (new) — a small persisted-state module, same
shape as `ColorblindMode`/`ModeButtonOrder`: `init()`/`isEnabled()`/
`getPitchDeg()`/`setEnabled()`/`setPitchDeg()`/`reset()`/`setSpeedMph()`.
The PITCH VALUE persists in localStorage independent of whether the
override is currently on (direct instruction: "if the slider is
manipulated that position should persist") — turning the toggle back on
later resumes wherever it was left, not a fresh default. Whether the
override itself was ON does NOT persist across a reload — real speed
isn't known yet at load time to check the 5mph gate against, and silently
resuming an active override from a previous session read as more
surprising than useful for a control this specialised. `reset()`
deliberately does NOT disable the override — it puts the PITCH back to a
single well-defined default (`DEFAULT_PITCH_DEG = 45`, duplicated from
`NavigationCameraEvaluator.STATE_PRESETS.NAV_IDLE.pitch` — same
"intentionally duplicated, keep in sync by hand" caveat this file already
carries for `MAPTILER_KEY`/`LOG_ENDPOINT_KEY`) while leaving the slider
usable — the toggle button is the only thing that turns the feature off.
`setEnabled(true)` is refused outright (returns `false`, no state change)
above the speed threshold — a hard "can't even turn it on while moving,"
not just a later auto-revert; `setSpeedMph()` is the auto-revert half,
called from the exact same `applySpeedOverrideIfActive()` convergence
point `LogPanel.setSpeedMph()`/`UI.setSpeedMph()` already funnel through
(both the real GPS path and the dev SPD override reach it from one line),
force-disabling an already-active override the instant speed crosses
`CONFIG.GPS_HEADING_MIN_SPEED_MPH`.

**`cameraController.js`'s `followNav()`** applies the override in exactly
one place: right after `NavigationCameraEvaluator.evaluate()` returns,
`cameraState.pitch` is overwritten with `ManualTilt.getPitchDeg()` if
`ManualTilt.isEnabled()` and the resolved `navDisplayStyle !== "raw"` —
zoom/anchorY/anchorX/bearing are left exactly as the evaluator computed
them, so only pitch is frozen, matching the confirmed "hard override, all
states" design. Deliberately RAW-excluded: RAW's own camera state
(`NAV_RAW`) already has a flat, always-0 pitch of its own with no tilt
concept — the project owner's own framing was specifically about Hybrid,
where the camera refinement work actually lives. No speed check needed
inside `followNav()` itself — `ManualTilt.isEnabled()` is already
speed-aware by the time this runs, since `applySpeedOverrideIfActive()`
always calls `ManualTilt.setSpeedMph()` before any of the several
`followNav()` call sites run later in the same handler (`onGpsSuccess`,
`onSpeedSimChanged`) — the auto-revert takes effect on the very next
camera update, not a frame late.

**UI**: `#btn-manual-tilt-toggle` (a small floating circular button,
top-right, positioned per-render from the SAME `chromeTopInset`
`_rawChromeInsets()` already measures for every other Hybrid/RAW
floating control in this app — one shared source, not a second
independently-guessed offset, the same discipline this file documents at
length for the rings-vs-dots/camera-anchor bug class), `#btn-manual-tilt-
reset` (top-left, only shown once the override is on), and `#manual-
tilt-panel` (a compact vertical strip: a live degrees readout in B612
Mono, plus the slider itself). The slider is a standard horizontal
`<input type="range" min="0" max="85">` rotated `-90deg` inside a
fixed-footprint wrapper — a well-established cross-browser vertical-
slider technique that doesn't depend on WebKit-only `-webkit-appearance:
slider-vertical` (Firefox never implemented it). `rotate(-90deg)`
specifically, not `90deg`, so the slider's own MAX end lands at the
visual TOP (dragging up = more tilt, the intuitive reading for a vertical
control) — derived from the actual CSS rotation math (a rightward point
rotates to the 12-o'clock position under a -90°/CCW rotation), then
independently confirmed with a real Playwright click test against a
plain rotated range input (clicking near the visual top read back
value=100, near the bottom read back value=0) rather than trusted on the
derivation alone.

**A real bug class this project has hit before, deliberately avoided
here from the start**: switching to AIR mode never runs
`refreshIndicators()` again (the same reason `UI.clearRangeRingsOverlay()`/
`clearAircraftList()`/etc. all need their own explicit calls at the
AIR-mode entry point, per the LOG-button-overlap and several other
entries in this file) — so a Hybrid-only floating control needs an
explicit hide call there too, or it would be left showing over the AIR
map for as long as the user stayed there. `_hideManualTiltControls()`
is called alongside those existing clears in the `btn-air` click handler,
matching that established pattern exactly rather than reinventing a
different fix. It only touches DOM visibility, not `ManualTilt`'s own
enabled/pitch state, so returning to Hybrid resumes exactly where it was
left. Switching between Hybrid and RAW needed no separate handling —
`refreshIndicators()` runs for both, and `_positionManualTiltControls()`
already re-hides the controls itself whenever `NavDisplayStyle.isRaw()`.

**Verified two ways**: (1) a real Node check against the actual shipped
`manualTilt.js` — default pitch/range, clamp behaviour at both ends,
pitch-value persistence across a simulated reload (`init()` called
again) while enabled-state does NOT persist, refusing to enable above the
threshold, allowing exactly AT the threshold (`>` not `>=`) then
auto-disabling just above it (5.1mph), reset restoring the default
pitch without disabling, and disabling always being allowed regardless
of speed — all passed. (2) A real, extracted-verbatim Playwright harness
(this project's established fallback for UI wiring that lives inside
`app.js`'s own large closure — the same technique the Traffic Rules
feature's own verification used) driving the actual shipped
`_positionManualTiltControls`/`_hideManualTiltControls`/
`_syncManualTiltUI`/`onManualTiltToggleClick`/`onManualTiltSliderInput`/
`onManualTiltResetClick`/`applySpeedOverrideIfActive` functions and the
real button-wiring block, string-sliced verbatim out of `app.js`, against
the real markup and `VCAS.css`: 34 checks, all passed, zero page errors —
covering the full enable → drag → reset → auto-revert-above-5mph →
refuse-to-re-enable → allowed-again-exactly-at-5mph cycle, hidden in both
RAW and (via the explicit AIR-entry hide call) AIR, and no horizontal
overflow at this project's standard 360px check.

**Honest status**: never tested against a real touch drag on an actual
device — the Playwright checks above exercise the underlying `<input
type="range">` value/event model directly (setting `.value` and
dispatching `input`, and a separate synthetic-click geometry test for the
rotation direction), which is what actually drives the app's own logic
regardless of how the browser's touch-to-thumb-position mapping renders
visually, but a rotated range input's real-device touch feel (iOS Safari
in particular has documented quirks with `-webkit-appearance` overrides)
has not been confirmed hands-on. Worth a real-device pass before
considering this fully done, same standing caveat this file already
carries for every UI feature verified this way.

### Follow-up: LOG itself moves to RAW's own position, not the Reset button (2026-09-09, same day)

Real-device feedback, once the feature above was confirmed working:
"my only moyre is that the camera reset looks like it covers or
replaces the log button so maybe move this down to the bottom left
like it is in raw mode." First attempt (superseded within the same
day, see below) anchored `#btn-manual-tilt-reset` from the bottom
instead of touching LOG at all — the wrong fix, corrected by the
project owner immediately after: "I meant move the log button on the
hybrid screen to the same position it occupies on the raw screen. if
there is a log button on air mode move it to the same position as
well. move the hybrid reset button to where the log button currently
is." I.e. LOG itself needed to move, not Reset — and Reset should
*take over* LOG's old top-left spot rather than vacate it.

Confirmed the actual collision first: `#btn-manual-tilt-reset` was
positioned top-left (`left: 14px`, same `top` as the toggle/panel), and
LOG (`#lp-toggle`) has **no Hybrid-mode position of its own** —
`LogPanel.setPosition()` was only ever called from
`refreshIndicators()`'s `if (isRawView)` branch (see "LOG button
row-alignment follow-up" above), so in Hybrid it was simply left
sitting wherever it was last positioned during a RAW session, or at
its plain CSS default (`#lp-toggle { left: 14px; top: 100px; }`) if
RAW was never entered — right where Reset's own top-left spot landed.
Confirmed the same gap exists in AIR: `refreshAirMode()` already calls
`LogPanel.update()` (LOG is live and functional there, per "Power
efficiency pass" above — it's not gated to NAV mode), but never
`LogPanel.setPosition()`, so it was equally stuck wherever it was last
left.

**Fix, matching the corrected instruction exactly**: reverted the
Reset-anchoring change entirely — `_positionManualTiltControls()`
(`app.js`) puts Reset back on the SAME top row as the toggle/panel
(`reset.style.top = top + "px"`, `reset.style.bottom = "auto"`;
`VCAS.css`'s `#btn-manual-tilt-reset` transition back to
`transition: top .2s`). New shared helper `_nonRawLogPosition(insets)`
mirrors RAW's own LOG formula (`square.plotLeft + 8, square.plotTop +
square.plotHeight - 40` — round 8 of the RAW-mode-redesign history: 8px
in from the plot's left edge, 40px up from the plot's own bottom edge,
where the aircraft-list panel begins) against the real bottom-chrome
edge in place of the plot's own bottom edge, since Hybrid/AIR have no
plot box to measure from: `{ x: 8, y: insets.viewportHeight -
insets.bottomInset - 40 }`. Called from `refreshIndicators()`'s Hybrid
(`else`, non-RAW) branch with the already-computed `insets`, and from
`refreshAirMode()` with a fresh `_rawChromeInsets()` call — safe to
reuse there too since that function is a pure DOM-measurement helper
(real `topBar`/`bottomBar`/`routeCard` `offsetHeight`s), unaffected by
which mode is currently active, not a second independently-written
AIR-specific inset calculation.

Verified two ways: (1) re-ran the same extracted-verbatim Playwright
harness this feature's own build established, updated to match the
reverted Reset behaviour — Reset and Panel both confirmed back on the
exact same top row as the toggle (`Math.abs(top delta) < 1px`), 38
checks total, all passing, zero page errors; (2) a direct Node check
against the real, extracted `_nonRawLogPosition()` source (not a
retyped copy) confirming its formula: `x` is always 8 (matching RAW's
own left margin), `y` is exactly 40px above the real bottom-chrome edge
for both a normal and a zero-`bottomInset` case. Not verified: the
actual real-device visual result in Hybrid/AIR (this sandbox's own
MapLibre-CDN flakiness makes a full live boot of `refreshIndicators()`/
`refreshAirMode()` unreliable here, same standing caveat as the
"Real-device investigation" entry above) — the formula itself is
verified correct, but seeing LOG actually land bottom-left on a real
phone is the real remaining check.

## 360°/planetarium "sky compass" view — scoped, not yet built (2026-09-09)

Direct request, alongside the Hybrid tilt work above: "a free view where
the user uses the phone in a 360 manager, like planetarium style apps,
so that the display shows which aircraft are in the 'camera' view point."
Confirmed via `AskUserQuestion`, on both of the two real forks this
needed resolving before any design could be committed to: **sensor-only
"sky compass"**, not true camera-passthrough AR (no live video feed —
use the phone's real compass heading + tilt to know which way it's
pointing, and show whichever aircraft fall in that direction as icons
over a plain/dark background, the same way RAW's plot works but oriented
by the phone's real 3D attitude instead of GPS course); and **design/
scope only for now, build later** — this entry is that scoping, not a
built feature. Nothing described below has been implemented.

**Why sensor-only, not AR — the real tradeoff, not just "simpler":** true
camera-passthrough AR needs `getUserMedia()` camera access (this app has
never used the camera anywhere, a real, deliberate first if adopted) plus
accurate real-time 3D device ORIENTATION (azimuth + pitch + roll, not
just the single compass heading `compassHeading.js` already extracts) to
correctly place aircraft over live video. This project has already
fought — and only partially resolved — DeviceOrientation API
fragmentation for the much narrower 2D-heading-only case (`compassHeading.js`,
see "Compass 'won't settle / settles wrong'" above: the
`deviceorientationabsolute`-vs-plain-`deviceorientation` event-name/
`absolute`-flag inconsistency across real Android implementations took
two separate follow-up passes to get right, and is STILL flagged as
needing real-device field re-test). A true-AR build needs that same
fragile 3D sensor data to be accurate enough for visual alignment, which
is a materially harder bar than "close enough to gate a fallback path" —
a real risk worth naming up front rather than discovering after a much
larger camera+AR build was already underway. Sensor-only sidesteps camera
permission entirely and needs only azimuth (already fought for) plus one
new axis (device pitch/inclination), a smaller, bounded extension of
ground already covered rather than a new fragility class.

### What already exists to build on

- **Azimuth**: `compassHeading.js` already extracts and smooths a
  real-world compass heading from `deviceorientationabsolute`/
  `deviceorientation`/iOS's `webkitCompassHeading`, including the
  `absolute`-flag fragmentation fix (2026-08-24 follow-up above). This
  view needs that exact same heading — not a new sensor read, but this
  module's speed-gated stop/start behaviour (`CONFIG.
  GPS_HEADING_MIN_SPEED_MPH`, see "Power efficiency pass" above — it
  currently STOPS above 5mph, GPS course wins there) would need to change
  for this view specifically, since a sky-compass view is inherently a
  stationary/handheld-pointing use case where GPS course is meaningless
  and the compass must stay live regardless of vehicle speed. Needs a
  real decision on how `CompassHeading.start()`/`stop()`'s existing speed
  gate interacts with a second consumer that has different needs than the
  main NAV heading did.
- **Elevation angle**: already computed per-aircraft by both
  `Relevance.evaluate()` (the overhead-detection `elevationDeg`) and
  `Visibility.estimate()` (angular-size/contrail scoring) — this view
  needs the identical number, not a new geometry formula, just a new
  CONSUMER of a value that already flows through the pipeline.
- **Device pitch/inclination**: the one genuinely new sensor axis. The
  DeviceOrientation event's `beta` value (front-back tilt) is the
  candidate — `compassHeading.js` never reads it today (heading only
  needs `alpha`), so this is unexplored territory in this codebase, not
  a small extension of already-verified logic the way azimuth is. Real
  research needed: whether `beta`'s own 0°/90°/180° convention (phone
  flat vs. phone vertical vs. phone upside-down) maps cleanly onto "how
  far above/below the horizon is the phone pointing," and whether real
  Android/iOS implementations agree on that convention as reliably as
  they mostly do for `alpha` (not guaranteed — `alpha`'s own fragmentation
  fight took two passes; `beta` has had no equivalent field-testing here
  at all).

### The real architectural question this needs before implementation: a NEW angular-matching primitive, not a reuse of RAW's plot

RAW's existing polar plot (`Geo.projectToPolarPosition`) places a dot by
**bearing + banded distance** — it has no elevation axis at all; every
aircraft, regardless of altitude, plots purely by ground-track bearing
and horizontal range. A sky-compass view is fundamentally different: it
needs to know whether an aircraft's real **(bearing, elevation)** pair
falls within the phone's current **(azimuth ± half-FOV, pitch ± half-FOV)**
window — a genuine new 2D angular-matching function, not a parameter
tweak on the existing one. This is closer in shape to `Relevance`'s own
FOV-half-angle bearing check (`Indicators.FOV_HALF_ANGLE_DEG`) than to
`Geo.projectToPolarPosition`, but needs a second, orthogonal FOV
half-angle for elevation that nothing in this codebase currently
computes or needs (a phone's camera/screen has a real, roughly-fixed
vertical FOV very different from RAW's arbitrary 75° horizontal design
choice — a real number to research, not invent, if AR/camera framing
were ever added later, and still worth picking a deliberate value even
for the sensor-only version).

### Rendering — reuses `Indicators`' per-aircraft computation, not its polar-projection output

Since this is explicitly NOT camera-passthrough AR, "showing which
aircraft are in view" doesn't need real per-pixel screen placement
matched to a live video feed — a simpler, honest rendering falls out of
the sensor-only choice: aircraft within the phone's current pointing
window get listed/highlighted (closer to AIR mode's unfiltered marker
list crossed with RAW's tap-for-detail popup than to a literal
"aircraft-shaped dot floating at its exact visual position over the
sky"), with the phone's live azimuth/pitch driving which subset is
currently "in view" rather than driving a precise on-screen coordinate.
Exact visual treatment (a dedicated list, a crosshair-style center
indicator, some hybrid) is real, unresolved design work for whenever
this is picked up — not decided here.

### Explicit non-scope for this scoping pass

No camera permission, no `getUserMedia()`, no video compositing, no
per-pixel AR overlay placement — all explicitly ruled out by the
sensor-only answer above, not deferred-but-implied. No 4th mode-button
UI, no settings-screen wiring, no new files — this entry is architecture
notes for a future session to start from, matching this project's own
established pattern for scoped-but-not-started work (see the "Long-term
destination" Android Auto scoping note at the top of this file, which sat
untouched for a real stretch before Phase 1 actually began). Whether this
becomes a 4th mode button, a separate entry point, or something else
entirely is also unresolved — the earlier AskUserQuestion on mode
placement was only reached in the "build now" branch, which wasn't the
answer given.

## Sky View: the planetarium-style free-view mode, actually built (2026-09-09, same day)

Direct follow-up to the scoping note immediately above, same day: "should
it be alternate reality similar to Pokemon go or similar to a virtual
planetarium." Two design questions confirmed via `AskUserQuestion` before
writing any code (both previously left open by the scoping note itself):
**planetarium-style, not AR/camera-passthrough** (no `getUserMedia()`,
no live video — matches the scoping note's own "sensor-only" framing),
and **a new 4th bottom-bar mode button** (not a sub-screen of AIR or a
Settings entry).

**Read the real current source before writing anything, per this
project's own established discipline** — `compassHeading.js` (confirmed
`userHeading` is ALREADY live via `CompassHeading` whenever the vehicle
is stationary/slow, mode-independent — `onGpsSuccess`'s own start/stop
toggle has nothing to do with which `mode` is active), `visibility.js`
(confirmed `elevationDeg` is already computed per-aircraft by
`Visibility.estimate()`, exactly the number this feature needed and had
no reason to recompute), `indicators.js` (`Indicators.buildAll()` already
returns `relativeBearing` + `vis.elevationDeg` per aircraft — the
horizontal half of the "is this in the phone's pointing window" check
falls straight out of data this app was already computing, not a new
primitive), and `modeButtonOrder.js` (confirmed its own reorder
validation is hardcoded to exactly the 3-entry RAW/AIR/HYBRID set — a
real constraint that shaped the scope decision below, not assumed).

### A deliberate architectural choice, made without re-asking: an overlay, not a real 4th `mode`

The scoping note's own open question ("4th mode button, or something
else") was resolved to "4th mode button" by the follow-up `AskUser
Question` — but *how* that button behaves was still an implementation
decision. `app.js`'s `mode` variable is a tight `"nav" | "air"` binary
with NavDisplayStyle (Hybrid/Raw) as a sub-state of `"nav"` — genuinely
adding a 3rd top-level value would mean touching every one of the
dozens of `mode === "nav"` conditionals scattered through this file (the
camera, the indicator pipeline, ADS-B rendering, WakeLock, route/
guidance cards…), each one a real chance to reproduce the exact "forgot
to clear/hide something at a mode-entry point" bug class this file's own
history is full of (the LOG-button overlap, the range-rings-overlay
leak into AIR, several others). Sky View doesn't need any of that
machinery — it's a read-only, GPS-independent-of-camera display.
**Implemented instead as a full-screen modal overlay** (`#sky-view-
screen`, `z-index:220`), the exact same "toggle a `.hidden` class over
whatever's already showing" pattern `#settings-screen`/`#onboarding-
screen` already use — `mode`/`NavDisplayStyle` never change while Sky
View is open, GPS/ADS-B polling keeps running underneath exactly as it
already does behind Settings, and closing it returns to precisely
whatever was showing before, with zero coordination needed with the
RAW/AIR/HYBRID switch logic. `#btn-sky` sits as a genuine 4th button
inside `.mode-toggle` (visually a peer of RAW/AIR/HYBRID, matching what
was asked for) but is deliberately **not** added to `ModeButtonOrder`'s
reorderable set — it isn't a persisted display mode the reorder feature
was ever about, and extending that module's hardcoded 3-entry validation
for a button that doesn't actually participate in "which mode is
current" would be scope creep on an already-shipped, tested feature for
no real benefit. Its own "active" look reuses the existing `.active-mode`
CSS class, toggled purely on whether the overlay is currently open —
completely independent of the other three buttons' own `.active-mode`
state, both coexist without conflict since they're separate DOM elements.

### Two sensor axes: one already existed, one genuinely didn't

**Azimuth — already solved, just newly reused.** `userHeading` is kept
live by `CompassHeading` (`src/sensors/compassHeading.js`) whenever
`userSpeedMph <= CONFIG.GPS_HEADING_MIN_SPEED_MPH`, regardless of `mode`
— confirmed by reading `onGpsSuccess`'s own compass start/stop toggle,
which checks only speed, never `mode`. Sky View reads this directly; no
new azimuth sensor code was needed at all.

**Elevation (device pitch) — the one genuinely new sensor axis**, exactly
as the scoping note anticipated. New `src/sensors/devicePitch.js`
(`DevicePitch`), a structural sibling of `compassHeading.js` — same
`isSupported`/`start`/`stop` shape, same circular-smoothing-adjacent
damping (`SMOOTH_FACTOR = 0.15`) and `MIN_UPDATE_INTERVAL_MS` throttle —
but deliberately a SEPARATE module rather than folded into `CompassHeading`
itself: a second `window.addEventListener` on the same
`deviceorientation`/`deviceorientationabsolute` event type is completely
safe (multiple listeners can subscribe to one DOM event), and Sky View's
lifecycle (only listens while its own overlay is open) is genuinely
different from `CompassHeading`'s (gated on vehicle speed) — reworking
the latter's own already-verified event handling to carry a second
payload would have been real, avoidable risk to working code for no
benefit over a second small module.

**The beta→elevation mapping is this project's own honest, unverified-
against-real-hardware derivation** (`elevationDeg = beta - 90`, clamped
to [-90, 90]) — documented inline with the same category of caveat
`compassHeading.js`'s own screen-rotation correction already carries.
Reasoning: per the W3C DeviceOrientation spec, `beta` is rotation around
the device's own side-to-side axis, 0° when lying flat screen-up.
Holding a phone vertically in front of your face — screen facing you,
top edge toward the sky, the natural "look through it like a viewfinder"
pose this feature is actually used in — is the commonly documented
beta≈90° posture, and in that pose the phone's BACK (the direction
"pointed at") faces roughly horizontally outward — the horizon — hence
`beta - 90`. Portrait-only for v1, no landscape/`gamma` correction
attempted (unlike `compassHeading.js`'s own, also field-unverified,
landscape correction) — Sky View is a two-handed look-through-it
interaction with no obvious landscape use case the way a dash-mounted
nav screen has.

**Permission**: both axes share the SAME iOS `DeviceOrientationEvent.
requestPermission()` gate (a per-event-TYPE grant, not per-listener) —
`CompassHeading` almost always already holds it by the time Sky View can
even open (opening requires being stationary/slow, the exact condition
that already starts `CompassHeading` in `onGpsSuccess`), but
`openSkyView()` requests it defensively too, since opening the overlay
is itself a real user gesture iOS will accept the prompt from if it
somehow hasn't fired yet.

### The angular-matching primitive — new, and genuinely new, not a repurposed one

Confirmed by reading `geo.js` directly: `Geo.projectToPolarPosition`
plots by bearing + BANDED DISTANCE, with no elevation axis anywhere in
it — RAW's plot has no "how high in the sky" concept at all, so it
structurally couldn't be reused or extended for this. New pure module
`src/logic/skyCompassLogic.js` (`SkyCompassLogic.projectToSkyPosition`)
instead: given an aircraft's bearing offset from the phone's current
azimuth and elevation offset from the phone's current pitch, a plain
small-angle LINEAR degrees-to-pixels mapping across a fixed window
(`FOV_HALF_H_DEG = 40`, `FOV_HALF_V_DEG = 30` — genuinely new tuned
constants, same honest "reasonable starting guess, not physically
derived, pending real field calibration" provenance this file already
carries for `CONTRAIL_MIN_ALTITUDE_FT`/`LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG`
— deliberately wider than a real phone camera's ~30-35° half-angle FOV,
since there's no live video to frame against, so a generous catch window
matters more than pixel accuracy here). Returns `null` outside the
window; `app.js`'s `refreshSkyView()` filters those out entirely — no
suppressed-edge-dot concept the way RAW's range selector has, since
there's no "beyond the selected range but still worth a bare dot"
equivalent for a pointing-direction window.

### Data: reuses `Indicators.buildAll()`, the AIR-mode shape, not `build()`

`refreshSkyView()` (`app.js`) builds the exact same `userState` shape
`refreshAirMode()` already does (`metar`/`localObstruction`/`upperAir`
snapshots, `mode: _activeDisplayMode()`) and calls `Indicators.buildAll()`
— unfiltered by `Relevance.evaluate()`, matching AIR's own "every tracked
aircraft, not just what a driver should glance at" philosophy, which is
the correct one here: Sky View is explicitly NOT a driving-relevance
concept, it's "what's actually in the direction I'm physically pointing
my phone," closer in spirit to AIR's unfiltered real-position view than
to RAW/Hybrid's teardrop-gated one. Re-derives nothing `Indicators`
doesn't already provide — `relativeBearing` (bearing minus `userHeading`,
which IS the device azimuth whenever this view can be open at all) and
`vis.elevationDeg` are read straight off `buildAll()`'s own per-aircraft
result, with only `elevationDeg - devicePitchDeg` (the vertical offset)
computed fresh, since nothing upstream had any reason to know the
phone's own current pitch.

### Rendering — plain colour-matched dots, no live camera, no decluttering

`ui.js` gained `renderSkyView(items, onItemClick)`/`clearSkyView()`,
modelled directly on `renderAircraftList()`'s own diff-by-hex-free,
rebuild-every-call shape (Sky View has no extrapolation-tick-driven
500ms cadence the way NAV/RAW's indicator layer does — see the "Power
efficiency pass" section above for why THAT layer specifically needed
diffing — Sky View only re-renders on a real sensor/GPS event, an
inherently lower, bursty cadence with no equivalent cost to amortize).
Each aircraft renders as a small colour-matched dot (reusing
`_displayColor(vis)`, the same colourblind-safe-aware colour selection
every other view already uses) plus a one-line callsign/hex label — no
icon shape, no direction arrow, no label-decluttering machinery the way
RAW's plot has; at this feature's actual expected density (a handful of
aircraft in a ~80°×60° window) there's nothing to declutter, and adding
that machinery preemptively would be exactly the kind of premature
complexity this project's own conventions push back on elsewhere. A
fixed centre crosshair (`#sky-view-crosshair`, pure CSS, `pointer-events:
none`) marks "where the phone is pointing right now" — never moves; the
dots move around it as azimuth/pitch change, the correct way around for
a planetarium-style display (the reference Stellarium-style screenshot
the project owner attached shows exactly this: a fixed viewing frame,
the sky content moving underneath it as the device reorients). Tapping a
dot reuses `UI.showAirPopup(aircraft, vis, null)` verbatim — the same
plain read-only popup AIR mode's own markers already use, `onLogOutcome`
passed as `null` since Sky View isn't wired to `ObservationLogger` (no
ground-truth logging context here, same reasoning the native Android
port's own AIR/HYBRID marker taps already documented for staying on a
plain `Toast` instead of the full RAW popup's Suppress/log buttons).

### Speed gating — the same 5mph distraction gate as everything else, no new mechanism

A genuinely open design fork not resolved by the two `AskUserQuestion`
answers (which covered visual style and entry point, not this) — decided
by direct precedent rather than re-asking, given the system's explicit
"continue without further questions" instruction for this turn: pointing
a phone up to scan the sky is at least as much of a driving distraction
as any of this app's other already-5mph-gated interactions (the LOG
button, the RAW popup's log/Suppress buttons, Hybrid's manual-tilt
override) — arguably more, since it requires taking a hand fully off the
wheel and looking up rather than glancing at a fixed dash-mounted
screen. Gated identically: `openSkyView()` refuses to open above
`CONFIG.GPS_HEADING_MIN_SPEED_MPH`; if already open, `applySpeedOverride
IfActive()` — the same convergence point `LogPanel.setSpeedMph()`/
`UI.setSpeedMph()`/`ManualTilt.setSpeedMph()` already funnel through —
force-closes it the instant speed crosses the threshold, mirroring
`ManualTilt`'s own "reverts to the default position" behaviour rather
than `LogPanel`'s "dims but stays open" one, since there's nothing
useful left to show once the phone's own compass heading itself stops
being trusted (GPS course takes over and `onCompassHeading` simply stops
firing — Sky View would otherwise sit frozen on a stale azimuth, worse
than closing outright). `#btn-sky` itself dims via a new `.sky-toggle-
disabled` class, same visual language as `.manual-tilt-toggle-disabled`/
`.lp-toggle-disabled`. Because gating happens at the mode-button level
and Sky View is only ever reachable while already stationary/slow, this
sidesteps the scoping note's own open question about whether
`CompassHeading`'s existing speed-gated stop/start needed reworking —
it doesn't: Sky View's own requirement (stationary) is a strict SUBSET
of `CompassHeading`'s own "live" condition, so the sensor is already
running by construction whenever this view can legitimately be open.

### Verified with real execution throughout, this project's own established discipline, not skipped for a UI feature

- `SkyCompassLogic.projectToSkyPosition()`: 14 real Node checks — dead-
  centre, all four window edges (inclusive boundary, not exclusive),
  outside-window rejection on both axes, default-constant fallback, and
  a mixed-quadrant case.
- `DevicePitch`: 11 real Playwright/Chromium checks against the actual
  shipped module (synthetic `deviceorientation`/`deviceorientationabsolute`
  events) — the beta=90/180/0/270 boundary cases (horizon/zenith/straight-
  down/clamped), smoothing behaviour on a large jump, the
  `MIN_UPDATE_INTERVAL_MS` throttle collapsing a rapid-fire burst to one
  emission, a missing-`beta` event producing no emission, `stop()`
  genuinely removing the listener, and `start()`'s idempotency. **One
  real gotcha hit and fixed while writing this harness, not assumed
  away**: `_lastEmitAt`'s throttle state persists across `start()`/
  `stop()` cycles within one page session (mirroring `compassHeading.js`'s
  own design) — an early draft's tests ran too close together in real
  time and had their own emissions silently swallowed by the PREVIOUS
  test's throttle window, not a bug in the module; fixed by spacing
  independent test blocks >150ms apart.
- `UI.renderSkyView`/`clearSkyView`: 11 real Playwright checks against
  the actual shipped `ui.js` (not a retyped copy) — dot count/position/
  colour/label correctness, callsign-null fallback to hex, the count-text
  readout, real click-wiring firing the caller's callback with the right
  item, `clearSkyView()` emptying the container, empty-array rendering
  nothing, and — since this function builds `innerHTML` from real
  aircraft-controlled text (`callsign`) — a genuine XSS-escaping check
  (`_escapeHtml`) confirming a malicious callsign renders as inert text,
  not a live `<img onerror>` element.
- `app.js`'s Sky View wiring: 31 real Playwright checks against the
  ACTUAL functions (`_syncSkyButtonState`/`openSkyView`/`closeSkyView`/
  `refreshSkyView`/`applySpeedOverrideIfActive`), extracted verbatim via
  brace-matching regex from the real, shipped `app.js` — not hand-copied
  — into a harness stubbing only genuine external dependencies
  (`CompassHeading`/`DevicePitch`/`Indicators`/`MetarProvider`/
  `LocalObstruction`/`UpperAirProvider`/`UI`). Covers: initial state,
  opening/closing at 0mph, `DevicePitch.start()`/`CompassHeading.start()`
  being called on open, a dead-ahead aircraft at the device's own current
  pitch plotting at screen centre, an aircraft outside the FOV window
  being filtered out entirely, tapping a rendered item correctly opening
  `showAirPopup` with that item's own aircraft/vis, the full 5mph
  speed-gate cycle (can't open above threshold, force-closes mid-session,
  exactly-at-threshold still allowed per `>` not `>=`, `DevicePitch.
  stop()` called on auto-close), `refreshSkyView()` itself showing the
  blocked banner and clearing dots if it ever sees a blocking speed
  directly (not just via the convergence point), and no horizontal
  overflow at this project's standard 360px check. **67 checks total
  across all four harnesses, zero failures, zero page errors.**

### Explicit v1 scope, not silently implied to be more

No ground-truth logging integration (`onLogOutcome: null` — see above).
No label/icon decluttering (not needed at this density, see above). No
Suppress button or aircraft-list panel the way RAW has — Sky View is
purely "what's currently in the window," nothing persists between
frames. No landscape support for the pitch axis. No native Android Auto
port sync — same standing "synced in dedicated passes, not every change"
note this file already carries for every prior web-only feature; the
native port has no Sky View equivalent, no `DevicePitch`/
`SkyCompassLogic` Kotlin ports, and no 4th mode button.

**Honest status**: verified at the logic/DOM-wiring level with real
execution throughout, as documented above — what's NOT verified is
real-device sensor behaviour (this sandbox has no magnetometer/
gyroscope, the same limitation `compassHeading.js`'s own history has
flagged repeatedly), and specifically whether the `beta - 90` elevation
derivation actually matches how a real tester naturally holds their
phone when trying to "look at" a specific aircraft — that's the real
remaining check, same category as every compass-heading fix in this
file's history that shipped "logic verified, hardware behaviour
pending real-device field re-test."

## Sky View renamed to 3D View; a "world building" backdrop added (2026-09-09, same day)

Direct feedback, same day the feature shipped: "we need a better name than
Sky since that's very close to Air which we already have. does 3D work?"
— confirmed and adopted. Mechanical rename across every touched file:
`btn-sky` → `btn-3d`, `#sky-view-*` → `#view3d-*`, `openSkyView`/
`closeSkyView`/`refreshSkyView`/`_syncSkyButtonState` →
`open3DView`/`close3DView`/`refresh3DView`/`_sync3DButtonState`,
`SkyCompassLogic` → `View3DLogic` (file renamed `skyCompassLogic.js` →
`view3dLogic.js`), `renderSkyView`/`clearSkyView` → `render3DView`/
`clear3DView`. No behaviour change — re-verified with the same Playwright
harnesses the feature originally shipped with, rebuilt against the
renamed identifiers (33 checks across 4 harnesses, all still passing).

**Second piece of the same message: "there needs to be more world
building, currently it's just black. can the maptiler be used within
this mode to generate a horizon and a basic 3d world or would something
else be needed?"**

**Answer, confirmed via `AskUserQuestion` before building: something
else — a lightweight procedural sky, not MapLibre.** Real reason, not
just "simpler": MapLibre's own camera model has a hard pitch ceiling —
confirmed directly against the locally-installed `maplibre-gl` package's
own compiled source (`maxPitch:60` default, `maxPitch>85` as the
absolute hard cap enforced internally) — the exact same constraint
already documented in this file's own Hybrid manual-tilt entry above. A
tilted MapLibre map fundamentally cannot represent looking near straight
up (elevation approaching 90°), which is precisely the range 3D View
exists to cover for a high-elevation aircraft — a real MapLibre "sky"
layer and `fill-extrusion` 3D buildings do exist in MapLibre's style spec
(confirmed present in the compiled bundle) and would look genuinely
better for LOW-elevation, near-horizon views, but they don't solve the
part of the problem that actually motivated this mode. Offered three
options (procedural sky / real MapLibre horizon-only / both staged);
project owner picked the lightweight procedural sky outright.

**Implementation — a sky/ground split at the real horizon, not a flat
black void.** New `View3DLogic.horizonScreenY(devicePitchDeg,
viewportHeight, fovHalfVDeg)`: the exact same linear degrees-to-pixels
mapping `projectTo3DPosition` already uses for a single aircraft dot,
applied to the horizon's own fixed real-world elevation (0°) — if the
phone points `devicePitchDeg` above the true horizon, the horizon itself
sits `devicePitchDeg` below wherever the phone is currently centred.
Deliberately UNCLAMPED (unlike `projectTo3DPosition`, which returns
`null` outside the window) — a horizon is always "somewhere," even
off-screen at a steep tilt, never a single point that can meaningfully
fall "outside" the frame the way one aircraft dot can.

New `UI.render3DWorld(horizonY, viewportHeight, isNight)` (`ui.js`) sizes
two new divs, `#view3d-sky` (0 to `horizonY`) and `#view3d-ground`
(`horizonY` to the bottom), each with its own top-to-bottom CSS gradient
— day: dark blue zenith fading to a lighter horizon-blue, brown ground
fading darker with depth; night: near-black zenith fading to a faint
navy horizon glow, with a fixed set of small `radial-gradient` "stars"
(a real starfield would need real celestial-mechanics data this project
has no source for; a static decorative texture reads as "night sky" at
a glance for a fraction of the cost). **A deliberate v1 simplification,
named rather than silently accepted**: each gradient is anchored to its
own DIV's current height, not to a fixed true-elevation range — so the
sky doesn't get physically "stretched" or "squished" in a perfectly
continuous way as the horizon (and therefore the sky div's own height)
moves with tilt. What actually matters for reading the scene at a glance
— which side of the horizon a given pixel is on, and a rough sense of
"further from the horizon reads darker" — holds regardless; a fully
continuous physically-anchored gradient was judged not worth the added
complexity for what's explicitly a lightweight backdrop, not a
simulation.

**`isNight` is a real reversal of this screen's own prior styling
decision, not an oversight.** The CSS section that originally shipped
this screen stated "3D View is read purely by pointing the phone at open
sky, not something that benefits from a bright daytime theme" (mirroring
RAW's own "no day mode for a cockpit instrument" precedent). That
reasoning doesn't actually transfer here: RAW is an abstract instrument
readout with no real-world equivalent to "look like daytime," while 3D
View depicts the literal real sky the user is pointing at — a genuine
blue day sky vs. a dark night sky is more honest, not less, once the
screen actually renders a world instead of pure black. Reuses the
already-existing `ThemeManager.getResolved()` signal (`"day"`/`"night"`,
the same one every other themed surface in this app already derives
from) — no new time-of-day/sun-position calculation added. The CHROME
(header bar, close button) is untouched by this and stays on the fixed
`--raw-chrome-bg` slate background every top/bottom bar in this app now
uses regardless of theme (round 11's chrome unification) — only the
WORLD content inside `#view3d-body` follows Day/Night, a real, deliberate
scope line between "instrument-panel chrome" and "the sky being
depicted," not a blanket "make everything theme-aware" change.

Wired into `refresh3DView()` (`app.js`), called unconditionally on every
refresh (including while the speed-gate "blocked" banner is showing —
the banner sits visually on top of it either way, and there's no reason
to freeze the world mid-transition) — `horizonY` from
`View3DLogic.horizonScreenY(devicePitchDeg, vh)`, `isNight` from
`ThemeManager.getResolved() === "night"`.

**Verified with real execution, this project's own established
discipline, applied to a purely visual feature same as any logic
one**: 5 real Node checks on `horizonScreenY()` itself (level pitch →
horizon at exact centre; pitched to the edge of the FOV window in either
direction → horizon at the very bottom/top of the viewport; a pitch
beyond the window still returns a real, correctly-computed off-screen
value rather than clamping or nulling; the default half-V constant
applies when omitted). 8 real Playwright checks against the actual
shipped `UI.render3DWorld()` (height/position math, day/night class
toggling, clamping a horizon position outside `[0, viewportHeight]`,
graceful no-throw handling if the DOM elements are ever missing). 6 more
Playwright checks against the real `app.js` wiring (extracted verbatim,
same technique this feature's own original build already established)
confirming `render3DWorld()` is actually called on open with the correct
horizon position for a level pitch, that tilting up via the real
`onDevicePitchChange` callback moves the horizon down as expected, that
a live theme change is reflected on the next refresh, and that the world
keeps rendering through the speed-gate's blocked state rather than
freezing. **A real, visual end-to-end check too, not just DOM
assertions**: a Playwright harness loading the actual `ui.js`/
`view3dLogic.js`/`VCAS.css` (not stubs) rendered three real screenshots
— night/level with two aircraft plotted against a starlit sky and dark
ground, night/tilted-up-20° (horizon visibly lower, more sky, fewer
stars below it), and day/tilted-down-15° (blue sky band shrinks, brown
ground fills most of the frame) — confirming the whole system reads as
a coherent scene, not just individually-correct numbers.

**Explicit scope, not silently implied to be more**: no real sun/moon
position (would need actual solar-position astronomy this project has
no other use for and no existing dependency to lean on); no terrain,
skyline silhouette, or MapLibre map content of any kind — this remains
deliberately map-free, per the "sensor-only, no camera/AR, no new heavy
dependency" discipline the feature's own original scoping note already
established; no true continuously-anchored sky gradient across tilts
(see the v1-simplification note above); no landscape-orientation
handling (matches `DevicePitch`'s own existing portrait-only scope). If
a real 3D map ever becomes worth the added complexity for the
near-horizon case specifically, that's the "both, staged" option that
was offered and not taken this round — a real, separately-scoped follow-
up, not an implied next step here.

## 3D View, world-building pass 2: horizon silhouette, haze band, ground texture, drifting clouds, compass ticks (2026-09-09, same day)

Direct follow-up to the sky/ground gradient shipped earlier the same day:
"there needs to be more world building, currently it's just black... what
other options are there for generating/having something that is a little
more aesthetically pleasing... can all of them be done cheaply?" Offered
five concrete, mostly-CSS options; confirmed all five are cheap except one
(drifting clouds need an ongoing CSS animation, everything else is
compute-once/static); direct instruction to build all five, plus "add an
option to turn off the clouds in settings if the user feels it's overly
affecting battery."

**Before building any of it, a separate technical question was raised and
answered first**: "could we warp the MapLibre tile so that it gives a
pseudo surface impression?" — a CSS `perspective()`+`rotateX()` warp of a
flat, unpitched MapLibre render, sidestepping the same pitch-ceiling limit
that already ruled MapLibre out of the sky/ground gradient work. Built a
real Playwright proof-of-concept (three renders at different perspective/
rotateX values) confirming the technique genuinely produces a convincing
receding-ground look. Offered three ways to actually wire it in (reuse the
already-paused MapLibre instance behind the 3D View overlay, a second
dedicated instance, or don't build it yet) via `AskUserQuestion` — answer:
**don't build it yet**. The procedural gradient is free and always
correct; a real tile-warp is a real architecture/battery jump for a
cosmetic upgrade with no clear signal it's needed. Nothing from that
investigation shipped — it's recorded here so the "yes, this works, here's
the real cost" answer doesn't need re-deriving if it comes up again.

### The five additions, all layered on the existing `#view3d-sky`/`#view3d-ground` split

1. **Haze band** — a third gradient stop lightening the sky near the
   horizon (`#view3d-sky`/`.night`, `VCAS.css`), replacing the old flat
   two-stop fade. Skies read paler near the horizon in reality; this was a
   pure CSS tweak to the existing gradient, no new elements.
2. **Horizon silhouette** — a repeating hill-shape SVG data-URI
   (`#view3d-horizon`, new), placed as a CHILD of `#view3d-ground` with a
   negative `top` offset rather than positioned independently — since
   `#view3d-ground`'s own `top` is already repositioned every refresh by
   `UI.render3DWorld()`, the silhouette inherits that same positioned-
   ancestor origin for free and tracks the horizon exactly with zero new
   JS. Same silhouette shape/colour for day and night (real distant
   terrain reads as a dark silhouette regardless of time of day) — only
   overall opacity differs (dimmer at night, so it doesn't fight the
   starfield above it).
3. **Ground texture** — a flat (non-perspective) repeating grid pattern
   layered under the existing solid gradient via a second/third
   `background-image` entry on `#view3d-ground` (`repeating-linear-
   gradient` × 2 for the grid lines, plus the original `linear-gradient`
   for the base fill) — same visual family as the perspective-warp
   proof-of-concept explored and declined above, just without the
   transform, so none of that approach's WebGL-context/battery cost.
4. **Drifting clouds** (`#view3d-clouds`, new, a child of `#view3d-sky`
   so it's clipped to the sky's own current height via `overflow:hidden`)
   — five hand-placed `.view3d-cloud` blurred ellipses (`filter:
   blur(7px)`, varied size/vertical position/animation-duration/negative
   animation-delay so they don't all start stacked at the left edge),
   animated via one shared `@keyframes view3d-cloud-drift` (`translateX`,
   linear, infinite) — a GPU-composited transform, the cheapest real
   animation category available, and the only layer in this whole set
   with genuinely ongoing per-frame cost. Dimmer/bluer at night
   (`#view3d-sky.night .view3d-cloud`) rather than hidden outright —
   faint clouds silhouetted against the starfield read as real depth
   rather than clutter.
5. **Compass-tick strip** (`#view3d-compass-ticks`, new, pinned along the
   top edge, NOT repositioned by pitch the way sky/ground/horizon are) —
   the one functionally new piece, not just decoration. New pure function
   `View3DLogic.compassTicks(headingDeg, viewportWidth, fovHalfHDeg)`
   (`view3dLogic.js`): every 10° of true compass bearing gets a tick if it
   falls inside the phone's current horizontal pointing window (the SAME
   `fovHalfHDeg` window `projectTo3DPosition` already gates aircraft on),
   every 45° (the 8-point compass) is a labelled "major" tick, everything
   else is a small unlabeled mark. Deliberately uses the IDENTICAL linear
   degrees-to-pixels mapping `projectTo3DPosition` already uses for its
   own bearing axis — a tick and an aircraft dot at the same true bearing
   always land at the same x, by construction, not by two independently-
   typed formulas that could drift apart (this project's own repeated
   "one shared source" discipline — see the rings-vs-dots history
   elsewhere in this file). New `UI.renderCompassTicks(ticks)` (`ui.js`)
   rebuilds the strip fully each call — at most ~9 entries at once (an
   80°-wide window, one tick per 10°), no diffing/reuse machinery needed
   at this scale, same reasoning `render3DView`'s own full-rebuild
   already uses.

### `View3DClouds` — the one settings toggle this pass adds

New `src/view3dClouds.js`, same `init`/`isEnabled`/`toggle` shape as
`ColorblindMode` — a plain persisted boolean (`localStorage` key
`vcas-3d-clouds`), **on by default** (a real visual improvement, not a
hidden feature someone has to discover first). Given its own toggle
specifically because it's the one piece of this five-item set with an
ongoing per-frame cost (the drifting-cloud animation) — the other four
(haze band, silhouette, ground texture, compass ticks) are all static/
compute-once and don't warrant one, matching this project's own
established discipline of only adding a control where there's a real
effect behind it.

New Settings → Display & Accessibility row ("Clouds in 3D View",
`#btn-3d-clouds-toggle`, `index.html`), wired in `app.js` exactly like the
existing colour-blind/air-rings toggles:
`onView3DCloudsToggleClick()`/`_updateView3DCloudsToggleBtn()`, called
from `init()` (button label synced on load) and from the settings-row
click handler. Re-renders 3D View immediately if it's already open
(`if (view3DOpen) refresh3DView();`) rather than waiting for the next
sensor tick, same "don't make the user wait" pattern the colour-blind/
air-rings toggles already use.

`UI.render3DWorld()` gained a 4th parameter, `cloudsEnabled` — toggles a
plain `.hidden` class on `#view3d-clouds` (this app's existing per-element
`#id.hidden { display:none; }` convention, not a new global class).
`refresh3DView()` (`app.js`) passes `View3DClouds.isEnabled()` straight
through on every call, alongside the existing horizon/theme args — the
clouds' on/off state is re-read fresh every refresh, not cached, so a
mid-session settings change (or the settings screen's own immediate
re-render call above) always reflects the current toggle.

### Verified with real execution throughout, this project's own established discipline

- **`View3DLogic.compassTicks()`**: 15 real Node checks — dead-ahead
  tick centred when facing that direction, an out-of-window direction
  (e.g. S while facing N) correctly absent, minor (non-45°) ticks present
  and unlabeled, wraparound across the 0°/360° boundary, and a custom
  `fovHalfHDeg` correctly widening/narrowing the window. All 15 pass
  against the real, shipped function.
- **`View3DClouds`**: 8 real Node checks against the actual shipped
  module (a minimal in-memory `localStorage` stub, same technique this
  project already uses for other persisted-state modules) — defaults to
  enabled with nothing stored, toggling off/on both persist correctly,
  and a fresh re-`init()` correctly picks up the persisted state. All 8
  pass.
- **DOM/CSS/visual**: a real Playwright/Chromium harness driving the
  ACTUAL extracted `#view3d-screen` markup (string-sliced verbatim out of
  `index.html`, not retyped) against the real `VCAS.css` and the real
  `render3DWorld`/`renderCompassTicks` logic (copied verbatim from the
  shipped `ui.js`) — 13 checks: clouds visibly present/hidden matching the
  `cloudsEnabled` flag, night mode correctly applied, compass ticks
  render and show the correct major-direction label for the current
  heading (N facing north, E facing east, N correctly absent when facing
  east and outside the 40° FOV), tilting up moves the horizon down (sky
  div grows taller), the horizon silhouette element has a real negative
  `top` offset and a real background image, the ground texture reports
  multiple `repeating-linear-gradient` layers, and no horizontal overflow
  at this project's standard 360px check. All 13 pass, zero page errors.
- **Settings-toggle wiring**: a second extracted-verbatim Playwright
  harness (the real `onView3DCloudsToggleClick`/
  `_updateView3DCloudsToggleBtn` functions, string-sliced out of the real
  `app.js`, against the real settings-row markup) — 6 checks: correct
  default label, label/active-class flip on click, `refresh3DView()`
  correctly NOT called while 3D View is closed, and correctly called
  exactly once when a toggle happens while it's open. All 6 pass.
- **Real screenshots**, not just DOM assertions: day/level (haze, hills,
  clouds, ground texture, N tick all visible together), night/level with
  clouds explicitly disabled via the setting (confirms the toggle
  actually removes them from the rendered page, not just a DOM flag),
  and day/tilted-up-20°-facing-east (confirms the horizon, haze band, and
  silhouette all move down together as a single coupled system when
  pitch changes, and the compass strip correctly swaps from N to E) — all
  three visually consistent with the intended design.

### Explicit scope, not silently implied to be more

No MapLibre tile-warp (explicitly investigated and declined this session,
see above — not a "maybe later," a real recorded no for now). No true
astronomical sun/moon position or real weather-driven cloud cover — the
clouds are decorative, hand-placed shapes, same "not a simulation" honesty
already established for the static night starfield. No per-cloud-shape
variety beyond size/position (all five clouds share one visual style). No
native Android Auto port sync — same standing "synced in dedicated
passes, not every change" note this file already carries for every other
web-only feature; the native 3D View equivalent (if one is ever built)
would need its own world-building pass.
