/**
 * OSRM routing provider — uses the public demo API.
 * https://router.project-osrm.org
 */
const OsrmProvider = (() => {
  const BASE_URL   = "https://router.project-osrm.org/route/v1/driving";
  const TIMEOUT_MS = 12000;

  async function getRoute(start, end) {
    const url =
      `${BASE_URL}/${start.lon},${start.lat};${end.lon},${end.lat}` +
      `?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = await res.json();
      if (data.code !== "Ok" || !data.routes || !data.routes.length) return null;

      const route = data.routes[0];
      return {
        geometry:        route.geometry, // GeoJSON LineString
        distanceMeters:  route.distance,
        durationSeconds: route.duration,
      };
    } catch (err) {
      clearTimeout(timer);
      console.warn("OsrmProvider: route request failed —", err.message);
      return null;
    }
  }

  return { getRoute };
})();
