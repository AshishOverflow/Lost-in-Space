// ============================================================
// AEGIS Rover — Core Simulation Types
// ============================================================

// --- Terrain ---
export enum TerrainType {
  FLAT_ROCK = 'FLAT_ROCK',
  GRAVEL = 'GRAVEL',
  SAND = 'SAND',
  ROCKY = 'ROCKY',
  STEEP = 'STEEP',
  BOULDER = 'BOULDER',
  CRATER = 'CRATER',
  UNKNOWN = 'UNKNOWN',
  HOME_BASE = 'HOME_BASE',
}

export interface TerrainConfig {
  type: TerrainType;
  passable: boolean;
  movementCost: number;      // energy multiplier
  label: string;
  color: string;
  symbol: string;
}

export const TERRAIN_CONFIGS: Record<TerrainType, TerrainConfig> = {
  [TerrainType.FLAT_ROCK]:  { type: TerrainType.FLAT_ROCK,  passable: true,  movementCost: 1.0, label: 'Flat Rock',   color: '#252d3d', symbol: '·' },
  [TerrainType.GRAVEL]:     { type: TerrainType.GRAVEL,     passable: true,  movementCost: 1.3, label: 'Gravel Bed',  color: '#785338', symbol: '∴' },
  [TerrainType.SAND]:       { type: TerrainType.SAND,       passable: true,  movementCost: 1.8, label: 'Sand Dunes',  color: '#d97706', symbol: '≈' },
  [TerrainType.ROCKY]:      { type: TerrainType.ROCKY,      passable: true,  movementCost: 2.2, label: 'Rough Rock',  color: '#b91c1c', symbol: '▲' },
  [TerrainType.STEEP]:      { type: TerrainType.STEEP,      passable: true,  movementCost: 3.0, label: 'Steep Slope', color: '#6b21a8', symbol: '⛰' },
  [TerrainType.BOULDER]:    { type: TerrainType.BOULDER,    passable: false, movementCost: Infinity, label: 'Boulder Barrier', color: '#1e293b', symbol: '■' },
  [TerrainType.CRATER]:     { type: TerrainType.CRATER,     passable: false, movementCost: Infinity, label: 'Impact Crater',   color: '#0b0f19', symbol: '◯' },
  [TerrainType.UNKNOWN]:    { type: TerrainType.UNKNOWN,    passable: true,  movementCost: 2.0, label: 'Unknown Fog', color: '#07090e', symbol: '?' },
  [TerrainType.HOME_BASE]:  { type: TerrainType.HOME_BASE,  passable: true,  movementCost: 1.0, label: 'Home Base',   color: '#0284c7', symbol: '⌂' },
};

// --- Grid ---
export interface Position {
  x: number;
  y: number;
}

export interface GridCell {
  position: Position;
  terrain: TerrainType;
  hasResource: boolean;
  resource?: Resource;
  hasObjective: boolean;
  objective?: ScientificObjective;
  isHomeBase: boolean;
  isRevealed: boolean;  // on belief map
}

// --- Resources ---
export enum ResourceType {
  MINERAL_SAMPLE = 'MINERAL_SAMPLE',
  WATER_ICE = 'WATER_ICE',
  GEOLOGICAL_SPECIMEN = 'GEOLOGICAL_SPECIMEN',
  RARE_ELEMENT = 'RARE_ELEMENT',
}

export interface Resource {
  id: string;
  type: ResourceType;
  position: Position;
  value: number;
  collectionEnergy: number;    // Wh
  collectionTime: number;      // seconds
  discovered: boolean;
  collected: boolean;
}

export const RESOURCE_CONFIGS: Record<ResourceType, { label: string; color: string; symbol: string; baseValue: number; baseEnergy: number }> = {
  [ResourceType.MINERAL_SAMPLE]:      { label: 'Mineral Sample',      color: '#fbbf24', symbol: '◆', baseValue: 30, baseEnergy: 2 },
  [ResourceType.WATER_ICE]:           { label: 'Water Ice',           color: '#00f0ff', symbol: '❄', baseValue: 50, baseEnergy: 3 },
  [ResourceType.GEOLOGICAL_SPECIMEN]: { label: 'Geological Specimen', color: '#10b981', symbol: '⬡', baseValue: 40, baseEnergy: 2.5 },
  [ResourceType.RARE_ELEMENT]:        { label: 'Rare Element',        color: '#f43f5e', symbol: '★', baseValue: 70, baseEnergy: 4 },
};

