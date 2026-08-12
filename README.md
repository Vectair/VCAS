# VCAS V1 — Personal ADS-B Visibility Prototype

A mobile-first web app that answers: **"Which aircraft around me are likely visible, and in what direction should I look?"**

VCAS runs in Android Chrome (or any modern browser) and displays nearby aircraft as glanceable polar-plotted indicators — bearing as angle, distance as radius from you — over a dark, MapLibre-rendered road map, similar in spirit to Google Maps' driving mode with a layer of airspace awareness. A second mode overlays the same aircraft as plotted icons on a top-down airspace view, and a routing layer (OpenRouteService — driving/cycling/walking) can drive a Google-Maps-style tilted, route-following 3D camera.

---

## Quick Start

### 1. Configure

Open `src/config.js`:

```js
const CONFIG = {
  MAPTILER_KEY: "your-maptiler-key-here",
  ...
};
```

`MAPTILER_KEY` is required for the vector road map (get a free key at
https://cloud.maptiler.com/auth/widget?mode=add — no credit card). Without it
the map tiles won't load, but GPS, the aircraft feed, and the NAV indicators
still work against a blank background.

**ADS-B aircraft data needs no key by default** — it defaults to the free
[airplanes.live](https://airplanes.live) API. To use ADS-B Exchange's paid
API instead, add to `config.js`:

```js
DATA_PROVIDER:  "adsb_exchange",
ADSB_API_KEY:   "your-key-here",
ADSB_API_HOST:  "adsbexchange.com",
```

### 2. Run locally

The app is plain HTML/JS/CSS with no build step. Any static file server works:

```bash
# Python 3
python3 -m http.server 8080

# Node (npx)
npx serve .

# Node (http-server)
npx http-server -p 8080
```

Then open `http://localhost:8080` in Chrome.

**To also use the ground-truth log panel** (see below), run `logServer.py` instead — it serves the exact same files but additionally persists logged observations to disk:

```bash
python3 logServer.py 8080
```

### 3. Use on Android

1. Connect your phone and PC to the same Wi-Fi network.
2. Find your PC's local IP (e.g. `192.168.1.42`).
3. Open `http://192.168.1.42:8080` in Chrome on your phone.
4. Accept the location permission prompt.

For a home-screen shortcut:
- Chrome → three-dot menu → **Add to Home screen**.

---

## App Modes

| Mode | Button | Description |
|------|--------|-------------|
| **Driving — Hybrid** | HYBRID | Road map, user position anchored near the bottom, aircraft polar-plotted by bearing/distance, tilted 3D speed-adaptive camera |
| **Driving — Raw** | RAW | Same NAV mode and traffic plot as Hybrid, but a flat TCAS/ND-style instrument screen instead of a road map, see below |
| **Airspace (AIR)** | AIR | Top-down, north-up map with aircraft plotted directly as icons |

Hybrid and Raw are both NAV mode under the hood — same traffic plot, same route/guidance logic — just a different camera and basemap, and both are one direct tap away rather than one being buried behind a Settings toggle.

Tap any indicator or aircraft icon to open a detail popup (auto-dismisses after 4 s).

**Screen wake lock** (`src/wakeLock.js`): the screen is kept from dimming/locking while NAV mode (Hybrid or Raw) is active, the same way any real navigation app stays on — released automatically when you switch to AIR mode, or when the browser/OS itself revokes it (tab backgrounded, low battery); re-acquired the next time the app becomes visible again if NAV is still the active mode. Uses the standard Screen Wake Lock API (`navigator.wakeLock`) and no-ops silently on browsers that don't support it.

**NAV display style** (HYBRID / RAW buttons on the main screen): NAV mode itself has two camera/basemap presentations, selectable independent of AIR mode. **Hybrid** (default) is the tilted, speed-adaptive follow camera described above, with the polar-plotted TCAS-style traffic overlay combined on top of the normal themed road map — a hybrid of the two. Its basemap carries genuine road/building substance (minor roads, residential streets, and building footprints all rendered, not just arterials) so it reads as an actual navigation map at a glance, on par with mainstream nav apps, rather than a stripped-down base underneath the traffic overlay; service/driveway-level roads stay suppressed to keep it from getting noisy. **Raw** goes for as close a match to a real TCAS/ND instrument display as practical: flat (pitch 0), heading-up (rotates with your heading, unlike AIR's fixed north-up), anchored near the bottom of the screen at a fixed zoom sized to fit the relevance teardrop's own ~15nm dead-ahead range, and — unlike every other view in the app — the basemap itself switches to a dedicated near-black "raw" style (`NavStyle.getStyle("raw")`) with no roads, buildings, or labels at all, the same way a real ND doesn't show streets — just the raw traffic picture. Traffic symbols in Raw use colours sampled directly from a real ND reference display (bright red square, amber circle, white diamond) instead of the app's usual themed palette, so it matches the reference "color and layout wise" rather than an approximation — colour-blind-safe mode still overrides these, same as every other style, since accessibility takes priority over reference fidelity. It's always dark regardless of the Day/Night/Auto preference (a cockpit instrument doesn't have a day mode); switching NAV out to AIR mode reverts to the normal themed map, and switching back re-applies the raw basemap if Raw is still the active NAV style. It's deliberately simple ("rudimentary" navigation) — no speed-based zoom/pitch adaptation, no turn-approach camera choreography — but the route line, ETA/guidance card, and turn hints all keep working normally; only the camera framing and basemap change (the route line itself also switches to a green matching the reference in Raw, vs. the usual blue). Switching styles takes effect immediately, no waiting for the next GPS update. Traffic indicators and the direction-of-travel arrows render identically in both styles — they're a screen-space polar plot layered above the map, not tied to its tilt (`src/navDisplayStyle.js`, `NAV_RAW` state in `src/navigation/navigationCameraEvaluator.js`, raw basemap in `src/map/navStyle.js`).

**Distance reference**: a polar-plotted dot's screen position alone doesn't reliably communicate "how far away is that" the way AIR mode's real map landmarks do — without a scale cue, a genuinely distant aircraft can visually read as closer than it is. Both NAV styles show dashed range rings (`UI.renderRangeRings()`) centred on the same anchor point the traffic plot uses, and every indicator's label carries its actual slant range (e.g. "8.4nm") alongside callsign/type — the same figure that drives where its dot is plotted, so the number and the position always agree.

The rings — and the traffic plot itself — use a non-linear "banded" distance scale rather than a straight linear one (`Geo.bandedRadiusFraction()`, bands defined in `Indicators.RING_BANDS_NM`, currently `[2, 5, 10, 15]` nm). Each band gets an equal share of the available on-screen radius regardless of how many real nm wide it is, so the four rings always look evenly spaced even though they mark very unequal real distances — close traffic (where "is this one nearer than that one" actually matters for spotting it) gets much more usable screen resolution than a linear scale would give it, while distant traffic still visibly separates into "how far away, roughly" bands instead of collapsing into one distant blob near the edge. This is purely a plotting/display scale — it doesn't touch sightability scoring, which still ranks aircraft independently and just places the resulting marker in whichever band its real range falls into. The relevance teardrop's own ~15nm dead-ahead cutoff (`Relevance.DEFAULTS.rMaxNm`) remains the outer boundary — nothing beyond it is shown at all, banding only reshapes how what IS shown gets spaced out within that range.

**Heading tape** (Raw only, `UI.renderCompassRing()`): matching the reference image's own top-of-screen compass display, Raw mode shows an ND-style heading tape across the top of the screen — a fixed lubber line marks dead-ahead with the current heading as a 3-digit digital readout, while tick marks (minor every 10°, labelled every 30°) slide past it as you turn, the same convention a real EFIS heading tape uses. Since Raw is already heading-up, the tape's centre always reads the aircraft's current heading. Hybrid doesn't show it — the rotating road map underneath already carries its own orientation cues, unlike Raw's otherwise bare instrument background.

The 📍 button next to the mode row arms destination-picking, opening a banner with two
ways to supply a target: type a place name/address into its search box, or tap the map
directly — either way, a route is requested in whichever transport mode
(driving/cycling/walking) is selected in the same banner — see
[Routing & Navigation Camera](#routing--navigation-camera) below.

---

## Configuration Reference

All keys live in `src/config.js`.

| Key | Default | Description |
|-----|---------|-------------|
| `MAPTILER_KEY` | `"PASTE_YOUR_MAPTILER_KEY_HERE"` | MapTiler browser token — required for road map tiles/glyphs |
| `ORS_API_KEY` | `"PASTE_YOUR_ORS_KEY_HERE"` | Free OpenRouteService "Standard" API key — required for routing (driving/cycling/walking) |
| `REFRESH_INTERVAL_SECONDS` | `3` | How often to poll the ADS-B provider — Airplanes.live's REST API is rate-limited to 1 req/sec, so this leaves generous headroom as a single-client app |
| `REMOVE_THRESHOLD_SECONDS` | `30` | Aircraft older than this (since last seen) are dropped entirely |
| `STALE_THRESHOLD_SECONDS` | `15` | Aircraft older than this are dimmed (`isStale`) in the driving view; also used as the hard age cutoff (3×) for which aircraft are considered at all |
| `DEFAULT_RANGE_NM` | `50` | Radius to query, in nautical miles |
| `GPS_HEADING_MIN_SPEED_MPH` | `5` | Minimum speed before GPS course-over-ground is trusted as heading |
| `SUPPRESS_DURATION_SECONDS` | `180` | How long a manually-suppressed aircraft (popup's Suppress button) stays hidden from NAV |
| `SUPPRESS_LOW_ALTITUDE_ENABLED` | `false` | Starting value only — overridden live by the Settings screen's Traffic Filtering section once you've touched it, persisted in localStorage |
| `SUPPRESS_LOW_ALTITUDE_FT` | `500` | Starting value only, same as above — altitude floor is barometric (MSL), not height above you; see the caveat comment in `config.js` |

NAV indicator count isn't a fixed config value — it's viewport-tiered via `Indicators.capForViewportWidth()` (`src/logic/indicators.js`): under 500px wide shows 5, 500–900px shows 7, above 900px shows 10. AIR mode is unrestricted (see below).

Optional — only needed to switch ADS-B providers (not present in `config.js` by default):

| Key | Description |
|-----|-------------|
| `DATA_PROVIDER` | `"airplanes_live"` (default, free, no key) or `"adsb_exchange"` (paid) |
| `ADSB_API_KEY` | Required if `DATA_PROVIDER` is `"adsb_exchange"` |
| `ADSB_API_HOST` | Required if `DATA_PROVIDER` is `"adsb_exchange"` (e.g. `"adsbexchange.com"`) |

---

## Visibility Categories

VCAS estimates how detectable an aircraft is under ideal conditions (flat terrain, no clouds, daylight), based on its angular size (wingspan vs. slant range) — how large it would actually appear to your eye, not just how close it is on the map.

Shape and colour together follow TCAS's own 4-symbol symbology (hollow diamond → filled diamond → amber/yellow circle → red square) as closely as the app's day/night theme allows, reinterpreted for VCAS's rules of outright *sightability* rather than TCAS's rules of collision risk — a red square means "you should certainly be able to see this," not "resolve an RA":

| Shape | Colour | Fill | Category | Angular size |
|-------|--------|------|----------|-------------|
| Square | Red | Solid | Certainly visible | ≥ 0.5° |
| Circle | Amber/yellow | Solid | Likely visible | 0.167° – 0.5° |
| Diamond | Turquoise/cyan | Solid | Possibly visible | 0.05° – 0.167° |
| Diamond | Turquoise/cyan | Hollow | Very unlikely/not visible | < 0.05° |

Circle and square are always fully solid, matching real TCAS (TA/RA symbols never fade) — only the diamond family's fill varies, hollow vs. solid.

The three dividers are literal cutoffs applied to every aircraft (not illustrative examples), anchored to real reference numbers where they exist:
- **0.5° (30 arcmin)** for *Certainly visible* is the Moon/Sun's own apparent diameter as seen from Earth (~29–33 arcmin, averaging ~31) — an independently verifiable "you couldn't miss this" reference size.
- **1 arcminute (0.0167°)** is the standard 20/20 visual-acuity resolving power. The two lower dividers are small multiples of that: ~3 arcmin (0.05°, *Possibly visible*) for "large enough to register as a contrasty shape once you're looking at the right bearing," ~10 arcmin (0.167°, *Likely visible*) for "large enough to actually resolve as a recognisable aircraft, not just a mark." These two are a principled vision-science estimate rather than a single peer-reviewed figure for this exact scenario.

Additional rules (`src/logic/visibility.js`):
- Aircraft beyond 40 NM slant range: capped at *Possibly visible*, regardless of angular size (haze/curvature at that range isn't modelled, so confidence isn't overstated).
- Aircraft within 1 NM and below 500 ft: always *Certainly visible*, even a small aircraft whose wingspan alone wouldn't cross the 0.5° threshold.
- Aircraft not updated in the last 20 seconds (fixed threshold, independent of `STALE_THRESHOLD_SECONDS` above) have their category degraded by one step.
- Elevation > 70° is labelled "overhead" in the detail popup's bearing field, and overrides the symbol shape to an upward chevron (see Symbols below) — it does not change where the indicator is drawn on screen.

**Live METAR conditions** (`src/logic/metarProvider.js`): when a current METAR is available for the nearest station (`aviationweather.gov`, free, no key — bbox search around the user's own position, refreshed every ~15 min since METARs only update roughly hourly), it adjusts the category above via two independent mechanisms, applied as the final step after everything else:
- **Cloud occlusion** — the lowest BKN/OVC/VV layer whose base sits below the aircraft's altitude. OVC/VV (overcast, or an indefinite obscured ceiling) is treated as a near-total block on line of sight — not a dimmer, a wall — forcing the bottom tier (*Very unlikely/not visible*) regardless of how large/close the aircraft would otherwise read. BKN (broken — real gaps, but contested line of sight) caps at *Possibly visible* instead of a full drop. FEW/SCT and any layer *above* the aircraft's altitude have no effect. Only the lowest qualifying layer matters — once line of sight hits one, higher layers are moot.
- **Reported prevailing visibility** — replaces the generic, always-on 40NM cap above with the day's actual reported figure, converted to nm, but only when it's meaningfully below "good" (<10SM): many stations cap their reportable value at 10SM even on much clearer days, so treating that as a real limit would make ordinary good-visibility days needlessly pessimistic for no reason.

This is strictly a scoring input — it doesn't add a weather display, a METAR readout, or any new UI surface (staying inside the app's own navigation + identification focus). Its only visible effect is that aircraft the model now believes are cloud-occluded or beyond the day's real reported visibility get downgraded, which (via the same score used everywhere else) changes their symbol/colour *and* — since `Indicators.build()` sorts and caps by that same score — their priority for the limited on-screen indicator slots when there's more relevant traffic than fits. No METAR available (fetch not yet complete, station out of range, etc.) is the same as before this existed — the whole mechanism no-ops silently. **Caveat**: built in a sandbox with no network path to `aviationweather.gov`, so parsing follows their documented JSON API shape but couldn't be checked against a live response — worth confirming once deployed. TAF and every other METAR field (wind, present-weather codes, temperature/dewpoint) were deliberately left out — see the design discussion for why (mostly redundant with, or lower-value than, the two mechanisms above for this specific purpose).

**Colour-blind-safe mode**: the toggle in Settings → Display & Accessibility (`src/colorblindMode.js`) swaps the category colours above for an Okabe-Ito-based palette (Okabe & Ito, "Color Universal Design," 2008 — the standard reference palette validated as pairwise-distinguishable under protanopia/deuteranopia), each with its own day-theme-darkened variant, same treatment as the normal palette's `colorDay`. This alternate palette makes no attempt to echo real TCAS colour — it's picked purely for hue-separation science: blue for the diamond family, yellow for the circle family, reddish-purple for the square family, chosen for maximum pairwise separation under the common red-green deficiencies (~8% of men). Deliberately one toggle, not several per-deficiency-type modes — an affected user wants something that works, not a menu of subtypes to self-diagnose into. Independent of which palette is active, shape and fill remain the primary encoding — a square reads as "certainly visible" and a hollow diamond as "very unlikely" by outline alone, a redundant, hue-independent channel covering the rarer cases a colour swap alone can't (tritanopia, full achromatopsia), and helping everyone in bright glare where hue discrimination itself degrades. Persisted in localStorage, applies to both NAV and AIR mode.

---

## Relevance Filtering (TCAS-style)

NAV mode doesn't just rank aircraft by visibility — it filters by relevance first (`src/logic/relevance.js`), modelled on how TCAS's own coverage is illustrated: a teardrop, not a symmetric arc. Long and wide ahead, pinched at the sides, with a small residual allowance directly behind, rather than a hard angular cutoff.

An aircraft is relevant if:
- it's nearly overhead (elevation > 70° — a plan-view bearing test doesn't mean anything looking straight up), or
- it's currently within the teardrop boundary for its bearing (closer required at the sides/behind than dead ahead), or
- projecting both the user's and the aircraft's motion forward a few seconds puts it inside the teardrop even though it isn't yet — i.e. it's converging into view.

Only relevant aircraft reach the visibility-score sort/display stage; everything else — mostly things behind you that aren't converging — is filtered out before ranking ever happens. This re-evaluates on every GPS update, so turning immediately reshuffles what's shown, with no smoothing or lag.

**Symbols** (`src/aircraftSymbol.js`): shape+fill is primarily the sightability tier (see Visibility Categories above). Relevance *reason* is a secondary modifier layered on top of that tier shape:

| Relevance reason | Modifier |
|-------|---------|
| Currently within the teardrop | None — plain tier shape/stroke |
| Predicted to converge into view | Dashed stroke on the tier shape (not yet current) |
| Overhead override | Shape replaced entirely by an upward chevron, regardless of tier — a "look up" cue, not a bearing cue |

AIR mode doesn't compute relevance at all (it's intentionally unfiltered), so every AIR marker just shows its tier shape with no dashed/overhead modifier.

**Position** (`Geo.projectToPolarPosition()`, `src/logic/geo.js`): NAV indicators are a true polar plot, not an edge frame — bearing maps to angle and distance maps to radius from an anchor point near the bottom of the screen (the same anchor the 3D camera itself uses), so closer traffic plots nearer to you and farther traffic plots farther out, rather than every aircraft regardless of range being jammed onto the frame edge. The radius scale is tied to the relevance teardrop's own dead-ahead range (`Relevance.DEFAULTS.rMaxNm`), so an indicator at the outer edge of the plot really is near the edge of relevance for that bearing. `Indicators.declutter()` now resolves genuine 2D proximity (any two indicators closer than the minimum gap get pushed apart along the line between them, over a few passes) rather than only spreading indicators sharing one screen edge, since polar-plotted indicators can end up close in any direction, not just along a shared edge.

**Direction of travel**: each indicator with a known ground track (`trackDeg`) also draws a small arrow showing which way that aircraft is currently moving, relative to your own heading-up view (NAV) or true north (AIR, since that map is always north-up) — a lead cue for where to keep looking next, not just where the aircraft is right now. Aircraft not transmitting a track show no arrow rather than a guessed one.

**Display cap & overflow**: NAV shows at most 5/7/10 indicators depending on viewport width; AIR mode is unrestricted. When more relevant aircraft exist than fit, the aircraft-count readout becomes a tappable "X of Y shown — tap for more" control that pages through the ranked list. Manual only — no automatic rotation, since an automatically-changing display was judged a driving distraction in its own right.

**Suppression**: the popup's Suppress button hides an aircraft from NAV for `SUPPRESS_DURATION_SECONDS`, freeing its slot for the next-ranked one. Deliberately a separate, explicit action — not a side effect of viewing the popup — and applies uniformly; no relevance reason is exempt from being suppressed.

**Ground/low-altitude clutter suppression**: aircraft with a known altitude below a threshold are dropped before either mode ever sees them. Adjustable live via Settings → Traffic Filtering — no redeploy needed, persists across reloads (`src/altitudeSuppressPanel.js`). `config.js`'s `SUPPRESS_LOW_ALTITUDE_ENABLED`/`SUPPRESS_LOW_ALTITUDE_FT` are only the out-of-the-box starting values now, defaulting off. This is barometric altitude (MSL), not height above you — see the config reference above. Prefers GPS/geometric altitude (`alt_geom`) over barometric when both are present, since `alt_geom` isn't affected by local air pressure the way barometric altitude is without a QNH correction (not implemented).

**Ground traffic and non-aircraft contacts**: ADS-B reports ground status as the literal string `"ground"` in place of a numeric altitude while an aircraft is parked/taxiing (`normaliseAircraft.js` captures this explicitly as `onGround`, rather than losing it to `parseFloat`) — suppressible via a dedicated toggle in the ALT panel menu, separate from the numeric threshold above, defaulting on. Ground service vehicles and fixed obstacles (ADS-B emitter categories C1-C5) are filtered unconditionally, no toggle — they're never aircraft.

---

## Routing & Navigation Camera

Tapping 📍 arms destination-picking, opening a banner with a search box, a "tap the map" hint, and the transport-mode picker (🚗 driving / 🚲 cycling / 🚶 walking, persisted across reloads). Either path lands on the same target-acquisition step:

- **Search by name/address** — `src/routing/orsGeocoder.js` queries [OpenRouteService's Geocoding API](https://openrouteservice.org/dev/#/api-docs/geocode/search/get) (Pelias-based; the same `CONFIG.ORS_API_KEY` already used for routing covers it too, no separate key needed), debounced 350ms as you type (or immediately on Enter), biased toward your current position (`focus.point`) so a same-named place near you outranks one across the country. Results render as a tappable list; picking one requests the route immediately, same as a map tap does.
- **Tap the map** — the next click/tap on the map itself supplies the target directly.

Either way, `requestRouteTo(lat, lon, label)` (`src/app.js`) requests a route from OpenRouteService to that point in the selected mode — a search result's real place name becomes the route card's destination label; a map tap falls back to raw coordinates, since it has nothing else to show. The route renders as a 3-layer glow/line/highlight polyline (`src/map.js`), with ETA and distance shown in a bottom card. A button on that card also toggles turn-by-turn text on/off, independent of the route line.

While a route is active, `src/navigation/navigationCameraEvaluator.js` drives the 3D camera through a small state machine, hysteresis-gated by speed and a minimum dwell time to avoid flicker:

| State | When |
|-------|------|
| `NAV_IDLE` | No route active |
| `URBAN_GUIDANCE` | Route active, under ~53 mph |
| `HIGHWAY_GUIDANCE` | Route active, sustained speed above ~53 mph |
| `TURN_APPROACH` | A turn ≥25° is detected within the current lookahead distance |

Each state has its own pitch/zoom/anchor baseline, and the camera's forward-look point is traced along the actual route polyline (not a straight line off heading), so it stays correct through curves.

**Caveat**: these speed thresholds (and `GPS_HEADING_MIN_SPEED_MPH`) were tuned around driving. Now that cycling/walking routing exists, walking-pace testing may show `NAV_IDLE`/`URBAN_GUIDANCE` behaving oddly at single-digit mph — likely needs its own tuning pass once there's real walking-speed field data.

**Guidance card text** (`src/navigation/maneuverTracker.js`): live turn-by-turn instruction, not a placeholder — `ManeuverTracker.nextManeuver()` reads OpenRouteService's own turn-by-turn steps (`orsProvider.js` now keeps `properties.segments[].steps[]` from the Directions response, previously discarded) to find which step the user is currently on and announce the *next* one: real instruction text and street name from ORS itself (e.g. "Turn right onto Oak Avenue"), with a live distance countdown computed from the user's actual snapped position via `RouteGeometry.distanceToIndex()` — not ORS's own per-step distance, which is static from route-request time. The maneuver icon rotates/swaps per ORS's numeric maneuver type code (left/right/sharp/slight/roundabout/u-turn/arrive), independent of `NavigationCameraEvaluator`'s own bearing-delta turn detector, which still drives the camera's `TURN_APPROACH` zoom-in — that one only decides *when the camera frames a turn*, not what the card says. If a route somehow has no usable steps (an unexpected ORS response shape), the card falls back to the camera's own geometric left/right detection rather than going blank. **Caveat**: ORS's steps schema (maneuver type codes, `way_points` indexing) is long-stable and well-documented, but this implementation could not be verified against a *live* ORS response — the sandbox it was built in has no network path to `api.openrouteservice.org` — so it's worth confirming instruction text and street names actually appear correctly on a real route before trusting it fully.

---

## Theme (Day / Night / Auto)

`src/map/themeManager.js` resolves Day/Night/Auto to a concrete palette for both the map style and UI. In Auto mode, Day is 07:00–19:00 local time; a 60-second timer re-checks the clock so the switch happens without a reload.

---

## Settings Screen

The **⚙** button (top-right, next to the ADS-B status pill) opens a full-screen settings overlay, separate from the primary driving/spotting view. Everything in it is a "configure occasionally" preference; everything that stays on the primary screen instead (mode switching, routing, aircraft popups, the LOG panel) is something used in-the-moment while actually driving or spotting. Current sections:

- **Display & Accessibility** — Day/Auto/Night theme, colour-blind-safe palette toggle (NAV display style — Hybrid/Raw — lives on the main screen's mode row, not here)
- **Traffic Filtering** — hide-aircraft-on-the-ground toggle, low-altitude suppression threshold presets
- **Data & Logging** — export buffered ground-truth observations

The underlying state modules (`src/altitudeSuppressPanel.js`, `src/colorblindMode.js`, `src/map/themeManager.js`) are UI-agnostic — the settings screen just renders controls against their existing `get*()`/`set*()` API. `src/navDisplayStyle.js` is the same kind of module but is no longer rendered here at all — its controls (HYBRID/RAW) moved to the primary screen's mode row, since it's an in-the-moment choice like mode switching itself, not an occasional preference; `app.js` calls its `get*()`/`set*()` API directly instead.

---

## Developer Tools (hidden)

**VIEW** (viewport emulation — preview the app at fixed device dimensions, phone portrait/landscape, and a wide "Auto" Android-Auto-head-unit profile, without deploying to a real device; scales `#viewport-dev-frame` via CSS transform so `position:fixed` UI scopes to the emulated frame) and **SPD** (override GPS speed with a fixed value, to test speed-gated behaviour — turn-by-turn detection, the camera's `HIGHWAY_GUIDANCE` state, the GPS-vs-compass heading trust threshold — without actually moving) aren't end-user features, just scaffolding for verifying behaviour that needs real movement/device diversity to trigger.

Neither is on the primary screen or in the real Settings screen (see below) — they're reachable only by tapping the **VCAS** brand mark in the top bar 7 times within 3 seconds (`src/devMode.js`), the same convention Android itself uses for unlocking its own developer options. Toggling it reloads the page; state persists in localStorage (`vcas-dev-mode`) until you do the same gesture again.

---

## Ground-Truth Log Panel

The **LOG** button (bottom-left, always visible) opens a list of *every* currently-tracked aircraft — not just the ones NAV is showing, including ones the relevance filter excluded, since logging "the algorithm was wrong to hide this" is exactly the point. Each row has four outcome buttons:

| Button | Meaning |
|--------|---------|
| ✈ | Visible — airframe |
| 〜 | Visible — contrail only |
| ▨ | Not visible — obstruction (building/terrain in the way) |
| ✕ | Not visible — just not seen |

Tapping one logs a full snapshot — your position/heading/speed, the aircraft's position/altitude/track, the computed visibility score and relevance reason, and your outcome — as one line in a JSON Lines log (one JSON object per line, easy to append to and easy to load into pandas/jq/a spreadsheet later).

**Where it goes**: `src/dev/observationLogger.js` POSTs to `CONFIG.LOG_ENDPOINT` (`src/config.js`) when one is configured — a real internet endpoint, so every device (phone, PC, whatever's actually running the deployed GitHub Pages app) logs to the exact same central place automatically, no manual export/sync between devices. `CONFIG.LOG_ENDPOINT_KEY` is sent as an `X-VCAS-Key` header on every request; it's a low-effort filter against random bots hitting the endpoint blindly, not real security — this is a static site, so both values ship to every visitor's browser and can be read from the deployed JS. When `LOG_ENDPOINT` is left blank, it falls back to the old relative `/api/log`, which only resolves to anything when running `logServer.py` locally instead of a plain static server (see Quick Start above) — useful for local dev without touching config.js.

If neither is reachable (offline, endpoint down, or nothing configured and `logServer.py` isn't running), observations aren't lost — `ObservationLogger` falls back to buffering them in `localStorage`. Exporting those buffered observations as a downloadable `.jsonl` file is in the **Settings** screen (see below), not this panel — logging a sighting is an in-the-moment action, exporting the backlog is an occasional/administrative one.

**Why this exists:** the current visibility model is angular-size-only and has no concept of contrails, cloud, haze, or terrain occlusion — real spotting can diverge from what the app predicts in ways the model can't currently explain (e.g. a high, distant aircraft trailing a contrail being far more conspicuous than a closer one in dry air). This panel is how that gap gets measured before it gets modelled.

`logs/` is gitignored — it will contain real GPS coordinates and timestamps and must never be committed.

---

## File Structure

```
/VCAS
  index.html                        Entry point — script load order matters
  README.md
  generate_tree.py                  Local dev utility (not part of the app)
  logServer.py                      Static server + POST/GET /api/log — local-dev fallback when CONFIG.LOG_ENDPOINT isn't set
  .gitignore                        Excludes logs/ (real GPS data) and OS/Python cruft
  /src
    app.js                          Main controller: GPS loop, mode switching, fetch loop, routing UI
    config.js                       All configurable constants
    map.js                          MapLibre wrapper: init, theme, markers, route layer
    ui.js                           Rendering: indicators, popups, status pills
    aircraftSymbol.js               Shared diamond/circle/chevron SVG icon factory
    altitudeSuppressPanel.js        In-app ALT threshold + hide-ground-aircraft control
    colorblindMode.js               Colour-blind-safe palette toggle state
    devMode.js                      Hidden VIEW/SPD unlock state (7-tap brand gesture)
    navDisplayStyle.js              NAV display style state (Hybrid / Raw)
    wakeLock.js                     Screen Wake Lock wrapper — keeps the screen on during NAV mode
    /data
      adsbExchangeClient.js         ADS-B provider adapter (airplanes.live / ADS-B Exchange)
      normaliseAircraft.js          Raw provider response → internal aircraft object
    /logic
      geo.js                        Bearing, distance, polar screen-position projection, forward-position projection
      visibility.js                 Angular size & detectability scoring (+ live METAR cloud/visibility adjustment)
      metarProvider.js              Nearest-METAR fetch/cache — feeds visibility.js only, no display surface
      relevance.js                  TCAS-style teardrop relevance gate (what's worth showing at all)
      indicators.js                 Driving-view aircraft ranking/filtering (relevance + suppression + sort)
    /map
      cameraController.js           Owns MapLibre camera state; bridges NavigationCameraEvaluator to the map
      navStyle.js                   Vector basemap style factory (day/night palettes, 31 layers)
      themeManager.js               Day/Night/Auto resolution
    /navigation
      navigationCameraEvaluator.js  Pure state machine: driving context → camera targets
      maneuverTracker.js            ORS turn-by-turn steps → guidance card's live instruction/distance
    /sensors
      compassHeading.js             Device-compass heading fallback for stationary/slow GPS
    /routing
      routingProvider.js            Abstract routing provider interface
      orsProvider.js                OpenRouteService adapter (driving/cycling/walking profiles)
      orsGeocoder.js                OpenRouteService geocoding (destination search by name/address)
      routeGeometry.js              Polyline nearest-point / forward-projection math
    /dev
      viewportDevPanel.js           Dev-only device-size emulator overlay
      observationLogger.js          POSTs to CONFIG.LOG_ENDPOINT (falls back to /api/log, then localStorage)
      logPanel.js                   Dev-only ground-truth logging UI (LOG button)
    /styles
      VCAS.css                      All styles
```

---

## Known Limitations (V1)

- **No build step / bundler** — all scripts loaded separately in dependency order via `<script>` tags; fine for prototype use, fragile to reorder.
- **Heading** — uses GPS course-over-ground when moving above `GPS_HEADING_MIN_SPEED_MPH`; falls back to the device compass (`src/sensors/compassHeading.js`) below that threshold, so heading keeps updating while stopped or crawling through a junction/roundabout — exactly where the relevance filter's "reshuffle on turn" behaviour matters most. Compass heading is magnetic, not true north (a few degrees off depending on region), and phone magnetometers are prone to drift/interference; the Android landscape-mount screen-rotation correction is derived from documentation and needs real-device confirmation. iOS requires a one-tap permission grant (banner shown automatically when needed); on unsupported browsers/desktop this silently does nothing and heading behaves exactly as before.
- **Visibility model** — flat terrain, daylight assumptions only; no terrain occlusion. Live METAR cloud-occlusion and reported-visibility adjustments now exist (see Visibility Categories above) when a nearby station has current data, but there's still **no contrail modelling** — angular size vs. slant range plus METAR conditions drives the score, but a high, distant aircraft trailing a contrail can be far more conspicuous than a closer one in dry air, and a METAR only describes conditions at the reporting station, not necessarily exactly where the aircraft is. See the Ground-Truth Log Panel section above for how this gap is being measured.
- **ADS-B coverage** — depends on feeder network; remote areas may have gaps.
- **CORS** — if a chosen ADS-B provider blocks direct browser requests, a small local proxy will be needed.
- **Relevance prediction assumes straight-line motion** — both the user's and each aircraft's projected position over the lookahead window are simple heading-based projections, not route-following (for the user) or track-curving (for aircraft). Reasonable over the short window used, but not exact through a turn.
- **Ground/low-altitude suppression is sea-level-referenced, not true height-above-you** — see the caveat in `config.js`.

---

## Future Extension Points

- Derive the altitude suppression threshold from GPS altitude as a live local-ground-level estimate, instead of the fixed sea-level value Settings currently sets manually.
- METAR-based QNH correction for aircraft that only report barometric altitude (no `alt_geom`) — parse the nearest METAR's altimeter setting, apply the standard ~27-30ft/hPa correction. Deferred in favor of the simpler, dependency-free GPS-altitude-preference fix already in place, which covers most modern transponders — though `src/logic/metarProvider.js`'s nearest-station fetch (added for cloud-occlusion/visibility scoring) already does the hard part now, so this would mostly be parsing one more field (`altim`) off data already being fetched, not new infrastructure.
- Verify the Android compass landscape-mount correction against a real device, and consider a magnetometer calibration prompt if readings prove erratic in the field.
- Local SDR receiver adapter (new `RoutingProvider`-style adapter alongside `adsbExchangeClient.js`).
- Contrail-aware visibility scoring — likely via the free, no-key [Open-Meteo](https://open-meteo.com/) pressure-level API (temperature/humidity at flight altitude) feeding a Schmidt-Appleman-criterion check into `Visibility.estimate()`, or Google's purpose-built [Contrails API](https://developers.google.com/contrails) (free but requires a Google Cloud API key) as a higher-accuracy alternative. The Ground-Truth Log Panel exists to build the evidence for whether this is worth the integration effort before committing to it.
- Terrain obstruction model.
- PWA manifest + service worker for offline map tiles.
- Android APK wrapper via Capacitor or similar.
- Voice callout: "Traffic, 2 o'clock, A320, 12 miles."
