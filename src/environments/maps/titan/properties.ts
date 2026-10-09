// ============================================================
// Titan — Shangri-La Dunes Environment Properties
// ============================================================

import { TerrainType, ResourceType } from '../../../types/simulation';
import { EnvironmentProperties } from '../../types';

export const titanProperties: EnvironmentProperties = {
  id: 'titan',
  name: 'Titan',
  subtitle: 'Shangri-La Dunes — Hydrocarbon Basin',
  tagline: 'Dense Atmosphere Tholin Exploration',
  description: 'Thick nitrogen atmosphere with heavy photochemical smog, vast hydrocarbon sand dunes, and liquid methane drainage channels.',
  icon: '🪐',

  mapWidth: 32,
  mapHeight: 32,

  sensorRadius: 3,
  safetyReserve: 15,           // Severe reserve required due to ultra-low solar flux
  uncertaintyBuffer: 1.45,

  batteryCapacity: 130,        // High battery needed for low-solar mission
  initialBattery: 110,

  solar: {
    ratedSolarPower: 8,        // Sunlight severely filtered by dense nitrogen/tholin haze
    panelEfficiency: 0.82,
    baseSunlightFactor: 0.60,
    dustFactor: 0.65,          // Heavy organic haze attenuation
  },

  energyCosts: {
    baseMovement: 2.3,         // Resistance in thick atmosphere & deep dune shifting
    scan: 1.4,
    collect: 3.2,
  },

  resourceCount: 9,
  resourceTypes: [
    ResourceType.GEOLOGICAL_SPECIMEN,
    ResourceType.MINERAL_SAMPLE,
    ResourceType.RARE_ELEMENT,
  ],

  objective: {
    id: 'obj-titan-1',
    name: 'Methane Fluvial Channel',
    description: 'Carved delta channel containing rounded tholin pebbles and liquid hydrocarbon river sediments',
    scanEnergy: 10,
    scanTime: 1400,
    dataReward: 140,
  },

  terrainDistribution: {
    flatRock: 0.25,
    gravel: 0.20,
    sand: 0.25,                // Vast organic tholin dunes
    rocky: 0.12,
    steep: 0.06,
    boulder: 0.06,
    crater: 0.06,              // Methane sinkholes
    edgeRoughness: 0.12,
  },

  terrainConfigs: {
    [TerrainType.FLAT_ROCK]: { label: 'Organic Bedrock', color: '#451a03', movementCost: 1.0 },
    [TerrainType.GRAVEL]:    { label: 'Tholin Shingle',  color: '#78350f', movementCost: 1.3 },
    [TerrainType.SAND]:      { label: 'Hydrocarbon Dune',color: '#b45309', movementCost: 1.9 },
    [TerrainType.ROCKY]:     { label: 'Bitumen Crag',    color: '#92400e', movementCost: 2.2 },
    [TerrainType.STEEP]:     { label: 'Methane Escarp',  color: '#b91c1c', movementCost: 3.1 },
    [TerrainType.BOULDER]:   { label: 'Frozen Water-Rock',color: '#292524' },
    [TerrainType.CRATER]:    { label: 'Methane Sinkhole',color: '#0c0a09' },
    [TerrainType.UNKNOWN]:   { label: 'Tholin Haze Fog', color: '#17120e', movementCost: 2.0 },
    [TerrainType.HOME_BASE]: { label: 'Dragonfly Base',  color: '#f59e0b', movementCost: 1.0 },
  },
};
