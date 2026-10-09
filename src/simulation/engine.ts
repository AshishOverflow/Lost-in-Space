// ============================================================
// Simulation Engine — Core game loop & state management
// ============================================================

import {
  SimulationState, SimulationConfig, DEFAULT_CONFIG,
  RoverMode, Direction, DIRECTION_VECTORS, ActionType,
  RoverAction, ActionCandidate, TerrainType, TERRAIN_CONFIGS,
  GridCell, Position, Resource, EventCategory, MissionEvent,
  DecisionState, HistoryPoint, LightingCondition, SolarState, BatteryState,
  RESOURCE_CONFIGS,
} from '../types/simulation';
import { generateEnvironment } from './terrainGenerator';
import { findPath, estimateReturnEnergy, findReturnPath } from './pathfinding';
import { updateSolarState, calculateSolarPower, calculateEnergyGenerated, predictSolarGeneration } from './solarModel';
import { posKey, posEqual, manhattanDist } from '../utils/helpers';

// ============================================================
// State creation
// ============================================================

export function createInitialState(config: SimulationConfig = DEFAULT_CONFIG): SimulationState {
  const env = generateEnvironment(config);

  const solar: SolarState = {
    ratedPower: config.ratedSolarPower,
    panelEfficiency: config.panelEfficiency,
    sunlightFactor: 0.9,
    currentPower: 0,
    lightingCondition: LightingCondition.DAYLIGHT,
    dustFactor: 1.0,
  };

  // Start at 8:00 AM simulation time (28800 seconds)
  const initialElapsedTime = 28800;
  const updatedSolar = updateSolarState(solar, initialElapsedTime, false);

  const battery: BatteryState = {
    capacity: config.batteryCapacity,
    currentEnergy: config.initialBattery,
    totalHarvested: 0,
    totalConsumed: 0,
  };

  const energyCosts = {
    baseMovement: 2.0,
    scan: 1.0,
    collect: 3.0,
    objectiveScan: 8.0,
    dataUpload: 2.0,
    idle: 0.1,
    communication: 0.5,
  };

  const state: SimulationState = {
    mapWidth: config.mapWidth,
    mapHeight: config.mapHeight,
    seed: config.seed,
    groundTruth: env.groundTruth,
    beliefMap: env.beliefMap,
    resources: env.resources,
    objectives: env.objectives,
    homeBase: env.homeBase,

    roverPosition: { ...env.roverStart },
    roverDirection: Direction.NORTH,
    roverMode: RoverMode.IDLE,
    roverPath: [],
    roverTrail: [{ ...env.roverStart }],
    roverTarget: null,

    solar: updatedSolar,
    battery,
    energyCosts,

    collectedResources: [],
    onboardData: 0,
    deliveredData: 0,
    missionStarted: false,
    missionComplete: false,
    missionFailed: false,

    decision: {
      currentGoal: 'Awaiting mission start',
      currentAction: 'Idle',
      actionReason: 'Mission not started',
      candidates: [],
      estimatedReturnEnergy: 0,
      safetyReserve: config.safetyReserve,
      riskLevel: 'LOW',
      nextPlannedAction: 'Start mission',
      safetyInterventions: 0,
    },
    events: [],
    metrics: {
      elapsedTime: initialElapsedTime,
      distanceTraveled: 0,
      totalEnergyConsumed: 0,
      totalEnergyHarvested: 0,
      resourcesCollected: 0,
      totalResourceValue: 0,
      scientificDataGenerated: 0,
      scientificDataDelivered: 0,
      mapExploredPercent: 0,
      discoveredCells: 0,
      totalCells: config.mapWidth * config.mapHeight,
      safetyInterventions: 0,
      rejectedActions: 0,
      returnRouteEnergy: 0,
    },
    history: [],

    isAutonomous: true,
    isPaused: true,
    isRunning: false,
    simulationSpeed: config.simulationSpeed,
    tickCount: 0,
    timePerTick: config.timePerTick,

    sensorRadius: config.sensorRadius,
    safetyReserve: config.safetyReserve,
    uncertaintyBuffer: config.uncertaintyBuffer,
  };

  // Initial sensor scan
  revealCells(state, state.roverPosition, state.sensorRadius);
  updateMetrics(state);
  recordHistory(state);

  return state;
}

// ============================================================
// Core tick — advances simulation by one step
// ============================================================

