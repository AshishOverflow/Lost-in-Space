// ============================================================
// Terrain Generator — Procedural environment creation (Legacy adapter)
// Delegates to the modular environment generator in src/environments/
// ============================================================

import { SimulationConfig } from '../types/simulation';
import { generateEnvironment as generateModularEnv } from '../environments/generator';
import { marsProperties } from '../environments/maps/mars/properties';

/**
 * Generate a complete environment from a SimulationConfig.
 * Delegates to the unified generateEnvironment function.
 */
export function generateEnvironment(config: SimulationConfig) {
  const envProps = {
    ...marsProperties,
    mapWidth: config.mapWidth,
    mapHeight: config.mapHeight,
    sensorRadius: config.sensorRadius,
    safetyReserve: config.safetyReserve,
    uncertaintyBuffer: config.uncertaintyBuffer,
    batteryCapacity: config.batteryCapacity,
    initialBattery: config.initialBattery,
    resourceCount: config.resourceCount,
    timePerTick: config.timePerTick,
    simulationSpeed: config.simulationSpeed,
    solar: {
      ...marsProperties.solar,
      ratedSolarPower: config.ratedSolarPower,
      panelEfficiency: config.panelEfficiency,
    },
  };

  return generateModularEnv(envProps, config.seed);
}
