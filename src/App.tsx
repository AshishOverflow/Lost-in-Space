// ============================================================
// AEGIS Rover — Mission Control Application
// ============================================================

import { useState, useMemo, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipForward, RotateCcw, Shuffle, Sun, Moon,
  Battery, Zap, Compass, Target, Crosshair, Upload, Clock,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  MapPin, Eye, Beaker, Shield, AlertTriangle, CheckCircle2,
  XCircle, Navigation, ScanLine, Pickaxe, ArrowLeft,
  Gauge, Radio, Brain, Cpu, Rocket, Footprints
} from 'lucide-react';
import { useSimulation } from './hooks/useSimulation';
import {
  TerrainType, TERRAIN_CONFIGS, RoverMode, Direction,
  EventCategory, RESOURCE_CONFIGS, LightingCondition,
  SimulationState, HistoryPoint,
} from './types/simulation';
import { formatEnergy, formatPower, formatPercent, formatSimTime, posEqual } from './utils/helpers';
import './index.css';

// ===================== HELPERS =====================

function getModeClass(mode: RoverMode): string {
  switch (mode) {
    case RoverMode.EXPLORING: case RoverMode.NAVIGATING_TO_RESOURCE: case RoverMode.NAVIGATING_TO_OBJECTIVE: return 'exploring';
    case RoverMode.RETURNING_TO_HUB: return 'returning';
    case RoverMode.COLLECTING: return 'collecting';
    case RoverMode.SCANNING_OBJECTIVE: return 'scanning';
    case RoverMode.HARVESTING: case RoverMode.WAITING_FOR_SUNLIGHT: return 'harvesting';
    case RoverMode.CONSERVING: return 'conserving';
    case RoverMode.LOW_POWER: return 'low-power';
    case RoverMode.MISSION_COMPLETE: return 'complete';
    case RoverMode.MISSION_FAILED: case RoverMode.RECOVERY_REQUIRED: return 'failed';
    default: return 'idle';
  }
}

function getModeLabel(mode: RoverMode): string {
  return mode.replace(/_/g, ' ');
}

function getStatusDotClass(mode: RoverMode, isPaused: boolean, isRunning: boolean): string {
  if (!isRunning) return 'status-dot--idle';
  if (isPaused) return 'status-dot--paused';
  if (mode === RoverMode.MISSION_COMPLETE) return 'status-dot--complete';
  if (mode === RoverMode.MISSION_FAILED || mode === RoverMode.RECOVERY_REQUIRED) return 'status-dot--failed';
  return 'status-dot--active';
}

function getBatteryClass(percent: number): string {
  if (percent > 0.5) return 'safe';
  if (percent > 0.25) return 'caution';
  return 'critical';
}

function getBatteryValueClass(percent: number): string {
  if (percent > 0.5) return 'metric-row__value--safe';
  if (percent > 0.25) return 'metric-row__value--caution';
  return 'metric-row__value--critical';
}

function getSolarIcon(condition: LightingCondition): string {
  switch (condition) {
    case LightingCondition.DAYLIGHT: return '☀️';
    case LightingCondition.MORNING: return '🌅';
    case LightingCondition.EVENING: return '🌇';
    case LightingCondition.NIGHT: return '🌙';
    case LightingCondition.DUST_STORM: return '🌫️';
  }
}

function getRoverEmoji(dir: Direction): string {
  switch (dir) {
    case Direction.NORTH: return '🔺';
    case Direction.SOUTH: return '🔻';
    case Direction.EAST: return '▶️';
    case Direction.WEST: return '◀️';
  }
}

// ===================== TELEMETRY SVG CHART =====================

