# Domain: VS Code Extension (codegraph-navigator)

## Scope

Lightweight VS Code sidebar extension that shells out to the globally installed `codegraph` CLI to explore scenarios, walk through execution traces, and browse functions. Located in `codegraph-navigator/` at the project root (intentionally separate from the npm workspace).

## Architecture

The extension is a **thin UI layer** with zero dependency on `@codegraph/core`. All data comes from the `codegraph` CLI via subprocess calls (`execFile`). It parses JSON output from commands like `codegraph view <id> --format json` and `codegraph functions --format json`.

```
extension.ts        <- activate/deactivate, registers all commands
    |
    +-- cli-bridge.ts   <- shells out to `codegraph` CLI, parses JSON/table output
    +-- logger.ts       <- OutputChannel + datewise file logging
    +-- decorations.ts  <- editor line highlights and inline annotations
    +-- providers/
        +-- scenarios.ts    <- Scenarios tree data provider
        +-- step-walker.ts  <- Step Walker tree data provider
        +-- functions.ts    <- Functions tree data provider
```

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest — views, commands, menus, configuration, activation events |
| `tsconfig.json` | TypeScript config (ES2022, Node16, separate from monorepo `tsconfig.base.json`) |
| `media/codegraph-icon.svg` | Activity bar icon |
| **Source** | |
| `src/extension.ts` | Entry point. `activate()` registers 3 tree providers, 13 commands (showViewer, showOutput, refreshScenarios, viewScenario, walkScenario, nextStep, prevStep, openStepInEditor, refreshFunctions, searchFunctions, showScenariosForFunction, discoverFromFunction, showScenariosForSymbol, discoverFromSymbol). `deactivate()` disposes logger |
| `src/cli-bridge.ts` | Subprocess bridge to `codegraph` CLI. `runCodeGraph(args)` executes with env `NO_COLOR=1 FORCE_COLOR=0`. `probeDB()` checks live DB availability, falls back to `--mock` mode. `listScenarios()` parses table output from `codegraph scenarios` using `extractIdsFromTable()` (strips ANSI, splits on Unicode `│` U+2502, handles truncated IDs with `…`). `getScenarioView(id)` calls `codegraph view <id> --format json`. `listFunctions()` calls `codegraph functions --format json`. `getScenariosForFunction()` filters by step function names. `discoverFromFunction()` runs `codegraph discover --hint` |
| `src/logger.ts` | Dual logging: VS Code OutputChannel ("CodeGraph Navigator") and datewise files at `.vscode/code-graph/logs/YYYY-MM-DD.log`. `initLogger(workspaceRoot)`, `log(level, message, data?)`, `showOutputChannel()`, `disposeLogger()` |
| `src/types.ts` | TypeScript types mirroring CLI JSON output: `Scenario`, `ScenarioStep`, `ScenarioView`, `FunctionInfo` |
| `src/decorations.ts` | Editor decorations for step walking. `openStepInEditor()` highlights current step line with inline annotation, marks other steps in the same file with blue left-border. `extractFilePath()` resolves `functionId` format `filePath:startLine` to filesystem path |
| `src/providers/scenarios.ts` | `ScenariosProvider` — tree view showing all scenarios (expandable to show steps). `ScenarioNode` with status icons, `StepPreviewNode` with action icons. Caches `ScenarioView` objects |
| `src/providers/step-walker.ts` | `StepWalkerProvider` — tree view showing current step detail (scenario name, step header, function, action, line, source code, justification, confidence, variables, corrections). `nextStep()`, `prevStep()`, `getCurrentStep()`, `loadScenario()` |
| `src/providers/functions.ts` | `FunctionsProvider` — tree view showing functions grouped by file (`FileGroupNode` → `FunctionNode`). Supports search filtering via `setSearch(query)` |
| **Config** | |
| `LICENSE` | MIT license |
| `.vscodeignore` | Excludes source/test files from VSIX |
| `.gitignore` | Excludes node_modules, dist, map files, vsix files |

