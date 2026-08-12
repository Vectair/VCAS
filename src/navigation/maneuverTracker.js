/**
 * ManeuverTracker — turns OpenRouteService's own turn-by-turn steps into
 * "what's the next thing to do, and how far away is it" for the current
 * position, instead of re-deriving turns from raw polyline bearing changes
 * (see NavigationCameraEvaluator's own bearing-delta scan, which the
 * camera's TURN_APPROACH zoom-in still uses for framing — this module is
 * about the guidance CARD's text/icon, which wants the routing engine's
 * actual decision, including street names and real maneuver classification
 * a geometric bend can't give you).
 *
 * NOTE ON THE ORS RESPONSE SHAPE: this assumes OpenRouteService's
 * documented Directions v2 GeoJSON `properties.segments[].steps[]` format —
 * each step has {distance, duration, type, instruction, name, way_points:
 * [startIdx, endIdx]}, `way_points` indexing into the SAME coordinate array
 * as the route geometry, and `type` a small integer maneuver code (0=left,
 * 1=right, 2=sharp left, 3=sharp right, 4=slight left, 5=slight right,
 * 6=straight, 7=enter roundabout, 8=exit roundabout, 9=u-turn, 10=arrive,
 * 11=depart, 12=keep left, 13=keep right). This is ORS's long-stable public
 * schema, but could not be verified against a live response from this
 * sandbox (outbound network to api.openrouteservice.org is blocked here) —
 * worth confirming against a real route once deployed. Every field is read
 * defensively (missing/malformed data degrades to "no maneuver", never
 * throws), and unrecognised `type` values fall back to a plain arrow.
 */
const ManeuverTracker = (() => {
  /**
   * @param {number[][]} coords  Route geometry coordinates, [lon,lat][].
   * @param {Array} steps        ORS steps array — see module comment.
   * @param {number} userLon
   * @param {number} userLat
   * @returns {{exists:boolean, instruction?:string, type?:number, name?:string,
   *            distanceMeters?:number, isArrival?:boolean}}
   */
  function nextManeuver(coords, steps, userLon, userLat) {
    if (!coords || coords.length < 2 || !Array.isArray(steps) || steps.length === 0) {
      return { exists: false };
    }

    const nearest = RouteGeometry.nearestOnLine(coords, userLon, userLat);
    const { segIdx, t } = nearest;

    // Which step is the user currently following? A step's range is
    // [way_points[0], way_points[1]] in coordinate-index space — the first
    // step whose end lies ahead of the user's current (continuous, segIdx+t
    // — NOT bare segIdx, which maxes out at coords.length-2 and so can
    // never itself reach a zero-width final "arrival" step's own index)
    // position is "active".
    const continuousPos = segIdx + t;
    let currentStepIdx = steps.findIndex(s => Array.isArray(s.way_points) && continuousPos < s.way_points[1]);
    if (currentStepIdx === -1) currentStepIdx = steps.length - 1;

    const currentStep = steps[currentStepIdx];
    if (!currentStep) return { exists: false };

    // The maneuver worth announcing is the NEXT step's instruction — it
    // describes what happens once the current step ends — except once
    // there IS no next step, where the current (final/arrival) step's own
    // instruction is what's left to show.
    const isCurrentLast = currentStepIdx >= steps.length - 1;
    const targetStepIdx = isCurrentLast ? currentStepIdx : currentStepIdx + 1;
    const targetStep = steps[targetStepIdx];
    if (!targetStep) return { exists: false };

    const targetIdx = Array.isArray(currentStep.way_points)
      ? currentStep.way_points[1]
      : coords.length - 1;

    const distanceMeters = RouteGeometry.distanceToIndex(coords, segIdx, t, targetIdx);

    return {
      exists: true,
      instruction: targetStep.instruction || null,
      type: typeof targetStep.type === "number" ? targetStep.type : null,
      name: targetStep.name || "",
      distanceMeters,
      isArrival: targetStepIdx === steps.length - 1,
    };
  }

  return { nextManeuver };
})();

if (typeof module !== "undefined") module.exports = ManeuverTracker;
