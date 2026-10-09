// ============================================================
// useSimulation — React hook for simulation state & controls
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  SimulationState, SimulationConfig, DEFAULT_CONFIG,
  ActionType, Direction, DIRECTION_VECTORS, TERRAIN_CONFIGS,
  RoverMode, RoverAction,
} from '../types/simulation';
import {
  createInitialState, simulationTick, executeManualAction, updateDecisionGoal,
} from '../simulation/engine';
import { findReturnPath } from '../simulation/pathfinding';

export function useSimulation(initialConfig: SimulationConfig = DEFAULT_CONFIG) {
  const [state, setState] = useState<SimulationState>(() => createInitialState(initialConfig));
  const [config, setConfig] = useState<SimulationConfig>(initialConfig);
  const intervalRef = useRef<number | null>(null);

  // Auto-tick
  useEffect(() => {
    if (!state.isPaused && state.missionStarted && !state.missionComplete && !state.missionFailed) {
      intervalRef.current = window.setInterval(() => {
        setState(prev => {
          const next = simulationTick(prev);
          updateDecisionGoal(next);
          return next;
        });
      }, 1000 / state.simulationSpeed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.isPaused, state.missionStarted, state.missionComplete, state.missionFailed, state.simulationSpeed]);

  const startMission = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: false, missionStarted: true, isRunning: true }));
  }, []);

  const pauseMission = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resumeMission = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: false }));
  }, []);

  const stepMission = useCallback(() => {
    setState(prev => {
      const next = simulationTick({ ...prev, isPaused: true });
      updateDecisionGoal(next);
      return next;
    });
  }, []);

  const resetMission = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState(createInitialState(config));
  }, [config]);

  const newEnvironment = useCallback((seed?: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const newConfig = { ...config, seed: seed ?? Math.floor(Math.random() * 100000) };
    setConfig(newConfig);
    setState(createInitialState(newConfig));
  }, [config]);

  const setSeed = useCallback((seed: number) => {
    const newConfig = { ...config, seed };
    setConfig(newConfig);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState(createInitialState(newConfig));
  }, [config]);

  const setSpeed = useCallback((speed: number) => {
    setState(prev => ({ ...prev, simulationSpeed: speed }));
  }, []);

  const toggleMode = useCallback(() => {
    setState(prev => ({ ...prev, isAutonomous: !prev.isAutonomous }));
  }, []);

  // Manual controls
  const moveRover = useCallback((direction: Direction) => {
    setState(prev => {
      if (prev.isAutonomous) return prev;
      const vec = DIRECTION_VECTORS[direction];
      const nx = prev.roverPosition.x + vec.x;
      const ny = prev.roverPosition.y + vec.y;
      if (nx < 0 || nx >= prev.mapWidth || ny < 0 || ny >= prev.mapHeight) return prev;
      const cell = prev.beliefMap[ny][nx];
      const terrain = TERRAIN_CONFIGS[cell.terrain];
      if (!terrain.passable) return prev;

      const moveCost = prev.energyCosts.baseMovement * terrain.movementCost;
      const action: RoverAction = {
        type: ActionType.MOVE,
        direction,
        targetPosition: { x: nx, y: ny },
        energyCost: moveCost,
        description: `Manual move ${direction}`,
      };
      return executeManualAction(prev, action);
    });
  }, []);

  const manualScan = useCallback(() => {
    setState(prev => {
      if (prev.isAutonomous) return prev;
      const action: RoverAction = {
        type: ActionType.SCAN,
        energyCost: prev.energyCosts.scan,
        description: 'Manual sensor scan',
      };
      return executeManualAction(prev, action);
    });
  }, []);

  const manualCollect = useCallback(() => {
    setState(prev => {
      if (prev.isAutonomous) return prev;
      const cell = prev.groundTruth[prev.roverPosition.y][prev.roverPosition.x];
      if (!cell.hasResource || !cell.resource || cell.resource.collected) return prev;
      const action: RoverAction = {
        type: ActionType.COLLECT,
        targetResourceId: cell.resource.id,
        energyCost: cell.resource.collectionEnergy,
        description: `Manual collect ${cell.resource.type}`,
      };
      return executeManualAction(prev, action);
    });
  }, []);

  const manualReturn = useCallback(() => {
    setState(prev => {
      if (prev.isAutonomous) return prev;
      const returnPath = findReturnPath(prev.beliefMap, prev.roverPosition, prev.homeBase, prev.energyCosts.baseMovement, prev.uncertaintyBuffer);
      if (returnPath.length === 0) return prev;
      const firstStep = returnPath[0];
      const terrain = TERRAIN_CONFIGS[prev.beliefMap[firstStep.y][firstStep.x].terrain];
      const action: RoverAction = {
        type: ActionType.RETURN_TO_BASE,
        targetPosition: firstStep,
        energyCost: prev.energyCosts.baseMovement * terrain.movementCost,
        description: 'Manual return to base',
      };
      const next = executeManualAction(prev, action);
      next.roverPath = returnPath;
      next.roverTarget = prev.homeBase;
      return next;
    });
  }, []);

  const manualWait = useCallback(() => {
    setState(prev => {
      if (prev.isAutonomous) return prev;
      const action: RoverAction = {
        type: ActionType.WAIT,
        energyCost: prev.energyCosts.idle,
        description: 'Manual wait',
      };
      return executeManualAction(prev, action);
    });
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (state.isAutonomous) return;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': moveRover(Direction.NORTH); break;
        case 'ArrowDown': case 's': case 'S': moveRover(Direction.SOUTH); break;
        case 'ArrowRight': case 'd': case 'D': moveRover(Direction.EAST); break;
        case 'ArrowLeft': case 'a': case 'A': moveRover(Direction.WEST); break;
        case ' ': e.preventDefault(); manualScan(); break;
        case 'c': case 'C': manualCollect(); break;
        case 'r': case 'R': manualReturn(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.isAutonomous, moveRover, manualScan, manualCollect, manualReturn]);

  return {
    state,
    config,
    startMission,
    pauseMission,
    resumeMission,
    stepMission,
    resetMission,
    newEnvironment,
    setSeed,
    setSpeed,
    toggleMode,
    moveRover,
    manualScan,
    manualCollect,
    manualReturn,
    manualWait,
  };
}
