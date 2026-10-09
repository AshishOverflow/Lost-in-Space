// ============================================================
// Environment Types — Schema for Modular Simulation Maps
// ============================================================

import {
  TerrainType, TerrainConfig, ResourceType, Position,
  GridCell, Resource, ScientificObjective, LightingCondition,
  EnergyCosts
} from '../types/simulation';

/** Distribution weights for procedural terrain generation */
export interface TerrainDistribution {
  flatRock: number;
  gravel: number;
  sand: number;
  rocky: number;
  steep: number;
  boulder: number;
  crater: number;
  edgeRoughness?: number;
}

/** Atmospheric and solar characteristics for the environment */
export interface EnvironmentSolarConfig {
  ratedSolarPower: number;      // Watts (e.g. 30W on Mars, 45W on Moon vacuum, 12W on Europa)
  panelEfficiency: number;      // 0..1 (e.g. 0.85)
  baseSunlightFactor: number;   // 0..1 (solar intensity)
  dustFactor: number;           // 0..1 (1.0 = clean, < 1.0 = dust/atmospheric attenuation)
  initialLighting?: LightingCondition;
}

/** Scientific objective specifications */
export interface EnvironmentObjectiveConfig {
  id: string;
  name: string;
  description: string;
  scanEnergy: number;          // Wh
  scanTime: number;            // seconds
  dataReward: number;          // science units
}

/** Complete properties contract for an environment/map */
export interface EnvironmentProperties {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  icon?: string;
  tagline?: string;

  // Map dimensions
  mapWidth: number;
  mapHeight: number;

  // Sensor and safety
  sensorRadius: number;
  safetyReserve: number;        // Wh
  uncertaintyBuffer: number;    // Multiplier for unrevealed terrain

  // Power & Battery
  batteryCapacity: number;      // Wh
  initialBattery: number;       // Wh
  solar: EnvironmentSolarConfig;
  energyCosts?: Partial<EnergyCosts>;

  // Resources & Objectives
  resourceCount: number;
  resourceTypes?: ResourceType[];
  objective: EnvironmentObjectiveConfig;

  // Terrain generation & visual styling
  terrainDistribution: TerrainDistribution;
  terrainConfigs?: Partial<Record<TerrainType, Partial<TerrainConfig>>>;
  solarChargingStations?: Position[];

  // Simulation timing
  timePerTick?: number;         // seconds
  simulationSpeed?: number;     // ticks per second
}

/** Result of generating an environment */
export interface GeneratedEnvironment {
  groundTruth: GridCell[][];
  beliefMap: GridCell[][];
  resources: Resource[];
  objectives: ScientificObjective[];
  homeBase: Position;
  roverStart: Position;
  solarStations: Position[];
  terrainConfigs: Record<TerrainType, TerrainConfig>;
  properties: EnvironmentProperties;
}
