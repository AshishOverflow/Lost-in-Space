// ============================================================
// Europa — Conamara Chaos Environment Properties
// ============================================================

import { TerrainType, ResourceType } from '../../../types/simulation';
import { EnvironmentProperties } from '../../types';

export const europaProperties: EnvironmentProperties = {
  id: 'europa',
  name: 'Europa',
  subtitle: 'Conamara Chaos — Jovian Ice Shell',
  tagline: 'Subsurface Ocean Cryo-Survey',
  description: 'Fractured water-ice crust, chaotic rafted ice blocks, and cryovolcanic fissures under faint Jovian sunlight (5.2 AU).',
  icon: '🧊',

  mapWidth: 30,
  mapHeight: 30,

  sensorRadius: 3,
  safetyReserve: 12,           // Higher reserve needed due to faint sunlight
  uncertaintyBuffer: 1.4,

  batteryCapacity: 120,
  initialBattery: 100,

  solar: {
    ratedSolarPower: 14,       // Deep space solar flux is ~3.7% of Earth's
    panelEfficiency: 0.90,
    baseSunlightFactor: 0.80,
    dustFactor: 0.98,
  },

  energyCosts: {
    baseMovement: 2.2,         // Cryogenic ice heating consumption
    scan: 1.2,
    collect: 3.5,
  },

  resourceCount: 9,
  resourceTypes: [
    ResourceType.WATER_ICE,
    ResourceType.WATER_ICE,
    ResourceType.RARE_ELEMENT,
    ResourceType.GEOLOGICAL_SPECIMEN,
  ],

  objective: {
    id: 'obj-europa-1',
    name: 'Hydrothermal Cryo-Vent',
    description: 'Active ice fissure expelling subsurface saline ocean plume enriched with prebiotic organics',
    scanEnergy: 12,
    scanTime: 1600,
    dataReward: 160,
  },

  terrainDistribution: {
    flatRock: 0.32,            // Smooth glacial plateaus
    gravel: 0.16,              // Ice granule scree
    sand: 0.12,                // Micro-frost fields
    rocky: 0.14,               // Chattered ice blocks
    steep: 0.12,               // Sastrugi pressure ridges
    boulder: 0.08,             // Ice spires
    crater: 0.06,              // Deep cryo-chasms
    edgeRoughness: 0.14,
  },

  terrainConfigs: {
    [TerrainType.FLAT_ROCK]: { label: 'Glacial Sheet',   color: '#0369a1', movementCost: 1.0 },
    [TerrainType.GRAVEL]:    { label: 'Frost Granules',  color: '#0284c7', movementCost: 1.2 },
    [TerrainType.SAND]:      { label: 'Cryo-Snow Drift', color: '#38bdf8', movementCost: 1.6 },
    [TerrainType.ROCKY]:     { label: 'Fractured Ice',   color: '#6366f1', movementCost: 2.3 },
    [TerrainType.STEEP]:     { label: 'Pressure Ridge',  color: '#4f46e5', movementCost: 3.4 },
    [TerrainType.BOULDER]:   { label: 'Glacial Serac',   color: '#1e1b4b' },
    [TerrainType.CRATER]:    { label: 'Sub-Ice Chasm',   color: '#020617' },
    [TerrainType.UNKNOWN]:   { label: 'Unscanned Glace', color: '#090d16', movementCost: 2.0 },
    [TerrainType.HOME_BASE]: { label: 'Europa Lander',   color: '#06b6d4', movementCost: 1.0 },
  },
};