export function simulationTick(state: SimulationState): SimulationState {
  if (state.missionComplete || state.missionFailed) return state;
  if (!state.missionStarted) {
    state.missionStarted = true;
    state.isRunning = true;
    state.roverMode = RoverMode.EXPLORING;
    addEvent(state, EventCategory.MISSION, 'Mission started — AEGIS Rover deploying');
  }

  const s: SimulationState = {
    ...state,
    events: [...state.events],
    history: [...state.history],
    roverTrail: [...state.roverTrail],
    roverPath: [...state.roverPath],
    collectedResources: [...state.collectedResources],
    decision: {
      ...state.decision,
      candidates: [...state.decision.candidates],
    },
  };
  s.tickCount++;

  // 1. Update simulation time
  s.metrics = { ...s.metrics, elapsedTime: s.metrics.elapsedTime + s.timePerTick };

  // 2. Update solar conditions
  s.solar = updateSolarState(s.solar, s.metrics.elapsedTime, false);

  // 3. Generate solar energy
  const solarPower = calculateSolarPower(s.solar);
  const energyGenerated = calculateEnergyGenerated(solarPower, s.timePerTick);
  const prevEnergy = s.battery.currentEnergy;
  s.battery = {
    ...s.battery,
    currentEnergy: Math.min(s.battery.capacity, s.battery.currentEnergy + energyGenerated),
  };
  const actualHarvested = s.battery.currentEnergy - prevEnergy;
  if (actualHarvested > 0) {
    s.battery.totalHarvested += actualHarvested;
  }

  // 4. Deduct idle energy
  s.battery = consumeEnergy(s.battery, s.energyCosts.idle);

  // 5. Estimate return energy
  const returnEnergy = estimateReturnEnergy(
    s.beliefMap, s.roverPosition, s.homeBase,
    s.energyCosts.baseMovement, s.uncertaintyBuffer
  );
  s.decision = { ...s.decision, estimatedReturnEnergy: returnEnergy };
  s.metrics = { ...s.metrics, returnRouteEnergy: returnEnergy };

  // 6. Execute autonomous action
  if (s.isAutonomous && !s.missionComplete && !s.missionFailed) {
    executeAutonomousAction(s);
  }

  // 7. Update metrics
  updateMetrics(s);
  recordHistory(s);

  return s;
}

// ============================================================
// Autonomous action execution
// ============================================================

function executeAutonomousAction(s: SimulationState) {
  // Check for mission-ending states
  if (s.roverMode === RoverMode.MISSION_COMPLETE || s.roverMode === RoverMode.MISSION_FAILED) return;

  // Evaluate candidates
  const candidates = evaluateCandidates(s);
  s.decision = { ...s.decision, candidates };

  // Safety check
  const safetyResult = applySafetyChecks(s, candidates);

  if (safetyResult.forcedAction) {
    executeAction(s, safetyResult.forcedAction);
    return;
  }

  // Pick best safe candidate
  const safeCandidates = candidates.filter(c => c.safetyAllowed);
  if (safeCandidates.length === 0) {
    // No safe action — enter recovery
    s.roverMode = RoverMode.RECOVERY_REQUIRED;
    addEvent(s, EventCategory.SAFETY, 'No safe actions available — RECOVERY REQUIRED');
    s.decision.currentGoal = 'Recovery required';
    s.decision.actionReason = 'All actions violate safety constraints';
    s.decision.riskLevel = 'CRITICAL';
    return;
  }

  safeCandidates.sort((a, b) => b.utility - a.utility);
  const best = safeCandidates[0];
  executeAction(s, best.action);

  s.decision = {
    ...s.decision,
    currentAction: best.action.description,
    actionReason: best.explanation,
    riskLevel: getRiskLevel(s),
    nextPlannedAction: safeCandidates.length > 1 ? safeCandidates[1].action.description : 'None',
  };
}

// ============================================================
// Candidate action evaluation — Utility planner
// ============================================================

