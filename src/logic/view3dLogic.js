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

  return { projectTo3DPosition, FOV_HALF_H_DEG, FOV_HALF_V_DEG };
})();

if (typeof module !== "undefined") module.exports = View3DLogic;
