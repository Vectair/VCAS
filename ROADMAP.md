# ROADMAP — VCAS implementation backlog

This is the project's **designated implementation list** — ideas and known
gaps worth exploring as the app develops, in one place. It did not exist
before 2026-09-17; before that, this material was scattered as inline
"not yet done" notes buried inside dated CLAUDE.md entries, with no single
place to see it all. Created specifically to fix that.

**How this differs from the other two docs**: CLAUDE.md is a dated
changelog — decisions, history, and *why* things are the way they are; it
records what happened. README.md is user/setup-facing documentation — what
the app does and how to configure it today. This file is the *future* —
things not yet built, in enough detail to pick up without re-deriving them.
When something here gets built, move it out (delete the entry, or leave a
one-line "done, see CLAUDE.md's <date> entry" pointer if it's likely to be
searched for by name later) rather than letting it rot in place as a stale
bullet — that's exactly the failure this file replaces.

Items are dated where they trace to a specific CLAUDE.md discussion, so the
fuller reasoning/context can be found there if needed.

---

## Infrastructure & process gaps — HIGHER PRIORITY than everything below (2026-09-18)

Surfaced by a direct "what's missing that isn't on the list yet" review,
not tied to any one feature. These are foundational/process gaps rather
than user-facing features — the project owner has explicitly marked this
whole section as higher priority than the feature ideas and polish items
further down, and work is starting here next.

### 1. The relay source code isn't in version control at all

`adsb-relay/relay.php` and `metar-relay/relay.php` (the CORS relays for
adsb.fi and aviationweather.gov — see CLAUDE.md's "ADS-B data source" and
"Visibility model calibration pass #1" entries) only ever exist as files
handed to the project owner directly via `SendUserFile`, never committed
to this repo. Every session that needs to touch them has to reconstruct
them from CLAUDE.md's own prose description rather than reading a real
file — and this already caused three real, sequential bugs in the same
relay on 2026-09-15 alone (a missing CORS-preflight handler, an opaque
`file_get_contents()` failure mode, and a flat-out wrong upstream URL).
**Fix**: commit the real, currently-deployed relay source into this repo
(e.g. a `relays/adsb-relay/relay.php` + `relays/metar-relay/relay.php`
structure), even though deployment itself stays manual (Bluehost has no
CI/CD hook today) — the goal is a diffable, readable source of truth,
not automated deployment. Needs the project owner to paste in (or upload)
the actual current live file for each relay as the starting point, since
no session has ever had direct access to what's actually deployed.

### 2. No persisted, repeatable automated test suite — STARTED (2026-09-18)

Every verification in this project's entire history — hundreds of
Playwright/Node checks across dozens of features (camera-anchor math,
the rings/dots banded-scale check, label decluttering, the relay
CORS/rate-gate behaviour, colorblind-mode compliance, the manual
compass-calibration flow, etc.) — was built fresh in a session's own
scratchpad and discarded once it passed. There was no `tests/` directory
in this repo and no CI. At the app's current scale (dozens of features
that provably interact — RAW's plot scale, the camera evaluator, the
range-ring/dot coordinate system, the relay dispatch logic) there is
real, growing risk that a future change silently regresses something a
past session already found and fixed, with nothing to catch it.

