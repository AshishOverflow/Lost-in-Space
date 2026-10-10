// ============================================================
// Environment Generator — Core procedural map builder
// ============================================================

import {
  TerrainType, GridCell, Position, Resource, ResourceType,
  ScientificObjective, RESOURCE_CONFIGS, TERRAIN_CONFIGS, TerrainConfig,
  MostValuableLocation, RichSampleSource
} from '../types/simulation';
import { SeededRandom, posKey } from '../utils/helpers';
import { EnvironmentProperties, GeneratedEnvironment, TerrainDistribution } from './types';

/**
 * Builds the complete terrain config for an environment by overlaying
 * environment-specific overrides onto the base TERRAIN_CONFIGS.
 */
export function resolveTerrainConfigs(
  overrides?: Partial<Record<TerrainType, Partial<TerrainConfig>>>
): Record<TerrainType, TerrainConfig> {
  const resolved: Record<TerrainType, TerrainConfig> = { ...TERRAIN_CONFIGS };

  if (overrides) {
    for (const key of Object.keys(overrides) as TerrainType[]) {
      const override = overrides[key];
      if (override && resolved[key]) {
        resolved[key] = {
          ...resolved[key],
          ...override,
        };
      }
    }
  }

  return resolved;
}

/**
 * Generate a complete environment using the provided properties and seed.
 * This is the unified function called for all environments.
 */