function evaluateCandidates(s: SimulationState): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const returnEnergy = s.decision.estimatedReturnEnergy;
  const safeEnergy = returnEnergy + s.safetyReserve + (returnEnergy * (s.uncertaintyBuffer - 1));

  // 1. Movement in four directions
  for (const dir of [Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST]) {
    const vec = DIRECTION_VECTORS[dir];
    const nx = s.roverPosition.x + vec.x;
    const ny = s.roverPosition.y + vec.y;
    if (nx < 0 || nx >= s.mapWidth || ny < 0 || ny >= s.mapHeight) continue;

    const beliefCell = s.beliefMap[ny][nx];
    const terrain = TERRAIN_CONFIGS[beliefCell.terrain];
    if (!terrain.passable) continue;

    const moveCost = s.energyCosts.baseMovement * terrain.movementCost;

    // Calculate utility components
    const isUnknown = !beliefCell.isRevealed;
    const infoGain = isUnknown ? 0.6 : countUnrevealedNeighbors(s, nx, ny) * 0.1;
    const hasResource = beliefCell.hasResource && beliefCell.resource && !beliefCell.resource.collected;
    const hasObjective = beliefCell.hasObjective && beliefCell.objective && !beliefCell.objective.scanned;
    const reward = hasResource ? (beliefCell.resource!.value / 70) : hasObjective ? 1.5 : 0;
    const distToHome = manhattanDist({ x: nx, y: ny }, s.homeBase);
    const currentDistToHome = manhattanDist(s.roverPosition, s.homeBase);

    // Mission progress based on distance to current target
    let missionProgress = 0;
    if (s.roverTarget) {
      const currentDist = manhattanDist(s.roverPosition, s.roverTarget);
      const newDist = manhattanDist({ x: nx, y: ny }, s.roverTarget);
      missionProgress = (currentDist - newDist) * 0.3;
    }

    // Risk based on battery level and distance from home
    const batteryPercent = s.battery.currentEnergy / s.battery.capacity;
    const risk = (1 - batteryPercent) * 0.3 + (distToHome / (s.mapWidth + s.mapHeight)) * 0.2;

    // If we should be returning, penalize moving away from home
    const shouldReturn = s.roverMode === RoverMode.RETURNING_TO_HUB ||
                          s.roverMode === RoverMode.LOW_POWER ||
                          s.roverMode === RoverMode.CONSERVING;

    let directionBonus = 0;
    if (shouldReturn) {
      directionBonus = distToHome < currentDistToHome ? 0.5 : -0.8;
    }

    // Utility calculation
    const utility = (
      0.3 * reward +
      0.25 * infoGain +
      0.2 * missionProgress +
      directionBonus -
      0.15 * (moveCost / s.energyCosts.baseMovement / 3) -
      0.1 * risk
    );

    const energyAfterAction = s.battery.currentEnergy - moveCost;
    const safetyAllowed = energyAfterAction >= safeEnergy;

    candidates.push({
      action: { type: ActionType.MOVE, direction: dir, energyCost: moveCost, description: `Move ${dir}`, targetPosition: { x: nx, y: ny } },
      utility,
      reward,
      informationGain: infoGain,
      missionProgress,
      energyCost: moveCost,
      timeCost: 1,
      risk,
      explanation: buildMoveExplanation(dir, infoGain, reward, risk, moveCost, safetyAllowed, beliefCell),
      safetyAllowed,
      safetyReason: safetyAllowed ? undefined : `Would leave ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh for safe return`,
    });
  }

  // 2. Scan action
  const scanGain = countUnrevealedInRadius(s, s.roverPosition, s.sensorRadius) * 0.15;
  if (scanGain > 0) {
    const scanSafe = s.battery.currentEnergy - s.energyCosts.scan >= safeEnergy;
    candidates.push({
      action: { type: ActionType.SCAN, energyCost: s.energyCosts.scan, description: 'Perform sensor scan' },
      utility: scanGain * 0.6,
      reward: 0,
      informationGain: scanGain,
      missionProgress: 0,
      energyCost: s.energyCosts.scan,
      timeCost: 1,
      risk: 0,
      explanation: `Scan to reveal ${Math.round(scanGain / 0.15)} unknown cells in sensor range`,
      safetyAllowed: scanSafe,
      safetyReason: scanSafe ? undefined : 'Insufficient energy for scan + safe return',
    });
  }

  // 3. Collect resource at current position
  const currentCell = s.groundTruth[s.roverPosition.y][s.roverPosition.x];
  if (currentCell.hasResource && currentCell.resource && !currentCell.resource.collected) {
    const res = currentCell.resource;
    const collectCost = res.collectionEnergy;
    const collectSafe = s.battery.currentEnergy - collectCost >= safeEnergy;
    candidates.push({
      action: { type: ActionType.COLLECT, targetResourceId: res.id, energyCost: collectCost, description: `Collect ${RESOURCE_CONFIGS[res.type].label}` },
      utility: res.value / 50 * 0.8,
      reward: res.value / 50,
      informationGain: 0,
      missionProgress: 0.1,
      energyCost: collectCost,
      timeCost: 1,
      risk: 0,
      explanation: `Collect ${RESOURCE_CONFIGS[res.type].label} (value: ${res.value}, cost: ${collectCost.toFixed(1)} Wh)`,
      safetyAllowed: collectSafe,
      safetyReason: collectSafe ? undefined : 'Insufficient energy for collection + safe return',
    });
  }

  // 4. Scan objective at current position
  if (currentCell.hasObjective && currentCell.objective && !currentCell.objective.scanned) {
    const obj = currentCell.objective;
    const objSafe = s.battery.currentEnergy - obj.scanEnergy >= safeEnergy;
    candidates.push({
      action: { type: ActionType.SCAN_OBJECTIVE, energyCost: obj.scanEnergy, description: `Scan ${obj.name}` },
      utility: 2.0,
      reward: obj.dataReward / 50,
      informationGain: 0.5,
      missionProgress: 0.5,
      energyCost: obj.scanEnergy,
      timeCost: 2,
      risk: 0.1,
      explanation: `Scan scientific objective '${obj.name}' for ${obj.dataReward} data units (cost: ${obj.scanEnergy} Wh)`,
      safetyAllowed: objSafe,
      safetyReason: objSafe ? undefined : 'Insufficient energy for scan + safe return',
    });
  }

  // 5. Upload data at home base
  if (posEqual(s.roverPosition, s.homeBase) && s.onboardData > 0) {
    const uploadSafe = s.battery.currentEnergy - s.energyCosts.dataUpload >= 0;
    candidates.push({
      action: { type: ActionType.UPLOAD_DATA, energyCost: s.energyCosts.dataUpload, description: 'Upload scientific data' },
      utility: 1.8,
      reward: s.onboardData / 50,
      informationGain: 0,
      missionProgress: 0.4,
      energyCost: s.energyCosts.dataUpload,
      timeCost: 1,
      risk: 0,
      explanation: `Upload ${s.onboardData.toFixed(0)} data units to mission control`,
      safetyAllowed: uploadSafe,
    });
  }

  // 6. Wait / harvest energy
  if (s.solar.currentPower > 0 && s.battery.currentEnergy < s.battery.capacity * 0.95) {
    const expectedHarvest = calculateEnergyGenerated(s.solar.currentPower, s.timePerTick);
    candidates.push({
      action: { type: ActionType.HARVEST_ENERGY, energyCost: s.energyCosts.idle, description: 'Harvest solar energy' },
      utility: s.battery.currentEnergy < s.battery.capacity * 0.4 ? 0.7 : 0.2,
      reward: expectedHarvest / 10,
      informationGain: 0,
      missionProgress: 0,
      energyCost: s.energyCosts.idle,
      timeCost: 1,
      risk: 0,
      explanation: `Harvest solar energy (expected: +${expectedHarvest.toFixed(1)} Wh at ${s.solar.currentPower.toFixed(1)} W)`,
      safetyAllowed: true,
    });
  }

  // 7. Return to base
  if (!posEqual(s.roverPosition, s.homeBase)) {
    const returnPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    if (returnPath.length > 0) {
      const firstStep = returnPath[0];
      const terrainCfg = TERRAIN_CONFIGS[s.beliefMap[firstStep.y][firstStep.x].terrain];
      const moveCost = s.energyCosts.baseMovement * terrainCfg.movementCost;
      const urgency = s.battery.currentEnergy < safeEnergy * 1.3 ? 1.5 : 0.3;
      const retEnergy = s.decision.estimatedReturnEnergy;

      candidates.push({
        action: { type: ActionType.RETURN_TO_BASE, direction: getDirectionTo(s.roverPosition, firstStep), targetPosition: firstStep, energyCost: moveCost, description: 'Return toward home base' },
        utility: urgency,
        reward: 0,
        informationGain: 0,
        missionProgress: posEqual(firstStep, s.homeBase) ? 0.3 : 0.1,
        energyCost: moveCost,
        timeCost: 1,
        risk: 0,
        explanation: `Navigate toward home base (${returnPath.length} steps, ~${retEnergy.toFixed(1)} Wh)${urgency > 1 ? ' — ENERGY LOW' : ''}`,
        safetyAllowed: true,
      });
    }
  }

  return candidates;
}

