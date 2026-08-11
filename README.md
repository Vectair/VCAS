# VCAS V1 — Personal ADS-B Visibility Prototype

A mobile-first web app that answers: **"Which aircraft around me are likely visible, and in what direction should I look?"**

VCAS runs in Android Chrome (or any modern browser) and displays nearby aircraft as glanceable edge indicators over a dark, MapLibre-rendered road map — similar in spirit to Google Maps' driving mode with a layer of airspace awareness. A second mode overlays the same aircraft as plotted icons on a top-down airspace view, and a routing layer (OpenRouteService — driving/cycling/walking) can drive a Google-Maps-style tilted, route-following 3D camera.

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
the map tiles won't load, but GPS, the aircraft feed, and edge indicators
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
| **Driving (NAV)** | NAV | Tilted 3D road map, user position anchored near the bottom, aircraft shown as edge indicators |
| **Airspace (AIR)** | AIR | Top-down, north-up map with aircraft plotted directly as icons |

Tap any edge indicator or aircraft icon to open a detail popup (auto-dismisses after 4 s).

The 📍 button next to the mode row arms destination-picking — the next map tap/click
requests a route to that point, in whichever transport mode (driving/cycling/walking) is
selected in the picker banner — see [Routing & Navigation Camera](#routing--navigation-camera) below.

---

## Configuration Reference

All keys live in `src/config.js`.

| Key | Default | Description |
|-----|---------|-------------|
| `MAPTILER_KEY` | `"PASTE_YOUR_MAPTILER_KEY_HERE"` | MapTiler browser token — required for road map tiles/glyphs |
| `ORS_API_KEY` | `"PASTE_YOUR_ORS_KEY_HERE"` | Free OpenRouteService "Standard" API key — required for routing (driving/cycling/walking) |
| `REFRESH_INTERVAL_SECONDS` | `10` | How often to poll the ADS-B provider |
| `REMOVE_THRESHOLD_SECONDS` | `30` | Aircraft older than this (since last seen) are dropped entirely |
| `STALE_THRESHOLD_SECONDS` | `15` | Aircraft older than this are dimmed (`isStale`) in the driving view; also used as the hard age cutoff (3×) for which aircraft are considered at all |
| `DEFAULT_RANGE_NM` | `50` | Radius to query, in nautical miles |
| `GPS_HEADING_MIN_SPEED_MPH` | `5` | Minimum speed before GPS course-over-ground is trusted as heading |
| `SUPPRESS_DURATION_SECONDS` | `180` | How long a manually-suppressed aircraft (popup's Suppress button) stays hidden from NAV |
| `SUPPRESS_LOW_ALTITUDE_ENABLED` | `true` | Starting value only — overridden live by the ALT button (see below) once you've touched it, persisted in localStorage |
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

VCAS estimates how detectable an aircraft is under ideal conditions (flat terrain, no clouds, daylight), based on its angular size (wingspan vs. slant range):

| Colour | Category | Angular size |
|--------|----------|-------------|
| Green | Very likely visible | ≥ 1.0° |
| Green (lighter) | Likely visible | 0.35° – 1.0° |
| Yellow | Possible | 0.12° – 0.35° |
| Amber | Difficult | 0.05° – 0.12° |
| Grey | Unlikely | < 0.05° |

Additional rules (`src/logic/visibility.js`):
- Aircraft beyond 40 NM slant range: capped at *Difficult*, regardless of angular size.
- Aircraft within 1 NM and below 500 ft: always *Very likely visible*.
- Aircraft not updated in the last 20 seconds (fixed threshold, independent of `STALE_THRESHOLD_SECONDS` above) have their category degraded by one step.
- Elevation > 70° is labelled "overhead" in the detail popup's bearing field — it does not change where the indicator is drawn on screen.

---

## Relevance Filtering (TCAS-style)

NAV mode doesn't just rank aircraft by visibility — it filters by relevance first (`src/logic/relevance.js`), modelled on how TCAS's own coverage is illustrated: a teardrop, not a symmetric arc. Long and wide ahead, pinched at the sides, with a small residual allowance directly behind, rather than a hard angular cutoff.

An aircraft is relevant if:
- it's nearly overhead (elevation > 70° — a plan-view bearing test doesn't mean anything looking straight up), or
- it's currently within the teardrop boundary for its bearing (closer required at the sides/behind than dead ahead), or
- projecting both the user's and the aircraft's motion forward a few seconds puts it inside the teardrop even though it isn't yet — i.e. it's converging into view.

Only relevant aircraft reach the visibility-score sort/display stage; everything else — mostly things behind you that aren't converging — is filtered out before ranking ever happens. This re-evaluates on every GPS update, so turning immediately reshuffles what's shown, with no smoothing or lag.

**Symbols** (`src/aircraftSymbol.js`) encode *why* an aircraft is shown; the existing colour scale still independently encodes *how visible* it'll be:

| Shape | Meaning |
|-------|---------|
| Diamond | Currently within the teardrop |
| Circle | Predicted to converge into view |
| Chevron (points up) | Overhead override — a "look up" cue, not a bearing cue |

AIR mode doesn't compute relevance at all (it's intentionally unfiltered), so every AIR marker is a plain diamond.

