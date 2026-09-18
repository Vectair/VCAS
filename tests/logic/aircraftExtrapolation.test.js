/**
 * Real-execution checks for src/logic/aircraftExtrapolation.js —
 * dead-reckons aircraft lat/lon between ADS-B polls using each aircraft's
 * own reported ground speed/track. See CLAUDE.md's "Architecture map"
 * entry for why this exists (a fast/close aircraft glides between the 3s
 * polls instead of visibly teleporting) and the "Power efficiency pass"
 * entry for how it's driven (a separate 500ms render tick).
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo, AircraftExtrapolation } = loadLogic();
const t = createSuite("aircraftExtrapolation.js");

function aircraft(overrides) {
  return Object.assign({
    hex: "abc123", callsign: "TEST1", type: "B738",
    lat: 51.5, lon: -0.12, altitudeFt: 5000, onGround: false,
    trackDeg: 90, groundSpeedKt: 300, verticalRateFpm: 0,
    lastSeenSeconds: 1, category: "A3", registration: "G-TEST",
    isGroundVehicleOrObstacle: false,
  }, overrides);
}

// ---- early-return guards: same instance back (assertSame-style, via identity) ----
{
  const noSpeed = aircraft({ groundSpeedKt: null });
  t.ok(AircraftExtrapolation.extrapolate(noSpeed, 10, 60) === noSpeed,
    "missing groundSpeedKt returns the exact same instance, not a reconstructed copy");

  const noTrack = aircraft({ trackDeg: null });
  t.ok(AircraftExtrapolation.extrapolate(noTrack, 10, 60) === noTrack,
    "missing trackDeg returns the exact same instance");

  const onGround = aircraft({ onGround: true });
  t.ok(AircraftExtrapolation.extrapolate(onGround, 10, 60) === onGround,
    "on-ground aircraft returns the exact same instance (no straight-line projection across taxiways)");

  const ac = aircraft();
  t.ok(AircraftExtrapolation.extrapolate(ac, 0, 60) === ac,
    "elapsedSeconds of exactly 0 returns the exact same instance");

  t.ok(AircraftExtrapolation.extrapolate(ac, -5, 60) === ac,
    "a negative elapsedSeconds clamps to 0 and returns the exact same instance");
}

// ---- exact numeric cross-checks against Geo.destinationPoint directly ----
{
  const ac = aircraft({ lat: 51.5, lon: -0.12, trackDeg: 45, groundSpeedKt: 400 });
  const elapsed = 12;
  const expectedDistM = 400 * 0.514444 * elapsed;
  const expectedDest = Geo.destinationPoint(51.5, -0.12, 45, expectedDistM);
  const result = AircraftExtrapolation.extrapolate(ac, elapsed, 60);
  t.eq(result.lat, expectedDest.lat, "un-clamped extrapolation matches Geo.destinationPoint exactly (lat)");
  t.eq(result.lon, expectedDest.lon, "un-clamped extrapolation matches Geo.destinationPoint exactly (lon)");

  // Beyond maxElapsedSeconds: uses the CAPPED distance, genuinely differing
  // from what the uncapped distance would have produced.
  const capped = AircraftExtrapolation.extrapolate(ac, 500, 60);
  const expectedCappedDest = Geo.destinationPoint(51.5, -0.12, 45, 400 * 0.514444 * 60);
  t.eq(capped.lat, expectedCappedDest.lat, "beyond maxElapsedSeconds uses the capped distance (lat)");
  t.eq(capped.lon, expectedCappedDest.lon, "beyond maxElapsedSeconds uses the capped distance (lon)");
  const uncappedWouldBeDest = Geo.destinationPoint(51.5, -0.12, 45, 400 * 0.514444 * 500);
  t.ok(capped.lat !== uncappedWouldBeDest.lat || capped.lon !== uncappedWouldBeDest.lon,
    "the capped result genuinely differs from what the uncapped distance would have produced (real clamping, not coincidence)");

  // Exact-at-the-cap boundary.
  const atCap = AircraftExtrapolation.extrapolate(ac, 60, 60);
  t.eq(atCap.lat, expectedCappedDest.lat, "exactly at maxElapsedSeconds matches the capped-distance result (lat)");
  t.eq(atCap.lon, expectedCappedDest.lon, "exactly at maxElapsedSeconds matches the capped-distance result (lon)");
}

// ---- field preservation: only lat/lon change ----
{
  const ac = aircraft({ callsign: "PRESERVE1", altitudeFt: 37000, category: "A5", registration: "N12345" });
  const result = AircraftExtrapolation.extrapolate(ac, 5, 60);
  t.eq(result.hex, ac.hex, "hex is preserved");
  t.eq(result.callsign, ac.callsign, "callsign is preserved");
  t.eq(result.type, ac.type, "type is preserved");
  t.eq(result.altitudeFt, ac.altitudeFt, "altitudeFt is preserved");
  t.eq(result.category, ac.category, "category is preserved");
  t.eq(result.registration, ac.registration, "registration is preserved");
  t.eq(result.trackDeg, ac.trackDeg, "trackDeg is preserved");
  t.eq(result.groundSpeedKt, ac.groundSpeedKt, "groundSpeedKt is preserved");
  t.ok(result.lat !== ac.lat || result.lon !== ac.lon, "lat/lon actually changed (sanity check the extrapolation ran)");
}

// ---- extrapolateAll: independent per-element handling, order preserved ----
{
  const noTrack = aircraft({ hex: "notrack", trackDeg: null });
  const onGround = aircraft({ hex: "ground", onGround: true });
  const flying = aircraft({ hex: "flying", lat: 40, lon: -3, trackDeg: 180, groundSpeedKt: 250 });
  const list = [noTrack, onGround, flying];
  const results = AircraftExtrapolation.extrapolateAll(list, 10, 60);

  t.eq(results.length, 3, "extrapolateAll preserves the list length");
  t.ok(results[0] === noTrack, "extrapolateAll: no-track aircraft held at its original instance");
  t.ok(results[1] === onGround, "extrapolateAll: on-ground aircraft held at its original instance");
  t.ok(results[2] !== flying, "extrapolateAll: the flying aircraft got a real new extrapolated object");
  t.eq(results[2].hex, "flying", "extrapolateAll preserves order (flying aircraft still 3rd)");

  t.eq(AircraftExtrapolation.extrapolateAll([], 10, 60).length, 0, "extrapolateAll on an empty list returns an empty list");
}

t.done();
