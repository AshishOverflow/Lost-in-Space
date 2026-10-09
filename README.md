# AEGIS Rover — Resource-Aware Autonomous Exploration & Mission Control

An interactive, resource-constrained planetary rover simulation built with **React**, **TypeScript**, and **Vite**.

AEGIS simulates an autonomous rover deployed on an unknown planetary surface (e.g., Mars), tasked with exploring unmapped terrain, discovering scientific points of interest, collecting geological samples, managing its energy using **Solar Array Power (SAP)**, and returning safely to base before its battery reaches critical reserves.

---

## 🚀 Key Highlights & Capabilities

- **Autonomous Decision-Making**: Multi-objective utility planner weighing information gain, scientific value, movement costs, and risk.
- **Solar Energy Harvesting (SAP)**: Diurnal solar cycle simulation with zenith angles, solar flux, shadows, and terrain illumination.
- **A* Pathfinding & Terrain Physics**: Realistic energy dissipation based on surface elevation, sand traps, rough rocks, and obstacles.
- **Explainable AI (XAI)**: Live candidate decision evaluations showing rank, calculated utility, predicted costs, and safety rulings.
- **Guaranteed Safe-Return Safety Manager**: Continuous calculation of path-back energy costs plus safety margins; triggers autonomous return-to-base protocols.
- **Partial Observability**: Fog-of-war exploration with sensor radius revealing terrain and scientific objectives dynamically.
- **Deterministic & Seedable**: Seed-based procedural terrain generator allowing full experiment reproducibility.
- **Interactive Mission Control UI**: Glassmorphism dark-theme dashboard with interactive canvas grid, real-time Recharts telemetry, and manual override controls.

---

## 🧭 Workflow & Simulation Architecture

### 1. The Core Simulation Loop
Each simulation step models a 5-minute slice of planetary time:
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Environment    │ ──> │ Sensor Pipeline │ ──> │ Utility Planner │
│  - Solar flux   │     │ - Fog of war    │     │ - Candidate gen │
│  - Time of day  │     │ - POI discovery │     │ - Scoring       │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
┌─────────────────┐     ┌─────────────────┐     ┌────────┴────────┐
│ State & History │ <── │ Energy Physics  │ <── │ Safety Manager  │
│ - Battery, logs │     │ - Move / Sample │     │ - Reserve check │
│ - Metrics update│     │ - Solar harvest │     │ - Return veto   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 2. Autonomous Planner & Utility Scoring
The AI engine evaluates candidate actions each step:
- **Movement (N, S, E, W)**: Evaluated based on unrevealed terrain neighbors, proximity to known resources, and terrain travel cost.
- **Geological Sample Collection**: High-utility action triggered when atop minable resources (Water Ice, Regolith, Basalt, Hematite).
- **Scientific POI Scanning**: Collects high-value scientific survey data.
- **Solar Harvesting / Wait**: If battery is low during peak daylight, stationary charging yields maximum net energy intake.
- **Return to Base**: Evaluates A* path to base; utility sharply increases as battery approaches the safety reserve threshold.

### 3. Safety Manager & Safe-Return Guarantee
The safety manager continuously calculates:
$$\text{Safe Energy Threshold} = E_{\text{return\_path}} \times \mu_{\text{uncertainty}} + E_{\text{reserve}}$$
- If the current battery falls near this threshold, the safety manager **vetoes exploratory actions** and forces `RETURN_TO_BASE`.
- In manual mode, unsafe moves that would trap the rover are flagged and protected.

### 4. Solar Power (SAP) Model
Solar power generation follows astronomical equations:
- **Diurnal cycle**: 24-hour Martian sol simulated in continuous steps.
- **Solar elevation & zenith angle**: Power peaks at solar noon, decreases at dawn/dusk, and drops to zero at night.
- **Lighting zones**: Direct sunlight (100%), Diffuse light (50%), Shadow/Occlusion (15%), Night (0%).

---

## 🗺️ Terrain & Resource Classification

