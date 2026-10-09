// ============================================================
// Lunar South Pole — Shackleton Rim Environment Properties
// ============================================================

import { TerrainType, ResourceType } from '../../../types/simulation';
import { EnvironmentProperties } from '../../types';

export const lunarProperties: EnvironmentProperties = {
  id: 'lunar',
  name: 'Moon',
  subtitle: 'Shackleton Rim — Lunar South Pole',
  tagline: 'Deep Vacuum Polar Prospecting',
  description: 'Extreme vacuum environment with high crater density, razor-sharp shadows, and permanently shadowed regions harboring cryogenic water-ice traps.',
  icon: '🌕',

  mapWidth: 32,
  mapHeight: 32,

  sensorRadius: 4,
  safetyReserve: 10,
  uncertaintyBuffer: 1.35,

  batteryCapacity: 110,
  initialBattery: 95,

  solar: {
    ratedSolarPower: 42,          // Direct solar without atmospheric loss
    panelEfficiency: 0.88,
    baseSunlightFactor: 0.95,
    dustFactor: 1.0,              // Vacuum — zero atmospheric dust settling
  },

  resourceCount: 10,
  resourceTypes: [
    ResourceType.WATER_ICE,
    ResourceType.WATER_ICE,       // High probability of polar ice
    ResourceType.MINERAL_SAMPLE,
    ResourceType.RARE_ELEMENT,
  ],

  objective: {
    id: 'obj-lunar-1',
    name: 'Shackleton Cold Trap',
    description: 'Permanently shadowed cryogenic crater basin containing billion-year-old primordial volatile layers',
    scanEnergy: 10,
    scanTime: 1500,
    dataReward: 125,
  },

  terrainDistribution: {
    flatRock: 0.28,
    gravel: 0.18,
    sand: 0.14,
    rocky: 0.15,
    steep: 0.08,
    boulder: 0.09,
    crater: 0.08,
    edgeRoughness: 0.18,
  },

  terrainConfigs: {
    [TerrainType.FLAT_ROCK]: { label: 'Basalt Regolith',   color: '#2a2f3a', movementCost: 1.0 },
    [TerrainType.GRAVEL]:    { label: 'Anorthosite Scree', color: '#475569', movementCost: 1.25 },
    [TerrainType.SAND]:      { label: 'Lunar Dust Bed',    color: '#64748b', movementCost: 1.7 },
    [TerrainType.ROCKY]:     { label: 'Highland Rimrock',  color: '#94a3b8', movementCost: 2.1 },
    [TerrainType.STEEP]:     { label: 'Crater Escarpment', color: '#334155', movementCost: 3.2 },
    [TerrainType.BOULDER]:   { label: 'Ejecta Monolith',   color: '#1e293b' },
    [TerrainType.CRATER]:    { label: 'Shadowed Abyss',    color: '#020617' },
    [TerrainType.UNKNOWN]:   { label: 'Unscanned Vacuum',  color: '#05070a', movementCost: 2.0 },
    [TerrainType.HOME_BASE]: { label: 'Artemis Outpost',   color: '#38bdf8', movementCost: 1.0 },
  },
};