**Display cap & overflow**: NAV shows at most 5/7/10 indicators depending on viewport width; AIR mode is unrestricted. When more relevant aircraft exist than fit, the aircraft-count readout becomes a tappable "X of Y shown — tap for more" control that pages through the ranked list. Manual only — no automatic rotation, since an automatically-changing display was judged a driving distraction in its own right.

**Suppression**: the popup's Suppress button hides an aircraft from NAV for `SUPPRESS_DURATION_SECONDS`, freeing its slot for the next-ranked one. Deliberately a separate, explicit action — not a side effect of viewing the popup — and applies uniformly; no relevance reason is exempt from being suppressed.

**Ground/low-altitude clutter suppression**: aircraft with a known altitude below a threshold are dropped before either mode ever sees them. Adjustable live via the **ALT** button (bottom-left, stacked above LOG) — no redeploy needed, persists across reloads (`src/altitudeSuppressPanel.js`). `config.js`'s `SUPPRESS_LOW_ALTITUDE_ENABLED`/`SUPPRESS_LOW_ALTITUDE_FT` are only the out-of-the-box starting values now. This is barometric altitude (MSL), not height above you — see the config reference above.

---

## Routing & Navigation Camera

Tapping 📍 arms destination-picking; the next map tap/click requests a route from [OpenRouteService](https://openrouteservice.org) to that point, in the selected transport mode (🚗 driving / 🚲 cycling / 🚶 walking — chosen in the picker banner, persisted across reloads) — there's no destination *search* yet, only tap-to-pick. The route renders as a 3-layer glow/line/highlight polyline (`src/map.js`), with ETA and distance shown in a bottom card. A button on that card also toggles turn-by-turn text on/off, independent of the route line.

While a route is active, `src/navigation/navigationCameraEvaluator.js` drives the 3D camera through a small state machine, hysteresis-gated by speed and a minimum dwell time to avoid flicker:

| State | When |
|-------|------|
| `NAV_IDLE` | No route active |
| `URBAN_GUIDANCE` | Route active, under ~53 mph |
| `HIGHWAY_GUIDANCE` | Route active, sustained speed above ~53 mph |
| `TURN_APPROACH` | A turn ≥25° is detected within the current lookahead distance |

Each state has its own pitch/zoom/anchor baseline, and the camera's forward-look point is traced along the actual route polyline (not a straight line off heading), so it stays correct through curves.

**Caveat**: these speed thresholds (and `GPS_HEADING_MIN_SPEED_MPH`) were tuned around driving. Now that cycling/walking routing exists, walking-pace testing may show `NAV_IDLE`/`URBAN_GUIDANCE` behaving oddly at single-digit mph — likely needs its own tuning pass once there's real walking-speed field data.

**Known gap:** the guidance card's turn instruction text and arrow icon are static placeholders ("Continue" / ↑) — they aren't yet derived from the real upcoming maneuver, even though `TURN_APPROACH` detection already exists internally.

---

## Theme (Day / Night / Auto)

`src/map/themeManager.js` resolves Day/Night/Auto to a concrete palette for both the map style and UI. In Auto mode, Day is 07:00–19:00 local time; a 60-second timer re-checks the clock so the switch happens without a reload.

---

## Dev Viewport Emulator

The **VIEW** button (bottom-right, always visible) lets you preview the app at fixed device dimensions — phone portrait/landscape, and a wide "Auto" (Android Auto head-unit style) profile — without deploying to a real device. It scales `#viewport-dev-frame` via CSS transform so `position:fixed` UI scopes to the emulated frame. Purely a dev tool; ships in the same build as the app.

---

## Ground-Truth Log Panel

The **LOG** button (bottom-left, always visible) opens a list of *every* currently-tracked aircraft — not just the ones NAV is showing, including ones the relevance filter excluded, since logging "the algorithm was wrong to hide this" is exactly the point. Each row has four outcome buttons:

| Button | Meaning |
|--------|---------|
| ✈ | Visible — airframe |
| 〜 | Visible — contrail only |
| ▨ | Not visible — obstruction (building/terrain in the way) |
| ✕ | Not visible — just not seen |

Tapping one logs a full snapshot — your position/heading/speed, the aircraft's position/altitude/track, the computed visibility score and relevance reason, and your outcome — as one line in `logs/observations.jsonl` (JSON Lines: one JSON object per line, easy to append to and easy to load into pandas/jq/a spreadsheet later). Requires running `logServer.py` instead of a plain static server (see Quick Start above); you can browse the accumulated log directly at `http://localhost:8080/api/log`.

If the log server isn't running (e.g. you're using plain `python -m http.server`), observations aren't lost — `src/dev/observationLogger.js` falls back to buffering them in `localStorage`, and the panel shows an "Export N buffered" button to download them as a `.jsonl` file once you do have the log server available.