// ============================================================
// Safety Manager
// ============================================================

interface SafetyResult {
  forcedAction: RoverAction | null;
  interventionReason?: string;
}

function applySafetyChecks(s: SimulationState, candidates: ActionCandidate[]): SafetyResult {
  const returnEnergy = s.decision.estimatedReturnEnergy;
  const safeEnergy = returnEnergy + s.safetyReserve + (returnEnergy * (s.uncertaintyBuffer - 1));

  // Critical battery — force return
  if (s.battery.currentEnergy < safeEnergy * 1.1 && !posEqual(s.roverPosition, s.homeBase)) {
    const returnPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    if (returnPath.length > 0) {
      const firstStep = returnPath[0];
      const terrainCfg = TERRAIN_CONFIGS[s.beliefMap[firstStep.y][firstStep.x].terrain];
      const moveCost = s.energyCosts.baseMovement * terrainCfg.movementCost;

      s.roverMode = RoverMode.RETURNING_TO_HUB;
      s.roverPath = returnPath;
      s.roverTarget = s.homeBase;
      s.decision.safetyInterventions++;
      s.metrics.safetyInterventions++;
      addEvent(s, EventCategory.SAFETY, `Safety override: returning to base (battery: ${s.battery.currentEnergy.toFixed(1)} Wh, need: ${safeEnergy.toFixed(1)} Wh)`);

      return {
        forcedAction: {
          type: ActionType.RETURN_TO_BASE,
          direction: getDirectionTo(s.roverPosition, firstStep),
          targetPosition: firstStep,
          energyCost: moveCost,
          description: 'SAFETY: Return to base immediately',
        },
        interventionReason: `Battery critically low for safe return`,
      };
    }
  }

  // Low battery — switch to conserving mode
  if (s.battery.currentEnergy < safeEnergy * 1.5 && s.roverMode === RoverMode.EXPLORING) {
    s.roverMode = RoverMode.CONSERVING;
    addEvent(s, EventCategory.SAFETY, `Switching to CONSERVING mode (battery: ${(s.battery.currentEnergy / s.battery.capacity * 100).toFixed(0)}%)`);
    s.decision.currentGoal = 'Conserve energy and plan return';
  }

  // Low solar — be cautious
  if (s.solar.lightingCondition === LightingCondition.EVENING ||
      s.solar.lightingCondition === LightingCondition.NIGHT) {
    if (s.roverMode === RoverMode.EXPLORING && s.battery.currentEnergy < s.battery.capacity * 0.6) {
      s.roverMode = RoverMode.CONSERVING;
      addEvent(s, EventCategory.ENERGY, `Low solar conditions — switching to CONSERVING mode`);
    }
  }

  // Mark unsafe candidates
  for (const c of candidates) {
    const energyAfterAction = s.battery.currentEnergy - c.energyCost;
    if (energyAfterAction < safeEnergy) {
      c.safetyAllowed = false;
      c.safetyReason = `Would leave ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh for safe return`;
      s.metrics.rejectedActions++;
    }
  }

  return { forcedAction: null };
}

