# VCAS V1 — Personal ADS-B Visibility Prototype

A mobile-first web app that answers: **"Which aircraft around me are likely visible, and in what direction should I look?"**

VCAS runs in Android Chrome (or any modern browser) and displays nearby aircraft as glanceable edge indicators over a dark road-map — similar in spirit to Google Maps night mode with a layer of airspace awareness.

---

## Quick Start

### 1. Configure

Open `src/config.js` and fill in your credentials:

```js
const CONFIG = {
  ADSB_API_KEY:  "your-key-here",
  ADSB_API_HOST: "adsbexchange.com",
  ...
};
```

The app loads and shows GPS/map even with no key; ADS-B data requires a valid key.

### 2. Run locally

The app is plain HTML/JS/CSS with no build step.  Any static file server works:

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
| **Driving (NAV)** | NAV | Dark road map, user position near bottom, aircraft shown as edge indicators |
| **Airspace (AIR)** | AIR | Top-down map with aircraft plotted directly as icons |

Tap any edge indicator or aircraft icon to open a detail popup (auto-dismisses after 4 s).

---

## Configuration Reference

| Key | Default | Description |
|-----|---------|-------------|
| `ADSB_API_KEY` | `""` | ADS-B Exchange API key |
| `ADSB_API_HOST` | `"adsbexchange.com"` | API host (swap to test against a local proxy) |
| `DEFAULT_RANGE_NM` | `20` | Radius to query, in nautical miles |
| `REFRESH_INTERVAL_SECONDS` | `10` | How often to poll ADS-B |
| `MAX_AIRCRAFT_SHOWN` | `8` | Max indicators in driving view |
| `STALE_THRESHOLD_SECONDS` | `20` | Aircraft older than this are dimmed |
| `REMOVE_THRESHOLD_SECONDS` | `60` | Aircraft older than this are dropped |
| `MIN_LABEL_VISIBILITY_SCORE` | `30` | Reserved for future label filtering |
| `GPS_HEADING_MIN_SPEED_MPH` | `5` | Min speed before GPS course is used instead of compass |

---

## Visibility Categories

VCAS estimates how detectable an aircraft is under ideal conditions (flat terrain, no clouds, daylight):

| Colour | Category | Angular size |
|--------|----------|-------------|
| Green | Very likely visible | ≥ 1.0° |
| Green (lighter) | Likely visible | 0.35° – 1.0° |
| Yellow | Possible | 0.12° – 0.35° |
| Amber | Difficult | 0.05° – 0.12° |
| Grey | Unlikely | < 0.05° |

Additional rules:
- Aircraft beyond 40 NM: capped at *Difficult*.
- Aircraft within 1 NM and below 500 ft: *Very likely visible*.
- Stale data (> 20 s old): category degraded by one step.
- Elevation > 70°: shown as *overhead* indicator near top-centre.

---

## File Structure

```
/VCAS
  index.html                  Entry point
  README.md
  /src
    app.js                    Main controller
    config.js                 All configurable constants
    map.js                    Leaflet map wrapper
    ui.js                     Rendering: indicators, popup, status
    /data
      adsbExchangeClient.js   ADS-B Exchange HTTP adapter
      normaliseAircraft.js    Raw→internal object normalisation
    /logic
      geo.js                  Bearing, distance, edge projection
      visibility.js           Angular size & detectability scoring
      indicators.js           Driving view indicator sorting/filtering
    /styles
      VCAS.css                 All styles
```

---

## Known Limitations (V1)

- **No build step / bundler** — all scripts loaded separately; fine for prototype use.
- **Heading** — uses GPS course-over-ground when moving. Stationary heading is not updated (no device orientation API integration yet).
- **Visibility model** — flat terrain, clear sky, daylight assumptions only. No cloud, terrain, or haze modelling.
- **ADS-B coverage** — depends on feeder network; remote areas may have gaps.
- **No turn-by-turn navigation** — road map is for orientation only.
- **CORS** — if ADS-B Exchange blocks direct browser requests, a small local proxy will be needed.

---

## Future Extension Points

- Device orientation API for stationary heading.
- Local SDR receiver adapter (swap `adsbExchangeClient.js`).
- Weather/cloud layer overlay.
- Terrain obstruction model.
- PWA manifest + service worker for offline map tiles.
- Android APK wrapper via Capacitor or similar.
- Voice callout: "Traffic, 2 o'clock, A320, 12 miles."
