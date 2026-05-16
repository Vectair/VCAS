/**
 * Abstract routing provider interface.
 *
 * Concrete providers must implement getRoute(start, end) and return:
 *   { geometry: GeoJSON LineString, distanceMeters: number, durationSeconds: number }
 * or null on failure.
 */
const RoutingProvider = {
  /**
   * @param {{ lat: number, lon: number }} start
   * @param {{ lat: number, lon: number }} end
   * @returns {Promise<{ geometry: object, distanceMeters: number, durationSeconds: number }|null>}
   */
  async getRoute(start, end) {
    throw new Error("RoutingProvider.getRoute must be implemented");
  },
};
