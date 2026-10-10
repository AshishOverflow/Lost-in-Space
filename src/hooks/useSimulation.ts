import { useState, useCallback, useRef, useEffect } from 'react';
import {
  SimulationState, SimulationConfig, DEFAULT_CONFIG,
  ActionType, Direction, DIRECTION_VECTORS, TERRAIN_CONFIGS, TerrainType,
  RoverAction, EventCategory,
} from '../types/simulation';
import {
  createInitialState, simulationTick, executeManualAction, updateDecisionGoal,
} from '../simulation/engine';
import { findReturnPath } from '../simulation/pathfinding';
import { DEFAULT_ENVIRONMENT, MAPS_REGISTRY, AVAILABLE_MAPS } from '../environments/maps';

export function useSimulation(initialConfig: SimulationConfig = DEFAULT_CONFIG) {
  const [currentMapId, setCurrentMapId] = useState<string>('mars');
  const [config, setConfig] = useState<SimulationConfig>(() => {
    const envProps = MAPS_REGISTRY['mars'] || DEFAULT_ENVIRONMENT;
    return {
      ...initialConfig,
      environmentId: envProps.id,
      mapWidth: envProps.mapWidth,
      mapHeight: envProps.mapHeight,
      batteryCapacity: envProps.batteryCapacity,
      initialBattery: envProps.initialBattery,
      ratedSolarPower: envProps.solar.ratedSolarPower,
      panelEfficiency: envProps.solar.panelEfficiency,
      safetyReserve: envProps.safetyReserve,
      uncertaintyBuffer: envProps.uncertaintyBuffer,
      sensorRadius: envProps.sensorRadius,
    };
  });
  const [state, setState] = useState<SimulationState>(() => {
    const envProps = MAPS_REGISTRY['mars'] || DEFAULT_ENVIRONMENT;
    return createInitialState(initialConfig, envProps);
  });
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

  const switchMap = useCallback((mapId: string, seed?: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const envProps = MAPS_REGISTRY[mapId] || DEFAULT_ENVIRONMENT;
    setCurrentMapId(envProps.id);
    const newConfig: SimulationConfig = {
      ...config,
      environmentId: envProps.id,
      mapWidth: envProps.mapWidth,
      mapHeight: envProps.mapHeight,
      batteryCapacity: envProps.batteryCapacity,
      initialBattery: envProps.initialBattery,
      ratedSolarPower: envProps.solar.ratedSolarPower,
      panelEfficiency: envProps.solar.panelEfficiency,
      safetyReserve: envProps.safetyReserve,
      uncertaintyBuffer: envProps.uncertaintyBuffer,
      sensorRadius: envProps.sensorRadius,
      seed: seed ?? config.seed,
    };
    setConfig(newConfig);
    setState(createInitialState(newConfig, envProps));
  }, [config]);

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
    const envProps = MAPS_REGISTRY[currentMapId] || DEFAULT_ENVIRONMENT;
    setState(createInitialState(config, envProps));
  }, [config, currentMapId]);

  const clearEvents = useCallback(() => {
    setState(prev => ({ ...prev, events: [] }));
  }, []);

  const newEnvironment = useCallback((seed?: number) => {
    switchMap(currentMapId, seed ?? Math.floor(Math.random() * 100000));
  }, [currentMapId, switchMap]);

  const setSeed = useCallback((seed: number) => {
    switchMap(currentMapId, seed);
  }, [currentMapId, switchMap]);

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
      const activeConfigs = prev.terrainConfigs || TERRAIN_CONFIGS;
      const terrain = activeConfigs[cell.terrain];
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
      const returnPath = findReturnPath(prev.beliefMap, prev.roverPosition, prev.homeBase, prev.energyCosts.baseMovement, prev.uncertaintyBuffer, prev.terrainConfigs);
      if (returnPath.length === 0) return prev;
      const firstStep = returnPath[0];
      const activeConfigs = prev.terrainConfigs || TERRAIN_CONFIGS;
      const cellTerrain = prev.beliefMap[firstStep.y][firstStep.x].terrain as TerrainType;
      const terrain = (activeConfigs && activeConfigs[cellTerrain]) || TERRAIN_CONFIGS[TerrainType.FLAT_ROCK];
      const action: RoverAction = {
        type: ActionType.RETURN_TO_BASE,
        targetPosition: firstStep,
        energyCost: prev.energyCosts.baseMovement * (terrain ? terrain.movementCost : 1.0),
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

  const confirmMostValuableLocation = useCallback((confirmed: boolean, customPos?: { x: number; y: number }) => {
    setState(prev => {
      if (!prev.mostValuableLocation && !customPos) return prev;
      const targetPos = customPos || (prev.mostValuableLocation ? { x: prev.mostValuableLocation.x, y: prev.mostValuableLocation.y } : { x: Math.floor(prev.mapWidth / 2), y: Math.floor(prev.mapHeight / 2) });
      const currentMvl = prev.mostValuableLocation || {
        x: targetPos.x,
        y: targetPos.y,
        name: 'Designated Prime Science Site',
        description: 'Designated high-priority scientific anomaly site.',
        scientificYield: 50,
        confirmed: false,
        visited: false,
      };

      const updatedMvl = {
        ...currentMvl,
        x: targetPos.x,
        y: targetPos.y,
        confirmed,
      };

      const updatedEvents = [
        ...prev.events,
        {
          id: `evt-${Date.now()}-mvl-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: prev.metrics.elapsedTime,
          category: EventCategory.DECISION,
          description: confirmed
            ? `MISSION DIRECTIVE: Prime Science Site designated at (${updatedMvl.x}, ${updatedMvl.y}). Rover path planning prioritizing scientific reconnaissance.`
            : `MISSION DIRECTIVE: Prime Science Site optional exploration declined. Nominal exploration protocol engaged.`,
        }
      ];

      return {
        ...prev,
        mostValuableLocation: updatedMvl,
        events: updatedEvents,
      };
    });
  }, []);

  return {
    state,
    config,
    currentMapId,
    availableMaps: AVAILABLE_MAPS,
    switchMap,
    startMission,
    pauseMission,
    resumeMission,
    stepMission,
    resetMission,
    clearEvents,
    newEnvironment,
    setSeed,
    setSpeed,
    toggleMode,
    confirmMostValuableLocation,
    moveRover,
    manualScan,
    manualCollect,
    manualReturn,
    manualWait,
  };
}
