// ============================================================
// Terrain Generator — Procedural environment creation
// ============================================================

import {
  TerrainType, GridCell, Position, Resource, ResourceType,
  ScientificObjective, RESOURCE_CONFIGS, SimulationConfig,
} from '../types/simulation';
import { SeededRandom, posKey } from '../utils/helpers';

/** Generate a complete environment from a config */
export function generateEnvironment(config: SimulationConfig) {
  const rng = new SeededRandom(config.seed);
  const { mapWidth: W, mapHeight: H } = config;

  // 1. Generate terrain
  const groundTruth: GridCell[][] = [];
  for (let y = 0; y < H; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < W; x++) {
      row.push({
        position: { x, y },
        terrain: generateTerrain(rng, x, y, W, H),
        hasResource: false,
        hasObjective: false,
        isHomeBase: false,
        isRevealed: false,
      });
    }
    groundTruth.push(row);
  }

  // 2. Place home base near bottom-left
  const homeBase: Position = { x: rng.nextInt(1, 4), y: rng.nextInt(H - 5, H - 2) };
  groundTruth[homeBase.y][homeBase.x].terrain = TerrainType.HOME_BASE;
  groundTruth[homeBase.y][homeBase.x].isHomeBase = true;
  // Clear area around home base
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = homeBase.x + dx, ny = homeBase.y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !(dx === 0 && dy === 0)) {
        groundTruth[ny][nx].terrain = TerrainType.FLAT_ROCK;
      }
    }
  }

  // 3. Rover starts at home base
  const roverStart: Position = { x: homeBase.x, y: homeBase.y };

  // 4. Place scientific objective in north-east sector far from home base
  const objX = rng.nextInt(W - 12, W - 6);
  const objY = rng.nextInt(5, 12);
  groundTruth[objY][objX].terrain = TerrainType.FLAT_ROCK;
  groundTruth[objY][objX].hasObjective = true;
  const objective: ScientificObjective = {
    id: 'obj-1',
    position: { x: objX, y: objY },
    name: 'Olympus Ridge Formation',
    description: 'Ancient geological formation with unique mineral stratification patterns',
    scanEnergy: 8,
    scanTime: 1200,
    dataReward: 100,
    discovered: false,
    scanned: false,
  };
  groundTruth[objY][objX].objective = objective;

  // Clear path around objective
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = objX + dx, ny = objY + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !(dx === 0 && dy === 0)) {
        if (groundTruth[ny][nx].terrain === TerrainType.BOULDER ||
            groundTruth[ny][nx].terrain === TerrainType.CRATER) {
          groundTruth[ny][nx].terrain = TerrainType.ROCKY;
        }
      }
    }
  }

  // 5. Place resources
  const resources: Resource[] = [];
  const resourceTypes = Object.values(ResourceType);
  const occupied = new Set<string>([posKey(homeBase.x, homeBase.y), posKey(objX, objY)]);

  for (let i = 0; i < config.resourceCount; i++) {
    let attempts = 0;
    while (attempts < 100) {
      const rx = rng.nextInt(1, W - 2);
      const ry = rng.nextInt(1, H - 2);
      const key = posKey(rx, ry);
      if (!occupied.has(key) &&
          groundTruth[ry][rx].terrain !== TerrainType.BOULDER &&
          groundTruth[ry][rx].terrain !== TerrainType.CRATER) {
        occupied.add(key);
        const rtype = rng.pick(resourceTypes);
        const rc = RESOURCE_CONFIGS[rtype];
        const resource: Resource = {
          id: `res-${i}`,
          type: rtype,
          position: { x: rx, y: ry },
          value: rc.baseValue + rng.nextInt(-10, 15),
          collectionEnergy: rc.baseEnergy + rng.next() * 2,
          collectionTime: 300 + rng.nextInt(0, 300),
          discovered: false,
          collected: false,
        };
        resources.push(resource);
        groundTruth[ry][rx].hasResource = true;
        groundTruth[ry][rx].resource = resource;
        // Ensure terrain is passable under the resource
        if (!isPassable(groundTruth[ry][rx].terrain)) {
          groundTruth[ry][rx].terrain = TerrainType.GRAVEL;
        }
        break;
      }
      attempts++;
    }
  }

  // 6. Ensure a traversable corridor exists (simple flood-fill check + carve if needed)
  ensureConnectivity(groundTruth, roverStart, { x: objX, y: objY }, W, H, rng);

  // 7. Create empty belief map
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
  };
}

function generateTerrain(rng: SeededRandom, x: number, y: number, W: number, H: number): TerrainType {
  const r = rng.next();
  // Edge cells more likely to be rough
  const edgeFactor = Math.min(x, y, W - 1 - x, H - 1 - y) < 2 ? 0.15 : 0;

  if (r < 0.35)              return TerrainType.FLAT_ROCK;
  if (r < 0.35 + 0.20)      return TerrainType.GRAVEL;
  if (r < 0.35 + 0.20 + 0.15) return TerrainType.SAND;
  if (r < 0.35 + 0.20 + 0.15 + 0.12) return TerrainType.ROCKY;
  if (r < 0.35 + 0.20 + 0.15 + 0.12 + 0.05 + edgeFactor) return TerrainType.STEEP;
  if (r < 0.35 + 0.20 + 0.15 + 0.12 + 0.05 + edgeFactor + 0.08) return TerrainType.BOULDER;
  if (r < 0.35 + 0.20 + 0.15 + 0.12 + 0.05 + edgeFactor + 0.08 + 0.05) return TerrainType.CRATER;
  return TerrainType.FLAT_ROCK;
}

function isPassable(terrain: TerrainType): boolean {
  return terrain !== TerrainType.BOULDER && terrain !== TerrainType.CRATER;
}

/** BFS check + carving if source and destination are disconnected */
function ensureConnectivity(
  grid: GridCell[][], src: Position, dst: Position,
  W: number, H: number, rng: SeededRandom
) {
  // BFS from src to dst
  const visited = new Set<string>();
  const queue: Position[] = [src];
  visited.add(posKey(src.x, src.y));
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }];

  while (queue.length > 0) {
    const p = queue.shift()!;
    if (p.x === dst.x && p.y === dst.y) return; // connected

    for (const d of dirs) {
      const nx = p.x + d.x, ny = p.y + d.y;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
        const key = posKey(nx, ny);
        if (!visited.has(key) && isPassable(grid[ny][nx].terrain)) {
          visited.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  // Not connected — carve a path
  let cx = src.x, cy = src.y;
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
