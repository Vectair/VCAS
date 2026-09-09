/**
 * Normalise raw ADS-B v2-format API response into Eos internal aircraft objects.
 * All provider-specific field names are contained here.
 * Compatible with ADS-B Exchange v2-style responses, the schema convention
 * shared across this ecosystem's community providers (adsb.fi, ADSB.lol,
 * ADS-B Exchange itself).
 */

// ADS-B emitter categories (DO-260B) that are never aircraft: ground service/
// emergency vehicles (C1/C2) and fixed obstacles like cranes or tethered
// balloons (C3-C5). Filtered unconditionally — there's no "maybe you want to
// see a service truck" case for an app about spotting aircraft.
const NON_AIRCRAFT_CATEGORIES = new Set(["C1", "C2", "C3", "C4", "C5"]);

function normaliseAircraft(raw) {
  if (!raw || typeof raw !== "object") return null;

  const hex = (raw.hex || raw.icao || "").toUpperCase().trim();
  if (!hex) return null;

  const callsign = (raw.flight || raw.callsign || "").trim() || null;
  // raw.t = aircraft type code (A320, B738…); some providers' raw.type is
  // instead the ADS-B message source type ("adsb_icao" etc.) — check raw.t
  // first to avoid picking that up by mistake.
  const type = (raw.t || raw.aircraft_type || "").trim() || null;

  const lat = parseFloat(raw.lat);
  const lon = parseFloat(raw.lon);
  if (isNaN(lat) || isNaN(lon)) return null;

  // alt_baro is a number in flight, but the literal string "ground" while
  // parked/taxiing (readsb/dump1090-family convention that both providers
  // use) — parseFloat("ground") silently becomes NaN, which used to
  // collapse indistinguishably into "altitude unknown," making ground
  // traffic invisible to every altitude-based filter. Capture it explicitly
  // instead of losing it.
  const rawAltBaro = raw.alt_baro ?? raw.altitude ?? raw.alt;
  const onGround = typeof rawAltBaro === "string" && rawAltBaro.trim().toLowerCase() === "ground";

  const altBaro = onGround ? NaN : parseFloat(rawAltBaro ?? NaN);
  const altGeom = parseFloat(raw.alt_geom ?? NaN);
  // Prefer GPS/GNSS-derived geometric altitude over barometric — alt_baro
  // assumes the standard 1013.25hPa pressure setting and can be off by
  // 500ft+ in real weather without a QNH correction (which we don't do);
  // alt_geom isn't affected by pressure at all. Falls back to alt_baro for
  // aircraft whose transponder doesn't transmit alt_geom.
  const altitudeFt = !isNaN(altGeom) ? altGeom : !isNaN(altBaro) ? altBaro : null;

  const trackDeg = parseFloat(raw.track ?? raw.true_heading ?? NaN);
  const groundSpeedKt = parseFloat(raw.gs ?? raw.speed ?? NaN);
  const verticalRateFpm = parseFloat(raw.baro_rate ?? raw.geom_rate ?? raw.vert_rate ?? NaN);

  // seen_pos / seen — provider-specific field naming variants for the same
  // "seconds since last position update" value
  const seen = parseFloat(raw.seen_pos ?? raw.seen ?? raw.last_seen ?? 0);
  const lastSeenSeconds = isNaN(seen) ? 0 : seen;

  const category = (raw.category || "").trim().toUpperCase() || null;
  const registration = (raw.r || raw.registration || "").trim() || null;
  const isGroundVehicleOrObstacle = category != null && NON_AIRCRAFT_CATEGORIES.has(category);

  // dbFlags — a readsb/tar1090-family bitfield (bit0=military, bit1=
  // "interesting", bit2=PIA, bit3=LADD; confirmed against readsb's own
  // source, wiedehopf/readsb's README-json.md + api.c/track.c). Only bit0
  // (military) is used anywhere in this app, for the OAT-vs-GAT traffic-
  // rules condition (see src/logic/trafficRules.js). adsb.fi runs the same
  // readsb server software this bitfield comes from, but whether ITS
  // specific v3 API actually passes dbFlags through was NOT verified
  // against a live response (this sandbox can't reach opendata.adsb.fi) —
  // tri-state on purpose: `null` ("unknown") when the field is simply
  // absent from a response, never defaulted to `false`/civil, so a traffic
  // rule can't silently misclassify traffic the API gave no signal about.
  const military = typeof raw.dbFlags === "number" ? (raw.dbFlags & 1) === 1 : null;

  return {
    hex,
    callsign,
    type,
    lat,
    lon,
    altitudeFt,
    onGround,
    trackDeg: isNaN(trackDeg) ? null : trackDeg,
    groundSpeedKt: isNaN(groundSpeedKt) ? null : groundSpeedKt,
    verticalRateFpm: isNaN(verticalRateFpm) ? null : verticalRateFpm,
    lastSeenSeconds,
    category,
    registration,
    isGroundVehicleOrObstacle,
    military,
  };
}

if (typeof module !== "undefined") module.exports = { normaliseAircraft };