// ============================================================
// Action execution
// ============================================================

function executeAction(s: SimulationState, action: RoverAction) {
  switch (action.type) {
    case ActionType.MOVE:
    case ActionType.RETURN_TO_BASE:
      executeMove(s, action);
      break;
    case ActionType.SCAN:
      executeScan(s, action);
      break;
    case ActionType.COLLECT:
      executeCollect(s, action);
      break;
    case ActionType.SCAN_OBJECTIVE:
      executeScanObjective(s, action);
      break;
    case ActionType.UPLOAD_DATA:
      executeUpload(s, action);
      break;
    case ActionType.HARVEST_ENERGY:
    case ActionType.WAIT:
      executeWait(s, action);
      break;
  }
}

function executeMove(s: SimulationState, action: RoverAction) {
  if (!action.targetPosition && !action.direction) return;

  let target: Position;
  if (action.targetPosition) {
    target = action.targetPosition;
  } else {
    const vec = DIRECTION_VECTORS[action.direction!];
    target = { x: s.roverPosition.x + vec.x, y: s.roverPosition.y + vec.y };
  }

  // Validate against GROUND TRUTH
  if (target.x < 0 || target.x >= s.mapWidth || target.y < 0 || target.y >= s.mapHeight) return;
  const actualCell = s.groundTruth[target.y][target.x];
  const actualTerrain = TERRAIN_CONFIGS[actualCell.terrain];

  if (!actualTerrain.passable) {
    // Blocked! Update belief map
    s.beliefMap[target.y][target.x] = { ...s.beliefMap[target.y][target.x], terrain: actualCell.terrain, isRevealed: true };
    addEvent(s, EventCategory.NAVIGATION, `Path blocked by ${actualTerrain.label} at (${target.x}, ${target.y})`);
    s.roverPath = []; // Clear current path
    return;
  }

  // Calculate actual movement cost using ground truth
  const actualMoveCost = s.energyCosts.baseMovement * actualTerrain.movementCost;
  s.battery = consumeEnergy(s.battery, actualMoveCost);

  // Move rover
  s.roverPosition = { ...target };
  s.roverDirection = action.direction || s.roverDirection;
  s.roverTrail.push({ ...target });
  s.metrics.distanceTraveled++;

  // Reveal cells around new position
  const discovered = revealCells(s, target, s.sensorRadius);

  // Update path (remove reached waypoint)
  if (s.roverPath.length > 0 && posEqual(s.roverPath[0], target)) {
    s.roverPath = s.roverPath.slice(1);
  }

  // Update mode based on context
  if (action.type === ActionType.RETURN_TO_BASE) {
    s.roverMode = RoverMode.RETURNING_TO_HUB;
    s.decision.currentGoal = 'Return to home base';
  } else if (s.roverMode !== RoverMode.CONSERVING && s.roverMode !== RoverMode.RETURNING_TO_HUB) {
    // Check if we're navigating to something specific
    if (s.roverTarget && !posEqual(s.roverPosition, s.roverTarget)) {
      const targetCell = s.beliefMap[s.roverTarget.y]?.[s.roverTarget.x];
      if (targetCell?.hasResource) {
        s.roverMode = RoverMode.NAVIGATING_TO_RESOURCE;
      } else if (targetCell?.hasObjective) {
        s.roverMode = RoverMode.NAVIGATING_TO_OBJECTIVE;
      } else {
        s.roverMode = RoverMode.EXPLORING;
      }
    } else {
      s.roverMode = RoverMode.EXPLORING;
    }
  }

  // Check if reached home base
  if (posEqual(s.roverPosition, s.homeBase)) {
    addEvent(s, EventCategory.MISSION, 'Arrived at home base');
    if (s.roverMode === RoverMode.RETURNING_TO_HUB) {
      s.roverMode = RoverMode.IDLE;
      s.roverPath = [];
      s.roverTarget = null;
    }
    // Check mission completion
    checkMissionCompletion(s);
  }

  if (discovered > 0) {
    addEvent(s, EventCategory.DISCOVERY, `Discovered ${discovered} new cells near (${target.x}, ${target.y})`);
  }
}

