/**
 * Abstract routing provider interface.
 *
 * Concrete providers must implement getRoute(start, end, mode) and return:
 *   { geometry: GeoJSON LineString, distanceMeters: number, durationSeconds: number }
 * or null on failure.
 */
const RoutingProvider = {
  /**
   * @param {{ lat: number, lon: number }} start
   * @param {{ lat: number, lon: number }} end
   * @param {"driving"|"cycling"|"walking"} [mode="driving"]
   * @returns {Promise<{ geometry: object, distanceMeters: number, durationSeconds: number }|null>}
   */
  async getRoute(start, end, mode) {
    throw new Error("RoutingProvider.getRoute must be implemented");
  },
};
