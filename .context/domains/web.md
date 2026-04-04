# Domain: Web UI (@codegraph/web)

## Scope

React + Vite single-page application with graph visualization. Located in `packages/web/`. Connects to the server via REST API (not GraphQL).

## Key Technologies

| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| Vite 5 | Build tool + dev server |
| Cytoscape.js | Call graph visualization |
| Zustand | State management |

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Vite entry point — renders `<App />` |
| `src/App.tsx` | Root component — layout and routing |
| `src/api.ts` | REST API client — typed fetch wrappers for all `/api/*` endpoints |
| `src/types.ts` | Shared TypeScript types (`Scenario`, `ScenarioStep`, `FunctionNode`, `CallEdge`, `BranchNode`, `Correction`, `CorrectionResult`, `GraphData`, `GraphNode`, `GraphEdge`, `DatabaseStats`, etc.) |
| `src/stores/scenario.ts` | `useScenarioStore` — Zustand store for scenarios, steps, variable state, corrections |
| `src/stores/graph.ts` | `useGraphStore` — Zustand store for graph visualization nodes, edges, layout, filtering |
| `src/stores/config.ts` | `useConfigStore` — Zustand store for editor config (e.g., `sshHost` for VS Code Remote SSH links). Fetches from `/api/config` |
| **Components** | |
| `src/components/ScenarioList.tsx` | Browse discovered scenarios |
| `src/components/ScenarioDetail.tsx` | View scenario with steps |
| `src/components/Walkthrough.tsx` | Step-by-step walkthrough UI |
| `src/components/CallGraph.tsx` | Cytoscape.js graph visualization |
| `src/components/CorrectionChat.tsx` | Submit corrections in natural language |
| `src/components/Header.tsx` | Application header/navigation |
| `src/components/JustificationPanel.tsx` | Display step justifications and assumptions |
| `src/components/OpenInVSCode.tsx` | "Open in VS Code" button — generates `vscode://` or `vscode-remote://` URIs using `sshHost` from config store for remote SSH workspaces |

## API Client

The web UI communicates with the server via REST API (`/api/*`), not GraphQL. The `api.ts` module provides typed functions:

- `fetchScenarios()`, `fetchScenario(id)`, `fetchSteps(scenarioId, from?, to?)`
- `discoverScenarios(hint?)`, `traceScenario(scenarioId)`
- `submitCorrection(scenarioId, message, stepId?)`
- `searchFunctions(query, limit?)`, `getCallers(functionId)`, `getCallees(functionId)`
- `fetchGraphData(scenarioId)`, `getStats()`

## Zustand Stores

### `useScenarioStore`
Manages: `scenarios`, `currentScenario`, `steps`, `totalSteps`, `currentStep`, `variableState`, `loading`, `error`.
Actions: `fetchScenarios()`, `fetchScenario(id)`, `fetchSteps(scenarioId)`, `setCurrentStep(index)`, `submitCorrection()`.
Variable state is computed by merging step variable states up to the current step index.

### `useGraphStore`
Manages: `nodes`, `edges`, `layout` (LayoutName: dagre/breadthfirst/cose/circle/grid), `filterText`, `loading`, `error`.
Actions: `fetchGraphData(scenarioId)`, `setLayout()`, `filterNodes()`.
Derived: `getFilteredNodes()`, `getFilteredEdges()`.

## Patterns

- **Zustand stores**: State management over Redux — simpler API, no boilerplate
- **REST API client**: Direct fetch to `/api/*` with typed response parsing
- **Cytoscape.js**: Declarative graph rendering for call paths and class hierarchies
- **Vite**: HMR dev server (`npm run dev`), production build (`npm run build`)
- **tsconfig**: Uses ESNext module (browser target), not Node16 like other packages

## Dev Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
```