function executeScan(s: SimulationState, action: RoverAction) {
  s.battery = consumeEnergy(s.battery, action.energyCost);
  const discovered = revealCells(s, s.roverPosition, s.sensorRadius + 1);
  addEvent(s, EventCategory.DISCOVERY, `Sensor scan complete — ${discovered} cells revealed`);
}

function executeCollect(s: SimulationState, action: RoverAction) {
  const resId = action.targetResourceId;
  if (!resId) return;
  const resource = s.resources.find(r => r.id === resId);
  if (!resource || resource.collected) return;

  s.battery = consumeEnergy(s.battery, action.energyCost);
  resource.collected = true;
  resource.discovered = true;
  s.collectedResources.push(resource);
  s.metrics.resourcesCollected++;
  s.metrics.totalResourceValue += resource.value;

  // Update ground truth and belief map
  const cell = s.groundTruth[resource.position.y][resource.position.x];
  cell.hasResource = false;
  const bCell = s.beliefMap[resource.position.y][resource.position.x];
  bCell.hasResource = false;

  s.roverMode = RoverMode.COLLECTING;
  addEvent(s, EventCategory.RESOURCE, `Collected ${RESOURCE_CONFIGS[resource.type].label} (value: ${resource.value}) at (${resource.position.x}, ${resource.position.y})`);

  // Set goal to find next target
  s.roverTarget = null;
  s.roverPath = [];
}

function executeScanObjective(s: SimulationState, action: RoverAction) {
  const obj = s.objectives.find(o => !o.scanned);
  if (!obj) return;

  s.battery = consumeEnergy(s.battery, action.energyCost);
  obj.scanned = true;
  s.onboardData += obj.dataReward;
  s.metrics.scientificDataGenerated += obj.dataReward;

  s.roverMode = RoverMode.SCANNING_OBJECTIVE;
  addEvent(s, EventCategory.SCIENCE, `Scanned '${obj.name}' — ${obj.dataReward} data units acquired`);

  // Set next goal: return to base
  s.decision.currentGoal = 'Return to base to deliver data';
  s.roverTarget = s.homeBase;
  s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
}

function executeUpload(s: SimulationState, action: RoverAction) {
  if (s.onboardData <= 0) return;
  s.battery = consumeEnergy(s.battery, action.energyCost);
  s.deliveredData += s.onboardData;
  s.metrics.scientificDataDelivered += s.onboardData;
  addEvent(s, EventCategory.SCIENCE, `Uploaded ${s.onboardData.toFixed(0)} data units to mission control`);
  s.onboardData = 0;

  s.roverMode = RoverMode.UPLOADING_DATA;
  checkMissionCompletion(s);
}

function executeWait(s: SimulationState, _action: RoverAction) {
  if (s.solar.currentPower > 0) {
    s.roverMode = RoverMode.HARVESTING;
    s.decision.currentGoal = 'Harvesting solar energy';
  } else {
    s.roverMode = RoverMode.WAITING_FOR_SUNLIGHT;
    s.decision.currentGoal = 'Waiting for sunlight';
  }
}

// ============================================================
// Manual action execution
// ============================================================