// --- Scientific Objective ---
export interface ScientificObjective {
  id: string;
  position: Position;
  name: string;
  description: string;
  scanEnergy: number;      // Wh
  scanTime: number;        // seconds
  dataReward: number;      // scientific data units
  discovered: boolean;
  scanned: boolean;
}

// --- Solar / Energy ---
export enum LightingCondition {
  DAYLIGHT = 'DAYLIGHT',
  MORNING = 'MORNING',
  EVENING = 'EVENING',
  NIGHT = 'NIGHT',
  DUST_STORM = 'DUST_STORM',
}

export interface SolarState {
  ratedPower: number;          // watts
  panelEfficiency: number;     // 0..1
  sunlightFactor: number;      // 0..1
  currentPower: number;        // watts (computed)
  lightingCondition: LightingCondition;
  dustFactor: number;          // 0..1 (1 = no dust)
}

export interface BatteryState {
  capacity: number;            // Wh
  currentEnergy: number;       // Wh
  totalHarvested: number;      // Wh cumulative
  totalConsumed: number;       // Wh cumulative
}

// --- Energy Costs ---
export interface EnergyCosts {
  baseMovement: number;        // Wh per move (flat terrain)
  scan: number;                // Wh per scan action
  collect: number;             // Wh base per collection
  objectiveScan: number;       // Wh for scanning scientific objective
  dataUpload: number;          // Wh for uploading data at base
  idle: number;                // Wh per idle tick
  communication: number;       // Wh per communication action
}

// --- Rover State ---
export enum RoverMode {
  IDLE = 'IDLE',
  EXPLORING = 'EXPLORING',
  NAVIGATING_TO_RESOURCE = 'NAVIGATING_TO_RESOURCE',
  COLLECTING = 'COLLECTING',
  NAVIGATING_TO_OBJECTIVE = 'NAVIGATING_TO_OBJECTIVE',
  SCANNING_OBJECTIVE = 'SCANNING_OBJECTIVE',
  RETURNING_TO_HUB = 'RETURNING_TO_HUB',
  UPLOADING_DATA = 'UPLOADING_DATA',
  HARVESTING = 'HARVESTING',
  CONSERVING = 'CONSERVING',
  LOW_POWER = 'LOW_POWER',
  WAITING_FOR_SUNLIGHT = 'WAITING_FOR_SUNLIGHT',
  MISSION_COMPLETE = 'MISSION_COMPLETE',
  MISSION_FAILED = 'MISSION_FAILED',
  RECOVERY_REQUIRED = 'RECOVERY_REQUIRED',
}

export enum Direction {
  NORTH = 'NORTH',
  SOUTH = 'SOUTH',
  EAST = 'EAST',
  WEST = 'WEST',
}

export const DIRECTION_VECTORS: Record<Direction, Position> = {
  [Direction.NORTH]: { x: 0, y: -1 },
  [Direction.SOUTH]: { x: 0, y: 1 },
  [Direction.EAST]:  { x: 1, y: 0 },
  [Direction.WEST]:  { x: -1, y: 0 },
};

// --- Actions ---
export enum ActionType {
  MOVE = 'MOVE',
  SCAN = 'SCAN',
  COLLECT = 'COLLECT',
  SCAN_OBJECTIVE = 'SCAN_OBJECTIVE',
  UPLOAD_DATA = 'UPLOAD_DATA',
  WAIT = 'WAIT',
  RETURN_TO_BASE = 'RETURN_TO_BASE',
  HARVEST_ENERGY = 'HARVEST_ENERGY',
}

export interface RoverAction {
  type: ActionType;
  direction?: Direction;
  targetPosition?: Position;
  targetResourceId?: string;
  energyCost: number;
  description: string;
}

// --- AI Decision ---
export interface ActionCandidate {
  action: RoverAction;
  utility: number;
  reward: number;
  informationGain: number;
  missionProgress: number;
  energyCost: number;
  timeCost: number;
  risk: number;
  explanation: string;
  safetyAllowed: boolean;
  safetyReason?: string;
}

