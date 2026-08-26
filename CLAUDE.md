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
