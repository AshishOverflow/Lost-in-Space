// ============================================================
// Simulation Engine — Core game loop & state management
// ============================================================

import {
  SimulationState, SimulationConfig, DEFAULT_CONFIG,
  RoverMode, Direction, DIRECTION_VECTORS, ActionType,
  RoverAction, ActionCandidate, TerrainType, TERRAIN_CONFIGS,
  GridCell, Position, EventCategory,
  LightingCondition, SolarState, BatteryState,
  RESOURCE_CONFIGS,
} from '../types/simulation';
import { generateEnvironment } from '../environments/generator';
import { EnvironmentProperties } from '../environments/types';
import { DEFAULT_ENVIRONMENT, MAPS_REGISTRY } from '../environments/maps';
import {
  findPath, estimateReturnEnergy, findReturnPath, findNearestRechargeHaven,
} from './pathfinding';
import { updateSolarState, calculateSolarPower, calculateEnergyGenerated, predictSolarGeneration } from './solarModel';
import { posKey, posEqual, manhattanDist } from '../utils/helpers';
import { createInitialSecureChannel, updateSecureNetworkChannel } from './secureNetwork';
import { RoverMissionDatabase } from '../database/roverDatabase';
import { DynamicHazard } from '../types/simulation';

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

  // Ensure Home Base and Solar Stations are explicitly revealed on belief map
  env.beliefMap[env.homeBase.y][env.homeBase.x].isHomeBase = true;
  env.beliefMap[env.homeBase.y][env.homeBase.x].terrain = TerrainType.HOME_BASE;
  env.beliefMap[env.homeBase.y][env.homeBase.x].isRevealed = true;

  for (const st of (env.solarStations ?? [])) {
    if (st.y >= 0 && st.y < envProps.mapHeight && st.x >= 0 && st.x < envProps.mapWidth) {
      env.beliefMap[st.y][st.x].isSolarChargingPoint = true;
    }
  }

  const state: SimulationState = {
    mapWidth: envProps.mapWidth,
    mapHeight: envProps.mapHeight,
    seed: config.seed,
    groundTruth: env.groundTruth,
    beliefMap: env.beliefMap,
    resources: env.resources,
    objectives: env.objectives,
    homeBase: env.homeBase,
    solarStations: env.solarStations ?? [],

    roverPosition: { ...env.homeBase },
    roverDirection: Direction.NORTH,
    roverMode: RoverMode.IDLE,
    roverPath: [],
    roverTrail: [{ ...env.homeBase }],
    roverTarget: null,
    visitedCount: { [posKey(env.homeBase.x, env.homeBase.y)]: 1 },
    unreachableTargets: [],
    lastPositions: [{ ...env.homeBase }],
    isCharging: false,

    solar: updatedSolar,
    battery,
    energyCosts,

    collectedResources: [],
    onboardData: 0,
    deliveredData: 0,
    missionStarted: false,
    missionComplete: false,
    missionFailed: false,

    secureNetwork: createInitialSecureChannel(),
    dynamicHazards: [],

    mostValuableLocation: env.mostValuableLocation,
    richSampleSources: env.richSampleSources ?? [],
    pathSafetyScore: 100,
    wheelSlipProbability: 0.03,
    predictedPathSlip: 0.03,

    decision: {
      currentGoal: 'Docked at Home Base — Awaiting launch',
      currentAction: 'Idle',
      actionReason: 'Initial state synchronized at Home Base',
      candidates: [],
      estimatedReturnEnergy: 0,
      safetyReserve: envProps.safetyReserve,
      riskLevel: 'LOW',
      nextPlannedAction: 'Launch exploration',
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

  // Initial sensor scan around starting base
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
    addEvent(state, EventCategory.MISSION, 'Mission deployed from Home Base Station');
  }

  const s: SimulationState = {
    ...state,
    events: [...state.events],
    history: [...state.history],
    roverTrail: [...state.roverTrail],
    roverPath: [...state.roverPath],
    visitedCount: { ...(state.visitedCount || {}) },
    unreachableTargets: [...(state.unreachableTargets || [])],
    lastPositions: [...(state.lastPositions || [])],
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

  // 1. Advance simulation time
  s.metrics = { ...s.metrics, elapsedTime: s.metrics.elapsedTime + s.timePerTick };

  // 2. Update solar atmospheric conditions
  s.solar = updateSolarState(s.solar, s.metrics.elapsedTime, false);

  // 3. Ambient solar energy harvesting
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

  // 4. Station Recharge & Data Downlink
  const isAtBase = posEqual(s.roverPosition, s.homeBase);
  const isAtSolar = isAtSolarChargingStation(s.roverPosition, s.solarStations);

  if (isAtBase) {
    // Automatic scientific data downlink at Home Base via secure channel
    if (s.onboardData > 0) {
      const delivered = s.onboardData;
      const netRes = updateSecureNetworkChannel(
        s.secureNetwork || createInitialSecureChannel(),
        s.roverPosition, s.homeBase, delivered
      );
      s.secureNetwork = netRes.channel;
      s.deliveredData += delivered;
      s.metrics.scientificDataDelivered += delivered;
      s.onboardData = 0;
      addEvent(s, EventCategory.SCIENCE, netRes.logMessage || `Home Base secure downlink: Delivered ${delivered.toFixed(0)} scientific data units to mission control`);
    }

    // Fast recharge from Home Base Hub
    if (s.battery.currentEnergy < s.battery.capacity * 0.95 && !s.missionComplete) {
      s.isCharging = true;
      s.roverMode = RoverMode.RECHARGING;
      const chargeNeeded = s.battery.capacity - s.battery.currentEnergy;
      const baseRecharge = Math.min(chargeNeeded, 25);
      s.battery.currentEnergy += baseRecharge;
      s.battery.totalHarvested += baseRecharge;
      addEvent(s, EventCategory.ENERGY, `Home Base Hub rapid recharge: ${s.battery.currentEnergy.toFixed(1)} / ${s.battery.capacity.toFixed(1)} Wh`);
    } else {
      if (s.isCharging) {
        s.isCharging = false;
        s.roverMode = RoverMode.EXPLORING;
        s.roverTarget = null;
        s.roverPath = [];
        addEvent(s, EventCategory.ENERGY, 'Home Base recharging complete (95%+). Resuming mission operations.');
      }
    }
  } else if (isAtSolar) {
    // Designated Solar Charging Station
    if (s.battery.currentEnergy < s.battery.capacity * 0.92) {
      s.isCharging = true;
      s.roverMode = RoverMode.RECHARGING;
      const chargeNeeded = s.battery.capacity - s.battery.currentEnergy;
      const chargeAmount = Math.min(chargeNeeded, 20 + s.solar.currentPower * 0.1);
      if (chargeAmount > 0) {
        s.battery.currentEnergy += chargeAmount;
        s.battery.totalHarvested += chargeAmount;
        addEvent(s, EventCategory.ENERGY, `Solar Station rapid charge: ${s.battery.currentEnergy.toFixed(1)} / ${s.battery.capacity.toFixed(1)} Wh`);
      }
    } else {
      if (s.isCharging) {
        s.isCharging = false;
        s.roverMode = RoverMode.EXPLORING;
        s.roverTarget = null;
        s.roverPath = [];
        s.lastSolarRechargeTick = s.tickCount;
        addEvent(s, EventCategory.ENERGY, 'Solar Station replenishment complete (92%+). Resuming exploration.');
      }
    }
  } else {
    s.isCharging = false;
  }

  // 5. Idle energy consumption (only when not docked at Base or Solar Station)
  if (!isAtBase && !isAtSolar) {
    s.battery = consumeEnergy(s.battery, s.energyCosts.idle);
  }

  // 6. Return energy estimation
  const returnEnergy = estimateReturnEnergy(
    s.beliefMap, s.roverPosition, s.homeBase,
    s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
  );
  s.decision = { ...s.decision, estimatedReturnEnergy: returnEnergy };
  s.metrics = { ...s.metrics, returnRouteEnergy: returnEnergy };

  // 7. Update goal and target path
  updateDecisionGoal(s);

  // 8. Execute autonomous action
  if (s.isAutonomous && !s.missionComplete && !s.missionFailed) {
    executeAutonomousAction(s);
  }

  // 8b. Most Valuable Location Visit Check
  if (s.mostValuableLocation && !s.mostValuableLocation.visited) {
    if (s.roverPosition.x === s.mostValuableLocation.x && s.roverPosition.y === s.mostValuableLocation.y) {
      s.mostValuableLocation.visited = true;
      s.deliveredData += s.mostValuableLocation.scientificYield;
      addEvent(
        s,
        EventCategory.SCIENCE,
        `⭐ High-Value Priority Site Visited: ${s.mostValuableLocation.name} at (${s.mostValuableLocation.x}, ${s.mostValuableLocation.y})! Secured +${s.mostValuableLocation.scientificYield} scientific data units.`
      );
    }
  }

  // 8c. Terramechanics: Live Wheel Slip & Path Safety Score
  const currentTile = s.beliefMap[s.roverPosition.y]?.[s.roverPosition.x];
  s.wheelSlipProbability = calculateWheelSlip(
    currentTile?.terrain || TerrainType.FLAT_ROCK,
    s.solar.lightingCondition,
    s.environmentProperties
  );
  s.pathSafetyScore = calculatePathSafetyScore(
    s.roverPath,
    s.beliefMap,
    s.solar.lightingCondition
  );

  // 9. Dynamic Environmental Obstacle Adaptation
  triggerDynamicEnvironmentalHazards(s);

  // 10. Update metrics and record history
  updateMetrics(s);
  recordHistory(s);

  // 11. Database logging: Update database each time rover operates
  RoverMissionDatabase.getInstance().logOperation({
    tick: s.tickCount,
    timestamp: s.metrics.elapsedTime,
    roverX: s.roverPosition.x,
    roverY: s.roverPosition.y,
    batteryEnergy: s.battery.currentEnergy,
    batteryCapacity: s.battery.capacity,
    solarPower: s.solar.currentPower,
    harvestedTotal: s.battery.totalHarvested,
    consumedTotal: s.battery.totalConsumed,
    onboardData: s.onboardData,
    deliveredData: s.deliveredData,
    roverMode: s.roverMode,
    currentGoal: s.decision.currentGoal,
  });

  // 12. Check mission completion
  checkMissionCompletion(s);

  return s;
}

// ============================================================
// Autonomous action execution
// ============================================================

function executeAutonomousAction(s: SimulationState) {
  if (s.roverMode === RoverMode.COMPLETED || s.roverMode === RoverMode.MISSION_FAILED) return;

  // If rover is actively charging, wait and replenish
  if (s.isCharging || s.roverMode === RoverMode.RECHARGING) {
    s.decision.currentAction = 'Recharging at Station';
    s.decision.actionReason = `Replenishing battery (${((s.battery.currentEnergy / s.battery.capacity) * 100).toFixed(0)}%)`;
    s.decision.riskLevel = 'LOW';
    return;
  }

  // Evaluate candidate actions
  const candidates = evaluateCandidates(s);
  s.decision = { ...s.decision, candidates };

  // Safety overrides
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
    s.roverMode = RoverMode.RECOVERY_REQUIRED;
    addEvent(s, EventCategory.SAFETY, 'No safe actions available — RECOVERY REQUIRED');
    s.decision.currentGoal = 'Recovery required';
    s.decision.actionReason = 'All candidate actions violate safe return reserve';
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
  const haven = findNearestRechargeHaven(
    s.beliefMap, s.roverPosition, s.homeBase, s.solarStations,
    s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
  );
  const returnEnergy = haven ? haven.energyCost : s.decision.estimatedReturnEnergy;
  if (returnEnergy <= 0 || posEqual(s.roverPosition, s.homeBase) || isAtSolarChargingStation(s.roverPosition, s.solarStations)) {
    return s.safetyReserve;
  }
  const dist = manhattanDist(s.roverPosition, s.homeBase);
  const durationSeconds = dist * s.timePerTick;
  const predictedSolar = predictSolarGeneration(s.solar, s.metrics.elapsedTime, durationSeconds, s.timePerTick);
  const solarCredit = Math.min(predictedSolar * 0.4, returnEnergy * 0.4);
  return Math.max(s.safetyReserve, returnEnergy + s.safetyReserve - solarCredit);
}

function evaluateCandidates(s: SimulationState): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];
  const safeEnergy = calculateSafeReturnEnergy(s);
  const isAtBase = posEqual(s.roverPosition, s.homeBase);
  const isAtSolar = isAtSolarChargingStation(s.roverPosition, s.solarStations);

  // If in recharging state, prioritize waiting to charge
  if (s.isCharging || s.roverMode === RoverMode.RECHARGING) {
    candidates.push({
      action: { type: ActionType.WAIT, energyCost: 0, description: 'Recharge at Station' },
      utility: 5.0,
      reward: 1.0,
      informationGain: 0,
      missionProgress: 0.5,
      energyCost: 0,
      timeCost: 1,
      risk: 0,
      explanation: `Station recharge active (${((s.battery.currentEnergy / s.battery.capacity) * 100).toFixed(0)}%)`,
      safetyAllowed: true,
    });
    return candidates;
  }

  // 1. Movement in four cardinal directions
  for (const dir of [Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST]) {
    // If docked at base or solar, do not depart until battery has reached at least 80%
    if ((isAtBase || isAtSolar) && s.battery.currentEnergy < s.battery.capacity * 0.80) {
      continue;
    }

    const vec = DIRECTION_VECTORS[dir];
    const nx = s.roverPosition.x + vec.x;
    const ny = s.roverPosition.y + vec.y;
    if (nx < 0 || nx >= s.mapWidth || ny < 0 || ny >= s.mapHeight) continue;

    const beliefCell = s.beliefMap[ny][nx];
    const activeConfigs = s.terrainConfigs || TERRAIN_CONFIGS;
    const terrain = activeConfigs[beliefCell.terrain] || TERRAIN_CONFIGS[beliefCell.terrain];
    if (beliefCell.isRevealed && !terrain.passable) continue;

    const moveCost = s.energyCosts.baseMovement * (terrain ? terrain.movementCost : 1.0);

    // Calculate utility components
    const isUnknown = !beliefCell.isRevealed;
    const infoGain = isUnknown ? 1.0 : countUnrevealedNeighbors(s, nx, ny) * 0.2;
    const hasResource = beliefCell.hasResource && beliefCell.resource && !beliefCell.resource.collected;
    const hasObjective = beliefCell.hasObjective && beliefCell.objective && !beliefCell.objective.scanned;
    const reward = hasResource ? (beliefCell.resource!.value / 50) : hasObjective ? 2.0 : 0;

    let cellReward = 0;
    if (hasResource) cellReward = 2.5;
    else if (hasObjective) cellReward = 3.0;

    // Precomputed path bonus
    let pathBonus = 0;
    if (s.roverPath.length > 0 && s.roverPath[0].x === nx && s.roverPath[0].y === ny) {
      pathBonus = 2.2;
    }

    // Mission progress towards target
    let missionProgress = 0;
    if (s.roverTarget) {
      const currentDist = manhattanDist(s.roverPosition, s.roverTarget);
      const newDist = manhattanDist({ x: nx, y: ny }, s.roverTarget);
      missionProgress = (currentDist - newDist) * 0.8;
    }

    // Visit penalty to avoid retracing previous paths
    const visitCount = s.visitedCount[posKey(nx, ny)] || 0;
    const visitPenalty = Math.min(visitCount * 0.5, 4.0);

    // Risk based on battery and haven distance
    const batteryPercent = s.battery.currentEnergy / s.battery.capacity;
    const distToHome = manhattanDist({ x: nx, y: ny }, s.homeBase);
    const risk = (1 - batteryPercent) * 0.3 + (distToHome / (s.mapWidth + s.mapHeight)) * 0.2;

    const utility = (
      cellReward +
      pathBonus +
      0.6 * reward +
      0.9 * infoGain +
      missionProgress -
      visitPenalty -
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
      safetyReason: safetyAllowed ? undefined : `Leaves ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh safe return`,
    });
  }

  // 2. Collect resource at current cell
  const currentCell = s.groundTruth[s.roverPosition.y][s.roverPosition.x];
  if (currentCell.hasResource && currentCell.resource && !currentCell.resource.collected) {
    const res = currentCell.resource;
    const collectCost = res.collectionEnergy;
    const collectSafe = s.battery.currentEnergy - collectCost >= safeEnergy;
    candidates.push({
      action: { type: ActionType.COLLECT, targetResourceId: res.id, energyCost: collectCost, description: `Collect ${RESOURCE_CONFIGS[res.type].label}` },
      utility: 4.5,
      reward: res.value / 40,
      informationGain: 0,
      missionProgress: 1.0,
      energyCost: collectCost,
      timeCost: 1,
      risk: 0,
      explanation: `Collect ${RESOURCE_CONFIGS[res.type].label} (value: ${res.value}, cost: ${collectCost.toFixed(1)} Wh)`,
      safetyAllowed: collectSafe,
      safetyReason: collectSafe ? undefined : 'Insufficient energy for collection + safe return',
    });
  }

  // 3. Scan objective at current cell
  if (currentCell.hasObjective && currentCell.objective && !currentCell.objective.scanned) {
    const obj = currentCell.objective;
    const objSafe = s.battery.currentEnergy - obj.scanEnergy >= safeEnergy;
    candidates.push({
      action: { type: ActionType.SCAN_OBJECTIVE, energyCost: obj.scanEnergy, description: `Scan ${obj.name}` },
      utility: 5.0,
      reward: obj.dataReward / 40,
      informationGain: 0.5,
      missionProgress: 1.5,
      energyCost: obj.scanEnergy,
      timeCost: 2,
      risk: 0.1,
      explanation: `Scan scientific objective '${obj.name}' (+${obj.dataReward} data, cost: ${obj.scanEnergy} Wh)`,
      safetyAllowed: objSafe,
      safetyReason: objSafe ? undefined : 'Insufficient energy for scan + safe return',
    });
  }

  // 4. Return to Haven (Home Base or Solar Station)
  // 4. Return to Haven (Home Base or Solar Station)
  if (!isAtBase) {
    const haven = findNearestRechargeHaven(
      s.beliefMap, s.roverPosition, s.homeBase, s.solarStations,
      s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
    );
    if (haven && haven.path.length > 0) {
      const firstStep = haven.path[0];
      const activeConfigs = s.terrainConfigs || TERRAIN_CONFIGS;
      const terrainCfg = activeConfigs[s.beliefMap[firstStep.y][firstStep.x].terrain] || TERRAIN_CONFIGS[TerrainType.FLAT_ROCK];
      const moveCost = s.energyCosts.baseMovement * (terrainCfg ? terrainCfg.movementCost : 1.0);

      const isReturning = s.roverMode === RoverMode.RETURNING_HOME;
      let returnUtility = isReturning ? 3.8 : 0.5;

      // Anti-loopback safeguard: If haven is a Solar Station, and the rover has healthy battery (> 60%)
      // or recently recharged at a solar station (< 25 ticks), do NOT pull the rover back into the solar station!
      const isRecentSolarHaven = !haven.isHome && (s.battery.currentEnergy > s.battery.capacity * 0.60 || (s.lastSolarRechargeTick !== undefined && s.tickCount - s.lastSolarRechargeTick < 25));
      if (isRecentSolarHaven) {
        returnUtility = -5.0; // Negative utility prevents ping-pong loopback
      }

      candidates.push({
        action: {
          type: ActionType.RETURN_TO_BASE,
          direction: getDirectionTo(s.roverPosition, firstStep),
          targetPosition: firstStep,
          energyCost: moveCost,
          description: haven.isHome ? 'Return toward Home Base' : 'Route toward Solar Station',
        },
        utility: returnUtility,
        reward: 0,
        informationGain: 0,
        missionProgress: 0.5,
        energyCost: moveCost,
        timeCost: 1,
        risk: 0,
        explanation: `Routing to ${haven.isHome ? 'Home Base' : 'Solar Station'} (${haven.path.length} steps, ~${haven.energyCost.toFixed(1)} Wh)`,
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
  const isAtBase = posEqual(s.roverPosition, s.homeBase);
  const isAtSolar = isAtSolarChargingStation(s.roverPosition, s.solarStations);

  if (s.isCharging || s.roverMode === RoverMode.RECHARGING) {
    return { forcedAction: null };
  }

  // Critical battery override
  if (s.battery.currentEnergy < safeEnergy * 1.05 && !isAtBase && !isAtSolar) {
    const haven = findNearestRechargeHaven(
      s.beliefMap, s.roverPosition, s.homeBase, s.solarStations,
      s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
    );
    const isRecentSolarHaven = haven && !haven.isHome && (s.battery.currentEnergy > s.battery.capacity * 0.60 || (s.lastSolarRechargeTick !== undefined && s.tickCount - s.lastSolarRechargeTick < 25));

    if (haven && haven.path.length > 0 && !isRecentSolarHaven) {
      const firstStep = haven.path[0];
      const activeConfigs = s.terrainConfigs || TERRAIN_CONFIGS;
      const terrainCfg = activeConfigs[s.beliefMap[firstStep.y][firstStep.x].terrain] || TERRAIN_CONFIGS[TerrainType.FLAT_ROCK];
      const moveCost = s.energyCosts.baseMovement * (terrainCfg ? terrainCfg.movementCost : 1.0);

      s.roverMode = RoverMode.RETURNING_HOME;
      s.roverPath = haven.path;
      s.roverTarget = haven.destination;
      s.decision.safetyInterventions++;
      s.metrics.safetyInterventions++;
      const destLabel = haven.isHome ? 'Home Base' : 'Solar Station';
      addEvent(s, EventCategory.SAFETY, `Safety override: Critical battery (${s.battery.currentEnergy.toFixed(1)} Wh). Navigating to ${destLabel}.`);

      return {
        forcedAction: {
          type: ActionType.RETURN_TO_BASE,
          direction: getDirectionTo(s.roverPosition, firstStep),
          targetPosition: firstStep,
          energyCost: moveCost,
          description: `SAFETY: Route to ${destLabel}`,
        },
        interventionReason: `Battery critically low for safe return reserve`,
      };
    }
  }

  // Mark unsafe candidates
  for (const c of candidates) {
    const energyAfterAction = s.battery.currentEnergy - c.energyCost;
    if (energyAfterAction < safeEnergy) {
      c.safetyAllowed = false;
      c.safetyReason = `Leaves ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh safe return reserve`;
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

  if (target.x < 0 || target.x >= s.mapWidth || target.y < 0 || target.y >= s.mapHeight) return;
  const actualCell = s.groundTruth[target.y][target.x];
  const activeConfigs = s.terrainConfigs || TERRAIN_CONFIGS;
  const actualTerrain = activeConfigs[actualCell.terrain] || TERRAIN_CONFIGS[actualCell.terrain];

  if (!actualTerrain.passable) {
    s.beliefMap[target.y][target.x] = { ...s.beliefMap[target.y][target.x], terrain: actualCell.terrain, isRevealed: true };
    addEvent(s, EventCategory.NAVIGATION, `Path blocked by ${actualTerrain.label} at (${target.x}, ${target.y})`);
    s.roverPath = [];
    return;
  }

  const actualMoveCost = s.energyCosts.baseMovement * actualTerrain.movementCost;
  s.battery = consumeEnergy(s.battery, actualMoveCost);

  // Update direction and positions
  const moveDir = action.direction || getDirectionTo(s.roverPosition, target);
  s.roverDirection = moveDir;
  s.roverPosition = { ...target };
  s.roverTrail.push({ ...target });
  s.metrics.distanceTraveled++;

  // Record visited count for intelligent route diversification
  const key = posKey(target.x, target.y);
  s.visitedCount[key] = (s.visitedCount[key] || 0) + 1;

  // Record recent positions for loop detection
  s.lastPositions = [...(s.lastPositions || []).slice(-7), { ...target }];

  // Reveal cells around new position
  const discovered = revealCells(s, target, s.sensorRadius);

  // Advance path
  if (s.roverPath.length > 0 && posEqual(s.roverPath[0], target)) {
    s.roverPath = s.roverPath.slice(1);
  }

  if (s.roverTarget && posEqual(target, s.roverTarget)) {
    s.roverPath = [];
    s.roverTarget = null;
  }

  // Docking at Home Base or Solar Station check
  if (posEqual(s.roverPosition, s.homeBase)) {
    const prevPos = s.roverTrail.length >= 2 ? s.roverTrail[s.roverTrail.length - 2] : null;
    if (!prevPos || !posEqual(prevPos, s.homeBase)) {
      addEvent(s, EventCategory.MISSION, 'Docked at Home Base Station Hub');
    }
  } else if (isAtSolarChargingStation(s.roverPosition, s.solarStations)) {
    addEvent(s, EventCategory.ENERGY, `Arrived at Solar Charging Station (${target.x}, ${target.y})`);
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

  const sampleData = 15;
  s.onboardData += sampleData;
  s.metrics.scientificDataGenerated += sampleData;

  const cell = s.groundTruth[resource.position.y][resource.position.x];
  cell.hasResource = false;
  if (cell.resource) cell.resource.collected = true;
  const bCell = s.beliefMap[resource.position.y][resource.position.x];
  bCell.hasResource = false;
  if (bCell.resource) bCell.resource.collected = true;

  s.roverMode = RoverMode.COLLECTING;
  addEvent(s, EventCategory.RESOURCE, `Collected ${RESOURCE_CONFIGS[resource.type].label} (value: ${resource.value}, +${sampleData} data) at (${resource.position.x}, ${resource.position.y})`);

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
  if (s.isCharging) {
    s.roverMode = RoverMode.RECHARGING;
    s.decision.currentGoal = 'Recharging at station';
  } else if (s.solar.currentPower > 0) {
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

  s.battery = consumeEnergy(s.battery, s.energyCosts.idle);

  const returnEnergy = estimateReturnEnergy(
    s.beliefMap, s.roverPosition, s.homeBase,
    s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
  );
  s.decision = { ...s.decision, estimatedReturnEnergy: returnEnergy };
  s.metrics = { ...s.metrics, returnRouteEnergy: returnEnergy };

  const safeEnergy = calculateSafeReturnEnergy(s);
  const energyAfterAction = s.battery.currentEnergy - action.energyCost;

  if (action.type !== ActionType.RETURN_TO_BASE && action.type !== ActionType.WAIT &&
      action.type !== ActionType.HARVEST_ENERGY && action.type !== ActionType.UPLOAD_DATA) {
    if (energyAfterAction < safeEnergy && !posEqual(s.roverPosition, s.homeBase)) {
      addEvent(s, EventCategory.SAFETY, `Manual action rejected: ${action.description} — insufficient energy for safe return`);
      s.decision.actionReason = `Action rejected: leaves ${energyAfterAction.toFixed(1)} Wh, need ${safeEnergy.toFixed(1)} Wh`;
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
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const nx = center.x + dx, ny = center.y + dy;
      if (nx < 0 || nx >= s.mapWidth || ny < 0 || ny >= s.mapHeight) continue;

      if (!s.beliefMap[ny][nx].isRevealed) {
        const actual = s.groundTruth[ny][nx];
        s.beliefMap[ny][nx] = {
          ...actual,
          isRevealed: true,
        };
        discovered++;

        if (actual.hasResource && actual.resource && !actual.resource.discovered) {
          actual.resource.discovered = true;
          const rObj = s.resources.find(r => r.id === actual.resource!.id);
          if (rObj) rObj.discovered = true;

          if (actual.resource.isRichSource) {
            const richSource = s.richSampleSources?.find(rs => rs.position.x === nx && rs.position.y === ny);
            if (richSource) richSource.discovered = true;
            addEvent(s, EventCategory.DISCOVERY, `💎 Rich Sample Source Discovered: ${actual.resource.richSourceName || 'High-Yield Deposit'} at (${nx}, ${ny}) (Value: ${actual.resource.value} units)`);
          } else {
            addEvent(s, EventCategory.RESOURCE, `Detected ${RESOURCE_CONFIGS[actual.resource.type].label} at (${nx}, ${ny})`);
          }
        }

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
    mapExploredPercent: (explored / Math.max(1, s.metrics.totalCells)) * 100,
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

// ============================================================
// Terramechanics: Wheel Slip & Path Safety Calculations
// ============================================================

export function calculateWheelSlip(
  terrain: TerrainType,
  lighting: LightingCondition,
  envProps?: any
): number {
  let baseSlip = 0.03;
  switch (terrain) {
    case TerrainType.FLAT_ROCK: baseSlip = 0.03; break;
    case TerrainType.ROCKY: baseSlip = 0.09; break;
    case TerrainType.GRAVEL: baseSlip = 0.22; break;
    case TerrainType.SAND: baseSlip = 0.44; break;
    case TerrainType.CRATER: baseSlip = 0.36; break;
    case TerrainType.BOULDER: baseSlip = 1.0; break;
    default: baseSlip = 0.12; break;
  }
  if (lighting === LightingCondition.DUST_STORM) baseSlip += 0.12;
  if (envProps?.hazardLevel === 'HIGH') baseSlip += 0.05;
  return Math.min(0.95, Math.max(0.01, +baseSlip.toFixed(2)));
}

export function calculatePathSafetyScore(
  path: Position[],
  beliefMap: GridCell[][],
  lighting: LightingCondition
): number {
  if (!path || path.length === 0) return 100;
  let totalSlip = 0;
  for (const pos of path) {
    const cell = beliefMap[pos.y]?.[pos.x];
    const slip = calculateWheelSlip(cell?.terrain || TerrainType.FLAT_ROCK, lighting);
    totalSlip += slip;
  }
  const avgSlip = totalSlip / path.length;
  return Math.max(15, Math.min(100, Math.round(100 - avgSlip * 115)));
}

let eventUniqueCounter = 0;
export function addEvent(s: SimulationState, category: EventCategory, description: string, energyValue?: number) {
  eventUniqueCounter++;
  const id = `evt-${Date.now()}-${eventUniqueCounter}-${Math.random().toString(36).slice(2, 6)}`;
  s.events.push({
    id,
    timestamp: s.metrics.elapsedTime,
    category,
    description,
    energyValue,
  });
  if (s.events.length > 300) {
    s.events.shift();
  }
}

function checkMissionCompletion(s: SimulationState) {
  const allObjectivesScanned = s.objectives.every(o => o.scanned);
  const minResourcesCollected = s.collectedResources.length >= 3;
  const atBase = posEqual(s.roverPosition, s.homeBase);
  const dataDelivered = s.deliveredData >= 50;

  if (atBase && allObjectivesScanned && minResourcesCollected && dataDelivered) {
    s.missionComplete = true;
    s.roverMode = RoverMode.COMPLETED;
    addEvent(s, EventCategory.MISSION, 'Mission COMPLETE! All objectives achieved.');
    s.decision.currentGoal = 'Mission Complete';
    s.decision.currentAction = 'All objectives achieved';
    s.decision.riskLevel = 'LOW';
    RoverMissionDatabase.getInstance().recordSuccessfulMission(s);
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

function isAtSolarChargingStation(position: Position, solarStations: Position[]): boolean {
  return solarStations.some(station => station.x === position.x && station.y === position.y);
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
// Intelligent Goal Planner with Anti-Loop and Route Diversification
// ============================================================

export function updateDecisionGoal(s: SimulationState) {
  if (s.missionComplete || s.missionFailed) return;

  const atBase = posEqual(s.roverPosition, s.homeBase);
  const atSolar = isAtSolarChargingStation(s.roverPosition, s.solarStations);

  // 1. Anti-Loop & Stalling Safeguard
  if (s.lastPositions && s.lastPositions.length >= 6) {
    const lp = s.lastPositions;
    const len = lp.length;
    // Check if oscillating between two cells or stuck in one cell
    const isLooping = (posEqual(lp[len - 1], lp[len - 3]) && posEqual(lp[len - 2], lp[len - 4])) ||
                      (posEqual(lp[len - 1], lp[len - 2]) && posEqual(lp[len - 2], lp[len - 3]));
    if (isLooping && s.roverTarget && !atBase && !atSolar) {
      s.unreachableTargets.push(posKey(s.roverTarget.x, s.roverTarget.y));
      s.roverPath = [];
      s.roverTarget = null;
      addEvent(s, EventCategory.NAVIGATION, 'Navigation safeguard: Repetitive cycle detected. Blacklisting target and diversifying path.');
    }
  }

  // 2. Charging Station Handling
  if (atBase && s.battery.currentEnergy < s.battery.capacity * 0.90) {
    s.decision.currentGoal = `Recharging at Home Base Hub (${((s.battery.currentEnergy / s.battery.capacity) * 100).toFixed(0)}%)`;
    s.roverTarget = null;
    s.roverPath = [];
    s.roverMode = RoverMode.RECHARGING;
    s.isCharging = true;
    return;
  }
  if (atSolar && s.battery.currentEnergy < s.battery.capacity * 0.90) {
    s.decision.currentGoal = `Recharging at Solar Station (${((s.battery.currentEnergy / s.battery.capacity) * 100).toFixed(0)}%)`;
    s.roverTarget = null;
    s.roverPath = [];
    s.roverMode = RoverMode.RECHARGING;
    s.isCharging = true;
    return;
  }

  // 3. Mission Completion Criteria Check
  const minResourcesCollected = s.collectedResources.length >= 3;
  const allObjectivesScanned = s.objectives.every(o => o.scanned);
  const dataDelivered = s.deliveredData >= 50;

  if (minResourcesCollected && allObjectivesScanned) {
    if (atBase && (dataDelivered || s.onboardData === 0)) {
      s.missionComplete = true;
      s.roverMode = RoverMode.COMPLETED;
      s.decision.currentGoal = 'Mission Accomplished';
      addEvent(s, EventCategory.MISSION, 'Mission COMPLETE! All criteria achieved and rover safely recovered at Home Base.');
      RoverMissionDatabase.getInstance().recordSuccessfulMission(s);
      return;
    }
    s.decision.currentGoal = 'All goals met — Returning to Home Base';
    s.roverMode = RoverMode.RETURNING_HOME;
    s.roverTarget = s.homeBase;
    if (!atBase && (s.roverPath.length === 0 || !posEqual(s.roverPath[s.roverPath.length - 1], s.homeBase))) {
      s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs);
    }
    return;
  }

  // 4. Energy-Aware Navigation: Verify Safe Haven Reachability
  const nearestHaven = findNearestRechargeHaven(
    s.beliefMap, s.roverPosition, s.homeBase, s.solarStations,
    s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
  );
  const havenEnergy = nearestHaven ? nearestHaven.energyCost : estimateReturnEnergy(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs);
  const criticalEnergy = havenEnergy + s.safetyReserve * 1.25;

  const isRecentSolarHaven = nearestHaven && !nearestHaven.isHome && (s.battery.currentEnergy > s.battery.capacity * 0.60 || (s.lastSolarRechargeTick !== undefined && s.tickCount - s.lastSolarRechargeTick < 25));

  if (!atBase && !atSolar && s.battery.currentEnergy <= criticalEnergy && !isRecentSolarHaven) {
    const dest = nearestHaven ? nearestHaven.destination : s.homeBase;
    const destLabel = nearestHaven && !nearestHaven.isHome ? 'Solar Charging Station' : 'Home Base';
    s.decision.currentGoal = `Low battery (${s.battery.currentEnergy.toFixed(1)} Wh) — Navigating to ${destLabel}`;
    s.roverMode = RoverMode.RETURNING_HOME;
    s.roverTarget = dest;
    s.roverPath = nearestHaven ? nearestHaven.path : findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs);
    return;
  }

  // 5. Discovered Uncollected Resources
  if (!minResourcesCollected) {
    const uncollected = s.resources
      .filter(r => r.discovered && !r.collected && !s.unreachableTargets.includes(posKey(r.position.x, r.position.y)))
      .sort((a, b) => manhattanDist(a.position, s.roverPosition) - manhattanDist(b.position, s.roverPosition));

    for (const targetRes of uncollected) {
      const pathRes = findPath(
        s.beliefMap, s.roverPosition, targetRes.position,
        s.energyCosts.baseMovement, 1.1,
        s.terrainConfigs, s.visitedCount, 1.0
      );
      if (pathRes) {
        const havenFromTarget = findNearestRechargeHaven(
          s.beliefMap, targetRes.position, s.homeBase, s.solarStations,
          s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
        );
        const returnFromTarget = havenFromTarget ? havenFromTarget.energyCost : havenEnergy;
        if (s.battery.currentEnergy >= pathRes.energyCost + targetRes.collectionEnergy + returnFromTarget + s.safetyReserve) {
          s.decision.currentGoal = `Collect ${RESOURCE_CONFIGS[targetRes.type].label}`;
          s.roverTarget = targetRes.position;
          s.roverMode = RoverMode.NAVIGATING_TO_RESOURCE;
          s.roverPath = pathRes.path;
          return;
        }
      } else {
        s.unreachableTargets.push(posKey(targetRes.position.x, targetRes.position.y));
      }
    }
  }

  // 6. Discovered Unscanned Objectives
  const unscannedObj = s.objectives.find(o => o.discovered && !o.scanned && !s.unreachableTargets.includes(posKey(o.position.x, o.position.y)));
  if (unscannedObj) {
    const pathRes = findPath(
      s.beliefMap, s.roverPosition, unscannedObj.position,
      s.energyCosts.baseMovement, 1.1,
      s.terrainConfigs, s.visitedCount, 1.0
    );
    if (pathRes) {
      const havenFromObj = findNearestRechargeHaven(
        s.beliefMap, unscannedObj.position, s.homeBase, s.solarStations,
        s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
      );
      const returnFromObj = havenFromObj ? havenFromObj.energyCost : havenEnergy;
      if (s.battery.currentEnergy >= pathRes.energyCost + unscannedObj.scanEnergy + returnFromObj + s.safetyReserve) {
        s.decision.currentGoal = `Navigate to ${unscannedObj.name}`;
        s.roverTarget = unscannedObj.position;
        s.roverMode = RoverMode.NAVIGATING_TO_OBJECTIVE;
        s.roverPath = pathRes.path;
        return;
      }
    } else {
      s.unreachableTargets.push(posKey(unscannedObj.position.x, unscannedObj.position.y));
    }
  }

  // 6b. User-confirmed Most Valuable Location (Optional Priority Exploration)
  if (s.mostValuableLocation && s.mostValuableLocation.confirmed && !s.mostValuableLocation.visited) {
    const mvlPos = { x: s.mostValuableLocation.x, y: s.mostValuableLocation.y };
    if (!s.unreachableTargets.includes(posKey(mvlPos.x, mvlPos.y))) {
      const pathRes = findPath(
        s.beliefMap, s.roverPosition, mvlPos,
        s.energyCosts.baseMovement, 1.1,
        s.terrainConfigs, s.visitedCount, 1.0
      );
      if (pathRes) {
        const havenFromMvl = findNearestRechargeHaven(
          s.beliefMap, mvlPos, s.homeBase, s.solarStations,
          s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
        );
        const returnCost = havenFromMvl ? havenFromMvl.energyCost : havenEnergy;
        // Verify battery reserve: sufficient to visit MVL, return to safety, and keep reserve
        if (s.battery.currentEnergy >= pathRes.energyCost + returnCost + s.safetyReserve * 1.1) {
          s.decision.currentGoal = `Survey Priority Site (${s.mostValuableLocation.name})`;
          s.roverTarget = mvlPos;
          s.roverMode = RoverMode.NAVIGATING_TO_OBJECTIVE;
          s.roverPath = pathRes.path;
          return;
        }
      } else {
        s.unreachableTargets.push(posKey(mvlPos.x, mvlPos.y));
      }
    }
  }

  // 7. Intelligent Frontier Exploration (Diversified Route Planning)
  const explorationResult = findExplorationTarget(s);
  if (explorationResult) {
    s.decision.currentGoal = 'Exploring unvisited terrain';
    s.roverMode = RoverMode.EXPLORING;
    s.roverTarget = explorationResult.target;
    s.roverPath = explorationResult.path;
    return;
  }

  // 8. Exploration Termination Safeguard
  // If no reachable unexplored frontier remains:
  if (atBase) {
    s.missionComplete = true;
    s.roverMode = RoverMode.COMPLETED;
    s.decision.currentGoal = 'Exploration Complete — All accessible areas surveyed';
    addEvent(s, EventCategory.MISSION, 'Mission Complete: All accessible sectors surveyed and rover docked safely.');
  } else {
    s.decision.currentGoal = 'Exploration complete — Returning to Home Base';
    s.roverMode = RoverMode.RETURNING_HOME;
    s.roverTarget = s.homeBase;
    s.roverPath = findReturnPath(s.beliefMap, s.roverPosition, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs);
  }
}

function findExplorationTarget(s: SimulationState): { target: Position; path: Position[] } | null {
  const unreachable = new Set(s.unreachableTargets || []);
  const midX = s.mapWidth / 2;
  const midY = s.mapHeight / 2;

  // Calculate sector coverage (4 quadrants) to encourage balanced exploration
  const quadrantTotal = [0, 0, 0, 0];
  const quadrantRevealed = [0, 0, 0, 0];
  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      const q = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);
      quadrantTotal[q]++;
      if (s.beliefMap[y][x].isRevealed) quadrantRevealed[q]++;
    }
  }
  const quadrantRatio = quadrantRevealed.map((rev, i) => rev / (quadrantTotal[i] || 1));

  interface FrontierCandidate {
    pos: Position;
    infoPotential: number;
    score: number;
  }

  const candidates: FrontierCandidate[] = [];

  for (let y = 0; y < s.mapHeight; y++) {
    for (let x = 0; x < s.mapWidth; x++) {
      if (s.beliefMap[y][x].isRevealed) continue;
      const key = posKey(x, y);
      if (unreachable.has(key)) continue;

      // Check if adjacent to revealed passable cell
      let adjacentRevealed = false;
      for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
        const nx = x + d.x, ny = y + d.y;
        if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight) {
          const adjCell = s.beliefMap[ny][nx];
          if (adjCell.isRevealed) {
            const activeConfigs = s.terrainConfigs || TERRAIN_CONFIGS;
            const cfg = activeConfigs[adjCell.terrain] || TERRAIN_CONFIGS[adjCell.terrain];
            if (cfg?.passable) {
              adjacentRevealed = true;
              break;
            }
          }
        }
      }
      if (!adjacentRevealed) continue;

      // Information gain potential
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
      const q = (x < midX ? 0 : 1) + (y < midY ? 0 : 2);
      const quadrantBonus = (1 - quadrantRatio[q]) * 15;

      let objBias = 0;
      const undiscoveredObj = s.objectives.find(o => !o.discovered);
      if (undiscoveredObj) {
        objBias = -manhattanDist({ x, y }, undiscoveredObj.position) * 0.4;
      }

      const visits = s.visitedCount?.[key] || 0;
      const visitPenalty = visits * 4.0;

      const score = (infoPotential * 2.5) - (dist * 0.8) + quadrantBonus + objBias - visitPenalty;
      candidates.push({ pos: { x, y }, infoPotential, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Evaluate top candidates for reachability and energy feasibility
  const topCandidates = candidates.slice(0, 16);
  for (const cand of topCandidates) {
    const pathRes = findPath(
      s.beliefMap, s.roverPosition, cand.pos,
      s.energyCosts.baseMovement, 1.2,
      s.terrainConfigs, s.visitedCount, 2.0
    );

    if (!pathRes || pathRes.path.length === 0) {
      s.unreachableTargets.push(posKey(cand.pos.x, cand.pos.y));
      continue;
    }

    const haven = findNearestRechargeHaven(
      s.beliefMap, cand.pos, s.homeBase, s.solarStations,
      s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs
    );
    const returnCost = haven ? haven.energyCost : estimateReturnEnergy(s.beliefMap, cand.pos, s.homeBase, s.energyCosts.baseMovement, s.uncertaintyBuffer, s.terrainConfigs);
    const totalRequired = pathRes.energyCost + returnCost + s.safetyReserve;

    if (s.battery.currentEnergy >= totalRequired) {
      return { target: cand.pos, path: pathRes.path };
    }
  }

  return null;
}

// ============================================================
// Dynamic Environmental Hazards & Route Adaptation
// ============================================================

export function triggerDynamicEnvironmentalHazards(s: SimulationState) {
  if (!s.missionStarted || s.missionComplete || s.missionFailed) return;

  // Trigger an environmental obstacle event every 28 ticks
  if (s.tickCount > 15 && s.tickCount % 28 === 0) {
    let targetCell: Position | null = null;

    // Check if rover has a multi-step path ahead, pick a waypoint ahead
    if (s.roverPath.length >= 3) {
      const candidate = s.roverPath[2];
      if (
        !posEqual(candidate, s.homeBase) &&
        !isAtSolarChargingStation(candidate, s.solarStations) &&
        !posEqual(candidate, s.roverPosition)
      ) {
        targetCell = candidate;
      }
    }

    // Otherwise pick a revealed passable cell within 5 cells radius of rover
    if (!targetCell) {
      const nearby: Position[] = [];
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = s.roverPosition.x + dx;
          const ny = s.roverPosition.y + dy;
          if (nx >= 0 && nx < s.mapWidth && ny >= 0 && ny < s.mapHeight) {
            const cell = s.beliefMap[ny][nx];
            const gCell = s.groundTruth[ny][nx];
            if (
              cell.isRevealed &&
              gCell.terrain !== TerrainType.BOULDER &&
              gCell.terrain !== TerrainType.CRATER &&
              !posEqual({ x: nx, y: ny }, s.roverPosition) &&
              !posEqual({ x: nx, y: ny }, s.homeBase) &&
              !isAtSolarChargingStation({ x: nx, y: ny }, s.solarStations)
            ) {
              nearby.push({ x: nx, y: ny });
            }
          }
        }
      }
      if (nearby.length > 0) {
        targetCell = nearby[Math.floor(Math.random() * nearby.length)];
      }
    }

    if (targetCell) {
      const hazardTypes = ['Seismic Rockfall', 'Caldera Ridge Creep', 'Dune Slump Barrier', 'Cryo-Fault Debris'];
      const hazardType = hazardTypes[Math.floor(Math.random() * hazardTypes.length)];

      // Dynamically block the cell on ground truth and belief map
      s.groundTruth[targetCell.y][targetCell.x] = {
        ...s.groundTruth[targetCell.y][targetCell.x],
        terrain: TerrainType.BOULDER,
      };
      s.beliefMap[targetCell.y][targetCell.x] = {
        ...s.beliefMap[targetCell.y][targetCell.x],
        terrain: TerrainType.BOULDER,
        isRevealed: true,
      };

      const hazardRecord: DynamicHazard = {
        id: `hazard-${s.tickCount}`,
        x: targetCell.x,
        y: targetCell.y,
        hazardType,
        tick: s.tickCount,
      };
      s.dynamicHazards = [...(s.dynamicHazards || []), hazardRecord];

      // Check if current planned trajectory is blocked
      const isRouteBlocked = s.roverPath.some(p => posEqual(p, targetCell!));

      if (isRouteBlocked && s.roverTarget) {
        // Adapt to obstacle: recompute alternative path around blockage!
        const detour = findPath(
          s.beliefMap, s.roverPosition, s.roverTarget,
          s.energyCosts.baseMovement, 1.1,
          s.terrainConfigs, s.visitedCount, 1.0
        );

        if (detour && detour.path.length > 0) {
          s.roverPath = detour.path;
          addEvent(s, EventCategory.SAFETY, `⚠️ Dynamic Obstacle: ${hazardType} blocked passage at (${targetCell.x}, ${targetCell.y}) — adaptive detour recomputed (${detour.path.length} steps)!`);
          RoverMissionDatabase.getInstance().logHazard({
            id: hazardRecord.id,
            tick: s.tickCount,
            timestamp: s.metrics.elapsedTime,
            x: targetCell.x,
            y: targetCell.y,
            hazardType,
            rerouteSuccess: true,
            detourLength: detour.path.length,
          });
        } else {
          // If destination is totally surrounded, blacklist and seek new frontier
          s.roverPath = [];
          s.roverTarget = null;
          s.unreachableTargets.push(posKey(targetCell.x, targetCell.y));
          addEvent(s, EventCategory.SAFETY, `⚠️ Path Blocked: ${hazardType} closed access to target at (${targetCell.x}, ${targetCell.y}) — recalculating mission goal.`);
        }
      } else {
        addEvent(s, EventCategory.NAVIGATION, `⚠️ Environmental Hazard: ${hazardType} obstructed cell at (${targetCell.x}, ${targetCell.y}) — terrain updated.`);
      }
    }
  }
}
