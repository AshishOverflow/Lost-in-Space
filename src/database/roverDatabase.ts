// ============================================================
// Scalable Rover Mission Database Engine
// Supports indexed queries, high-frequency telemetry logging,
// secure packet persistence, and structured mission summaries.
// ============================================================

import type { SimulationState } from '../types/simulation';
import { formatSimTime } from '../utils/helpers';

export interface SuccessfulMissionRecord {
  missionId: string;
  runIndex: number;
  completedAt: string;
  environment: string;
  status: 'MISSION_SUCCESSFUL';
  distanceTraversed: number;
  areaExploredPercent: number;
  cellsExplored: number;
  totalCells: number;
  resourcesCollectedCount: number;
  resources: Array<{ type: string; value: number }>;
  totalResourceValue: number;
  biosignaturesScanned: string[];
  solarEnergyHarvestedWh: number;
  energyConsumedWh: number;
  dataTransportedUnits: number;
  dynamicHazardsAdapted: number;
  elapsedTimeFormatted: string;
  elapsedTimeSeconds: number;
}

export interface TelemetryRecord {
  id: string;
  tick: number;
  timestamp: number;
  roverX: number;
  roverY: number;
  batteryEnergy: number;
  batteryCapacity: number;
  solarPower: number;
  harvestedTotal: number;
  consumedTotal: number;
  onboardData: number;
  deliveredData: number;
  roverMode: string;
  currentGoal: string;
}

export interface NetworkPacketRecord {
  bundleId: string;
  sequenceNum: number;
  timestamp: number;
  protocol: string;
  cipher: string;
  source: string;
  destination: string;
  dataSizeUnits: number;
  latencyMs: number;
  status: 'PENDING' | 'TRANSMITTING' | 'ACKNOWLEDGED' | 'DELIVERED';
  authHash: string;
}

export interface HazardIncidentRecord {
  id: string;
  tick: number;
  timestamp: number;
  x: number;
  y: number;
  hazardType: string;
  rerouteSuccess: boolean;
  detourLength: number;
}

export interface MissionDatabaseSummary {
  missionId: string;
  environment: string;
  totalOperatingTicks: number;
  finalTelemetryRecord?: TelemetryRecord;
  totalPacketsDelivered: number;
  totalDataDelivered: number;
  totalResourcesLogged: number;
  totalBiosignsLogged: number;
  hazardsOvercome: number;
  dbRecordsCount: number;
}

export class RoverMissionDatabase {
  private static instance: RoverMissionDatabase | null = null;
  private dbName = 'AegisRoverMissionDB';
  private dbVersion = 1;
  private idb: IDBDatabase | null = null;
  private memoryTelemetry: TelemetryRecord[] = [];
  private memoryPackets: NetworkPacketRecord[] = [];
  private memoryHazards: HazardIncidentRecord[] = [];
  private isReady = false;

  private constructor() {
    this.initIDB();
  }

  public static getInstance(): RoverMissionDatabase {
    if (!RoverMissionDatabase.instance) {
      RoverMissionDatabase.instance = new RoverMissionDatabase();
    }
    return RoverMissionDatabase.instance;
  }