### Planetary Terrain Types
| Terrain | Symbol | Color | Passable | Movement Cost | Description |
|:---|:---:|:---:|:---:|:---:|:---|
| **Flat Rock** | `·` | `#252d3d` (Slate Navy) | Yes | 1.0× | Stable, low-friction basalt plain |
| **Gravel Bed** | `∴` | `#785338` (Desert Bronze) | Yes | 1.3× | Loose pebble regolith |
| **Sand Dunes** | `≈` | `#d97706` (Golden Ochre) | Yes | 1.8× | High-slip loose Martian sand dunes |
| **Rough Rock** | `▲` | `#b91c1c` (Crimson Rust) | Yes | 2.2× | Jagged, high-torque volcanic rock |
| **Steep Slope** | `⛰` | `#6b21a8` (Amethyst Purple) | Yes | 3.0× | High-elevation gradient incline |
| **Boulder Barrier** | `■` | `#1e293b` (Obsidian Slate) | No | ∞ | Impassable geological rock barrier |
| **Impact Crater** | `◯` | `#0b0f19` (Abyssal Void) | No | ∞ | Steep, hazard-prone impact structure |
| **Home Base** | `⌂` | `#0284c7` (Sapphire Station) | Yes | 1.0× | Lander deployment & data upload hub |
| **Unknown Fog** | `?` | `#07090e` (Deep Space Void) | Yes | 2.0× | Unexplored terrain (Fog of War) |

### Luminous Minerals & Resources
| Resource | Symbol | Glowing Color | Base Value | Energy Cost | Description |
|:---|:---:|:---:|:---:|:---:|:---|
| **Water Ice** | `❄` | `#00f0ff` (Neon Cyan) | +50 v | 3.0 Wh | Subsurface volatile ice deposits |
| **Mineral Sample** | `◆` | `#fbbf24` (Solar Amber) | +30 v | 2.0 Wh | Crystalline silicate mineral vein |
| **Geological Specimen** | `⬡` | `#10b981` (Emerald Green) | +40 v | 2.5 Wh | Sedimentary rock core sample |
| **Rare Element** | `★` | `#f43f5e` (Hot Rose Pink) | +70 v | 4.0 Wh | High-yield isotopic rare minerals |

---

## 🛠️ Project Structure

```
├── src/
│   ├── types/
│   │   └── simulation.ts       # Full simulation, terrain, energy & event types
│   ├── simulation/
│   │   ├── engine.ts           # State transitions, utility planner, safety manager
│   │   ├── pathfinding.ts      # A* search & optimistic path cost estimation
│   │   ├── solarModel.ts       # Diurnal solar cycle & flux calculations
│   │   └── terrainGenerator.ts # Procedural map generation with seedable PRNG
│   ├── hooks/
│   │   └── useSimulation.ts    # React state hook & auto-step interval manager
│   ├── utils/
│   │   └── helpers.ts          # Formatting, math & utility helpers
│   ├── App.tsx                 # Mission Control UI layout & components
│   ├── index.css               # Design system, glassmorphism & Martian theme
│   └── main.tsx                # React application entry
├── index.html                  # HTML5 shell with meta tags & title
├── package.json                # Dependencies and scripts
└── tsconfig.app.json           # TypeScript configuration
```

---

## 🎮 How to Run

### Prerequisites
- Node.js (v18 or higher)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Production Build
```bash
npm run build
```

---

## 🕹️ Mission Control Features & Controls

1. **Simulation Controls**:
   - `Auto (Play/Pause)`: Run autonomous AI exploration loop.
   - `Step Forward`: Step 1 action at a time to examine planner reasoning.
   - `Speed Slider`: Adjust simulation tick rate (1× to 20×).
   - `Reset / New Seed`: Generate new procedural Martian landscapes.
2. **Interactive Grid**:
   - Hover over any revealed cell to inspect coordinates, terrain type, energy cost multiplier, and resource details.
   - Visualized path-to-base and planned waypoint trails.
3. **Mission Telemetry**:
   - Real-time battery bar with safe-return reserve zone indicator.
   - Solar Array Power (SAP) gauge and current sun elevation.
   - Samples collected, data uploaded, distance traveled, and % area mapped.
4. **Explainable AI (XAI) Panel**:
   - Ranks all considered candidate actions with their reward, risk, energy cost, and utility score.
   - Highlights Safety Manager interventions and explanation strings.
5. **Telemetry Charts**:
   - Real-time power balance (Solar generation vs Motor/Subsystem consumption).
   - Historical battery charge level and exploration progression curve.
