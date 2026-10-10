// ============================================================
// Pathfinding — A* and Dijkstra for rover navigation
// ============================================================

import { Position, GridCell, TerrainType, TERRAIN_CONFIGS, TerrainConfig } from '../types/simulation';
import { posKey } from '../utils/helpers';

interface PathNode {
  x: number;
  y: number;
  g: number;    // cost from start
  h: number;    // heuristic to goal
  f: number;    // g + h
  parent: PathNode | null;
}

const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
];

/**
 * A* pathfinding on the belief map.
 * Returns the path (excluding start, including goal) and total energy cost.
 * Returns null if no path exists.
 */
export function findPath(
  beliefMap: GridCell[][],
  start: Position,
  goal: Position,
  baseMovementEnergy: number,
  uncertaintyBuffer: number = 1.0,
  terrainConfigs?: Record<TerrainType, TerrainConfig>,
  visitedCounts?: Record<string, number>,
  visitPenaltyWeight: number = 0
): { path: Position[]; energyCost: number } | null {
  const H = beliefMap.length;
  const W = beliefMap[0].length;

  if (goal.x < 0 || goal.x >= W || goal.y < 0 || goal.y >= H) return null;
  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], energyCost: 0 };
  }

  const activeConfigs = terrainConfigs || TERRAIN_CONFIGS;
  const openSet = new Map<string, PathNode>();
  const closedSet = new Set<string>();

  const startNode: PathNode = {
    x: start.x, y: start.y,
    g: 0,
    h: manhattan(start, goal) * baseMovementEnergy,
    f: manhattan(start, goal) * baseMovementEnergy,
    parent: null,
  };
  openSet.set(posKey(start.x, start.y), startNode);

  while (openSet.size > 0) {
    // Find lowest f
    let current: PathNode | null = null;
    for (const node of openSet.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    if (current.x === goal.x && current.y === goal.y) {
      // Reconstruct path
      const path: Position[] = [];
      let node: PathNode | null = current;
      let totalEnergy = 0;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.unshift({ x: node.x, y: node.y });
        const cell = beliefMap[node.y][node.x];
        const cfg = activeConfigs[cell.terrain] || TERRAIN_CONFIGS[cell.terrain] || TERRAIN_CONFIGS[TerrainType.FLAT_ROCK];
        totalEnergy += baseMovementEnergy * (cfg.passable ? cfg.movementCost : 2.0);
        node = node.parent;
      }
      return { path, energyCost: totalEnergy };
    }

    const currentKey = posKey(current.x, current.y);
    openSet.delete(currentKey);
    closedSet.add(currentKey);

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nKey = posKey(nx, ny);
      if (closedSet.has(nKey)) continue;

      const cell = beliefMap[ny][nx];
      const terrainCfg = activeConfigs[cell.terrain] || TERRAIN_CONFIGS[cell.terrain];

      // Cannot pass through known impassable terrain
      if (cell.isRevealed && terrainCfg && !terrainCfg.passable) continue;

      let moveCost = baseMovementEnergy * (terrainCfg ? terrainCfg.movementCost : 1.0);

      // Low-risk safety routing: penalize high wheel-slip and hazardous terrain
      if (cell.terrain === TerrainType.SAND) {
        moveCost += baseMovementEnergy * 1.5; // High wheel slip hazard penalty
      } else if (cell.terrain === TerrainType.CRATER) {
        moveCost += baseMovementEnergy * 1.2; // Unstable crater slope penalty
      } else if (cell.terrain === TerrainType.GRAVEL) {
        moveCost += baseMovementEnergy * 0.35; // Loose pebble penalty
      }

      // Add uncertainty for unknown cells
      if (!cell.isRevealed || cell.terrain === TerrainType.UNKNOWN) {
        moveCost = baseMovementEnergy * TERRAIN_CONFIGS[TerrainType.UNKNOWN].movementCost * uncertaintyBuffer;
      }

      // Route diversification penalty for previously visited cells
      if (visitPenaltyWeight > 0 && visitedCounts && visitedCounts[nKey]) {
        moveCost += Math.min(visitedCounts[nKey] * visitPenaltyWeight, 15);
      }

      const tentativeG = current.g + moveCost;

      const existing = openSet.get(nKey);
      if (existing && tentativeG >= existing.g) continue;

      const hVal = manhattan({ x: nx, y: ny }, goal) * baseMovementEnergy;
      const newNode: PathNode = {
        x: nx, y: ny,
        g: tentativeG,
        h: hVal,
        f: tentativeG + hVal,
        parent: current,
      };
      openSet.set(nKey, newNode);
    }
  }

  return null; // No path
}

/**
 * Calculate the minimum energy to return to home base using A*.
 * Uses conservative estimates for unknown terrain.
 */
export function estimateReturnEnergy(
  beliefMap: GridCell[][],
  start: Position,
  homeBase: Position,
  baseMovementEnergy: number,
  uncertaintyBuffer: number,
  terrainConfigs?: Record<TerrainType, TerrainConfig>
): number {
  if (start.x === homeBase.x && start.y === homeBase.y) return 0;
  const result = findPath(beliefMap, start, homeBase, baseMovementEnergy, uncertaintyBuffer, terrainConfigs);
  if (!result) {
    // No known path — estimate using manhattan distance with high cost
    return manhattan(start, homeBase) * baseMovementEnergy * TERRAIN_CONFIGS[TerrainType.UNKNOWN].movementCost * uncertaintyBuffer;
  }
  return result.energyCost;
}

/**
 * Get the return path to home base
 */
export function findReturnPath(
  beliefMap: GridCell[][],
  start: Position,
  homeBase: Position,
  baseMovementEnergy: number,
  uncertaintyBuffer: number,
  terrainConfigs?: Record<TerrainType, TerrainConfig>
): Position[] {
  const result = findPath(beliefMap, start, homeBase, baseMovementEnergy, uncertaintyBuffer, terrainConfigs);
  return result ? result.path : [];
}

/**
 * Find the nearest reachable recharge haven (either Home Base or a Solar Charging Station)
 */
export function findNearestRechargeHaven(
  beliefMap: GridCell[][],
  start: Position,
  homeBase: Position,
  solarStations: Position[],
  baseMovementEnergy: number,
  uncertaintyBuffer: number,
  terrainConfigs?: Record<TerrainType, TerrainConfig>
): { destination: Position; path: Position[]; energyCost: number; isHome: boolean } | null {
  const havens: { pos: Position; isHome: boolean }[] = [
    { pos: homeBase, isHome: true },
    ...solarStations.map(s => ({ pos: s, isHome: false })),
  ];

  let bestResult: { destination: Position; path: Position[]; energyCost: number; isHome: boolean } | null = null;

  for (const haven of havens) {
    const res = findPath(beliefMap, start, haven.pos, baseMovementEnergy, uncertaintyBuffer, terrainConfigs);
    if (res) {
      if (!bestResult || res.energyCost < bestResult.energyCost) {
        bestResult = {
          destination: haven.pos,
          path: res.path,
          energyCost: res.energyCost,
          isHome: haven.isHome,
        };
      }
    }
  }

  return bestResult;
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