export function executeManualAction(state: SimulationState, action: RoverAction): SimulationState {
  if (state.missionComplete || state.missionFailed) return state;

  const s = { ...state };
  if (!s.missionStarted) {
    s.missionStarted = true;
    s.isRunning = true;
    addEvent(s, EventCategory.MISSION, 'Mission started — Manual control mode');
  }

  s.tickCount++;
  s.metrics = { ...s.metrics, elapsedTime: s.metrics.elapsedTime + s.timePerTick };

  // Solar update
  s.solar = updateSolarState(s.solar, s.metrics.elapsedTime, false);
  const solarPower = calculateSolarPower(s.solar);
  const energyGenerated = calculateEnergyGenerated(solarPower, s.timePerTick);
  const prevEnergy = s.battery.currentEnergy;
  s.battery = {
    ...s.battery,
    currentEnergy: Math.min(s.battery.capacity, s.battery.currentEnergy + energyGenerated),
  };
  const actualHarvested = s.battery.currentEnergy - prevEnergy;
  if (actualHarvested > 0) {
    s.battery.totalHarvested += actualHarvested;
  }

  // Idle cost
  s.battery = consumeEnergy(s.battery, s.energyCosts.idle);

  // Update return estimate
  const returnEnergy = estimateReturnEnergy(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
  s.decision = { ...s.decision, estimatedReturnEnergy: returnEnergy };
  s.metrics = { ...s.metrics, returnRouteEnergy: returnEnergy };

  // Safety check for manual action
  const safeEnergy = returnEnergy + s.safetyReserve + (returnEnergy * (s.uncertaintyBuffer - 1));
  const energyAfterAction = s.battery.currentEnergy - action.energyCost;

  if (action.type !== ActionType.RETURN_TO_BASE && action.type !== ActionType.WAIT &&
      action.type !== ActionType.HARVEST_ENERGY && action.type !== ActionType.UPLOAD_DATA) {
    if (energyAfterAction < safeEnergy && !posEqual(s.roverPosition, s.homeBase)) {
      addEvent(s, EventCategory.SAFETY, `Manual action rejected: ${action.description} — insufficient energy for safe return`);
      s.decision.actionReason = `Action rejected: would leave ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh`;
      s.metrics.rejectedActions++;
      updateMetrics(s);
      recordHistory(s);
      return s;
    }
  }

  executeAction(s, action);
  updateMetrics(s);
  recordHistory(s);
  return s;
}

// ============================================================
// Helper functions
// ============================================================

function consumeEnergy(battery: BatteryState, amount: number): BatteryState {
  const consumed = Math.min(battery.currentEnergy, amount);
  return {
    ...battery,
    currentEnergy: Math.max(0, battery.currentEnergy - consumed),
    totalConsumed: battery.totalConsumed + consumed,
  };
}

function revealCells(s: SimulationState, center: Position, radius: number): number {
  let discovered = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue; // Manhattan distance
      const nx = center.x + dx, ny = center.y + dy;
      if (nx < 0 || nx >= s.mapWidth || ny < 0 || ny >= s.mapHeight) continue;

      if (!s.beliefMap[ny][nx].isRevealed) {
        const actual = s.groundTruth[ny][nx];
        s.beliefMap[ny][nx] = {
          ...actual,
          isRevealed: true,
        };
        discovered++;

        // Discover resources
        if (actual.hasResource && actual.resource && !actual.resource.discovered) {
          actual.resource.discovered = true;
          addEvent(s, EventCategory.RESOURCE, `Detected ${RESOURCE_CONFIGS[actual.resource.type].label} at (${nx}, ${ny})`);
        }

        // Discover objectives
        if (actual.hasObjective && actual.objective && !actual.objective.discovered) {
          actual.objective.discovered = true;
          addEvent(s, EventCategory.SCIENCE, `Discovered scientific objective '${actual.objective.name}' at (${nx}, ${ny})`);
          s.decision.currentGoal = `Navigate to ${actual.objective.name}`;
          s.roverTarget = actual.objective.position;
          s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, actual.objective.position, s.energyCosts.baseMovement, 1.0) || [];
        }
      }
    }
  }
  return discovered;
}

function countUnrevealedNeighbors(s: SimulationState, x: number, y: number): number {
  let count = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight) {
        if (!s.beliefMap[ny][nx].isRevealed) count++;
      }
    }
  }
  return count;
}

function countUnrevealedInRadius(s: SimulationState, center: Position, radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const nx = center.x + dx, ny = center.y + dy;
      if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight) {
        if (!s.beliefMap[ny][nx].isRevealed) count++;
      }
    }
  }
  return count;
}

function updateMetrics(s: SimulationState) {
  let explored = 0;
  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      if (s.beliefMap[y][x].isRevealed) explored++;
    }
  }
  s.metrics = {
    ...s.metrics,
    totalEnergyConsumed: s.battery.totalConsumed,
    totalEnergyHarvested: s.battery.totalHarvested,
    discoveredCells: explored,
    mapExploredPercent: explored / s.metrics.totalCells,
  };
}

function recordHistory(s: SimulationState) {
  s.history.push({
    time: s.metrics.elapsedTime,
    battery: s.battery.currentEnergy,
    solarPower: s.solar.currentPower,
    harvested: s.battery.totalHarvested,
    consumed: s.battery.totalConsumed,
    explored: s.metrics.mapExploredPercent,
  });
}