export function generateEnvironment(
  properties: EnvironmentProperties,
  seed: number = 42
): GeneratedEnvironment {
  const rng = new SeededRandom(seed);
  const W = properties.mapWidth;
  const H = properties.mapHeight;
  const terrainConfigs = resolveTerrainConfigs(properties.terrainConfigs);

  // 1. Generate base terrain grid
  const groundTruth: GridCell[][] = [];
  for (let y = 0; y < H; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < W; x++) {
      row.push({
        position: { x, y },
        terrain: sampleTerrain(rng, x, y, W, H, properties.terrainDistribution),
        hasResource: false,
        hasObjective: false,
        isHomeBase: false,
        isRevealed: false,
      });
    }
    groundTruth.push(row);
  }

  // 2. Place Home Base near bottom-left
  const homeBase: Position = {
    x: rng.nextInt(1, Math.min(4, Math.floor(W / 4))),
    y: rng.nextInt(Math.max(0, H - 5), H - 2),
  };
  groundTruth[homeBase.y][homeBase.x].terrain = TerrainType.HOME_BASE;
  groundTruth[homeBase.y][homeBase.x].isHomeBase = true;

  // Clear area around home base (make passable)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = homeBase.x + dx;
      const ny = homeBase.y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !(dx === 0 && dy === 0)) {
        groundTruth[ny][nx].terrain = TerrainType.FLAT_ROCK;
      }
    }
  }

  // 3. Rover starts at home base
  const roverStart: Position = { x: homeBase.x, y: homeBase.y };

  // 4. Place solar charging stations in the map to support safe recharging loops.
  const solarStations = placeSolarChargingStations(groundTruth, W, H, homeBase, roverStart, rng, properties.solarChargingStations);

  // 4. Place Scientific Objective (far from home base)
  const objX = rng.nextInt(Math.max(0, W - 8), W - 3);
  const objY = rng.nextInt(2, Math.min(H - 3, 7));
  groundTruth[objY][objX].terrain = TerrainType.FLAT_ROCK;
  groundTruth[objY][objX].hasObjective = true;

  const objective: ScientificObjective = {
    id: properties.objective.id,
    position: { x: objX, y: objY },
    name: properties.objective.name,
    description: properties.objective.description,
    scanEnergy: properties.objective.scanEnergy,
    scanTime: properties.objective.scanTime,
    dataReward: properties.objective.dataReward,
    discovered: false,
    scanned: false,
  };
  groundTruth[objY][objX].objective = objective;

  // Clear path directly around objective
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = objX + dx;
      const ny = objY + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !(dx === 0 && dy === 0)) {
        if (
          groundTruth[ny][nx].terrain === TerrainType.BOULDER ||
          groundTruth[ny][nx].terrain === TerrainType.CRATER
        ) {
          groundTruth[ny][nx].terrain = TerrainType.ROCKY;
        }
      }
    }
  }

  // 5. Place resources
  const resources: Resource[] = [];
  const allowedTypes = properties.resourceTypes && properties.resourceTypes.length > 0
    ? properties.resourceTypes
    : Object.values(ResourceType);

  const occupied = new Set<string>([
    posKey(homeBase.x, homeBase.y),
    posKey(objX, objY),
  ]);

  for (let i = 0; i < properties.resourceCount; i++) {
    let attempts = 0;
    while (attempts < 100) {
      const rx = rng.nextInt(1, W - 2);
      const ry = rng.nextInt(1, H - 2);
      const key = posKey(rx, ry);

      if (
        !occupied.has(key) &&
        groundTruth[ry][rx].terrain !== TerrainType.BOULDER &&
        groundTruth[ry][rx].terrain !== TerrainType.CRATER
      ) {
        occupied.add(key);
        const rtype = rng.pick(allowedTypes);
        const rc = RESOURCE_CONFIGS[rtype];
        const isRich = i < 3;
        const yieldMult = isRich ? +(2.2 + rng.next() * 1.5).toFixed(1) : 1.0;
        const richName = isRich
          ? `${properties.name} Concentrated ${rc.label} Vein`
          : undefined;

        const resource: Resource = {
          id: `res-${i}`,
          type: rtype,
          position: { x: rx, y: ry },
          value: Math.round((rc.baseValue + rng.nextInt(-5, 15)) * yieldMult),
          collectionEnergy: rc.baseEnergy + rng.next() * 2,
          collectionTime: 300 + rng.nextInt(0, 300),
          discovered: false,
          collected: false,
          isRichSource: isRich,
          richSourceName: richName,
          yieldMultiplier: yieldMult,
        };

        resources.push(resource);
        groundTruth[ry][rx].hasResource = true;
        groundTruth[ry][rx].resource = resource;

        if (!isPassable(groundTruth[ry][rx].terrain)) {
          groundTruth[ry][rx].terrain = TerrainType.GRAVEL;
        }
        break;
      }
      attempts++;
    }
  }

  // 6. Generate distinct Rich Sample Sources list
  const richSampleSources: RichSampleSource[] = resources
    .filter(r => r.isRichSource)
    .map(r => ({
      id: `rich-${r.id}`,
      name: r.richSourceName || `${properties.name} High-Yield Specimen`,
      position: r.position,
      resourceType: r.type,
      yieldMultiplier: +(r.value / (RESOURCE_CONFIGS[r.type].baseValue)).toFixed(1),
      description: `Concentrated high-density geological deposit offering enhanced scientific return.`,
      discovered: false,
      sampled: false,
    }));

  // 7. Designate Candidate Most Valuable Location
  const mvlX = rng.nextInt(Math.floor(W * 0.4), Math.min(W - 2, Math.floor(W * 0.85)));
  const mvlY = rng.nextInt(Math.floor(H * 0.2), Math.min(H - 2, Math.floor(H * 0.75)));
  if (!isPassable(groundTruth[mvlY][mvlX].terrain)) {
    groundTruth[mvlY][mvlX].terrain = TerrainType.FLAT_ROCK;
  }
  const mostValuableLocation: MostValuableLocation = {
    x: mvlX,
    y: mvlY,
    name: `${properties.name} Prime Strata Alpha`,
    description: `Primary planetary hotspot with exceptional isotopic and mineralogical concentration.`,
    scientificYield: 150,
    confirmed: false,
    visited: false,
  };

  // 8. Ensure connectivity between start and objective
  ensureConnectivity(groundTruth, roverStart, { x: objX, y: objY }, W, H, rng);
  ensureConnectivity(groundTruth, roverStart, { x: mvlX, y: mvlY }, W, H, rng);

  // 9. Create empty belief map
  const beliefMap: GridCell[][] = [];
  for (let y = 0; y < H; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < W; x++) {
      row.push({
        position: { x, y },
        terrain: TerrainType.UNKNOWN,
        hasResource: false,
        hasObjective: false,
        isHomeBase: false,
        isRevealed: false,
      });
    }
    beliefMap.push(row);
  }

  return {
    groundTruth,
    beliefMap,
    resources,
    objectives: [objective],
    homeBase,
    roverStart,
    solarStations,
    terrainConfigs,
    properties,
    mostValuableLocation,
    richSampleSources,
  };
}