**Why this exists:** the current visibility model is angular-size-only and has no concept of contrails, cloud, haze, or terrain occlusion — real spotting can diverge from what the app predicts in ways the model can't currently explain (e.g. a high, distant aircraft trailing a contrail being far more conspicuous than a closer one in dry air). This panel is how that gap gets measured before it gets modelled.

`logs/` is gitignored — it will contain real GPS coordinates and timestamps and must never be committed.

---

## File Structure

```
/VCAS
  index.html                        Entry point — script load order matters
  README.md
  generate_tree.py                  Local dev utility (not part of the app)
  logServer.py                      Static server + POST/GET /api/log (ground-truth observation persistence)
  .gitignore                        Excludes logs/ (real GPS data) and OS/Python cruft
  /src
    app.js                          Main controller: GPS loop, mode switching, fetch loop, routing UI
    config.js                       All configurable constants
    map.js                          MapLibre wrapper: init, theme, markers, route layer
    ui.js                           Rendering: indicators, popups, status pills
    aircraftSymbol.js               Shared diamond/circle/chevron SVG icon factory
    /data
      adsbExchangeClient.js         ADS-B provider adapter (airplanes.live / ADS-B Exchange)
      normaliseAircraft.js          Raw provider response → internal aircraft object
    /logic
      geo.js                        Bearing, distance, edge projection, forward-position projection
      visibility.js                 Angular size & detectability scoring
      relevance.js                  TCAS-style teardrop relevance gate (what's worth showing at all)
      indicators.js                 Driving-view aircraft ranking/filtering (relevance + suppression + sort)
    /map
      cameraController.js           Owns MapLibre camera state; bridges NavigationCameraEvaluator to the map
      navStyle.js                   Vector basemap style factory (day/night palettes, 31 layers)
      themeManager.js               Day/Night/Auto resolution
    /navigation
      navigationCameraEvaluator.js  Pure state machine: driving context → camera targets
    /sensors
      compassHeading.js             Device-compass heading fallback for stationary/slow GPS
    /routing
      routingProvider.js            Abstract routing provider interface
      orsProvider.js                OpenRouteService adapter (driving/cycling/walking profiles)
      routeGeometry.js              Polyline nearest-point / forward-projection math
    /dev
      viewportDevPanel.js           Dev-only device-size emulator overlay
      observationLogger.js          POSTs to /api/log, falls back to localStorage if unavailable
      logPanel.js                   Dev-only ground-truth logging UI (LOG button)
    /styles
      VCAS.css                      All styles
```

