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

- **adsb.fi attribution needs to be more prominent.** Their usage terms
  require citing them with a link to their homepage — currently satisfied
  minimally (Settings > Data & Logging, `index.html`'s `.settings-credit`),
  which is compliant but easy to miss since it's buried in a settings
  sub-screen. Explicit instruction from the project owner (2026-08-20):
  leave it as-is for now, but move it somewhere actually visible in the
  main UI before release.

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
  dead, no error shown to the user, only a reload fixes it. Fine for now
  since it's rare and a reload always works, but a single-user app can
  get away with "just reload it" in a way VCAS can't once other people
  are relying on it. Real fix — bundling into fewer requests, or at
  minimum load-error detection that shows a "reload" prompt instead of a
  silently-dead UI — not yet scoped.

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
same handoff-file pattern as the parked central log below; ask whether
the owner still has it if this ever needs touching again). `src/config.js`
now has `ADSB_RELAY_URL`/`ADSB_RELAY_KEY` filled in with that URL and the
matching secret, and `adsbExchangeClient.js`'s `adsb_fi` provider routes
through it automatically (falls back to calling adsb.fi directly — which
still works outside a browser, e.g. curl/Node, but not in the deployed
app — only if those config values are ever blanked out).

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

## Central observation log — also PARKED

`src/dev/observationLogger.js` currently falls back to local
`logServer.py`/localStorage. A central logging design (Bluehost-hosted PHP
endpoint + private GitHub repo mirroring, so phone/PC/whatever all log to
the same place) was fully designed and built — deploy files were handed to
the project owner (`DEPLOY_INSTRUCTIONS.md`, `log.php`, `logs/.htaccess`,
not committed to this repo) — but parked pending the owner's own setup work:
creating a private GitHub repo, generating a GitHub PAT, uploading to
Bluehost via cPanel, and providing the final deployed URL + shared secret
for `CONFIG.LOG_ENDPOINT`/`LOG_ENDPOINT_KEY`. Don't restart this design from
scratch if asked to pick it back up — ask whether the owner still has those
handoff files first.

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