/** Samples a terrain type based on the distribution configuration */
function sampleTerrain(
  rng: SeededRandom,
  x: number,
  y: number,
  W: number,
  H: number,
  dist: TerrainDistribution
): TerrainType {
  const r = rng.next();
  const edgeDist = Math.min(x, y, W - 1 - x, H - 1 - y);
  const edgeBonus = edgeDist < 2 ? (dist.edgeRoughness ?? 0.15) : 0;

  // Cumulative threshold calculation
  let c = dist.flatRock;
  if (r < c) return TerrainType.FLAT_ROCK;

  c += dist.gravel;
  if (r < c) return TerrainType.GRAVEL;

  c += dist.sand;
  if (r < c) return TerrainType.SAND;

  c += dist.rocky;
  if (r < c) return TerrainType.ROCKY;

  c += dist.steep + edgeBonus;
  if (r < c) return TerrainType.STEEP;

  c += dist.boulder + edgeBonus;
  if (r < c) return TerrainType.BOULDER;

  c += dist.crater;
  if (r < c) return TerrainType.CRATER;

  return TerrainType.FLAT_ROCK;
}

function isPassable(terrain: TerrainType): boolean {
  return terrain !== TerrainType.BOULDER && terrain !== TerrainType.CRATER;
}

function placeSolarChargingStations(
  grid: GridCell[][],
  width: number,
  height: number,
  homeBase: Position,
  roverStart: Position,
  rng: SeededRandom,
  predefined?: Position[]
): Position[] {
  const stations: Position[] = [];
  const occupied = new Set<string>([posKey(homeBase.x, homeBase.y), posKey(roverStart.x, roverStart.y)]);

  if (predefined && predefined.length > 0) {
    for (const p of predefined) {
      if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
      const key = posKey(p.x, p.y);
      if (occupied.has(key)) continue;
      occupied.add(key);
      stations.push({ x: p.x, y: p.y });
      grid[p.y][p.x].isSolarChargingPoint = true;
      grid[p.y][p.x].terrain = TerrainType.FLAT_ROCK;
    }
  }

  const targetStations = Math.max(1, Math.min(3, Math.floor((width * height) / 200)));
  while (stations.length < targetStations) {
    const candidate = {
      x: rng.nextInt(2, width - 2),
      y: rng.nextInt(2, height - 2),
    };
    const key = posKey(candidate.x, candidate.y);
    if (occupied.has(key)) continue;
    if (Math.abs(candidate.x - homeBase.x) + Math.abs(candidate.y - homeBase.y) < 6) continue;
    const terrain = grid[candidate.y][candidate.x].terrain;
    if (!isPassable(terrain)) continue;

    occupied.add(key);
    stations.push(candidate);
    grid[candidate.y][candidate.x].isSolarChargingPoint = true;
    grid[candidate.y][candidate.x].terrain = TerrainType.FLAT_ROCK;
  }

  return stations;
}

/** BFS connectivity guarantee from src to dst */
function ensureConnectivity(
  grid: GridCell[][],
  src: Position,
  dst: Position,
  W: number,
  H: number,
  rng: SeededRandom
) {
  const visited = new Set<string>();
  const queue: Position[] = [src];
  visited.add(posKey(src.x, src.y));
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];

  while (queue.length > 0) {
    const p = queue.shift()!;
    if (p.x === dst.x && p.y === dst.y) return;

    for (const d of dirs) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        const key = posKey(nx, ny);
        if (!visited.has(key) && isPassable(grid[ny][nx].terrain)) {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  // Carve corridor if obstructed
  let cx = src.x;
  let cy = src.y;
  while (cx !== dst.x || cy !== dst.y) {
    if (cx < dst.x) cx++;
    else if (cx > dst.x) cx--;
    else if (cy < dst.y) cy++;
    else if (cy > dst.y) cy--;

    if (!isPassable(grid[cy][cx].terrain)) {
      grid[cy][cx].terrain = rng.next() < 0.5 ? TerrainType.GRAVEL : TerrainType.SAND;
    }
  }
}
