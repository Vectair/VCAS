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

Not yet done: a sortable aircraft list (callsign/type/altitude,
default-sorted by the same visibility-likelihood scoring the indicators
use, re-sortable by range/altitude/type) filling whatever space the plot's
arc-not-circle shape still leaves empty, with tap-to-highlight linking
between a list row and its on-plot icon. Ask before assuming this was
abandoned if picking the RAW work back up — it's the agreed next step,
not a rejected idea.

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

## General conventions established this session

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
