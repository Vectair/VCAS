/**
 * Real-execution checks for src/logic/geo.js — the geodesic/projection math
 * underlying the range rings, aircraft dot placement, and RAW's plot layout.
 * See CLAUDE.md's "Camera anchor math" / "Rings and dots share one scale"
 * / "RAW-mode redesign, round 7" entries for the real bugs this file's
 * formulas have caused in the past when two callers silently disagreed
 * about them — the checks below exist to catch exactly that class of
 * regression before it ships again.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { Geo } = loadLogic();
const t = createSuite("geo.js");

// R_M/R_NM below are geo.js's own private Earth-radius constants, read
// directly from the source and replicated here for an independent,
// closed-form cross-check — not re-implementing the haversine formula,
// just the two fixed radii it scales against.
const R_M = 6371000.0;
const R_NM = 3440.065;
const DEG = Math.PI / 180;

// ---- calculateBearing: cardinal directions ----
t.approx(Geo.calculateBearing(0, 0, 1, 0), 0, 1e-6, "bearing due north is 0deg");
t.approx(Geo.calculateBearing(0, 0, -1, 0), 180, 1e-6, "bearing due south is 180deg");
t.approx(Geo.calculateBearing(0, 0, 0, 1), 90, 1e-6, "bearing due east (equator) is 90deg");
t.approx(Geo.calculateBearing(0, 0, 0, -1), 270, 1e-6, "bearing due west (equator) is 270deg");

// ---- calculateDistanceMeters / calculateDistanceNm: exact 1-degree arcs ----
const expectedMetersPerDeg = R_M * DEG;
const expectedNmPerDeg = R_NM * DEG;
t.approx(Geo.calculateDistanceMeters(0, 0, 1, 0), expectedMetersPerDeg, 0.01,
  "1 degree of meridian arc in metres matches R_M * radians(1deg) exactly");
t.approx(Geo.calculateDistanceMeters(0, 0, 0, 1), expectedMetersPerDeg, 0.01,
  "1 degree of equatorial arc in metres matches R_M * radians(1deg) exactly");
t.approx(Geo.calculateDistanceNm(0, 0, 1, 0), expectedNmPerDeg, 0.001,
  "1 degree of meridian arc in nm matches R_NM * radians(1deg) exactly");
t.eq(Geo.calculateDistanceMeters(5, 10, 5, 10), 0, "distance from a point to itself is exactly 0");

// ---- calculateRelativeBearing: normalization to [-180, 180], positive=right ----
t.eq(Geo.calculateRelativeBearing(0, 0), 0, "relative bearing dead ahead is 0");
t.eq(Geo.calculateRelativeBearing(90, 0), 90, "relative bearing 90deg right of heading is +90");
t.eq(Geo.calculateRelativeBearing(270, 0), -90, "relative bearing 90deg left of heading is -90");
t.eq(Geo.calculateRelativeBearing(180, 0), 180, "relative bearing dead behind reads +180, not -180");
t.eq(Geo.calculateRelativeBearing(350, 10), -20, "wraps correctly across 0/360 to the left");
t.eq(Geo.calculateRelativeBearing(10, 350), 20, "wraps correctly across 0/360 to the right");

// ---- bandedRadiusFraction ----
// The literal documented real case from CLAUDE.md's "RAW ND-style range
// selector" section: an 8nm aircraft against bands [2,5,10] must land at
// exactly 2.6/3.0 of the available radius.
t.approx(Geo.bandedRadiusFraction(8, [2, 5, 10]), 2.6 / 3, 1e-9,
  "8nm against [2,5,10] bands is exactly 2.6/3.0 (documented real case)");
t.eq(Geo.bandedRadiusFraction(0, [2, 5, 10]), 0, "range 0 is fraction 0");
t.approx(Geo.bandedRadiusFraction(5, [2, 5, 10]), 2 / 3, 1e-9, "exact band boundary (5 of [2,5,10]) is 2/3");
t.eq(Geo.bandedRadiusFraction(999, [2, 5, 10]), 1, "range far beyond the last band clamps to fraction 1");
t.eq(Geo.bandedRadiusFraction(5, []), 0, "empty bands array returns 0, not NaN/throw");

// ---- maxRadiusForBearing ----
// Dead-ahead (bearing 0): sinA=0 so the horizontal constraint is Infinity,
// leaving only the vertical one — an exact, hand-derivable formula.
{
  const w = 400, h = 800, anchorY = 0.8, safeInset = 60;
  const cy = h * anchorY;
  const topY = safeInset + 20;
  const expected = cy - topY;
  t.approx(Geo.maxRadiusForBearing(0, w, h, anchorY, safeInset), expected, 1e-9,
    "dead-ahead radius matches the exact Y-headroom formula");
}
{
  // A narrow viewport's FOV-edge radius must be strictly less than its
  // dead-ahead radius — the horizontal constraint binds at the edges.
  const w = 360, h = 800;
  const deadAhead = Geo.maxRadiusForBearing(0, w, h);
  const edge = Geo.maxRadiusForBearing(75, w, h);
  t.ok(edge < deadAhead, "FOV-edge radius is strictly less than dead-ahead on a narrow viewport");
}

// ---- circularPlotRadius: must equal the min() of its two defining bearings ----
{
  const w = 400, h = 900, anchorY = 0.8, safeInset = 60, fov = 75;
  const expected = Math.min(
    Geo.maxRadiusForBearing(0, w, h, anchorY, safeInset),
    Geo.maxRadiusForBearing(fov, w, h, anchorY, safeInset)
  );
  t.eq(Geo.circularPlotRadius(w, h, anchorY, safeInset, fov), expected,
    "circularPlotRadius exactly equals the min() of dead-ahead and the FOV edge");
}

// ---- projectToPolarPosition ----
{
  const w = 400, h = 900;
  const bands = [2, 5, 10, 15, 50];
  const outside = Geo.projectToPolarPosition(100, 10, w, h, bands, 0.8, 60, 75);
  t.eq(outside, null, "a bearing outside the FOV half-angle returns null");

  const atEdge = Geo.projectToPolarPosition(75, 10, w, h, bands, 0.8, 60, 75);
  t.ok(atEdge !== null, "a bearing exactly at the FOV edge is still plottable (inclusive boundary)");

  const deadAhead = Geo.projectToPolarPosition(0, 5, w, h, bands, 0.8, 60, 75);
  t.eq(deadAhead.x, w * 0.5, "dead-ahead x is exactly the anchor's centre x (sinA=0)");

  const near = Geo.projectToPolarPosition(0, 2, w, h, bands, 0.8, 60, 75);
  const far = Geo.projectToPolarPosition(0, 10, w, h, bands, 0.8, 60, 75);
  t.ok(far.y < near.y, "a farther dead-ahead range produces a strictly smaller y (screen Y is inverted)");

  const offset = Geo.projectToPolarPosition(0, 5, w, h, bands, 0.8, 60, 75, 100, 50);
  t.eq(offset.x, deadAhead.x + 100, "offsetX shifts x by exactly offsetX");
  t.eq(offset.y, deadAhead.y + 50, "offsetY shifts y by exactly offsetY");
}

// ---- destinationPoint: round-trips through calculateBearing/calculateDistanceMeters ----
{
  const lat = 51.5, lon = -0.12, bearing = 45, distM = 10000;
  const dest = Geo.destinationPoint(lat, lon, bearing, distM);
  t.approx(Geo.calculateDistanceMeters(lat, lon, dest.lat, dest.lon), distM, 0.5,
    "destinationPoint's own distance round-trips through calculateDistanceMeters");
  t.approx(Geo.calculateBearing(lat, lon, dest.lat, dest.lon), bearing, 0.01,
    "destinationPoint's own bearing round-trips through calculateBearing");
}

// ---- circleCoordinates: closed ring, every point at the true radius ----
{
  const lat = 40, lon = -3, radiusM = 5000;
  const ring = Geo.circleCoordinates(lat, lon, radiusM, 36);
  const first = ring[0], last = ring[ring.length - 1];
  t.approx(first[0], last[0], 1e-9, "circleCoordinates: first and last lon coincide (closed ring)");
  t.approx(first[1], last[1], 1e-9, "circleCoordinates: first and last lat coincide (closed ring)");
  const midpoint = ring[9]; // a quarter of the way around
  t.approx(Geo.calculateDistanceMeters(lat, lon, midpoint[1], midpoint[0]), radiusM, 1,
    "an arbitrary ring point sits at the true radius from centre");
}

// ---- arcCoordinates: open arc, endpoints at the declared bearings ----
{
  const lat = 40, lon = -3, radiusM = 5000, centerBearing = 0, halfAngle = 30;
  const arc = Geo.arcCoordinates(lat, lon, radiusM, centerBearing, halfAngle, 24);
  const first = arc[0], last = arc[arc.length - 1];
  t.ok(Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6,
    "arcCoordinates: first and last points differ (open arc, unlike circleCoordinates)");
  const firstBearing = Geo.calculateBearing(lat, lon, first[1], first[0]);
  const lastBearing = Geo.calculateBearing(lat, lon, last[1], last[0]);
  t.approx(firstBearing, (centerBearing - halfAngle + 360) % 360, 0.01, "arc's first point sits at centerBearing-halfAngle");
  t.approx(lastBearing, centerBearing + halfAngle, 0.01, "arc's last point sits at centerBearing+halfAngle");
}

// ---- computePlotLayout ----
{
  // Portrait, plenty of vertical room: the plot should NOT consume the full
  // content height (the real 2026-09-08 bug this function's rework fixed —
  // see CLAUDE.md's "round 7" entry) and the rows region should exactly
  // fill whatever's left below it.
  const layout = Geo.computePlotLayout(400, 100, 2000, {});
  t.eq(layout.orientation, "portrait", "contentWidth <= contentHeight is portrait");
  t.ok(layout.plotHeight < 2000, "plenty of vertical room: plot does not consume the full content height");
  t.ok(layout.anchorY > 0 && layout.anchorY < 1, "derived anchorY is a genuine fraction");
  t.eq(layout.rows.top, 100 + layout.plotHeight, "rows region starts exactly where the plot ends");
  t.approx(layout.rows.height, 2000 - layout.plotHeight, 1e-6, "rows region fills exactly what's left");

  // Portrait, NOT enough room to trim: falls back to "use it all."
  const tight = Geo.computePlotLayout(400, 100, 50, { desiredAnchorY: 0.8 });
  t.eq(tight.plotHeight, 50, "not enough room to trim: plotHeight falls back to the full contentHeight");
  t.eq(tight.anchorY, 0.8, "not enough room to trim: anchorY falls back to desiredAnchorY unchanged");

  // Landscape.
  const landscape = Geo.computePlotLayout(1400, 100, 500, {});
  t.eq(landscape.orientation, "landscape", "contentWidth > contentHeight is landscape");
  t.eq(landscape.plotHeight, 500, "landscape: plot height is the full contentHeight");
  t.ok(landscape.plotWidth <= 1400, "landscape: plot width never exceeds contentWidth");
  t.eq(landscape.rows.left, landscape.plotWidth, "landscape: rows region starts exactly where the plot ends horizontally");

  // Degenerate/zero content must never throw or go negative (the real bug
  // caught before shipping the 2026-09-08 rework — see CLAUDE.md).
  const degenerate = Geo.computePlotLayout(0, 0, 0, {});
  t.ok(degenerate.plotWidth >= 0, "degenerate zero content: plotWidth is never negative");
  t.ok(degenerate.plotHeight >= 0, "degenerate zero content: plotHeight is never negative");

  // contentWidth === contentHeight is the documented portrait boundary (<=).
  const square = Geo.computePlotLayout(500, 0, 500, {});
  t.eq(square.orientation, "portrait", "contentWidth === contentHeight is portrait (inclusive boundary)");
}

t.done();
