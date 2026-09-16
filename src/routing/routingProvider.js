/**
 * Abstract routing provider interface.
 *
 * Concrete providers must implement getRoute(start, end, mode) and return:
 *   { geometry: GeoJSON LineString, distanceMeters: number, durationSeconds: number,
 *     steps: Array }
 * or null on failure. `steps` may be an empty array — see ManeuverTracker,
 * which already degrades cleanly (falls back to the camera's own geometric
 * turn detection) when a provider has no turn-by-turn data of its own.
 *
 * Implemented by src/routing/orsProvider.js (the default) and
 * src/routing/tomtomProvider.js (optional, experimental) — see
 * src/routing/activeRoutingProvider.js for the dispatcher that picks
 * between them. Neither concrete provider literally extends this object
 * (this codebase doesn't use that pattern anywhere else); it's the
 * documented shape both conform to by duck typing.
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
