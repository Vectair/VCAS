/**
 * Normalise raw ADS-B v2-format API response into Eos internal aircraft objects.
 * All provider-specific field names are contained here.
 * Compatible with Airplanes.live and ADS-B Exchange v2 responses.
 */

function normaliseAircraft(raw) {
  if (!raw || typeof raw !== "object") return null;

  const hex = (raw.hex || raw.icao || "").toUpperCase().trim();
  if (!hex) return null;

  const callsign = (raw.flight || raw.callsign || "").trim() || null;
  // raw.t = aircraft type code (A320, B738…); raw.type on Airplanes.live is
  // the ADS-B message source type ("adsb_icao" etc.) — check raw.t first.
  const type = (raw.t || raw.aircraft_type || "").trim() || null;

  const lat = parseFloat(raw.lat);
  const lon = parseFloat(raw.lon);
  if (isNaN(lat) || isNaN(lon)) return null;

  const altBaro = parseFloat(raw.alt_baro ?? raw.altitude ?? raw.alt ?? NaN);
  const altGeom = parseFloat(raw.alt_geom ?? NaN);
  const altitudeFt = !isNaN(altBaro) ? altBaro : !isNaN(altGeom) ? altGeom : null;

  const trackDeg = parseFloat(raw.track ?? raw.true_heading ?? NaN);
  const groundSpeedKt = parseFloat(raw.gs ?? raw.speed ?? NaN);
  const verticalRateFpm = parseFloat(raw.baro_rate ?? raw.geom_rate ?? raw.vert_rate ?? NaN);

  // seen_pos = Airplanes.live field; seen = ADS-B Exchange field
  const seen = parseFloat(raw.seen_pos ?? raw.seen ?? raw.last_seen ?? 0);
  const lastSeenSeconds = isNaN(seen) ? 0 : seen;

  const category = (raw.category || "").trim() || null;
  const registration = (raw.r || raw.registration || "").trim() || null;

  return {
    hex,
    callsign,
    type,
    lat,
    lon,
    altitudeFt: isNaN(altitudeFt) ? null : altitudeFt,
    trackDeg: isNaN(trackDeg) ? null : trackDeg,
    groundSpeedKt: isNaN(groundSpeedKt) ? null : groundSpeedKt,
    verticalRateFpm: isNaN(verticalRateFpm) ? null : verticalRateFpm,
    lastSeenSeconds,
    category,
    registration,
  };
}

if (typeof module !== "undefined") module.exports = { normaliseAircraft };
