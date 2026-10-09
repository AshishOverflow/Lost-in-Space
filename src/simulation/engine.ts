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
import { generateEnvironment } from '../environments/generator';
import { EnvironmentProperties } from '../environments/types';
import { DEFAULT_ENVIRONMENT, MAPS_REGISTRY } from '../environments/maps';
import { findPath, estimateReturnEnergy, findReturnPath } from './pathfinding';
import { updateSolarState, calculateSolarPower, calculateEnergyGenerated, predictSolarGeneration } from './solarModel';
import { posKey, posEqual, manhattanDist } from '../utils/helpers';

// ============================================================
// State creation
// ============================================================

export function createInitialState(
  config: SimulationConfig = DEFAULT_CONFIG,
  environment?: EnvironmentProperties
): SimulationState {
  const envProps = environment || (config.environmentId ? MAPS_REGISTRY[config.environmentId] : undefined) || DEFAULT_ENVIRONMENT;
  const env = generateEnvironment(envProps, config.seed);

  const solar: SolarState = {
    ratedPower: envProps.solar.ratedSolarPower,
    panelEfficiency: envProps.solar.panelEfficiency,
    sunlightFactor: envProps.solar.baseSunlightFactor,
    currentPower: 0,
    lightingCondition: envProps.solar.initialLighting ?? LightingCondition.DAYLIGHT,
    dustFactor: envProps.solar.dustFactor,
  };

  // Start at 8:00 AM simulation time (28800 seconds)
  const initialElapsedTime = 28800;
  const updatedSolar = updateSolarState(solar, initialElapsedTime, false);

  const battery: BatteryState = {
    capacity: envProps.batteryCapacity,
    currentEnergy: envProps.initialBattery,
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
    ...(envProps.energyCosts || {}),
  };

  const state: SimulationState = {
    mapWidth: envProps.mapWidth,
    mapHeight: envProps.mapHeight,
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
      safetyReserve: envProps.safetyReserve,
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
      totalCells: envProps.mapWidth * envProps.mapHeight,
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
    timePerTick: envProps.timePerTick ?? config.timePerTick,

    sensorRadius: envProps.sensorRadius,
    safetyReserve: envProps.safetyReserve,
    uncertaintyBuffer: envProps.uncertaintyBuffer,

    environmentId: envProps.id,
    environmentName: envProps.name,
    environmentSubtitle: envProps.subtitle,
    environmentDescription: envProps.description,
    environmentProperties: envProps,
    terrainConfigs: env.terrainConfigs,
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
    collectedResources: state.collectedResources.map(r => ({ ...r })),
    resources: state.resources.map(r => ({ ...r })),
    objectives: state.objectives.map(o => ({ ...o })),
    decision: {
      ...state.decision,
      candidates: [...state.decision.candidates],
    },
    metrics: { ...state.metrics },
    battery: { ...state.battery },
    solar: { ...state.solar },
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

  // 3b. Base Station Hub power recharge & data downlink
  if (posEqual(s.roverPosition, s.homeBase)) {
    const chargeNeeded = s.battery.capacity - s.battery.currentEnergy;
    const baseRecharge = Math.min(chargeNeeded, 25);
    if (baseRecharge > 0) {
      s.battery.currentEnergy += baseRecharge;
      s.battery.totalHarvested += baseRecharge;
    }
    // Auto-offload data at base
    if (s.onboardData > 0) {
      const delivered = s.onboardData;
      s.deliveredData += delivered;
      s.metrics.scientificDataDelivered += delivered;
      s.onboardData = 0;
      addEvent(s, EventCategory.SCIENCE, `Base station downlink: Delivered ${delivered.toFixed(0)} scientific data units to mission control`);
    }
    // Reset from conserving/returning mode once charged sufficiently
    if (s.battery.currentEnergy >= s.battery.capacity * 0.85 && !s.missionComplete && !s.missionFailed) {
      if (s.roverMode === RoverMode.IDLE || s.roverMode === RoverMode.CONSERVING || s.roverMode === RoverMode.RETURNING_TO_HUB) {
        s.roverMode = RoverMode.EXPLORING;
        addEvent(s, EventCategory.ENERGY, 'Battery recharged to 85%+. Resuming mission exploration.');
      }
    }
  }

  // 4. Deduct idle energy (if not docked at base)
  if (!posEqual(s.roverPosition, s.homeBase)) {
    s.battery = consumeEnergy(s.battery, s.energyCosts.idle);
  }

  // 5. Estimate return energy
  const returnEnergy = estimateReturnEnergy(
    s.beliefMap, s.roverPosition, s.homeBase,
    s.energyCosts.baseMovement, s.uncertaintyBuffer
  );
  s.decision = { ...s.decision, estimatedReturnEnergy: returnEnergy };
  s.metrics = { ...s.metrics, returnRouteEnergy: returnEnergy };

  // 6. Update goal and target path before autonomous evaluation
  updateDecisionGoal(s);

  // 7. Execute autonomous action
  if (s.isAutonomous && !s.missionComplete && !s.missionFailed) {
    executeAutonomousAction(s);
  }

  // 8. Update metrics and record history
  updateMetrics(s);
  recordHistory(s);

  // 9. Check mission completion
  checkMissionCompletion(s);

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
    s.decision = {
      ...s.decision,
      currentAction: safetyResult.forcedAction.description,
      actionReason: safetyResult.interventionReason || 'Forced safety action',
      riskLevel: 'CRITICAL',
    };
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

function calculateSafeReturnEnergy(s: SimulationState): number {
  const returnEnergy = s.decision.estimatedReturnEnergy;
  if (returnEnergy <= 0 || posEqual(s.roverPosition, s.homeBase)) {
    return s.safetyReserve;
  }
  const dist = manhattanDist(s.roverPosition, s.homeBase);
  const durationSeconds = dist * s.timePerTick;
  const predictedSolar = predictSolarGeneration(s.solar, s.metrics.elapsedTime, durationSeconds, s.timePerTick);
  const solarCredit = Math.min(predictedSolar * 0.5, returnEnergy * 0.5);
  return Math.max(s.safetyReserve, returnEnergy + s.safetyReserve - solarCredit);
}

function evaluateCandidates(s: SimulationState): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const safeEnergy = calculateSafeReturnEnergy(s);
  const isAtBase = posEqual(s.roverPosition, s.homeBase);

  // 0. Base Station Hub Rapid Recharging (Top priority if at base with depleted battery)
  if (isAtBase && s.battery.currentEnergy < s.battery.capacity * 0.85) {
    candidates.push({
      action: { type: ActionType.WAIT, energyCost: 0, description: 'Recharge at Base Station' },
      utility: 3.6,
      reward: 0.5,
      informationGain: 0,
      missionProgress: 0.3,
      energyCost: 0,
      timeCost: 1,
      risk: 0,
      explanation: `Base Hub fast recharge active (${((s.battery.currentEnergy / s.battery.capacity) * 100).toFixed(0)}% / 85% ready)`,
      safetyAllowed: true,
    });
  }

  // 1. Movement in four directions
  for (const dir of [Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST]) {
    // When docked at base, do not depart until battery is at least 80% charged
    if (isAtBase && s.battery.currentEnergy < s.battery.capacity * 0.80) {
      continue;
    }

    const vec = DIRECTION_VECTORS[dir];
    const nx = s.roverPosition.x + vec.x;
    const ny = s.roverPosition.y + vec.y;
    if (nx < 0 || nx >= s.mapWidth || ny < 0 || ny >= s.mapHeight) continue;

    const beliefCell = s.beliefMap[ny][nx];
    const terrain = (s.terrainConfigs && s.terrainConfigs[beliefCell.terrain]) || TERRAIN_CONFIGS[beliefCell.terrain];
    if (!terrain.passable) continue;

    const moveCost = s.energyCosts.baseMovement * terrain.movementCost;

    // Calculate utility components
    const isUnknown = !beliefCell.isRevealed;
    const infoGain = isUnknown ? 0.7 : countUnrevealedNeighbors(s, nx, ny) * 0.15;
    const hasResource = beliefCell.hasResource && beliefCell.resource && !beliefCell.resource.collected;
    const hasObjective = beliefCell.hasObjective && beliefCell.objective && !beliefCell.objective.scanned;
    const reward = hasResource ? (beliefCell.resource!.value / 50) : hasObjective ? 1.5 : 0;
    const distToHome = manhattanDist({ x: nx, y: ny }, s.homeBase);
    const currentDistToHome = manhattanDist(s.roverPosition, s.homeBase);

    // Direct high reward for stepping onto an uncollected resource or unscanned objective
    let cellReward = 0;
    if (hasResource) {
      cellReward = 2.0;
    } else if (hasObjective) {
      cellReward = 2.5;
    }

    // Following precomputed optimal path bonus
    let pathBonus = 0;
    if (s.roverPath.length > 0 && s.roverPath[0].x === nx && s.roverPath[0].y === ny) {
      pathBonus = 1.2;
    }

    // Mission progress based on distance to current target
    let missionProgress = 0;
    if (s.roverTarget) {
      const currentDist = manhattanDist(s.roverPosition, s.roverTarget);
      const newDist = manhattanDist({ x: nx, y: ny }, s.roverTarget);
      missionProgress = (currentDist - newDist) * 0.6;
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
      directionBonus = distToHome < currentDistToHome ? 0.8 : -1.2;
    }

    // Anti-oscillation: penalize stepping right back to the previous tile unless returning
    const prevPos = s.roverTrail.length >= 2 ? s.roverTrail[s.roverTrail.length - 2] : null;
    const isBacktrack = prevPos && prevPos.x === nx && prevPos.y === ny;
    const backtrackPenalty = (isBacktrack && !shouldReturn) ? 0.45 : 0;

    // Overall utility calculation
    const utility = (
      cellReward +
      pathBonus +
      0.5 * reward +
      0.8 * infoGain +
      missionProgress +
      directionBonus -
      backtrackPenalty -
      0.1 * (moveCost / s.energyCosts.baseMovement) -
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

  // 2. Scan action — Active sensor sweep in dense unknown regions
  const unrevealedInRange = countUnrevealedInRadius(s, s.roverPosition, s.sensorRadius + 1);
  if (unrevealedInRange >= 5 && !isAtBase && s.battery.currentEnergy > safeEnergy + s.energyCosts.scan * 2) {
    const scanSafe = s.battery.currentEnergy - s.energyCosts.scan >= safeEnergy;
    candidates.push({
      action: { type: ActionType.SCAN, energyCost: s.energyCosts.scan, description: 'Perform sensor scan' },
      utility: 1.35 + Math.min(1.0, (unrevealedInRange / 20) * 0.5),
      reward: 0.5,
      informationGain: unrevealedInRange * 0.1,
      missionProgress: 0.3,
      energyCost: s.energyCosts.scan,
      timeCost: 1,
      risk: 0,
      explanation: `Sensor sweep reveals ~${unrevealedInRange} cells in expanded sensor range`,
      safetyAllowed: scanSafe,
      safetyReason: scanSafe ? undefined : 'Insufficient energy for scan + safe return',
    });
  }

  // 3. Collect resource at current position (Top priority!)
  const currentCell = s.groundTruth[s.roverPosition.y][s.roverPosition.x];
  if (currentCell.hasResource && currentCell.resource && !currentCell.resource.collected) {
    const res = currentCell.resource;
    const collectCost = res.collectionEnergy;
    const collectSafe = s.battery.currentEnergy - collectCost >= safeEnergy;
    candidates.push({
      action: { type: ActionType.COLLECT, targetResourceId: res.id, energyCost: collectCost, description: `Collect ${RESOURCE_CONFIGS[res.type].label}` },
      utility: 3.2,
      reward: res.value / 50,
      informationGain: 0,
      missionProgress: 0.8,
      energyCost: collectCost,
      timeCost: 1,
      risk: 0,
      explanation: `Collect ${RESOURCE_CONFIGS[res.type].label} (value: ${res.value}, cost: ${collectCost.toFixed(1)} Wh)`,
      safetyAllowed: collectSafe,
      safetyReason: collectSafe ? undefined : 'Insufficient energy for collection + safe return',
    });
  }

  // 4. Scan objective at current position (Top priority!)
  if (currentCell.hasObjective && currentCell.objective && !currentCell.objective.scanned) {
    const obj = currentCell.objective;
    const objSafe = s.battery.currentEnergy - obj.scanEnergy >= safeEnergy;
    candidates.push({
      action: { type: ActionType.SCAN_OBJECTIVE, energyCost: obj.scanEnergy, description: `Scan ${obj.name}` },
      utility: 3.5,
      reward: obj.dataReward / 50,
      informationGain: 0.5,
      missionProgress: 1.0,
      energyCost: obj.scanEnergy,
      timeCost: 2,
      risk: 0.1,
      explanation: `Scan scientific objective '${obj.name}' for ${obj.dataReward} data units (cost: ${obj.scanEnergy} Wh)`,
      safetyAllowed: objSafe,
      safetyReason: objSafe ? undefined : 'Insufficient energy for scan + safe return',
    });
  }

  // 5. Upload data at home base
  if (isAtBase && s.onboardData > 0) {
    const uploadSafe = s.battery.currentEnergy - s.energyCosts.dataUpload >= 0;
    candidates.push({
      action: { type: ActionType.UPLOAD_DATA, energyCost: s.energyCosts.dataUpload, description: 'Upload scientific data' },
      utility: 3.0,
      reward: s.onboardData / 50,
      informationGain: 0,
      missionProgress: 0.5,
      energyCost: s.energyCosts.dataUpload,
      timeCost: 1,
      risk: 0,
      explanation: `Upload ${s.onboardData.toFixed(0)} data units to mission control`,
      safetyAllowed: uploadSafe,
    });
  }

  // 6. Wait / harvest energy in field
  if (!isAtBase && s.solar.currentPower > 0 && s.battery.currentEnergy < s.battery.capacity * 0.95) {
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
  if (!isAtBase) {
    const returnPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    if (returnPath.length > 0) {
      const firstStep = returnPath[0];
      const terrainCfg = (s.terrainConfigs && s.terrainConfigs[s.beliefMap[firstStep.y][firstStep.x].terrain]) || TERRAIN_CONFIGS[s.beliefMap[firstStep.y][firstStep.x].terrain];
      const moveCost = s.energyCosts.baseMovement * terrainCfg.movementCost;
      const retEnergy = s.decision.estimatedReturnEnergy;

      // Calculate return utility dynamically based on actual conditions
      let returnUtility = -0.5;
      let returnReason = 'Energy healthy — continuing exploration';

      const energyRatio = s.battery.currentEnergy / safeEnergy;
      const hasDataToDeliver = s.onboardData > 25;
      const allDone = s.collectedResources.length >= 3 && s.objectives.every(o => o.scanned);

      if (allDone) {
        // All mission goals met! Return home to finish mission
        returnUtility = 2.8;
        returnReason = 'Mission criteria fulfilled — returning to base';
      } else if (energyRatio < 1.15) {
        // Critical energy — urgent return
        returnUtility = 2.5;
        returnReason = 'CRITICAL ENERGY: Return required';
      } else if (energyRatio < 1.35) {
        // Approaching reserve
        returnUtility = 1.0 + (1.35 - energyRatio) * 3.0;
        returnReason = 'LOW ENERGY: Returning toward base';
      } else if (s.roverMode === RoverMode.RETURNING_TO_HUB || s.roverMode === RoverMode.CONSERVING) {
        // Already in returning or conserving mode
        returnUtility = 1.8;
        returnReason = 'Returning to hub';
      } else if (hasDataToDeliver) {
        // Valuable data on board
        returnUtility = Math.min(1.5, 0.6 + (s.onboardData / 50) * 0.8);
        returnReason = `Delivering ${s.onboardData.toFixed(0)} data units to base`;
      }

      candidates.push({
        action: { type: ActionType.RETURN_TO_BASE, direction: getDirectionTo(s.roverPosition, firstStep), targetPosition: firstStep, energyCost: moveCost, description: 'Return toward home base' },
        utility: returnUtility,
        reward: hasDataToDeliver ? s.onboardData / 50 : 0,
        informationGain: 0,
        missionProgress: posEqual(firstStep, s.homeBase) ? 0.3 : 0.1,
        energyCost: moveCost,
        timeCost: 1,
        risk: 0,
        explanation: `${returnReason} (${returnPath.length} steps, ~${retEnergy.toFixed(1)} Wh)`,
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
  const safeEnergy = calculateSafeReturnEnergy(s);

  // Critical battery — force return to base immediately
  if (s.battery.currentEnergy < safeEnergy * 1.05 && !posEqual(s.roverPosition, s.homeBase)) {
    const returnPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    if (returnPath.length > 0) {
      const firstStep = returnPath[0];
      const terrainCfg = (s.terrainConfigs && s.terrainConfigs[s.beliefMap[firstStep.y][firstStep.x].terrain]) || TERRAIN_CONFIGS[s.beliefMap[firstStep.y][firstStep.x].terrain];
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

  // Low battery — switch to conserving mode when approaching safe reserve
  if (s.battery.currentEnergy < safeEnergy * 1.18 && s.roverMode === RoverMode.EXPLORING && !posEqual(s.roverPosition, s.homeBase)) {
    s.roverMode = RoverMode.CONSERVING;
    addEvent(s, EventCategory.SAFETY, `Switching to CONSERVING mode (battery: ${(s.battery.currentEnergy / s.battery.capacity * 100).toFixed(0)}%)`);
    s.decision.currentGoal = 'Conserve energy and plan return';
  }

  // Evening / Night — conserve only if battery is approaching safe reserve
  if ((s.solar.lightingCondition === LightingCondition.EVENING || s.solar.lightingCondition === LightingCondition.NIGHT) &&
      !posEqual(s.roverPosition, s.homeBase)) {
    if (s.roverMode === RoverMode.EXPLORING && s.battery.currentEnergy < safeEnergy * 1.3) {
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
  const actualTerrain = (s.terrainConfigs && s.terrainConfigs[actualCell.terrain]) || TERRAIN_CONFIGS[actualCell.terrain];

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
    const prevPos = s.roverTrail.length >= 2 ? s.roverTrail[s.roverTrail.length - 2] : null;
    if (!prevPos || !posEqual(prevPos, s.homeBase)) {
      addEvent(s, EventCategory.MISSION, 'Arrived at home base');
    }
    if (s.roverMode === RoverMode.RETURNING_TO_HUB || s.roverMode === RoverMode.CONSERVING) {
      s.roverMode = RoverMode.IDLE;
      s.roverPath = [];
      s.roverTarget = null;
    }
    // Deliver data automatically upon docking at base
    if (s.onboardData > 0) {
      const delivered = s.onboardData;
      s.deliveredData += delivered;
      s.metrics.scientificDataDelivered += delivered;
      s.onboardData = 0;
      addEvent(s, EventCategory.SCIENCE, `Base station downlink: Delivered ${delivered.toFixed(0)} scientific data units to mission control`);
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
  s.collectedResources = [...s.collectedResources, { ...resource }];
  s.metrics.resourcesCollected++;
  s.metrics.totalResourceValue += resource.value;

  // Mineral sample data reward
  const sampleData = 15;
  s.onboardData += sampleData;
  s.metrics.scientificDataGenerated += sampleData;

  // Update ground truth and belief map
  const cell = s.groundTruth[resource.position.y][resource.position.x];
  cell.hasResource = false;
  if (cell.resource) cell.resource.collected = true;
  const bCell = s.beliefMap[resource.position.y][resource.position.x];
  bCell.hasResource = false;
  if (bCell.resource) bCell.resource.collected = true;

  s.roverMode = RoverMode.COLLECTING;
  addEvent(s, EventCategory.RESOURCE, `Collected ${RESOURCE_CONFIGS[resource.type].label} (value: ${resource.value}, +${sampleData} data) at (${resource.position.x}, ${resource.position.y})`);

  // Clear goal so planner evaluates next target
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

  // Synchronize cells
  const gCell = s.groundTruth[obj.position.y][obj.position.x];
  if (gCell.objective) gCell.objective.scanned = true;
  const bCell = s.beliefMap[obj.position.y][obj.position.x];
  if (bCell.objective) bCell.objective.scanned = true;

  s.roverMode = RoverMode.SCANNING_OBJECTIVE;
  addEvent(s, EventCategory.SCIENCE, `Scanned '${obj.name}' — ${obj.dataReward} data units acquired`);

  s.roverTarget = null;
  s.roverPath = [];
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
  const safeEnergy = calculateSafeReturnEnergy(s);
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
          const rObj = s.resources.find(r => r.id === actual.resource!.id);
          if (rObj) rObj.discovered = true;
          addEvent(s, EventCategory.RESOURCE, `Detected ${RESOURCE_CONFIGS[actual.resource.type].label} at (${nx}, ${ny})`);
        }

        // Discover objectives
        if (actual.hasObjective && actual.objective && !actual.objective.discovered) {
          actual.objective.discovered = true;
          const oObj = s.objectives.find(o => o.id === actual.objective!.id);
          if (oObj) oObj.discovered = true;
          addEvent(s, EventCategory.SCIENCE, `Discovered scientific objective '${actual.objective.name}' at (${nx}, ${ny})`);
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
  const minResourcesCollected = s.collectedResources.length >= 3;
  const allObjectivesScanned = s.objectives.every(o => o.scanned);

  // 1. If at base and battery < 85%, recharge
  if (atBase && s.battery.currentEnergy < s.battery.capacity * 0.85) {
    s.decision.currentGoal = 'Recharging at Base Station';
    s.roverTarget = null;
    s.roverPath = [];
    return;
  }

  // 2. If all mission goals are accomplished, return to home base
  if (minResourcesCollected && allObjectivesScanned) {
    s.decision.currentGoal = 'All goals met — Returning to base';
    s.roverMode = RoverMode.RETURNING_TO_HUB;
    s.roverTarget = s.homeBase;
    if (!atBase && (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], s.homeBase))) {
      s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    }
    return;
  }

  // 3. If in returning or conserving mode due to low power, target home base
  if (s.roverMode === RoverMode.RETURNING_TO_HUB || s.roverMode === RoverMode.LOW_POWER || s.roverMode === RoverMode.CONSERVING) {
    s.decision.currentGoal = 'Return to home base safely';
    s.roverTarget = s.homeBase;
    if (!atBase && (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], s.homeBase))) {
      s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer);
    }
    return;
  }

  // 4. If we haven't collected 3 resources yet, check for discovered uncollected resources
  if (!minResourcesCollected) {
    const uncollected = s.resources
      .filter(r => r.discovered && !r.collected)
      .sort((a, b) => manhattanDist(a.position, s.roverPosition) - manhattanDist(b.position, s.roverPosition));
    if (uncollected.length > 0) {
      const targetRes = uncollected[0];
      s.decision.currentGoal = `Collect ${RESOURCE_CONFIGS[targetRes.type].label}`;
      s.roverTarget = targetRes.position;
      s.roverMode = RoverMode.NAVIGATING_TO_RESOURCE;
      if (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], targetRes.position)) {
        const pathRes = findPath(s.beliefMap, s.roverPosition, targetRes.position, s.energyCosts.baseMovement, 1.1);
        if (pathRes) s.roverPath = pathRes.path;
      }
      return;
    }
  }

  // 5. Check for discovered unscanned objectives
  const unscannedObj = s.objectives.find(o => o.discovered && !o.scanned);
  if (unscannedObj) {
    s.decision.currentGoal = `Navigate to ${unscannedObj.name}`;
    s.roverTarget = unscannedObj.position;
    s.roverMode = RoverMode.NAVIGATING_TO_OBJECTIVE;
    if (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], unscannedObj.position)) {
      const pathRes = findPath(s.beliefMap, s.roverPosition, unscannedObj.position, s.energyCosts.baseMovement, 1.1);
      if (pathRes) s.roverPath = pathRes.path;
    }
    return;
  }

  // 6. Otherwise explore unknown frontier
  s.decision.currentGoal = 'Explore unknown terrain';
  s.roverMode = RoverMode.EXPLORING;
  const frontier = findExplorationTarget(s);
  s.roverTarget = frontier;
  if (frontier && (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], frontier))) {
    const pathRes = findPath(s.beliefMap, s.roverPosition, frontier, s.energyCosts.baseMovement, 1.2);
    if (pathRes) s.roverPath = pathRes.path;
  }
}

function findExplorationTarget(s: SimulationState): Position | null {
  let bestPos: Position | null = null;
  let bestScore = -Infinity;

  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      if (s.beliefMap[y][x].isRevealed) continue;

      // Check if this cell is on the frontier (adjacent to a revealed passable cell)
      let adjacentRevealed = false;
      for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
        const nx = x + d.x, ny = y + d.y;
        if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight && s.beliefMap[ny][nx].isRevealed) {
          adjacentRevealed = true;
          break;
        }
      }
      if (!adjacentRevealed) continue;

      // Compute frontier information potential
      let infoPotential = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight && !s.beliefMap[ny][nx].isRevealed) {
            infoPotential++;
          }
        }
      }

      const dist = manhattanDist({ x, y }, s.roverPosition);

      // Objective direction bonus: guide rover towards undiscovered objective
      let objBias = 0;
      const undiscoveredObj = s.objectives.find(o => !o.discovered);
      if (undiscoveredObj) {
        const distToObj = manhattanDist({ x, y }, undiscoveredObj.position);
        objBias = -distToObj * 0.6;
      }

      const score = (infoPotential * 0.3) - (dist * 0.4) + objBias;
      if (score > bestScore) {
        bestScore = score;
        bestPos = { x, y };
      }
    }
  }

  return bestPos;
}
