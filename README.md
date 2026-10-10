# AEGIS Rover: Lost in Space (Planetary Rover Mission Control)

## Team

**Team Name:** NASA

| Name | Roll Number |
|:---|:---|
| Narain Surya RS | 24PC16 |
| Ashish MKS | 24PC03 |
| Sachin Saravan K | 24PC31 |
| Aparnaa M | 24PC02 |
| Bindusai Gunturi | 24PC10 |

---

## Selected Problem Statement

**Lost in Space: Rover Mission Control**

Build a simulation system that controls a rover exploring an unknown environment with limited energy. The rover must collect valuable data, upload it from designated communication zones, adapt to changing conditions, and plan a safe return before its energy runs out.

---

## Solution Description

AEGIS Rover Mission Control is an interactive, browser-based rover simulation. An autonomous rover explores four procedurally generated planetary environments (Mars, Moon, Europa, Titan) while a live dashboard shows its decisions.

- **Unknown environment:** Seeded PRNG terrain generation gives reproducible maps with planet-specific terrain, hazards and solar conditions. The environment can be switched mid-session.
- **Exploration tracking:** Fog-of-war reveals only cells within sensor range. Explored % is tracked live, and every discovery is logged with coordinates.
- **Energy management:** Terrain-dependent movement costs and a solar charging cycle drive the energy model. A Safety Manager vetoes exploration and forces a return when the battery nears `E_return_path × uncertainty_buffer + safety_reserve`.
- **Useful locations:** The rover finds biosignature objectives and rich sample sources, and the user can designate a Most Valuable Location for the planner to prioritise.
- **Data collection and transport:** Samples are collected and data is buffered onboard. Delivery uses a CCSDS DTN (RFC 9171) simulation and only completes when the rover docks at the home base hub.
- **Communication and charging zones:** The home hub is the downlink point, and solar charging points act as mid-mission waypoints. The planner scores both when choosing actions.
- **Blocked paths:** Dynamic hazards appear mid-mission. A* re-plans every tick, and a Path Safety Score and Wheel Slip Probability update live.
- **Measurable results:** A Mission Debrief popup summarises the run (area explored, resources, energy harvested, distance, data delivered). Every run is also appended to `src/database/missions.json`, and a live telemetry log records all events.

| Planet | Solar Flux | Battery | Key Challenge |
|:---|:---:|:---:|:---|
| Mars (Olympus Ridge) | 30 W | 100 Wh | Dust attenuation |
| Moon (Shackleton Rim) | 42 W | 110 Wh | Dense craters, sharp shadows |
| Europa (Conamara Chaos) | 14 W | 120 Wh | Faint sunlight, high energy cost |
| Titan (Shangri-La Dunes) | 8 W | 130 Wh | Haze, severe solar limitation |

---

## Technologies and Tools

| Category | Technology |
|:---|:---|
| Framework | React 19 |
| Language | TypeScript 6 |
| Build Tool | Vite 8 |
| Pathfinding | Custom A* (TypeScript) |
| Terrain Generation | Seeded PRNG generator |
| Charts / Icons | Recharts, Lucide React |
| Persistence | JSON flat-file (`missions.json`) |
| Data Transport Simulation | CCSDS DTN (RFC 9171) |
| Styling | Vanilla CSS (dark mode, glassmorphism) |
| Linting | OxLint |

---

## Running and Demonstrating the Project

**Prerequisites:** Node.js v18+ and npm.

```bash
npm install        # install dependencies
npm run dev        # start dev server at http://localhost:5173
npm run build      # production build
npm run preview    # preview the production build
```

**Demo steps**

1. Open http://localhost:5173. A Mars environment loads by default.
2. Click **Start Mission** in the map toolbar and watch the rover explore through the fog-of-war.
3. Watch the battery bar and Path Safety Score. The rover returns on its own when energy nears the reserve threshold.
4. Check the Mission Telemetry Log for SAFETY and NAVIGATION events as dynamic hazards force re-routing.
5. When the mission ends, review the Mission Debrief popup. The run is also saved to `src/database/missions.json`.
6. To try another planet, click Moon, Europa or Titan, read the briefing, then click **Commence Expedition**.

---

## Significant External Resources

**Libraries:** React, TypeScript, Vite, Lucide React, Recharts, OxLint.

**Algorithms and references:**
- A* Search: Hart, Nilsson and Raphael (1968)
- CCSDS Delay Tolerant Networking, RFC 9171
- Terramechanics: Bekker and Wong soil-wheel interaction models
- Diurnal solar cycle modelling with zenith angle
- Partial observability and SLAM-inspired exploration concepts
- Sakayori, G., & Ishigami, G. (2021). Energy-aware trajectory planning for planetary rovers. Advanced Robotics, 35(21–22), 1302–1316. https://doi.org/10.1080/01691864.2021.1959396
- Topiwala, A., Inani, P., & Kathpal, A. (2018, June 10). Frontier based exploration for autonomous robot. arXiv.org. https://arxiv.org/abs/1806.03581
- Anil, A., Lanillos, P., & Kouw, W. M. (2026, August 1). Expected free energy-based informative path planning for robotic Mars exploration. Research Portal Eindhoven University of Technology. https://research.tue.nl/en/publications/expected-free-energy-based-informative-path-planning-for-robotic-/
---

## Use of AI Tools

We used **Google Antigravity** with **Claude Sonnet 4.6** and **Gemini 3.8 Flash** throughout development, mainly for:

- The multi-objective utility planner and Safety Manager (`engine.ts`)
- A* pathfinding with terrain-weighted energy costs
- Dynamic hazard injection and path re-routing
- The CCSDS DTN data transport simulation
- The wheel-slip probability model
- The planetary briefing modal, colour guides, CSS design system, mission debrief popup and JSON persistence