---

## Known Limitations (V1)

- **No build step / bundler** — all scripts loaded separately in dependency order via `<script>` tags; fine for prototype use, fragile to reorder.
- **Heading** — uses GPS course-over-ground when moving above `GPS_HEADING_MIN_SPEED_MPH`; falls back to the device compass (`src/sensors/compassHeading.js`) below that threshold, so heading keeps updating while stopped or crawling through a junction/roundabout — exactly where the relevance filter's "reshuffle on turn" behaviour matters most. Compass heading is magnetic, not true north (a few degrees off depending on region), and phone magnetometers are prone to drift/interference; the Android landscape-mount screen-rotation correction is derived from documentation and needs real-device confirmation. iOS requires a one-tap permission grant (banner shown automatically when needed); on unsupported browsers/desktop this silently does nothing and heading behaves exactly as before.
- **Visibility model** — flat terrain, clear sky, daylight assumptions only. No cloud, terrain, or haze modelling, and critically, **no contrail modelling** — angular size vs. slant range currently drives the score, but a high, distant aircraft trailing a contrail can be far more conspicuous than a closer one in dry air. See the Ground-Truth Log Panel section above for how this gap is being measured.
- **ADS-B coverage** — depends on feeder network; remote areas may have gaps.
- **Routing is a fixed demo, not real navigation** — one hardcoded destination, no destination search, turn instruction text/icon are static placeholders.
- **CORS** — if a chosen ADS-B provider blocks direct browser requests, a small local proxy will be needed.
- **Relevance prediction assumes straight-line motion** — both the user's and each aircraft's projected position over the lookahead window are simple heading-based projections, not route-following (for the user) or track-curving (for aircraft). Reasonable over the short window used, but not exact through a turn.
- **Ground/low-altitude suppression is sea-level-referenced, not true height-above-you** — see the caveat in `config.js`. Reconfiguring it currently means editing `config.js` directly; there's no in-app settings screen yet (see below).

---

## Future Extension Points

- Derive the altitude suppression threshold from GPS altitude as a live local-ground-level estimate, instead of the fixed sea-level value the ALT button currently sets manually.
- Real destination search (name/address lookup) instead of tap-to-pick-a-point-on-the-map only.
- Verify the Android compass landscape-mount correction against a real device, and consider a magnetometer calibration prompt if readings prove erratic in the field.
- Local SDR receiver adapter (new `RoutingProvider`-style adapter alongside `adsbExchangeClient.js`).
- Contrail-aware visibility scoring — likely via the free, no-key [Open-Meteo](https://open-meteo.com/) pressure-level API (temperature/humidity at flight altitude) feeding a Schmidt-Appleman-criterion check into `Visibility.estimate()`, or Google's purpose-built [Contrails API](https://developers.google.com/contrails) (free but requires a Google Cloud API key) as a higher-accuracy alternative. The Ground-Truth Log Panel exists to build the evidence for whether this is worth the integration effort before committing to it.
- Terrain obstruction model.
- PWA manifest + service worker for offline map tiles.
- Android APK wrapper via Capacitor or similar.
- Voice callout: "Traffic, 2 o'clock, A320, 12 miles."
