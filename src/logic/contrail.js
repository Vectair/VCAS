/**
 * Contrail — Schmidt-Appleman-criterion (SAC) contrail formation check.
 *
 * Pure physics, no I/O, no app-specific concepts — mirrors geo.js's own
 * precedent of keeping self-contained math in its own file rather than
 * inline in visibility.js. Given ambient pressure/temperature/humidity at
 * an aircraft's altitude, estimates whether its exhaust plume condenses
 * into a contrail, and whether that contrail is persistent (ambient air is
 * ice-supersaturated, so it spreads into cirrus rather than dissipating in
 * seconds) — see visibility.js's `_contrailRescueCategory()` for how this
 * feeds the sightability score.
 *
 * Follows the standard Schumann (1996) formulation — mixing-line slope G
 * between engine exhaust and ambient air, and the polynomial fit for the
 * liquid-saturation threshold temperature T_LM — the same approach used by
 * other open contrail-prediction implementations (e.g. pycontrails' sac.py).
 * Engine efficiency is a generic constant (visibility.js's
 * CONTRAIL_ENGINE_EFFICIENCY) since ADS-B carries no per-aircraft engine
 * data, so this is necessarily an approximation — good enough to inform a
 * scoring floor, not a certified meteorological forecast. See CLAUDE.md's
 * "Contrail formation" entry for the full design writeup and the real
 * ground-truth data this should eventually be checked against.
 */
const Contrail = (() => {
  const EI_H2O = 1.25;   // kg water vapour emitted per kg fuel burned (kerosene)
  const CP_AIR = 1004;   // J/(kg·K), specific heat of air at constant pressure
  const EPS    = 0.6222; // ratio of molar masses, water vapour / dry air
  const Q_FUEL = 43.1e6; // J/kg, specific combustion heat of kerosene

  // Saturation vapour pressure over liquid water / ice (Sonntag 1990), hPa, T in °C.
  function _satVaporPressureLiquidHpa(tC) {
    return 6.1121 * Math.exp((17.502 * tC) / (240.97 + tC));
  }
  function _satVaporPressureIceHpa(tC) {
    return 6.1115 * Math.exp((22.452 * tC) / (272.55 + tC));
  }

  // Mixing-line slope between exhaust plume and ambient air, in Pa/K.
  function _mixingLineSlope(pressureHpa, engineEfficiency) {
    const pressurePa = pressureHpa * 100;
    return (EI_H2O * CP_AIR * pressurePa) / (EPS * Q_FUEL * (1 - engineEfficiency));
  }

  // Schumann (1996) polynomial fit: liquid-saturation threshold temperature (°C)
  // for mixing-line slope G (Pa/K) — the warmest ambient temperature at which a
  // contrail can form at all (at 100% RH). Valid for G > 0.053 Pa/K.
  function _thresholdTempC(mixingLineSlope) {
    const x = Math.log(mixingLineSlope - 0.053);
    return -46.46 + 9.43 * x + 0.72 * x * x;
  }

  /**
   * @param {object} conditions  { pressureHpa, temperatureC, relativeHumidityPct } — ambient
   *   conditions at the aircraft's altitude. relativeHumidityPct is relative to liquid water
   *   (standard meteorological convention, matching Open-Meteo's own field).
   * @param {number} engineEfficiency  Overall propulsion efficiency, 0-1.
   * @returns {{forms: boolean, persistent: boolean}}
   */
  function evaluate(conditions, engineEfficiency) {
    if (!conditions) return { forms: false, persistent: false };
    const { pressureHpa, temperatureC, relativeHumidityPct } = conditions;
    if (pressureHpa == null || temperatureC == null || relativeHumidityPct == null) {
      return { forms: false, persistent: false };
    }

    const G = _mixingLineSlope(pressureHpa, engineEfficiency);
    if (!(G > 0.053)) return { forms: false, persistent: false }; // formula undefined below this G

    const tLM = _thresholdTempC(G);
    if (temperatureC >= tLM) return { forms: false, persistent: false }; // too warm at any humidity

    // Ambient state vs. the mixing line: contrail forms if the exhaust plume's
    // mixing path crosses liquid saturation before fully diluting into ambient air.
    const eSatLiquidAtTlm    = _satVaporPressureLiquidHpa(tLM);
    const eCriticalHpa       = eSatLiquidAtTlm + (G * (temperatureC - tLM)) / 100; // Pa/K -> hPa/K
    const eSatLiquidAmbient  = _satVaporPressureLiquidHpa(temperatureC);
    const eAmbientHpa        = (relativeHumidityPct / 100) * eSatLiquidAmbient;

    const forms = eAmbientHpa >= eCriticalHpa;
    if (!forms) return { forms: false, persistent: false };

    // Persistence: contrail spreads into cirrus rather than dissipating in
    // seconds only if the ambient air is supersaturated with respect to ice.
    const eSatIceAmbient = _satVaporPressureIceHpa(temperatureC);
    const persistent = eAmbientHpa > eSatIceAmbient;

    return { forms: true, persistent };
  }

  return { evaluate };
})();

if (typeof module !== "undefined") module.exports = Contrail;
