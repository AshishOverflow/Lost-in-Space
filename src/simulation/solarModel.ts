// ============================================================
// Solar Power Model — SAP Energy System
// ============================================================

import { SolarState, LightingCondition } from '../types/simulation';

/**
 * Get the sunlight factor based on simulation elapsed time.
 * Uses a simplified day-night cycle:
 *   1 Sol = 24 hours (86400 seconds)
 *   06:00 – 08:00  Morning   (0.4 – 0.7)
 *   08:00 – 16:00  Daylight  (0.85 – 1.0)
 *   16:00 – 18:00  Evening   (0.7 – 0.4)
 *   18:00 – 06:00  Night     (0.0)
 */
export function getSunlightCondition(elapsedSeconds: number): { factor: number; condition: LightingCondition } {
  const hourInDay = (elapsedSeconds % 86400) / 3600; // 0-24

  if (hourInDay >= 8 && hourInDay < 16) {
    // Peak daylight — slight variation
    const midpoint = 12;
    const dist = Math.abs(hourInDay - midpoint);
    const factor = 1.0 - dist * 0.02;
    return { factor: Math.max(0.85, factor), condition: LightingCondition.DAYLIGHT };
  }
  if (hourInDay >= 6 && hourInDay < 8) {
    // Morning ramp up
    const progress = (hourInDay - 6) / 2;
    return { factor: 0.3 + progress * 0.55, condition: LightingCondition.MORNING };
  }
  if (hourInDay >= 16 && hourInDay < 18) {
    // Evening ramp down
    const progress = (hourInDay - 16) / 2;
    return { factor: 0.85 - progress * 0.55, condition: LightingCondition.EVENING };
  }
  // Night
  return { factor: 0.0, condition: LightingCondition.NIGHT };
}

/**
 * Calculate current solar power output in watts.
 * P_solar = P_rated × f_sun × η × f_dust
 */
export function calculateSolarPower(solar: SolarState): number {
  return solar.ratedPower * solar.sunlightFactor * solar.panelEfficiency * solar.dustFactor;
}

/**
 * Calculate energy generated in a time step.
 * E_generated = P_solar × Δt / 3600  (Wh)
 */
export function calculateEnergyGenerated(powerWatts: number, deltaTimeSeconds: number): number {
  return powerWatts * deltaTimeSeconds / 3600;
}

/**
 * Update solar state for a given simulation time.
 */
export function updateSolarState(solar: SolarState, elapsedSeconds: number, isDustStorm: boolean): SolarState {
  const { factor, condition } = getSunlightCondition(elapsedSeconds);
  const dustFactor = isDustStorm ? 0.15 : 1.0;
  const newSolar = {
    ...solar,
    sunlightFactor: factor,
    lightingCondition: isDustStorm ? LightingCondition.DUST_STORM : condition,
    dustFactor,
  };
  newSolar.currentPower = calculateSolarPower(newSolar);
  return newSolar;
}

/**
 * Predict average solar generation for the next N seconds.
 * Uses conservative estimates.
 */
export function predictSolarGeneration(
  solar: SolarState,
  currentElapsed: number,
  durationSeconds: number,
  stepSeconds: number = 300
): number {
  let totalEnergy = 0;
  let time = currentElapsed;
  const steps = Math.ceil(durationSeconds / stepSeconds);

  for (let i = 0; i < steps; i++) {
    const { factor } = getSunlightCondition(time);
    // Conservative: use 70% of predicted factor
    const conservativeFactor = factor * 0.7;
    const power = solar.ratedPower * conservativeFactor * solar.panelEfficiency * solar.dustFactor;
    totalEnergy += calculateEnergyGenerated(power, Math.min(stepSeconds, durationSeconds - i * stepSeconds));
    time += stepSeconds;
  }

  return totalEnergy;
}
