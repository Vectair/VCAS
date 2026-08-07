# VCAS V1 — Personal ADS-B Visibility Prototype

A mobile-first web app that answers: **"Which aircraft around me are likely visible, and in what direction should I look?"**

VCAS runs in Android Chrome (or any modern browser) and displays nearby aircraft as glanceable edge indicators over a dark, MapLibre-rendered road map — similar in spirit to Google Maps' driving mode with a layer of airspace awareness. A second mode overlays the same aircraft as plotted icons on a top-down airspace view, and a routing layer (OSRM) can drive a Google-Maps-style tilted, route-following 3D camera.

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

The ↗ button next to the mode row requests a test drive route (OSRM) to a
hardcoded destination — see [Routing & Navigation Camera](#routing--navigation-camera) below.

---

## Configuration Reference

All keys live in `src/config.js`.

| Key | Default | Description |
|-----|---------|-------------|
| `MAPTILER_KEY` | `"PASTE_YOUR_MAPTILER_KEY_HERE"` | MapTiler browser token — required for road map tiles/glyphs |
| `REFRESH_INTERVAL_SECONDS` | `10` | How often to poll the ADS-B provider |
| `REMOVE_THRESHOLD_SECONDS` | `30` | Aircraft older than this (since last seen) are dropped entirely |
| `STALE_THRESHOLD_SECONDS` | `15` | Aircraft older than this are dimmed (`isStale`) in the driving view; also used as the hard age cutoff (3×) for which aircraft are considered at all |
| `DEFAULT_RANGE_NM` | `50` | Radius to query, in nautical miles |
| `GPS_HEADING_MIN_SPEED_MPH` | `5` | Minimum speed before GPS course-over-ground is trusted as heading |

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

## Routing & Navigation Camera

Tapping ↗ requests a driving route from the public [OSRM demo API](https://router.project-osrm.org) to a **hardcoded test destination** (Liverpool John Lennon Airport) — there's no destination search yet. The route renders as a 3-layer glow/line/highlight polyline (`src/map.js`), with ETA and distance shown in a bottom card.

While a route is active, `src/navigation/navigationCameraEvaluator.js` drives the 3D camera through a small state machine, hysteresis-gated by speed and a minimum dwell time to avoid flicker:

| State | When |
|-------|------|
| `NAV_IDLE` | No route active |
| `URBAN_GUIDANCE` | Route active, under ~53 mph |
| `HIGHWAY_GUIDANCE` | Route active, sustained speed above ~53 mph |
| `TURN_APPROACH` | A turn ≥25° is detected within the current lookahead distance |

Each state has its own pitch/zoom/anchor baseline, and the camera's forward-look point is traced along the actual route polyline (not a straight line off heading), so it stays correct through curves.

**Known gap:** the guidance card's turn instruction text and arrow icon are static placeholders ("Continue" / ↑) — they aren't yet derived from the real upcoming maneuver, even though `TURN_APPROACH` detection already exists internally.

---

## Theme (Day / Night / Auto)

`src/map/themeManager.js` resolves Day/Night/Auto to a concrete palette for both the map style and UI. In Auto mode, Day is 07:00–19:00 local time; a 60-second timer re-checks the clock so the switch happens without a reload.

---

## Dev Viewport Emulator

The **VIEW** button (bottom-right, always visible) lets you preview the app at fixed device dimensions — phone portrait/landscape, and a wide "Auto" (Android Auto head-unit style) profile — without deploying to a real device. It scales `#viewport-dev-frame` via CSS transform so `position:fixed` UI scopes to the emulated frame. Purely a dev tool; ships in the same build as the app.

---

## File Structure

```
/VCAS
  index.html                        Entry point — script load order matters
  README.md
  generate_tree.py                  Local dev utility (not part of the app)
  /src
    app.js                          Main controller: GPS loop, mode switching, fetch loop, routing UI
    config.js                       All configurable constants
    map.js                          MapLibre wrapper: init, theme, markers, route layer
    ui.js                           Rendering: indicators, popups, status pills
    /data
      adsbExchangeClient.js         ADS-B provider adapter (airplanes.live / ADS-B Exchange)
      normaliseAircraft.js          Raw provider response → internal aircraft object
    /logic
      geo.js                        Bearing, distance, edge projection
      visibility.js                 Angular size & detectability scoring
      indicators.js                 Driving-view indicator sorting/filtering
    /map
      cameraController.js           Owns MapLibre camera state; bridges NavigationCameraEvaluator to the map
      navStyle.js                   Vector basemap style factory (day/night palettes, 31 layers)
      themeManager.js               Day/Night/Auto resolution
    /navigation
      navigationCameraEvaluator.js  Pure state machine: driving context → camera targets
    /routing
      routingProvider.js            Abstract routing provider interface
      osrmProvider.js               OSRM public demo API adapter
      routeGeometry.js              Polyline nearest-point / forward-projection math
    /dev
      viewportDevPanel.js           Dev-only device-size emulator overlay
    /styles
      VCAS.css                      All styles
```

---

## Known Limitations (V1)

- **No build step / bundler** — all scripts loaded separately in dependency order via `<script>` tags; fine for prototype use, fragile to reorder.
- **Heading** — uses GPS course-over-ground when moving above `GPS_HEADING_MIN_SPEED_MPH`. Stationary heading is not updated (no device orientation API integration yet).
- **Visibility model** — flat terrain, clear sky, daylight assumptions only. No cloud, terrain, or haze modelling.
- **ADS-B coverage** — depends on feeder network; remote areas may have gaps.
- **Routing is a fixed demo, not real navigation** — one hardcoded destination, no destination search, turn instruction text/icon are static placeholders.
- **CORS** — if a chosen ADS-B provider blocks direct browser requests, a small local proxy will be needed.

---

## Future Extension Points

- Real destination search instead of the hardcoded test route.
- Turn-by-turn instruction text/icon driven by the existing `TURN_APPROACH` detection.
- Device orientation API for stationary heading.
- Local SDR receiver adapter (new `RoutingProvider`-style adapter alongside `adsbExchangeClient.js`).
- Weather/cloud layer overlay.
- Terrain obstruction model.
- PWA manifest + service worker for offline map tiles.
- Android APK wrapper via Capacitor or similar.
- Voice callout: "Traffic, 2 o'clock, A320, 12 miles."