export interface DecisionState {
  currentGoal: string;
  currentAction: string;
  actionReason: string;
  candidates: ActionCandidate[];
  estimatedReturnEnergy: number;
  safetyReserve: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  nextPlannedAction: string;
  safetyInterventions: number;
}

// --- Event Log ---
export enum EventCategory {
  MOVEMENT = 'MOVEMENT',
  DISCOVERY = 'DISCOVERY',
  RESOURCE = 'RESOURCE',
  SCIENCE = 'SCIENCE',
  ENERGY = 'ENERGY',
  SAFETY = 'SAFETY',
  MISSION = 'MISSION',
  NAVIGATION = 'NAVIGATION',
  DECISION = 'DECISION',
}

export interface MissionEvent {
  id: string;
  timestamp: number;         // simulation seconds
  category: EventCategory;
  description: string;
  energyValue?: number;
  outcome?: string;
}

// --- Mission Metrics ---
export interface MissionMetrics {
  elapsedTime: number;          // seconds
  distanceTraveled: number;     // cells
  totalEnergyConsumed: number;  // Wh
  totalEnergyHarvested: number; // Wh
  resourcesCollected: number;
  totalResourceValue: number;
  scientificDataGenerated: number;
  scientificDataDelivered: number;
  mapExploredPercent: number;
  discoveredCells: number;
  totalCells: number;
  safetyInterventions: number;
  rejectedActions: number;
  returnRouteEnergy: number;
}

// --- History for charts ---
export interface HistoryPoint {
  time: number;
  battery: number;
  solarPower: number;
  harvested: number;
  consumed: number;
  explored: number;
}

// --- Complete Simulation State ---
export interface SimulationState {
  // Environment
  environmentId?: string;
  environmentName?: string;
  terrainConfigs?: Record<TerrainType, TerrainConfig>;
  mapWidth: number;
  mapHeight: number;
  seed: number;
  groundTruth: GridCell[][];        // actual terrain
  beliefMap: GridCell[][];          // rover's known terrain
  resources: Resource[];
  objectives: ScientificObjective[];
  homeBase: Position;

  // Rover
  roverPosition: Position;
  roverDirection: Direction;
  roverMode: RoverMode;
  roverPath: Position[];            // planned route
  roverTrail: Position[];           // movement history
  roverTarget: Position | null;

  // Energy
  solar: SolarState;
  battery: BatteryState;
  energyCosts: EnergyCosts;

  // Mission
  collectedResources: Resource[];
  onboardData: number;
  deliveredData: number;
  missionStarted: boolean;
  missionComplete: boolean;
  missionFailed: boolean;

  // AI
  decision: DecisionState;
  events: MissionEvent[];
  metrics: MissionMetrics;
  history: HistoryPoint[];

  // Control
  isAutonomous: boolean;
  isPaused: boolean;
  isRunning: boolean;
  simulationSpeed: number;          // ticks per second
  tickCount: number;
  timePerTick: number;              // seconds per tick

  // Config
  sensorRadius: number;
  safetyReserve: number;            // Wh
  uncertaintyBuffer: number;        // multiplier for unknown terrain
}

// --- Simulation Config ---
export interface SimulationConfig {
  mapWidth: number;
  mapHeight: number;
  seed: number;
  sensorRadius: number;
  safetyReserve: number;
  uncertaintyBuffer: number;
  batteryCapacity: number;
  initialBattery: number;
  ratedSolarPower: number;
  panelEfficiency: number;
  resourceCount: number;
  timePerTick: number;
  simulationSpeed: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  mapWidth: 30,
  mapHeight: 30,
  seed: 42,
  sensorRadius: 3,
  safetyReserve: 8,         // Wh
  uncertaintyBuffer: 1.3,   // 30% extra for unknown terrain
  batteryCapacity: 100,     // Wh
  initialBattery: 90,       // Wh
  ratedSolarPower: 30,      // Watts
  panelEfficiency: 0.85,
  resourceCount: 8,
  timePerTick: 300,         // 5 minutes per tick
  simulationSpeed: 2,       // ticks per second in auto mode
};