function SvgTelemetryChart({
  data,
  dataKey1,
  dataKey2,
  color1,
  color2,
  label1,
  label2,
  height = 90,
  unit1 = '',
  unit2 = '',
  isPercent = false,
}: {
  data: HistoryPoint[];
  dataKey1: keyof HistoryPoint;
  dataKey2?: keyof HistoryPoint;
  color1: string;
  color2?: string;
  label1: string;
  label2?: string;
  height?: number;
  unit1?: string;
  unit2?: string;
  isPercent?: boolean;
}) {
  if (!data || data.length < 2) {
    return (
      <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
        Awaiting telemetry data...
      </div>
    );
  }
  const w = 260;
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;

  const vals1 = data.map(d => Number(d[dataKey1]) || 0);
  const vals2 = dataKey2 ? data.map(d => Number(d[dataKey2]) || 0) : [];
  const maxVal = isPercent ? 1.0 : Math.max(1, ...vals1, ...(vals2.length ? vals2 : [0])) * 1.05;

  const getPoints = (vals: number[]) => {
    return vals.map((v, i) => {
      const x = padL + (i / (vals.length - 1)) * plotW;
      const y = padT + plotH - (Math.max(0, v) / maxVal) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  };

  const pts1 = getPoints(vals1);
  const pathD1 = `M ${pts1[0]} L ${pts1.join(' L ')}`;
  const areaD1 = `M ${padL},${padT + plotH} L ${pts1.join(' L ')} L ${padL + plotW},${padT + plotH} Z`;

  let pathD2 = '';
  if (dataKey2 && vals2.length) {
    const pts2 = getPoints(vals2);
    pathD2 = `M ${pts2[0]} L ${pts2.join(' L ')}`;
  }

  const cur1 = vals1[vals1.length - 1];
  const cur2 = vals2.length ? vals2[vals2.length - 1] : null;
  const gradId = `grad-${label1.replace(/\s+/g, '')}`;

  return (
    <div style={{ width: '100%', marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
        <span style={{ color: color1 }}>
          {label1}: {isPercent ? `${(cur1 * 100).toFixed(0)}%` : `${cur1.toFixed(1)}${unit1}`}
        </span>
        {label2 && cur2 !== null && (
          <span style={{ color: color2 }}>
            {label2}: {cur2.toFixed(1)}{unit2}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block', overflow: 'hidden' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color1} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color1} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
        <line x1={padL} y1={padT + plotH / 2} x2={padL + plotW} y2={padT + plotH / 2} stroke="rgba(255,255,255,0.06)" strokeDasharray="2,2" />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="rgba(255,255,255,0.12)" />

        <text x={padL - 4} y={padT + 7} fill="var(--text-dim)" fontSize="8" textAnchor="end" fontFamily="var(--font-mono)">
          {isPercent ? '100%' : maxVal > 100 ? maxVal.toFixed(0) : maxVal.toFixed(1)}
        </text>
        <text x={padL - 4} y={padT + plotH} fill="var(--text-dim)" fontSize="8" textAnchor="end" fontFamily="var(--font-mono)">
          0
        </text>

        <path d={areaD1} fill={`url(#${gradId})`} />
        <path d={pathD1} fill="none" stroke={color1} strokeWidth="1.8" />
        {pathD2 && <path d={pathD2} fill="none" stroke={color2} strokeWidth="1.6" strokeDasharray="3,2" />}
      </svg>
    </div>
  );
}

// ===================== MAIN APP =====================

function App() {
  const sim = useSimulation();
  const { state } = sim;
  const [seedInput, setSeedInput] = useState(String(state.seed));
  const [showPath, setShowPath] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showFog, setShowFog] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number; screenX: number; screenY: number } | null>(null);

  const batteryPercent = state.battery.currentEnergy / state.battery.capacity;
  const reservePercent = (state.safetyReserve + state.decision.estimatedReturnEnergy) / state.battery.capacity;

  // Path and trail sets for quick lookup
  const pathSet = useMemo(() => {
    const s = new Set<string>();
    state.roverPath.forEach(p => s.add(`${p.x},${p.y}`));
    return s;
  }, [state.roverPath]);

  const trailSet = useMemo(() => {
    const s = new Set<string>();
    state.roverTrail.forEach(p => s.add(`${p.x},${p.y}`));
    return s;
  }, [state.roverTrail]);

  // Chart data (sampled)
  const chartData = useMemo(() => {
    const data = state.history;
    if (data.length <= 60) return data;
    const step = Math.max(1, Math.floor(data.length / 60));
    return data.filter((_, i) => i % step === 0 || i === data.length - 1);
  }, [state.history]);

  return (
    <div className="app-container">
      {/* ========== HEADER ========== */}
      <header className="mission-header">
        <div className="mission-header__left">
          <div className="mission-header__title"><span>AEGIS</span> Rover Mission Control</div>
          <div className="mission-header__status">
            <span className={`status-dot ${getStatusDotClass(state.roverMode, state.isPaused, state.isRunning)}`} />
            {!state.isRunning ? 'STANDBY' : state.isPaused ? 'PAUSED' : state.missionComplete ? 'COMPLETE' : state.missionFailed ? 'FAILED' : 'ACTIVE'}
          </div>
        </div>
        <div className="mission-header__right">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            <Clock size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
            {formatSimTime(state.metrics.elapsedTime)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cyan-400)' }}>
            {getSolarIcon(state.solar.lightingCondition)} {formatPower(state.solar.currentPower)}
          </span>
          <span className={`mode-badge mode-badge--${getModeClass(state.roverMode)}`}>
            {getModeLabel(state.roverMode)}
          </span>
        </div>
      </header>

      {/* ========== MAIN CONTENT ========== */}
      <div className="main-content">
        {/* ========== LEFT PANEL ========== */}
        <div className="panel">
          {/* Mission Overview */}
          <div className="panel-section">
            <div className="panel-section__title"><Rocket size={13} /> Mission Overview</div>
            <div className="metric-row">
              <span className="metric-row__label">Status</span>
              <span className={`mode-badge mode-badge--${getModeClass(state.roverMode)}`} style={{ fontSize: 9 }}>
                {getModeLabel(state.roverMode)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Sim Time</span>
              <span className="metric-row__value">{formatSimTime(state.metrics.elapsedTime)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Tick</span>
              <span className="metric-row__value">{state.tickCount}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Mode</span>
              <span className="metric-row__value">{state.isAutonomous ? '🤖 Autonomous' : '🎮 Manual'}</span>
            </div>
          </div>

          {/* Battery & Solar */}
          <div className="panel-section">
            <div className="panel-section__title"><Battery size={13} /> Battery & Solar</div>
            <div className="metric-row">
              <span className="metric-row__label">Battery</span>
              <span className={`metric-row__value ${getBatteryValueClass(batteryPercent)}`}>
                {(batteryPercent * 100).toFixed(0)}% ({formatEnergy(state.battery.currentEnergy)})
              </span>
            </div>
            <div className="battery-bar">
              <div
                className={`battery-bar__fill battery-bar__fill--${getBatteryClass(batteryPercent)}`}
                style={{ width: `${batteryPercent * 100}%` }}
              />
              <div className="battery-bar__reserve" style={{ left: `${Math.min(100, reservePercent * 100)}%` }} />
            </div>
            <div className="solar-indicator">
              <span className="solar-indicator__icon">{getSolarIcon(state.solar.lightingCondition)}</span>
              <div className="solar-indicator__info">
                <div className="solar-indicator__condition">{state.solar.lightingCondition.replace(/_/g, ' ')}</div>
                <div className="solar-indicator__power">{formatPower(state.solar.currentPower)}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                f={state.solar.sunlightFactor.toFixed(2)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Rated Solar Power</span>
              <span className="metric-row__value">{state.solar.ratedPower.toFixed(0)} W</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Panel Efficiency</span>
              <span className="metric-row__value">{(state.solar.panelEfficiency * 100).toFixed(0)}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Effective Solar Power</span>
              <span className="metric-row__value metric-row__value--solar">{state.solar.currentPower.toFixed(1)} W</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Capacity</span>
              <span className="metric-row__value">{formatEnergy(state.battery.capacity)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Total Harvested</span>
              <span className="metric-row__value metric-row__value--solar">{formatEnergy(state.battery.totalHarvested)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Total Consumed</span>
              <span className="metric-row__value">{formatEnergy(state.battery.totalConsumed)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Return Energy</span>
              <span className={`metric-row__value ${state.decision.estimatedReturnEnergy > state.battery.currentEnergy * 0.5 ? 'metric-row__value--caution' : ''}`}>
                {formatEnergy(state.decision.estimatedReturnEnergy)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Safety Reserve</span>
              <span className="metric-row__value">{formatEnergy(state.safetyReserve)}</span>
            </div>
          </div>

          {/* Resources & Science */}
          <div className="panel-section">
            <div className="panel-section__title"><Beaker size={13} /> Resources & Science</div>
            <div className="metric-row">
              <span className="metric-row__label">Collected</span>
              <span className="metric-row__value metric-row__value--info">{state.metrics.resourcesCollected} / {state.resources.length}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Resource Value</span>
              <span className="metric-row__value">{state.metrics.totalResourceValue}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Data (onboard)</span>
              <span className="metric-row__value">{state.onboardData.toFixed(0)} units</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Data (delivered)</span>
              <span className="metric-row__value metric-row__value--safe">{state.deliveredData.toFixed(0)} units</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Map Explored</span>
              <span className="metric-row__value">{formatPercent(state.metrics.mapExploredPercent)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Distance</span>
              <span className="metric-row__value">{state.metrics.distanceTraveled} cells</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Dist from Base</span>
              <span className="metric-row__value">
                {Math.abs(state.roverPosition.x - state.homeBase.x) + Math.abs(state.roverPosition.y - state.homeBase.y)} cells
              </span>
            </div>
          </div>

          {/* Mission Objectives */}
          <div className="panel-section">
            <div className="panel-section__title"><Target size={13} /> Objectives</div>
            {state.objectives.map(obj => (
              <div key={obj.id} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: obj.scanned ? 'var(--green-400)' : obj.discovered ? 'var(--amber-400)' : 'var(--text-muted)' }}>
                  {obj.scanned ? '✅' : obj.discovered ? '🔍' : '❓'} {obj.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', paddingLeft: 18 }}>
                  {obj.scanned ? 'Scanned' : obj.discovered ? 'Located — not scanned' : 'Not discovered'}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Completion Criteria:</div>
              <div style={{ fontSize: 10, color: state.objectives.every(o => o.scanned) ? 'var(--green-400)' : 'var(--text-secondary)' }}>
                {state.objectives.every(o => o.scanned) ? '✅' : '⬜'} Scan all objectives ({state.objectives.filter(o => o.scanned).length}/{state.objectives.length})
              </div>
              <div style={{ fontSize: 10, color: state.collectedResources.length >= 3 ? 'var(--green-400)' : 'var(--text-secondary)' }}>
                {state.collectedResources.length >= 3 ? '✅' : '⬜'} Collect 3+ resources ({state.collectedResources.length}/3)
              </div>
              <div style={{ fontSize: 10, color: state.deliveredData >= 50 ? 'var(--green-400)' : 'var(--text-secondary)' }}>
                {state.deliveredData >= 50 ? '✅' : '⬜'} Deliver 50+ data units ({state.deliveredData.toFixed(0)}/50)
              </div>
              <div style={{ fontSize: 10, color: state.missionComplete ? 'var(--green-400)' : 'var(--text-secondary)' }}>
                {state.missionComplete ? '✅' : '⬜'} Return to base {state.missionComplete ? '(Recovered)' : ''}
              </div>
            </div>
          </div>

          {/* Safety */}
          <div className="panel-section">
            <div className="panel-section__title"><Shield size={13} /> Safety Status</div>
            <div className="metric-row">
              <span className="metric-row__label">Risk Level</span>
              <span className={`risk-level risk-level--${state.decision.riskLevel}`}>{state.decision.riskLevel}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Interventions</span>
              <span className="metric-row__value">{state.metrics.safetyInterventions}</span>
            </div>
            <div className="metric-row">
              <span className="metric-row__label">Rejected Actions</span>
              <span className="metric-row__value">{state.metrics.rejectedActions}</span>
            </div>
          </div>

          {/* Terrain Legend */}
          <div className="panel-section">
            <div className="panel-section__title"><MapPin size={13} /> Terrain Legend</div>
            <div className="terrain-legend">
              {Object.values(TERRAIN_CONFIGS).filter(t => t.type !== TerrainType.UNKNOWN && t.type !== TerrainType.HOME_BASE).map(t => (
                <div key={t.type} className="terrain-legend__item">
                  <div className="terrain-legend__swatch" style={{ background: t.color, border: t.passable ? 'none' : '1px solid rgba(255,255,255,0.2)' }}>{t.symbol}</div>
                  <span>{t.label} ({t.passable ? `×${t.movementCost}` : '∞'})</span>
                </div>
              ))}
              <div className="terrain-legend__item">
                <div className="terrain-legend__swatch" style={{ background: TERRAIN_CONFIGS[TerrainType.HOME_BASE].color }}>⌂</div>
                <span>Home Base</span>
              </div>
              <div className="terrain-legend__item">
                <div className="terrain-legend__swatch" style={{ background: TERRAIN_CONFIGS[TerrainType.UNKNOWN].color, border: '1px solid rgba(255,255,255,0.1)' }}>?</div>
                <span>Unknown Fog</span>
              </div>
            </div>
          </div>

          {/* Minerals & Resources Legend */}
          <div className="panel-section">
            <div className="panel-section__title"><Beaker size={13} /> Minerals & Resources</div>
            <div className="terrain-legend">
              {Object.values(RESOURCE_CONFIGS).map(r => (
                <div key={r.label} className="terrain-legend__item">
                  <div
                    className="terrain-legend__swatch"
                    style={{
                      background: r.color,
                      color: '#000',
                      fontWeight: 700,
                      boxShadow: `0 0 6px ${r.color}88`,
                    }}
                  >
                    {r.symbol}
                  </div>
                  <span>{r.label} (+{r.baseValue}v)</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ========== CENTER — MAP ========== */}
        <div className="map-container">
          <div className="map-toolbar">
            <div className="map-toolbar__left">
              {/* Simulation controls */}
              {!state.missionStarted ? (
                <button className="btn btn--success" onClick={sim.startMission}>
                  <Play size={13} /> Start
                </button>
              ) : state.isPaused ? (
                <button className="btn btn--success" onClick={sim.resumeMission}>
                  <Play size={13} /> Resume
                </button>
              ) : (
                <button className="btn" onClick={sim.pauseMission}>
                  <Pause size={13} /> Pause
                </button>
              )}
              <button className="btn btn--icon" onClick={sim.stepMission} title="Step">
                <SkipForward size={13} />
              </button>
              <button className="btn btn--icon" onClick={sim.resetMission} title="Reset">
                <RotateCcw size={13} />
              </button>
              <button className="btn btn--icon" onClick={() => sim.newEnvironment()} title="New Environment">
                <Shuffle size={13} />
              </button>

              <span style={{ color: 'var(--border-strong)', margin: '0 2px' }}>|</span>

              {/* Speed */}
              <div className="speed-control">
                <span className="speed-control__label">SPD</span>
                {[1, 2, 4, 8].map(spd => (
                  <button
                    key={spd}
                    className={`btn speed-btn ${state.simulationSpeed === spd ? 'btn--active' : ''}`}
                    onClick={() => sim.setSpeed(spd)}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            <div className="map-toolbar__right">
              {/* Seed input */}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Seed:</span>
              <input
                className="input-field"
                value={seedInput}
                onChange={e => setSeedInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sim.setSeed(parseInt(seedInput) || 42); }}
                style={{ width: 60 }}
              />
              <button className="btn" onClick={() => sim.setSeed(parseInt(seedInput) || 42)} style={{ fontSize: 10 }}>
                Apply
              </button>

              <span style={{ color: 'var(--border-strong)', margin: '0 2px' }}>|</span>

              {/* Toggles */}
              <button className={`btn btn--icon ${showPath ? 'btn--active' : ''}`} onClick={() => setShowPath(!showPath)} title="Toggle Path">
                <Navigation size={12} />
              </button>
              <button className={`btn btn--icon ${showTrail ? 'btn--active' : ''}`} onClick={() => setShowTrail(!showTrail)} title="Toggle Trail">
                <Footprints size={12} />
              </button>
              <button className={`btn btn--icon ${showFog ? 'btn--active' : ''}`} onClick={() => setShowFog(!showFog)} title="Toggle Fog">
                <Eye size={12} />
              </button>

              <span style={{ color: 'var(--border-strong)', margin: '0 2px' }}>|</span>

              {/* Mode toggle */}
              <button
                className={`btn ${state.isAutonomous ? 'btn--primary' : ''}`}
                onClick={sim.toggleMode}
              >
                {state.isAutonomous ? <><Brain size={12} /> Auto</> : <><Cpu size={12} /> Manual</>}
              </button>
            </div>
          </div>

          {state.missionComplete && (
            <div style={{
              background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.25), rgba(6, 182, 212, 0.25))',
              border: '1px solid var(--green-400)',
              borderRadius: 6,
              padding: '10px 16px',
              margin: '0 12px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--green-400)',
              fontWeight: 600,
              fontSize: 12,
              boxShadow: '0 0 15px rgba(16, 185, 129, 0.25)'
            }}>
              <span>🏆 MISSION ACCOMPLISHED — All objectives scanned, resources collected, and rover recovered at Home Base!</span>
              <span style={{ fontSize: 11, color: 'var(--cyan-400)', fontFamily: 'var(--font-mono)' }}>
                Data Delivered: {state.deliveredData.toFixed(0)} units
              </span>
            </div>
          )}

          {/* MAP GRID */}
          <div className="map-canvas-wrapper">
            <div
              className="map-grid"
              style={{
                gridTemplateColumns: `repeat(${state.mapWidth}, 20px)`,
                gridTemplateRows: `repeat(${state.mapHeight}, 20px)`,
              }}
            >
              {Array.from({ length: state.mapHeight }, (_, y) =>
                Array.from({ length: state.mapWidth }, (_, x) => {
                  const isRover = state.roverPosition.x === x && state.roverPosition.y === y;
                  const isHome = state.homeBase.x === x && state.homeBase.y === y;
                  const beliefCell = state.beliefMap[y][x];
                  const revealed = beliefCell.isRevealed;
                  const isOnPath = showPath && pathSet.has(`${x},${y}`);
                  const isOnTrail = showTrail && trailSet.has(`${x},${y}`);

                  const terrainCfg = revealed ? TERRAIN_CONFIGS[beliefCell.terrain] : TERRAIN_CONFIGS[TerrainType.UNKNOWN];
                  const bgColor = (showFog && !revealed) ? TERRAIN_CONFIGS[TerrainType.UNKNOWN].color : terrainCfg.color;

                  let content = null;
                  if (isRover) {
                    content = <span className="rover-icon">{getRoverEmoji(state.roverDirection)}</span>;
                  } else if (isHome && revealed) {
                    content = <span className="map-cell__home">⌂</span>;
                  } else if (revealed && beliefCell.hasResource && beliefCell.resource && !beliefCell.resource.collected) {
                    const rc = RESOURCE_CONFIGS[beliefCell.resource.type];
                    content = (
                      <span
                        className="map-cell__resource"
                        style={{
                          color: rc.color,
                          filter: `drop-shadow(0 0 5px ${rc.color})`,
                          fontWeight: 'bold',
                          fontSize: 12,
                        }}
                      >
                        {rc.symbol}
                      </span>
                    );
                  } else if (revealed && beliefCell.hasObjective && beliefCell.objective && !beliefCell.objective.scanned) {
                    content = <span className="map-cell__objective">🔬</span>;
                  } else if (revealed && beliefCell.hasObjective && beliefCell.objective && beliefCell.objective.scanned) {
                    content = <span style={{ fontSize: 10, opacity: 0.4 }}>✓</span>;
                  } else if (!revealed && showFog) {
                    content = null;
                  } else if (revealed) {
                    // Show terrain symbol for revealed non-flat cells
                    if (beliefCell.terrain !== TerrainType.FLAT_ROCK && beliefCell.terrain !== TerrainType.HOME_BASE) {
                      content = <span style={{ fontSize: 8, opacity: 0.4, fontWeight: 700 }}>{terrainCfg.symbol}</span>;
                    }
                  }

                  const classes = [
                    'map-cell',
                    !revealed && showFog ? 'map-cell--unknown' : '',
                    isOnTrail && !isRover ? 'map-cell--trail' : '',
                    isOnPath && !isRover ? 'map-cell--path' : '',
                    isRover ? 'map-cell--rover' : '',
                    revealed && beliefCell.terrain === TerrainType.BOULDER ? 'map-cell--boulder' : '',
                    revealed && beliefCell.terrain === TerrainType.CRATER ? 'map-cell--crater' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={`${x}-${y}`}
                      className={classes}
                      style={{ backgroundColor: bgColor }}
                      onMouseEnter={e => setHoveredCell({ x, y, screenX: e.clientX, screenY: e.clientY })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Manual controls overlay */}
          {!state.isAutonomous && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(18, 21, 28, 0.92)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: '10px 16px',
              display: 'flex', alignItems: 'center', gap: 16,
              backdropFilter: 'blur(8px)',
            }}>
              <div className="manual-controls">
                <button className="btn btn--icon btn-up" onClick={() => sim.moveRover(Direction.NORTH)}><ChevronUp size={16} /></button>
                <button className="btn btn--icon btn-down" onClick={() => sim.moveRover(Direction.SOUTH)}><ChevronDown size={16} /></button>
                <button className="btn btn--icon btn-left" onClick={() => sim.moveRover(Direction.WEST)}><ChevronLeft size={16} /></button>
                <button className="btn btn--icon btn-right" onClick={() => sim.moveRover(Direction.EAST)}><ChevronRight size={16} /></button>
                <button className="btn btn--icon btn-center" onClick={sim.manualScan} title="Scan"><ScanLine size={14} /></button>
              </div>
              <div className="manual-actions">
                <button className="btn" onClick={sim.manualCollect}><Pickaxe size={12} /> Collect</button>
                <button className="btn" onClick={sim.manualReturn}><ArrowLeft size={12} /> Return</button>
                <button className="btn" onClick={sim.manualWait}><Clock size={12} /> Wait</button>
              </div>
            </div>
          )}

          {/* Cell tooltip */}
          {hoveredCell && (
            <CellTooltip state={state} x={hoveredCell.x} y={hoveredCell.y} screenX={hoveredCell.screenX} screenY={hoveredCell.screenY} />
          )}
        </div>

        {/* ========== RIGHT PANEL ========== */}
        <div className="panel">
          {/* AI Decision */}
          <div className="panel-section">
            <div className="panel-section__title"><Brain size={13} /> Rover Intelligence</div>
            <div className="decision-card">
              <div className="decision-card__header">Current Goal</div>
              <div className="decision-card__value">{state.decision.currentGoal}</div>
            </div>
            <div className="decision-card">
              <div className="decision-card__header">Current Action</div>
              <div className="decision-card__value">{state.decision.currentAction}</div>
            </div>
            <div className="decision-card">
              <div className="decision-card__header">Reason</div>
              <div className="decision-card__value" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {state.decision.actionReason}
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <div className="metric-row">
                <span className="metric-row__label">Risk</span>
                <span className={`risk-level risk-level--${state.decision.riskLevel}`}>{state.decision.riskLevel}</span>
              </div>
              <div className="metric-row">
                <span className="metric-row__label">Return Energy</span>
                <span className="metric-row__value">{formatEnergy(state.decision.estimatedReturnEnergy)}</span>
              </div>
              <div className="metric-row">
                <span className="metric-row__label">Solar Condition</span>
                <span className="metric-row__value metric-row__value--solar">
                  {getSolarIcon(state.solar.lightingCondition)} {state.solar.lightingCondition.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-row__label">Next Action</span>
                <span className="metric-row__value" style={{ fontSize: 10 }}>{state.decision.nextPlannedAction}</span>
              </div>
            </div>
          </div>

          {/* Candidate Actions */}
          {state.decision.candidates.length > 0 && (
            <div className="panel-section">
              <div className="panel-section__title"><Gauge size={13} /> Action Candidates</div>
              <div className="candidate-list">
                {[...state.decision.candidates]
                  .sort((a, b) => b.utility - a.utility)
                  .slice(0, 8)
                  .map((c, i) => (
                    <div key={i} className={`candidate-item ${i === 0 && c.safetyAllowed ? 'candidate-item--best' : ''} ${!c.safetyAllowed ? 'candidate-item--unsafe' : ''}`}>
                      <span className="candidate-item__name">
                        {c.action.description}
                        {!c.safetyAllowed && <span style={{ fontSize: 9, color: 'var(--red-400)', marginLeft: 4 }}>⚠</span>}
                      </span>
                      <span className={`candidate-item__utility ${c.utility > 0 ? 'metric-row__value--safe' : 'metric-row__value--critical'}`}>
                        {c.utility.toFixed(2)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Energy Charts */}
          <div className="panel-section">
            <div className="panel-section__title"><Zap size={13} /> Energy History</div>
            <SvgTelemetryChart
              data={chartData}
              dataKey1="battery"
              dataKey2="solarPower"
              color1="#60a5fa"
              color2="#22d3ee"
              label1="Battery"
              label2="Solar"
              unit1=" Wh"
              unit2=" W"
              height={95}
            />
          </div>

          {/* Harvested vs Consumed */}
          <div className="panel-section">
            <div className="panel-section__title"><Sun size={13} /> Energy Balance</div>
            <SvgTelemetryChart
              data={chartData}
              dataKey1="harvested"
              dataKey2="consumed"
              color1="#34d399"
              color2="#f87171"
              label1="Harvested"
              label2="Consumed"
              unit1=" Wh"
              unit2=" Wh"
              height={85}
            />
          </div>

          {/* Exploration Progress */}
          <div className="panel-section">
            <div className="panel-section__title"><Compass size={13} /> Exploration</div>
            <SvgTelemetryChart
              data={chartData}
              dataKey1="explored"
              color1="#a78bfa"
              label1="Explored"
              isPercent={true}
              height={75}
            />
          </div>

          {/* Event Log */}
          <div className="panel-section">
            <div className="panel-section__title"><Radio size={13} /> Mission Log ({state.events.length})</div>
            <div className="event-log">
              {state.events.length === 0 ? (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11 }}>
                  No events yet
                </div>
              ) : (
                [...state.events].reverse().slice(0, 50).map(evt => (
                  <div key={evt.id} className="event-entry">
                    <span className="event-entry__time">{formatSimTime(evt.timestamp)}</span>
                    <span className={`event-entry__badge event-entry__badge--${evt.category.toLowerCase()}`}>
                      {evt.category}
                    </span>
                    <span className="event-entry__text">{evt.description}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== CELL TOOLTIP =====================

function CellTooltip({ state, x, y, screenX, screenY }: {
  state: SimulationState; x: number; y: number; screenX: number; screenY: number;
}) {
  const beliefCell = state.beliefMap[y][x];
  const revealed = beliefCell.isRevealed;
  const terrainCfg = revealed ? TERRAIN_CONFIGS[beliefCell.terrain] : TERRAIN_CONFIGS[TerrainType.UNKNOWN];
  const isRover = state.roverPosition.x === x && state.roverPosition.y === y;
  const isHome = state.homeBase.x === x && state.homeBase.y === y;

  return (
    <div className="cell-tooltip" style={{
      left: Math.min(screenX + 12, window.innerWidth - 180),
      top: Math.min(screenY + 12, window.innerHeight - 140),
    }}>
      <div className="cell-tooltip__title">
        ({x}, {y}) — {revealed ? terrainCfg.label : 'Unknown'}
      </div>
      {revealed && (
        <>
          <div className="cell-tooltip__row">
            <span>Cost</span>
            <span>{terrainCfg.passable ? `×${terrainCfg.movementCost}` : 'Impassable'}</span>
          </div>
          {isRover && (
            <div className="cell-tooltip__row">
              <span>🤖</span>
              <span>Rover here</span>
            </div>
          )}
          {isHome && (
            <div className="cell-tooltip__row">
              <span>⌂</span>
              <span>Home Base</span>
            </div>
          )}
          {beliefCell.hasResource && beliefCell.resource && (
            <div className="cell-tooltip__row">
              <span>{RESOURCE_CONFIGS[beliefCell.resource.type].symbol}</span>
              <span>{RESOURCE_CONFIGS[beliefCell.resource.type].label} (v:{beliefCell.resource.value})</span>
            </div>
          )}
          {beliefCell.hasObjective && beliefCell.objective && (
            <div className="cell-tooltip__row">
              <span>🔬</span>
              <span>{beliefCell.objective.name}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
