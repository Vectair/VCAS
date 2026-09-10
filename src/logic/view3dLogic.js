/**
 * View3DLogic — pure angular-matching primitive for the "3D" free-view
 * mode (CLAUDE.md's "360°/planetarium sky view" scoping note; renamed
 * from "Sky View" to "3D" to avoid confusion with the existing AIR mode
 * name). Given an aircraft's real angular offset from the phone's
 * current pointing direction (bearing offset from device azimuth,
 * elevation offset from device pitch), decides whether it falls inside
 * the phone's current "pointing window" and, if so, where to plot it on
 * screen.
 *
 * Deliberately a NEW primitive, not a reuse of Geo.projectToPolarPosition —
 * that function plots by bearing + banded DISTANCE with no elevation axis
 * at all (RAW's plot has no concept of "how high in the sky", every
 * aircraft regardless of altitude plots purely by ground-track bearing and
 * horizontal range). 3D View needs a genuinely different 2D angular
 * window check: does (bearing offset, elevation offset) fall inside
 * (±fovHalfHDeg, ±fovHalfVDeg) of where the phone is pointing right now.
 *
 * Deliberately planetarium-style, not photorealistic AR (see CLAUDE.md) —
 * a small-angle LINEAR degrees-to-pixels mapping across the window is
 * visually fine at this scale and doesn't need a true gnomonic/stereographic
 * projection the way a wide-FOV star chart would.
 */
const View3DLogic = (() => {
  // Genuinely new tuned constants, same honest "reasonable starting guess,
  // not physically derived" provenance this project already carries for
  // CONTRAIL_MIN_ALTITUDE_FT/LOCAL_OBSTRUCTION_MAX_ELEVATION_DEG etc. —
  // pending real field calibration once this has actually been used to
  // find real aircraft. Deliberately wider than a literal phone camera's
  // FOV (~30-35° half-angle for a typical rear camera) since this is
  // sensor-only, not video — a generous catch window matters more than
  // pixel-accurate framing when there's no live image to confirm against.
  const FOV_HALF_H_DEG = 40;
  const FOV_HALF_V_DEG = 30;

  /**
   * @param {number} relativeBearingDeg  Aircraft bearing minus device
   *   azimuth, already normalized to [-180, 180] (Geo.calculateRelativeBearing's
   *   own contract — positive = right of where the phone points).
   * @param {number} elevationOffsetDeg  Aircraft elevation angle minus the
   *   device's own current pointing elevation (DevicePitch's output).
   * @returns {{x:number,y:number}|null}  Screen position, or null if the
   *   aircraft falls outside the phone's current pointing window.
   */
  function projectTo3DPosition(relativeBearingDeg, elevationOffsetDeg, viewportWidth, viewportHeight, fovHalfHDeg, fovHalfVDeg) {
    const halfH = fovHalfHDeg != null ? fovHalfHDeg : FOV_HALF_H_DEG;
    const halfV = fovHalfVDeg != null ? fovHalfVDeg : FOV_HALF_V_DEG;

    if (Math.abs(relativeBearingDeg) > halfH || Math.abs(elevationOffsetDeg) > halfV) return null;

    const x = viewportWidth / 2 + (relativeBearingDeg / halfH) * (viewportWidth / 2);
    // Screen Y is inverted relative to elevation — a higher elevation
    // (more positive) plots nearer the top of the screen (smaller y).
    const y = viewportHeight / 2 - (elevationOffsetDeg / halfV) * (viewportHeight / 2);
    return { x, y };
  }

  /**
   * Screen Y for the true horizon (elevation 0), given where the phone is
   * currently pointing — the "world building" backdrop behind the aircraft
   * dots (see CLAUDE.md's own note on why this is a lightweight procedural
   * sky/ground split, not a real 3D map: MapLibre's camera model has a
   * hard pitch ceiling — 85° in this project's own build, see the Hybrid
   * manual-tilt entry — so it structurally cannot render the near-zenith
   * views this mode needs for a high-elevation aircraft).
   *
   * Same linear degrees-to-pixels mapping projectTo3DPosition uses for a
   * single aircraft, applied to the horizon's own fixed elevation (0°):
   * if the phone points `devicePitchDeg` above the true horizon, the
   * horizon itself sits `devicePitchDeg` below wherever the phone is
   * currently centred. Deliberately UNCLAMPED, unlike projectTo3DPosition
   * — a horizon is always "somewhere" (even off-screen, tilted steeply
   * enough), not a single point that can fall meaningfully "outside the
   * window" the way one aircraft dot can.
   */
  function horizonScreenY(devicePitchDeg, viewportHeight, fovHalfVDeg) {
    const halfV = fovHalfVDeg != null ? fovHalfVDeg : FOV_HALF_V_DEG;
    return viewportHeight / 2 + (devicePitchDeg / halfV) * (viewportHeight / 2);
  }

  // 8-point compass, used to label the "major" ticks compassTicks() returns
  // (every 45°) — the same set a real compass rose shows, not an arbitrary
  // subdivision.
  const COMPASS_POINT_LABELS = {
    0: "N", 45: "NE", 90: "E", 135: "SE",
    180: "S", 225: "SW", 270: "W", 315: "NW",
  };

  /** Signed angular difference a-b, normalized to (-180, 180]. */
  function _angleDiff(a, b) {
    return ((a - b + 540) % 360) - 180;
  }

  /**
   * Compass-tick strip for 3D View's top edge (2026-09-09 follow-up: "add
   * compass ticks around the edge... reusing the azimuth you already
   * have"). Every 10° of true compass bearing gets a tick if it falls
   * inside the phone's current horizontal pointing window (the SAME
   * fovHalfHDeg window projectTo3DPosition already gates on); every 45°
   * (the 8-point compass) is a "major" tick with a direction label,
   * everything else is a small unlabeled mark. x uses the identical
   * linear degrees-to-pixels mapping projectTo3DPosition uses for its own
   * bearing axis, so a tick and an aircraft dot at the same true bearing
   * always land at the same x — not a second, independently-computed
   * layout that could drift from the dots (this project's own repeated
   * "one shared source" discipline, see CLAUDE.md's rings-vs-dots
   * history).
   *
   * @param {number} headingDeg  Device azimuth (0-360, true compass bearing).
   * @returns {Array<{deg:number,x:number,major:boolean,label:string|null}>}
   */
  function compassTicks(headingDeg, viewportWidth, fovHalfHDeg) {
    const halfH = fovHalfHDeg != null ? fovHalfHDeg : FOV_HALF_H_DEG;
    const ticks = [];
    for (let deg = 0; deg < 360; deg += 10) {
      const offset = _angleDiff(deg, headingDeg);
      if (Math.abs(offset) > halfH) continue;
      const x = viewportWidth / 2 + (offset / halfH) * (viewportWidth / 2);
      const major = deg % 45 === 0;
      ticks.push({ deg, x, major, label: major ? COMPASS_POINT_LABELS[deg] : null });
    }
    return ticks;
  }

  return { projectTo3DPosition, horizonScreenY, compassTicks, FOV_HALF_H_DEG, FOV_HALF_V_DEG };
})();

if (typeof module !== "undefined") module.exports = View3DLogic;
