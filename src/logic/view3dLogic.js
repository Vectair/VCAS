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

  // Anti-jitter dead zone (2026-09-13, "extremely jittery" report). Even
  // heavily-smoothed sensor output still has some residual per-sample noise
  // — and this view's own linear degrees-to-pixels mapping (see
  // projectTo3DPosition's own doc comment: ±40°/±30° full window) amplifies
  // that into visible on-screen wobble more than RAW's compass tape or a
  // real map ever would. Rather than fighting this purely with heavier EMA
  // smoothing (which trades away real responsiveness while the user is
  // deliberately panning to scan the sky), shouldUpdateFrame() gates the
  // RENDER decision itself: skip repainting the whole scene unless the
  // phone has moved more than this many degrees, on either axis, since the
  // last frame that actually rendered. A genuinely small residual wobble
  // never gets a chance to move anything on screen at all; a real,
  // deliberate pan clears it within one or two sensor samples.
  const FRAME_UPDATE_THRESHOLD_DEG = 0.3;

  /**
   * @param {number|null} lastAzimuthDeg   Azimuth at the last rendered frame, or null if none yet.
   * @param {number|null} lastPitchDeg     Elevation/pitch at the last rendered frame, or null if none yet.
   * @param {number} azimuthDeg            Current device azimuth.
   * @param {number} pitchDeg              Current device pitch/elevation.
   * @returns {boolean} true if the scene should repaint this tick.
   */
  function shouldUpdateFrame(lastAzimuthDeg, lastPitchDeg, azimuthDeg, pitchDeg) {
    if (lastAzimuthDeg == null || lastPitchDeg == null) return true; // nothing rendered yet — always paint the first frame
    const azDiff = Math.abs(_angleDiff(azimuthDeg, lastAzimuthDeg));
    const pitchDiff = Math.abs(pitchDeg - lastPitchDeg);
    return azDiff > FRAME_UPDATE_THRESHOLD_DEG || pitchDiff > FRAME_UPDATE_THRESHOLD_DEG;
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

  // Dot prominence (2026-09-19, direct report: "it's giving the same
  // relevance to all aircraft regardless of [distance/visibility
  // likelihood]"). Every aircraft dot used to render at a fixed 14px/
  // full-opacity regardless of how big it'd actually look or how
  // confident Visibility.estimate() actually is — the same uniform-
  // prominence problem this project has already fixed once for a
  // different display (RAW's own banded polar scale exists precisely so
  // "does distance correlate with plotted position" holds — see
  // CLAUDE.md's "Rings and dots share one scale" history). 3D View has
  // no equivalent scale at all: dotAppearance() is the fix, driven by
  // two ALREADY-COMPUTED Visibility.estimate() fields rather than new
  // physics — angularSizeDeg (real apparent size: wingspan/length over
  // slant range, the same number that decides which tier an aircraft
  // falls into before any contrail/METAR/obstruction adjustment) sizes
  // the dot, and score (the FINAL confidence after every adjustment —
  // can diverge from angularSizeDeg via the contrail floor, a METAR/
  // upper-air/local-obstruction cap, or staleness degrade) sets its
  // opacity. Using both, not just one, means a small-but-confidently-
  // rescued contrail and a large-but-weather-capped jet read distinctly
  // different from each other, not collapsed into one "aircraft exists"
  // signal.
  //
  // Same honest "reasonable starting guess, not physically derived"
  // provenance as FOV_HALF_H_DEG/FOV_HALF_V_DEG above — DOT_REF_ANGULAR_DEG
  // (1.0°) is comfortably above the 0.5° "Certainly visible" tier cutoff
  // (visibility.js's own CATEGORIES table), so only a genuinely close/large
  // aircraft saturates the dot at its maximum size; most real sightings
  // will land well under it. MIN_DOT_OPACITY (0.3) keeps even a
  // score:10 ("Very unlikely") aircraft faintly visible/tappable rather
  // than invisible — matching how the PWA's own hollow "Very unlikely"
  // SVG icon (fillOpacity:0 in CATEGORIES) still has a visible stroke
  // elsewhere in the app, never a literal zero-opacity nothing.
  const DOT_MIN_PX = 8;
  const DOT_MAX_PX = 22;
  const DOT_REF_ANGULAR_DEG = 1.0;
  const DOT_MIN_OPACITY = 0.3;

  /**
   * @param {number} angularSizeDeg  Visibility.estimate()'s own real
   *   apparent-size figure (degrees) — bigger/closer aircraft, bigger dot.
   * @param {number} score  Visibility.estimate()'s own final confidence
   *   score (10-100) — more likely to actually be seen, more opaque dot.
   * @returns {{sizePx:number, opacity:number}}
   */
  function dotAppearance(angularSizeDeg, score) {
    const sizeT = Math.max(0, Math.min(1, (angularSizeDeg || 0) / DOT_REF_ANGULAR_DEG));
    const sizePx = DOT_MIN_PX + sizeT * (DOT_MAX_PX - DOT_MIN_PX);
    const opacity = Math.max(DOT_MIN_OPACITY, Math.min(1, (score || 0) / 100));
    return { sizePx, opacity };
  }

  return {
    projectTo3DPosition, horizonScreenY, compassTicks, shouldUpdateFrame, dotAppearance,
    FOV_HALF_H_DEG, FOV_HALF_V_DEG, FRAME_UPDATE_THRESHOLD_DEG,
    DOT_MIN_PX, DOT_MAX_PX, DOT_REF_ANGULAR_DEG, DOT_MIN_OPACITY,
  };
})();

if (typeof module !== "undefined") module.exports = View3DLogic;
