// ============================================================
// Pathfinding — A* and Dijkstra for rover navigation
// ============================================================

import { Position, GridCell, TerrainType, TERRAIN_CONFIGS } from '../types/simulation';
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
  uncertaintyBuffer: number = 1.0
): { path: Position[]; energyCost: number } | null {
  const H = beliefMap.length;
  const W = beliefMap[0].length;

  if (goal.x < 0 || goal.x >= W || goal.y < 0 || goal.y >= H) return null;

  const openSet = new Map<string, PathNode>();
  const closedSet = new Set<string>();

  const startNode: PathNode = {
    x: start.x, y: start.y,
    g: 0,
    h: manhattan(start, goal),
    f: manhattan(start, goal),
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
      let totalEnergy = current.g;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.unshift({ x: node.x, y: node.y });
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
      const terrainCfg = TERRAIN_CONFIGS[cell.terrain];

      // Cannot pass through impassable terrain
      if (!terrainCfg.passable) continue;

      let moveCost = baseMovementEnergy * terrainCfg.movementCost;

      // Add uncertainty for unknown cells
      if (cell.terrain === TerrainType.UNKNOWN) {
        moveCost = baseMovementEnergy * TERRAIN_CONFIGS[TerrainType.UNKNOWN].movementCost * uncertaintyBuffer;
      }

      const tentativeG = current.g + moveCost;

      const existing = openSet.get(nKey);
      if (existing && tentativeG >= existing.g) continue;

      const newNode: PathNode = {
        x: nx, y: ny,
        g: tentativeG,
        h: manhattan({ x: nx, y: ny }, goal) * baseMovementEnergy,
        f: tentativeG + manhattan({ x: nx, y: ny }, goal) * baseMovementEnergy,
        parent: current,
      };
      openSet.set(nKey, newNode);
    }
  }

  return null; // No path
}

/**
 * Calculate the minimum energy to return to home base using Dijkstra.
 * Uses conservative estimates for unknown terrain.
 */
export function estimateReturnEnergy(
  beliefMap: GridCell[][],
  start: Position,
  homeBase: Position,
  baseMovementEnergy: number,
  uncertaintyBuffer: number
): number {
  const result = findPath(beliefMap, start, homeBase, baseMovementEnergy, uncertaintyBuffer);
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
  uncertaintyBuffer: number
): Position[] {
  const result = findPath(beliefMap, start, homeBase, baseMovementEnergy, uncertaintyBuffer);
  return result ? result.path : [];
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