**A real, committed `tests/` folder now exists** — see `tests/README.md`
for how to run it (`node tests/run.js`, no npm/framework dependency,
matching this repo's own "no bundler, no package.json" convention) and
CLAUDE.md's own dated entries for the full writeup. Covers seven
pure-logic modules now: `geo.js` (50 checks), `visibility.js` (31
checks), `relevance.js` (27 checks), `aircraftExtrapolation.js` (27
checks), `indicators.js` (37 checks), `contrail.js` (24 checks),
`trafficRules.js` (53 checks) — 249 checks total, all verified against
the real, unmodified source (one genuine borderline test-premise bug was
caught and fixed by actually running the suite before committing it, not
assumed correct — the same discipline every one-off verification in this
project's history has already relied on, applied here to code that now
stays in the repo afterward).

**Still not covered, real remaining work, not implied to be done**:
`upperAirProvider.js`/`metarProvider.js` (network-fetch modules — need a
mocked `fetch`), the relay PHP files (blocked on #1 above — no committed
source to test against yet), any DOM/UI wiring (would need a headless-
browser harness, a materially bigger lift than these plain-Node checks),
and no CI runner wiring these into GitHub Actions yet (currently a
manual `node tests/run.js`, a real improvement over zero but not yet
automatic on every push/PR).

### 3. API keys ship in plaintext in the public `config.js` bundle, with no monitoring

`CONFIG.ORS_API_KEY`, `MAPTILER_KEY`, and `TOMTOM_API_KEY` (unlike
`ADSB_RELAY_KEY`/`METAR_RELAY_KEY`, which only exist server-side behind
a relay) all ship directly in the deployed app's own JS, readable by
anyone via browser devtools. Nothing confirms whether MapTiler's or
TomTom's dashboards actually have domain/referrer restriction enabled —
ORS and TomTom in particular have never had the same scrutiny the
adsb.fi/METAR keys got specifically because those two *had* to be moved
server-side (no CORS header). If any of these three leaked and got
scraped, there is no usage ledger or alert the way the two relays now
have via their own `?stats=1` endpoint (see the 2026-09-11 "Relay request
ledger" work) — quota exhaustion or abuse would only be noticed once the
app itself started failing for real users. **Fix**: confirm each
provider's dashboard has origin/referrer restriction actually turned on,
and consider whether ORS/TomTom should eventually get the same
relay-with-ledger treatment adsb.fi/METAR already have, at least for
visibility even if not strictly required for CORS.

### 4. Accessibility beyond colour has never been addressed

The 2026-09-14 colorblind-mode compliance audit covers colour, but
nothing in this app's history has ever touched screen-reader support,
ARIA labelling/roles, or keyboard navigation for Settings, popups, the
Traffic Rules rule builder, or the compass-calibration flow. Not urgent
at the current "a handful of known testers" scale, but a real gap before
any wider release — the same category of thing the Pre-V1 checklist
already tracks for other concerns (adsb.fi attribution, script-load
fragility), just never added for this one.

### 5. No deploy health-check

`.github/workflows/deploy-pages.yml` builds and pushes on every commit
to `main`; nothing afterward confirms the live site actually works. The
2026-09-01 service-worker staleness saga is the concrete example of the
cost: a real regression sat silently live for days because a broken
deploy and a working one look identical from the Actions log alone —
the only signal was a project owner's own manual report. **Fix**: even a
minimal post-deploy smoke check (a scripted fetch of the live URL
confirming the page loads and a key script/asset resolves, or a manual
checklist run after each deploy) would close a real, already-demonstrated
gap.

---

## New feature ideas

### Briefing page (2026-09-17)

Proposed as a screen accessible only when stationary or in pedestrian/
cycling mode — the same distraction-gating precedent already applied
elsewhere in this app (the 5mph interaction gates on the LOG button, the
RAW popup's log/suppress buttons, the Hybrid manual-tilt override, 3D
View itself). Two genuinely different halves, worth treating as separate
scoping efforts rather than one screen built in one pass:

- **Static half** — what each part of the app is and how to read the
  symbology. Largely already covered by the existing first-launch
  onboarding screen's own legend (`_renderOnboardingLegend()` in
  `app.js`, which already pulls real icons/colours straight from
  `Visibility.getCategories()` so it can't drift from what's actually
  rendered — see CLAUDE.md's "First-launch onboarding screen" entry).
  The real gap onboarding doesn't cover: it's shown once per install
  and then gone. This half of the briefing page is arguably just "make
  that same reusable content permanently reachable again," not new
  content to author — reuse `UI.displayColor()`/`AircraftSymbol.svg()`/
  `Visibility.getCategories()` exactly as onboarding already does,
  rather than a second hand-copied legend.

- **Dynamic half — the real new work.** A preflight-briefing-style
  synthesis of current/predicted conditions and how they affect
  sightability *by direction and altitude*, e.g. "low-level visibility
  poor due to haze (affects close-in traffic); upper-atmosphere
  conditions favour contrail persistence." Real infrastructure this
  could draw on already exists and needs no new integration:
  `MetarProvider` (surface conditions), `UpperAirProvider` (Open-Meteo
  cloud bands + the pressure-level profile the new Schmidt-Appleman
  contrail check already fetches), `LocalObstruction` (building/
  vegetation density), and `Visibility`/`Relevance`'s own scoring
  internals. Two things genuinely go beyond what the app has today,
  each a real, separately-scoped sub-decision:
  - **Airport/airway/navaid/waypoint proximity.** No aeronautical
    reference data exists anywhere in this app currently (only live
    ADS-B positions and route geometry) — would need sourcing a real
    dataset (e.g. OurAirports' free CSV exports, OpenAIP, or a
    similar open aeronautical database) and almost certainly a new
    CORS relay if the source doesn't send permissive headers, same
    pattern as every other external data source this app has had to
    work around (adsb.fi, aviationweather.gov). Worth checking CORS
    headers on whatever source is picked *before* building against it
    — this project has been burned by assuming a data source's shape/
    headers without verifying directly more than once (see CLAUDE.md's
    ADS-B relay debugging saga, 2026-09-15).
  - **Known schedule data** ("how good is spotting going to be in
    various directions or altitudes" informed by expected traffic) —
    flagged by the idea itself as speculative/"potentially." This is
    a materially larger integration than everything else in this list
    (a real flight-schedule data source, likely paid/rate-limited,
    with its own accuracy caveats) — worth treating as optional/
    deferred within this feature rather than a blocker to shipping the
    rest of it.
  - **Route-aware version**: if a nav route is active, the same
    dynamic content extended along the route — likely traffic hotspots
    en route, destination conditions. A natural follow-up once the
    non-route version works, not a prerequisite for it.

### User-submitted meteorological data (2026-09-17)

A PIREP-style community input layer — explicitly lower-confidence than
METAR/Open-Meteo, not weighted the same. Real design questions, not yet
answered:
- **Where it's stored**: this needs to be shared across users, so it's
  architecturally closer to the existing central observation log
  (`log.php` + GitHub mirror, not committed to this repo — see
  CLAUDE.md's "Central observation log" entry) than to a purely local
  feature. Reusing that same handoff pattern (a small PHP endpoint +
  shared secret) is the obvious starting point rather than inventing new
  infrastructure.
- **Weighting/decay**: needs its own confidence tier, separate from
  METAR/local-obstruction/upper-air — likely wired into
  `Visibility.estimate()` as a new optional parameter following the
  exact pattern `metar`/`localObstruction`/`upperAir` already establish
  (each is `null`-safe, each only ever caps a category downward, never
  raises one — the same discipline should apply here). A stale or
  unweighted submission floor should decay/expire, unlike METAR which
  is refreshed on its own cadence.
- **Abuse/spam**: unlike the existing observation log (personal,
  opt-in, low-volume, from known testers), a user-submitted-met feature
  that's genuinely shared and influences OTHER users' scoring is a real
  new surface for bad data (deliberate or accidental) to degrade the
  model for everyone. Needs real thought before building — at minimum
  some geographic/temporal clustering or a minimum-corroboration
  threshold before a submission actually affects scoring, not just
  "any single tap moves the needle."
- **UI**: needs to be simple enough that a non-technical tester can use
  it (same target audience as the existing ground-truth LOG panel) —
  likely a small set of tap-to-select conditions (visibility band,
  cloud description) rather than free text.

### Passive "probably not seen" inference from unlogged aircraft — PARKED (2026-09-17)

**Status: parked, not scoped.** Recorded so it isn't lost, not because
it's ready to build — the project owner's own framing: "it needs further
thought regarding its usefulness" before this goes any further. Don't
treat the notes below as a design to implement; they're the reasoning
that needs revisiting first, not a plan.

The origin: the user's own stated logging behaviour is that they log
*sightings* far more than misses, because sightings are rarer — meaning
the existing ground-truth dataset has a structural bias no calibration
pass has accounted for (every "visibility model calibration" entry in
CLAUDE.md has worked from explicitly-logged observations only). The raw
idea: aircraft that appear/track in the app but are never tapped could
be treated as a weak, implicit "probably not seen" signal for later
correlation review — but whether that idea actually holds up is the open
question, not a detail of how to build it. The real open question is
usefulness, specifically: "not interacted with" conflates "genuinely
wasn't visible" with "was visible but the user just didn't look at the
phone" — a confound the explicit log doesn't have — and it's not yet
clear the resulting signal would be worth the noise, the added volume
this app's own logging infrastructure would need to absorb, or the
schema complexity of keeping it clearly separate from real observations.
Revisit only once there's a clearer view on whether the signal is
actually worth extracting at all.

---

## Known gaps and polish items (pulled from CLAUDE.md's scattered history)

### Visibility model — pending real calibration data, not urgent code changes

- `CONTRAIL_ENGINE_EFFICIENCY` and the six fetched pressure levels
  (`visibility.js`) are reasonable starting guesses, uncalibrated
  against real `visible_contrail` ground-truth data (2026-09-17).
- `LOCAL_OBSTRUCTION_DENSE_THRESHOLD`/`MAX_ELEVATION_DEG` are similarly
  uncalibrated — need real density numbers across known reference
  locations (open airfield vs. suburb vs. city vs. woodland).
- A real airframe-underconfidence pattern was found in calibration pass
  review data (8/32 `visible_airframe` cases sitting exactly at the
  "Possibly visible" tier boundary despite confident real sightings) —
  flagged as a watch-item, not yet acted on; too thin a sample (n=8) to
  retune the 0.167° threshold from on its own.
- `not_visible_obstruction` real cases mostly fall *above*
  `LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG` (only 3 of 9 logged cases were
  at/below the 12° gate) — the local-obstruction feature can only ever
  address about a third of real logged obstruction misses as currently
  scoped. Confirmed, not yet addressed.
- Local obstruction's "no true polygon clipping" v1 simplification
  (centroid-in-radius, not exact geometric intersection) has been
  confirmed to actually bite in real data (a real case with
  `vegetationFeatureCount: 6` but `vegetationDensity: 0`) — accepted
  trade-off, not a bug, but worth revisiting if it recurs often.
- No `visible_lights` observations have been logged yet — the outcome
  exists (added 2026-08-27) but is unexercised, so nothing can be
  learned from it yet.
- METAR relay, Open-Meteo (cloud-band + pressure-level), and TomTom
  Orbis parsing were all built against documented schemas, never
  against a live response — this sandbox can't reach any of those
  domains. Worth confirming real response shapes match once each has
  had real traffic.

### Native Android Auto port — behind the PWA in several places

This project's own established pattern is "synced in dedicated passes,
not every change" — the following PWA features have no native
equivalent yet, accumulated across many passes without a full sync:

- Traffic Rules (filter/highlight by type/category/altitude/military-
  civil) — no native settings screen, no `military`/`dbFlags` field in
  `NormaliseAircraft.kt`.
- 3D View / sky-compass mode entirely — no `DevicePitch`/
  `SkyCompassLogic` Kotlin ports, no 4th mode button.
- Hybrid manual camera-tilt override.
- Mode-button-order settings (`ModeButtonOrder`).
- TomTom routing provider / `ActiveRoutingProvider` dispatcher.
- Colorblind-safe swatches for Traffic Rules, and the status-pill
  colorblind fix.
- RAW mode's merged nav-status card, screen-space flight-plan line, and
  several of the later RAW-redesign rounds' chrome details (nav/route
  diamond icon colour, rows-backdrop, unbounded-list-to-bounded-list
  fix from 2026-09-16).
- Only 2 status pills natively (adsb.fi/MapTiler) vs. the PWA's 4
  (+ Open-Meteo, + whatever else has shipped since).
- Manual compass calibration (sight a tracked aircraft or tap a map
  landmark to find true North, 2026-09-18) — no native equivalent at
  all; the native port still only has whatever `CompassHeading.kt`
  parity existed before this.
- Ten real route-display/nav-card bug fixes from 2026-09-20/09-21
  (RAW's flight-plan line no longer vanishing when only the leading
  route point falls outside the FOV; the raw-vertex-count truncation fix
  so the line spans the whole route instead of squashing inside the
  first ring; the line no longer tracing the plot's outer edge for its
  entire beyond-selected-range remainder; the merged nav-status card's
  destination-address row now hidden in RAW so ETA sits flush on the
  turn-instruction row; the card itself reworked from a solid opaque
  panel that pushed the square/compass-tape down by its own height into
  a transparent, `pointer-events:none` overlay drawn directly onto the
  radar's own unused black space, so the square starts at the same Y
  whether or not a route is active, matching the design draft's own
  "integrated into the screen, not a floating expansion" layout; the
  follow-up that closed the overlay rework's own remaining gap — the
  compass tape's own ticks/digital-heading/lubber-line, derived from a
  separate `tapeRadius` the overlay rework never touched, now also
  retreat by the merged card's real height while a route is active, so
  the tape's own decorative geometry no longer visually collides with
  the now-transparent overlay text; a follow-up that pixel-measured the
  card's own TEXT against the reference mockup rather than just its
  position, bringing every RAW-scoped font-size and both cards' padding
  down to within a few percent of the mockup's own measured
  proportions; a further correction once that mockup-measured fix was
  STILL reported too large — every readout in the card now matches, to
  the exact pixel, the font-size the app already uses for its own
  passive "SPD ... MPH" tape readout (`src/ui.js`'s `renderCompassRing()`,
  13px), a single internally-verifiable target superseding the mockup-
  approximated one; and finally a cleanup pass, once the card's own
  sizing was confirmed correct, that REMOVED two controls rather than
  restyling them — the 💬 guidance-text-hide toggle (turn-by-turn text
  is now hardwired always-on whenever navigating, "unobtrusive by being
  compact," not by being hideable) and the standalone ✕ cancel-route
  button (cancelling a route is now done via the existing bottom-bar
  NAVIGATION button, which now branches on whether a route is active
  rather than always arming destination-pick mode) — plus deleted the
  compass tape's own digital 3-digit heading readout outright, since it
  was overlapping the merged card's text and the tape's own rotation
  against the fixed lubber line already conveys heading) —
  `RawPlotView.kt`'s own route-line rendering has none of the route-line
  fixes (no FOV-skip, no even-sampling decimation, no range-boundary
  cutoff), and there's no native merged nav-status card, destination-row,
  overlay-vs-floating-panel, tape-clearance, matched-to-the-passive-
  readout font-size, or NAV-button-cancels-route equivalent at all yet —
  its own compass tape (if any) still needs a check for whether it
  carries an equivalent digital-heading readout worth removing too, once
  a native sync pass actually happens.

A real full native sync pass — not a single-feature port — is probably
worth scheduling once the PWA's own feature velocity slows down, rather
than continuing to accumulate gaps indefinitely.

### Android Auto native port — car-side phases not yet started

Per CLAUDE.md's own "Long-term destination" scoping note: phases 1-2
(bare CarAppService, MapLibre Native map, GPS-driven camera, ADS-B
polling) are done and confirmed building. Not started:
- Phase 3: routing + `NavigationTemplate`'s own turn-by-turn display.
- Phase 4: foreground `Service` + Android's background-location
  permission flow.
- Phase 5: settings companion screen, feature-parity pass — RAW's dense
  instrument-style look may need real redesign to fit Android Auto's
  own template constraints (distraction-review design question, still
  open).
- `TURN_APPROACH`'s `DECOUPLED_MANEUVER` bearing mode is computed by
  `NavigationCameraEvaluator.kt` but not yet consumed by
  `applyCameraResult()` on the car side.
- No destination pin/marker on the car-side route line.

### Routing / navigation

- Off-route detection threshold (`CONFIG.OFF_ROUTE_THRESHOLD_METERS`,
  50m) is a flat distance cutoff, not mode- or road-type-aware —
  untuned against real field data.
- TomTom's Orbis Routing API doesn't return turn-by-turn instruction
  text (`steps` stays empty) — the guidance card falls back to the
  camera's own geometric turn detection for TomTom-sourced routes. A
  real fix needs a live `instructionsType=text` response inspected
  first, not another schema guess.
- No real live end-to-end TomTom request has been confirmed from the
  deployed app (sandbox can't reach `api.tomtom.com`) — worth
  confirming on a real device now that `TOMTOM_API_KEY` is actually
  filled in (`config.js`, since ~2026-09-20). Same caveat applies to
  the TomTom geocoding fallback (`tomtomGeocoder.js`/
  `activeGeocoder.js`, 2026-09-19) — its request/response shape and
  CORS support were confirmed from TomTom's own official npm-published
  SDK source, not a live device response; worth a real on-device search
  once this is next tested.
- `CONFINE_RADIUS_KM` (200km, both `orsGeocoder.js` and
  `tomtomGeocoder.js`, 2026-09-21 — see CLAUDE.md) is a reasonable
  starting guess for a driving-nav app's day-trip range, not tuned
  against real usage. If real searches start missing a legitimately
  distant destination (a city genuinely >200km away), or still return
  too many same-named matches from just outside the radius, this is the
  first number to revisit.
- `activeGeocoder.js`'s `MERGE_THRESHOLD` (3 — ORS results below this
  count trigger a supplementary TomTom query) is a plain count
  heuristic, not a relevance check — flagged during the 2026-09-21
  TomTom investigation as a possible secondary contributor to "search
  feels minimal," not yet changed or tuned. The confinement-radius fix
  may have already improved this in practice (ORS's own result count
  should better reflect genuine local coverage once it's no longer
  diluted by globally-scattered same-name matches), but that hasn't
  been separately verified.
- `ActiveRoutingProvider` (TomTom-vs-ORS routing) is still switched off
  by default, hidden behind a 7-tap DevMode unlock in Settings — this
  is deliberate (Orbis Routing is still "public preview," per its own
  docs), not a bug, but worth revisiting once real on-device traffic-
  aware ETAs have been confirmed working.
- METAR-based QNH correction for aircraft reporting only barometric
  altitude (no `alt_geom`) — `metarProvider.js`'s nearest-station fetch
  already does the hard part; this would mostly be parsing one more
  field (`altim`) off data already being fetched.

### Sensors / UI polish

- RAW mode's range selector — a tap-and-hold "fan out all 5 values"
  interaction was agreed as the right design (vs. a literal rotary
  knob) but never built; current tap-to-cycle behaviour stays
  "acceptable for now."
- A real, narrow (<360px) device could still overflow the bottom
  bar's mode-toggle row (a genuine floor found at 328px, affecting all
  three modes equally) — deprioritized since it's below this project's
  own 360px worst-case standard and no real device has hit it yet.
- 3D View's `beta - 90` device-pitch-to-elevation mapping is this
  project's own derivation, never confirmed against real hardware.
- A real architectural concern (not yet investigated): 3D View's own
  required near-vertical phone pose (`beta≈90°`) sits close to a
  documented Euler-angle near-singularity in the alpha/beta/gamma
  decomposition Android's `deviceorientationabsolute` path relies on —
  could be a bigger source of "jittery heading" in 3D View specifically
  than plain sensor noise, and none of the smoothing/dead-zone work
  shipped so far would fix it if so.
- `DevicePitch` doesn't reset on `close3DView()` — reopening briefly
  shows a stale pitch for ~150-300ms (self-heals, cosmetic).
- `#view3d-hint` ("Point your phone at the sky…") never hides once
  aircraft are actually in view — cosmetic.
- Android compass landscape-mount correction (`compassHeading.js`) is
  derived from documentation, never confirmed on a real device.
- Magnetic declination correction has never been implemented anywhere
  in this app (compass heading is magnetic, not true, north).

### Other

- Higher-accuracy contrail modelling via Google's purpose-built
  [Contrails API](https://developers.google.com/contrails) (needs a
  Google Cloud key) — worth revisiting as a possible supplement to the
  Schmidt-Appleman/Open-Meteo check now shipped, once real
  `visible_contrail` ground-truth data exists to compare either
  approach against.
- Terrain obstruction model / true line-of-sight — explicitly scoped
  and rejected as disproportionate infrastructure for now (no free
  global high-resolution elevation+building data, no GIS backend) when
  the local-obstruction feature was designed; worth revisiting only if
  that changes.
- Local SDR receiver adapter — a new `RoutingProvider`-style ADS-B
  adapter alongside `adsbExchangeClient.js`, for a self-hosted feed
  instead of/alongside adsb.fi.
- Voice callout: "Traffic, 2 o'clock, A320, 12 miles."
- iOS has no manifest-driven splash mechanism (`apple-touch-startup-
  image`) — the in-page `#launch-screen` overlay covers this today, but
  the gap was noted as still technically open.
- Derive the low-altitude suppression threshold from live GPS altitude
  instead of the fixed sea-level value Settings currently sets
  manually.
