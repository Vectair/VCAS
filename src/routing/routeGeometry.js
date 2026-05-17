/**
 * Route polyline geometry utilities.
 * Completely calibrated for cross-platform SI metrics and projection continuity.
 */
const RouteGeometry = (() => {
  const R = 6371000; // Earth radius in metres
  const DEG_TO_RAD = Math.PI / 180;

  function _toRad(d) { return d * DEG_TO_RAD; }

  // Great-circle Haversine distance in metres between two [lon, lat] points.
  function _dist(a, b) {
    const dLat = (b[1] - a[1]) * DEG_TO_RAD;
    const dLon = (b[0] - a[0]) * DEG_TO_RAD;
    const s    = Math.sin(dLat / 2);
    const o    = Math.sin(dLon / 2);
    const h    = s * s + Math.cos(a[1] * DEG_TO_RAD) * Math.cos(b[1] * DEG_TO_RAD) * o * o;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Nearest point on segment [a, b] to point p.
   * Scaled using cosine latitude weights to resolve Mercator distortion anomalies.
   */
  function _nearestOnSegment(p, a, b) {
    // Core Correction: Apply cosine projection modifier to correct longitudinal space convergence
    const cosLatFactor = Math.cos(((a[1] + b[1]) / 2) * DEG_TO_RAD);
    
    const dx = (b[0] - a[0]) * cosLatFactor;
    const dy = b[1] - a[1];
    
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { t: 0, point: [a[0], a[1]] };

    const px = (p[0] - a[0]) * cosLatFactor;
    const py = p[1] - a[1];

    let t = (px * dx + py * dy) / lenSq;
    t = Math.max(0, Math.min(1, t)); // Bound clamp projection limits

    return { 
      t, 
      point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] 
    };
  }

  /**
   * Find nearest snapped trajectory node on a GeoJSON LineString path array.
   */
  function nearestOnLine(coords, lon, lat) {
    if (!coords || coords.length === 0) {
      return { segIdx: 0, t: 0, point: [lon, lat] };
    }
    if (coords.length < 2) {
      return { segIdx: 0, t: 0, point: [coords[0][0], coords[0][1]] };
    }

    const p = [lon, lat];
    let bestDist = Infinity;
    let bestSeg = 0;
    let bestT = 0;
    let bestPt = [coords[0][0], coords[0][1]];

    for (let i = 0; i < coords.length - 1; i++) {
      const { t, point } = _nearestOnSegment(p, coords[i], coords[i + 1]);
      const d = _dist(p, point);
      if (d < bestDist) {
        bestDist = d;
        bestSeg  = i;
        bestT    = t;
        bestPt   = point;
      }
    }
    return { segIdx: bestSeg, t: bestT, point: bestPt };
  }

  /**
   * Project forward along the route from a given position by `meters`.
   * Refactored to feature continuous integration step boundaries to prevent camera jumping.
   */
  function projectAlong(coords, segIdx, t, meters) {
    if (!coords || coords.length < 2) return null;
    if (meters <= 0) {
      const currentSegmentNode = coords[segIdx];
      return { lon: currentSegmentNode[0], lat: currentSegmentNode[1] };
    }

    const a = coords[segIdx];
    const b = coords[Math.min(segIdx + 1, coords.length - 1)];

    // Interpolate exact structural coordinate point within active segment boundary
    const curLon = a[0] + t * (b[0] - a[0]);
    const curLat = a[1] + t * (b[1] - a[1]);

    const segRemain = _dist([curLon, curLat], b);

    // Continuous Path Integration Gateway Check
    if (meters <= segRemain) {
      // Avoid division-by-zero crashes on ultra-short coordinate vectors
      const denominator = Math.max(segRemain, 0.1);
      const frac = meters / denominator;
      return {
        lon: curLon + frac * (b[0] - curLon),
        lat: curLat + frac * (b[1] - curLat),
      };
    }

    // Step across polyline vertex indices recursively using scalar meter values
    let remainingMeters = meters - segRemain;
    let targetIndex = segIdx + 1;

    while (targetIndex < coords.length - 1) {
      const p1 = coords[targetIndex];
      const p2 = coords[targetIndex + 1];
      const currentSegmentLength = _dist(p1, p2);

      if (remainingMeters <= currentSegmentLength) {
        const denominator = Math.max(currentSegmentLength, 0.1);
        const frac = remainingMeters / denominator;
        return {
          lon: p1[0] + frac * (p2[0] - p1[0]),
          lat: p1[1] + frac * (p2[1] - p1[1]),
        };
      }
      
      remainingMeters -= currentSegmentLength;
      targetIndex++;
    }

    // Clamps target lookahead coordinates safely to the destination vertex if exceeded
    const absoluteFinalNode = coords[coords.length - 1];
    return { lon: absoluteFinalNode[0], lat: absoluteFinalNode[1] };
  }

  return { nearestOnLine, projectAlong };
})();

if (typeof module !== "undefined") module.exports = RouteGeometry;
