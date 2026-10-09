// ============================================================
// Mars — Olympus Ridge Environment Properties
// ============================================================

import { TerrainType, ResourceType } from '../../../types/simulation';
import { EnvironmentProperties } from '../../types';

export const marsProperties: EnvironmentProperties = {
  id: 'mars',
  name: 'Mars',
  subtitle: 'Olympus Ridge — Gale Basin',
  tagline: 'Red Planet Surface Expedition',
  description: 'Oxidized ferric regolith, rolling sand dunes, and basalt formations subject to atmospheric dust attenuation.',
  icon: '🪐',

  mapWidth: 30,
  mapHeight: 30,

  sensorRadius: 3,
  safetyReserve: 8,
  uncertaintyBuffer: 1.3,

  batteryCapacity: 100,
  initialBattery: 90,

  solar: {
    ratedSolarPower: 30,
    panelEfficiency: 0.85,
    baseSunlightFactor: 0.9,
    dustFactor: 0.95,
  },

  resourceCount: 8,
  resourceTypes: [
    ResourceType.MINERAL_SAMPLE,
    ResourceType.GEOLOGICAL_SPECIMEN,
    ResourceType.WATER_ICE,
    ResourceType.RARE_ELEMENT,
  ],

  objective: {
    id: 'obj-mars-1',
    name: 'Olympus Ridge Formation',
    description: 'Ancient geological formation with unique mineral stratification patterns',
    scanEnergy: 8,
    scanTime: 1200,
    dataReward: 100,
  },

  terrainDistribution: {
    flatRock: 0.35,
    gravel: 0.20,
    sand: 0.15,
    rocky: 0.12,
    steep: 0.05,
    boulder: 0.08,
    crater: 0.05,
    edgeRoughness: 0.15,
  },

  terrainConfigs: {
    [TerrainType.FLAT_ROCK]: { label: 'Basalt Bedrock', color: '#252d3d', movementCost: 1.0 },
    [TerrainType.GRAVEL]:    { label: 'Ferric Gravel',  color: '#785338', movementCost: 1.3 },
    [TerrainType.SAND]:      { label: 'Rust Dunes',     color: '#d97706', movementCost: 1.8 },
    [TerrainType.ROCKY]:     { label: 'Rough Crag',     color: '#b91c1c', movementCost: 2.2 },
    [TerrainType.STEEP]:     { label: 'Caldera Scarp',  color: '#6b21a8', movementCost: 3.0 },
    [TerrainType.BOULDER]:   { label: 'Basalt Monolith',color: '#1e293b' },
    [TerrainType.CRATER]:    { label: 'Impact Crater',  color: '#0b0f19' },
    [TerrainType.UNKNOWN]:   { label: 'Uncharted Fog',  color: '#07090e', movementCost: 2.0 },
    [TerrainType.HOME_BASE]: { label: 'Aegis Hub',      color: '#0284c7', movementCost: 1.0 },
  },
};