function addEvent(s: SimulationState, category: EventCategory, description: string, energyValue?: number) {
  s.events.push({
    id: `evt-${s.events.length}`,
    timestamp: s.metrics.elapsedTime,
    category,
    description,
    energyValue,
  });
}

function checkMissionCompletion(s: SimulationState) {
  const allObjectivesScanned = s.objectives.every(o => o.scanned);
  const minResourcesCollected = s.collectedResources.length >= 3;
  const atBase = posEqual(s.roverPosition, s.homeBase);
  const dataDelivered = s.deliveredData >= 50;

  if (atBase && allObjectivesScanned && minResourcesCollected && dataDelivered) {
    s.missionComplete = true;
    s.roverMode = RoverMode.MISSION_COMPLETE;
    addEvent(s, EventCategory.MISSION, 'Mission COMPLETE! All objectives achieved.');
    s.decision.currentGoal = 'Mission Complete';
    s.decision.currentAction = 'All objectives achieved';
    s.decision.riskLevel = 'LOW';
  }
}

function getRiskLevel(s: SimulationState): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const batteryPercent = s.battery.currentEnergy / s.battery.capacity;
  const safeEnergy = s.decision.estimatedReturnEnergy + s.safetyReserve;
  const energyRatio = s.battery.currentEnergy / safeEnergy;

  if (energyRatio < 1.1 || batteryPercent < 0.15) return 'CRITICAL';
  if (energyRatio < 1.5 || batteryPercent < 0.3) return 'HIGH';
  if (energyRatio < 2.0 || batteryPercent < 0.5) return 'MEDIUM';
  return 'LOW';
}

function getDirectionTo(from: Position, to: Position): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? Direction.EAST : Direction.WEST;
  }
  return dy > 0 ? Direction.SOUTH : Direction.NORTH;
}

function buildMoveExplanation(
  dir: Direction, infoGain: number, reward: number,
  risk: number, energyCost: number, safe: boolean, cell: GridCell
): string {
  const parts: string[] = [];
  if (infoGain > 0.3) parts.push('reveals unexplored terrain');
  if (reward > 0.3) parts.push(cell.hasResource ? 'approaches resource' : 'approaches objective');
  if (risk > 0.3) parts.push('elevated risk');
  if (!safe) parts.push('UNSAFE — violates return reserve');
  parts.push(`cost: ${energyCost.toFixed(1)} Wh`);
  return `Move ${dir}: ${parts.join(', ')}`;
}

// ============================================================
// Utility: update decision goal based on state
// ============================================================

export function updateDecisionGoal(s: SimulationState) {
  if (s.missionComplete || s.missionFailed) return;

  const atBase = posEqual(s.roverPosition, s.homeBase);
  const hasUnscannedObjective = s.objectives.some(o => o.discovered && !o.scanned);
  const hasDiscoveredResources = s.resources.some(r => r.discovered && !r.collected);
  const hasOnboardData = s.onboardData > 0;

  if (s.roverMode === RoverMode.RETURNING_TO_HUB || s.roverMode === RoverMode.LOW_POWER) {
    s.decision.currentGoal = 'Return to home base safely';
  } else if (atBase && hasOnboardData) {
    s.decision.currentGoal = 'Upload collected data';
  } else if (hasUnscannedObjective) {
    const obj = s.objectives.find(o => o.discovered && !o.scanned)!;
    s.decision.currentGoal = `Navigate to ${obj.name}`;
    s.roverTarget = obj.position;
  } else if (hasDiscoveredResources) {
    const nearest = s.resources
      .filter(r => r.discovered && !r.collected)
      .sort((a, b) => manhattanDist(a.position, s.roverPosition) - manhattanDist(b.position, s.roverPosition));
    if (nearest.length > 0) {
      s.decision.currentGoal = `Collect ${RESOURCE_CONFIGS[nearest[0].type].label}`;
      s.roverTarget = nearest[0].position;
    }
  } else {
    s.decision.currentGoal = 'Explore unknown terrain';
    // Find nearest unexplored frontier
    s.roverTarget = findExplorationTarget(s);
  }
}

function findExplorationTarget(s: SimulationState): Position | null {
  let bestPos: Position | null = null;
  let bestScore = -Infinity;

  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      if (s.beliefMap[y][x].isRevealed) continue;
      // Find unrevealed cells adjacent to revealed cells
      let adjacentRevealed = false;
      for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
        const nx = x + d.x, ny = y + d.y;
        if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight && s.beliefMap[ny][nx].isRevealed) {
          adjacentRevealed = true;
          break;
        }
      }
      if (!adjacentRevealed) continue;

      const dist = manhattanDist({ x, y }, s.roverPosition);
      const score = -dist; // Prefer closer frontier cells
      if (score > bestScore) {
        bestScore = score;
        bestPos = { x, y };
      }
    }
  }

  return bestPos;
}