  private initIDB() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      this.isReady = true;
      return;
    }

    try {
      const request = window.indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('telemetry')) {
          const store = db.createObjectStore('telemetry', { keyPath: 'id' });
          store.createIndex('tick', 'tick', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('packets')) {
          const store = db.createObjectStore('packets', { keyPath: 'bundleId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('hazards')) {
          const store = db.createObjectStore('hazards', { keyPath: 'id' });
          store.createIndex('tick', 'tick', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.idb = (event.target as IDBOpenDBRequest).result;
        this.isReady = true;
      };

      request.onerror = () => {
        this.isReady = true; // Fallback to memory storage
      };
    } catch {
      this.isReady = true;
    }
  }

  /**
   * Log an operational telemetry point whenever the rover acts
   */
  public async logOperation(record: Omit<TelemetryRecord, 'id'>): Promise<string> {
    const id = `tel-${record.tick}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const fullRecord: TelemetryRecord = { id, ...record };

    this.memoryTelemetry.push(fullRecord);
    if (this.memoryTelemetry.length > 500) {
      this.memoryTelemetry.shift();
    }

    if (this.idb) {
      try {
        const tx = this.idb.transaction('telemetry', 'readwrite');
        const store = tx.objectStore('telemetry');
        store.put(fullRecord);
      } catch {
        // IDB transaction fallback handled via in-memory store
      }
    }

    return id;
  }

  /**
   * Log a secure network packet transmission
   */
  public async logPacket(packet: NetworkPacketRecord): Promise<void> {
    this.memoryPackets.push(packet);
    if (this.memoryPackets.length > 200) {
      this.memoryPackets.shift();
    }

    if (this.idb) {
      try {
        const tx = this.idb.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        store.put(packet);
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Log an environmental obstacle adaptation event
   */
  public async logHazard(hazard: HazardIncidentRecord): Promise<void> {
    this.memoryHazards.push(hazard);

    if (this.idb) {
      try {
        const tx = this.idb.transaction('hazards', 'readwrite');
        const store = tx.objectStore('hazards');
        store.put(hazard);
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Retrieve total operating records count and telemetry summary
   */
  public getSummary(missionId: string, environment: string): MissionDatabaseSummary {
    const finalTel = this.memoryTelemetry[this.memoryTelemetry.length - 1];
    return {
      missionId,
      environment,
      totalOperatingTicks: finalTel ? finalTel.tick : 0,
      finalTelemetryRecord: finalTel,
      totalPacketsDelivered: this.memoryPackets.filter(p => p.status === 'DELIVERED' || p.status === 'ACKNOWLEDGED').length,
      totalDataDelivered: finalTel ? finalTel.deliveredData : 0,
      totalResourcesLogged: 0,
      totalBiosignsLogged: 0,
      hazardsOvercome: this.memoryHazards.length,
      dbRecordsCount: this.memoryTelemetry.length + this.memoryPackets.length + this.memoryHazards.length,
    };
  }

  public getRecentPackets(limit = 10): NetworkPacketRecord[] {
    return [...this.memoryPackets].reverse().slice(0, limit);
  }

  public getRecentHazards(): HazardIncidentRecord[] {
    return [...this.memoryHazards].reverse();
  }

  public exportJSON(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      telemetry: this.memoryTelemetry,
      packets: this.memoryPackets,
      hazards: this.memoryHazards,
    }, null, 2);
  }

  private successfulMissions: SuccessfulMissionRecord[] = [];
  private recordedMissionKeys = new Set<string>();

  /**
   * Automatically append a structured mission record to src/database/missions.json
   * each time the rover successfully completes all objectives on any planetary map.
   */
  public async recordSuccessfulMission(state: SimulationState): Promise<SuccessfulMissionRecord | null> {
    const sessionKey = `${state.seed}-${state.tickCount}-${state.environmentName || 'Mars'}`;
    if (this.recordedMissionKeys.has(sessionKey)) {
      return null;
    }
    this.recordedMissionKeys.add(sessionKey);

    const runIndex = this.successfulMissions.length + 1;
    const missionId = `AEGIS-MSN-${String(runIndex).padStart(3, '0')}`;

    const record: SuccessfulMissionRecord = {
      missionId,
      runIndex,
      completedAt: new Date().toISOString(),
      environment: state.environmentName || 'Mars Surface',
      status: 'MISSION_SUCCESSFUL',
      distanceTraversed: state.metrics?.distanceTraveled ?? 0,
      areaExploredPercent: +(((state.metrics?.discoveredCells ?? 0) / Math.max(1, state.metrics?.totalCells ?? (state.mapWidth * state.mapHeight))) * 100).toFixed(1),
      cellsExplored: state.metrics?.discoveredCells ?? 0,
      totalCells: state.metrics?.totalCells ?? (state.mapWidth * state.mapHeight),
      resourcesCollectedCount: state.collectedResources?.length ?? 0,
      resources: (state.collectedResources || []).map(r => ({
        type: r.type,
        value: r.value,
      })),
      totalResourceValue: state.metrics?.totalResourceValue ?? 0,
      biosignaturesScanned: (state.objectives || [])
        .filter(o => o.scanned)
        .map(o => o.name),
      solarEnergyHarvestedWh: +(state.battery?.totalHarvested ?? 0).toFixed(1),
      energyConsumedWh: +(state.battery?.totalConsumed ?? 0).toFixed(1),
      dataTransportedUnits: +state.deliveredData.toFixed(0),
      dynamicHazardsAdapted: state.dynamicHazards?.length ?? 0,
      elapsedTimeFormatted: formatSimTime(state.metrics?.elapsedTime ?? 0),
      elapsedTimeSeconds: state.metrics?.elapsedTime ?? 0,
    };

    this.successfulMissions.push(record);

    // Dynamic database persistence: appends straight to src/database/missions.json
    try {
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        await fetch('/api/database/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
      } else if (typeof fetch === 'function') {
        await fetch('http://localhost:5173/api/database/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
      }
    } catch (err) {
      console.warn('Auto-save to src/database/missions.json encountered network error:', err);
    }

    return record;
  }

  public getSuccessfulMissions(): SuccessfulMissionRecord[] {
    return this.successfulMissions;
  }

  public clear(): void {
    this.memoryTelemetry = [];
    this.memoryPackets = [];
    this.memoryHazards = [];
    if (this.idb) {
      try {
        const tx = this.idb.transaction(['telemetry', 'packets', 'hazards'], 'readwrite');
        tx.objectStore('telemetry').clear();
        tx.objectStore('packets').clear();
        tx.objectStore('hazards').clear();
      } catch {
        // ignored
      }
    }
  }
}
