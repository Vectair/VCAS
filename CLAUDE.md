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

**Testing convention for MapLibre-related changes:** this sandbox can't reach
MapLibre's CDN or any real tile server (network egress policy blocks them).
Verify camera/projection math with a *locally npm-installed* `maplibre-gl`
package (`registry.npmjs.org` is allowlisted) driven via Playwright/headless
Chromium with a minimal tile-less style
(`{version:8, sources:{}, layers:[{type:"background",...}]}`), not by
reasoning about it or trusting a code comment's claim. This caught two real
bugs this session that pure code review missed.

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