## Sidebar Views

| View ID | Name | Content |
|---------|------|---------|
| `codegraph.scenarios` | Scenarios | All scenarios from the graph. Expand to see steps. Right-click → Walk Scenario |
| `codegraph.stepWalker` | Step Walker | Current step detail with prev/next navigation buttons. Auto-opens source file |
| `codegraph.functions` | Functions | All functions grouped by file. Search button. Right-click → Show Scenarios / Discover |

## Commands

| Command | Title | Trigger |
|---------|-------|---------|
| `codegraph.showViewer` | CodeGraph: Show Code Graph Viewer | Command palette |
| `codegraph.showOutput` | CodeGraph: Show Output Log | Command palette |
| `codegraph.refreshScenarios` | CodeGraph: Refresh Scenarios | Scenarios view title bar |
| `codegraph.viewScenario` | CodeGraph: View Scenario | Scenario context menu |
| `codegraph.walkScenario` | CodeGraph: Walk Scenario | Scenario context menu |
| `codegraph.nextStep` | CodeGraph: Next Step | Step Walker title bar |
| `codegraph.prevStep` | CodeGraph: Previous Step | Step Walker title bar |
| `codegraph.openStepInEditor` | CodeGraph: Open Step in Editor | Step item click / context menu |
| `codegraph.refreshFunctions` | CodeGraph: Refresh Functions | Functions view title bar |
| `codegraph.searchFunctions` | CodeGraph: Search Functions | Functions view title bar |
| `codegraph.showScenariosForFunction` | CodeGraph: Show Scenarios for Function | Function context menu |
| `codegraph.discoverFromFunction` | CodeGraph: Discover Scenarios from Function | Function context menu |
| `codegraph.showScenariosForSymbol` | CodeGraph: Show Scenarios for This Function | Editor right-click menu |
| `codegraph.discoverFromSymbol` | CodeGraph: Discover Scenarios Starting from This Function | Editor right-click menu |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codegraph.cliPath` | string | `"codegraph"` | Path to the `codegraph` CLI binary |
| `codegraph.autoOpenStep` | boolean | `true` | Auto-open source file when stepping |

## Build & Install

```bash
cd codegraph-navigator
npm install
npm run build                          # tsc compile
npx @vscode/vsce package --no-dependencies  # create .vsix
code --install-extension codegraph-navigator-0.1.0.vsix
```

VS Code tasks in `.vscode/tasks.json` wrap these commands:
- **CodeGraph Navigator: Build & Install** — full pipeline (install → build → package → install VSIX)
- **CodeGraph Navigator: Watch** — `tsc --watch` for development
- **Run CodeGraph Navigator Extension** — F5 launch config for Extension Development Host debugging

## Key Patterns

- **CLI bridge, not library import**: The extension never imports `@codegraph/core`. It executes `codegraph` as a subprocess and parses stdout. This keeps it independent and ensures the CLI remains the primary interface
- **DB probe + mock fallback**: On first use, `probeDB()` tests DB availability. If Neo4j is unreachable, all commands automatically append `--mock` for demo data
- **ANSI stripping**: CLI output contains ANSI color codes from chalk even with `NO_COLOR=1`. `stripAnsi()` removes them before parsing JSON or table output
- **Table ID reconstruction**: `codegraph scenarios` table output truncates long IDs with `…` (U+2026). The extension reads the Name column and regenerates the full ID using the same `generateId` algorithm as `ScenarioEngine`
- **OutputChannel logging**: All log entries go to both the VS Code "CodeGraph Navigator" output channel (visible in Output panel) and datewise files at `.vscode/code-graph/logs/`

## Known Limitations

- The `codegraph scenarios` command has no `--format json` flag, so scenario listing requires fragile table parsing
- The `codegraph functions` command may fail with "LIMIT: Invalid input '100.0'" on some Neo4j versions (Cypher integer type mismatch in core)
- Extension activates only when workspace contains `.codegraph.yaml` (via `activationEvents`)
