# Domain: VS Code Extension (codegraph-navigator)

## Scope

Lightweight VS Code sidebar extension that imports `@codegraph/core` directly to explore scenarios, walk through execution traces, and browse functions. Located in `codegraph-navigator/` at the project root (intentionally separate from the npm workspace).

## Architecture

The extension is a **thin UI layer** that depends on `@codegraph/core` as a library. It creates a `CodeGraphClient` instance (live DB or mock mode) via `core-bridge.ts` and uses the client API for all data access. No CLI subprocess calls.

```
extension.ts        <- activate/deactivate, registers all commands
    |
    +-- core-bridge.ts       <- creates CodeGraphClient from @codegraph/core, singleton pattern
    +-- logger.ts            <- OutputChannel + datewise file logging
    +-- decorations.ts       <- editor line highlights and inline annotations
    +-- codewalk-decorations.ts <- editor decorations for code walk cells
    +-- skills-installer.ts  <- install Claude/Copilot AI skills from Command Palette
    +-- providers/
        +-- scenarios.ts           <- Scenarios tree data provider
        +-- step-walker.ts         <- Step Walker tree data provider
        +-- functions.ts           <- Functions tree data provider
        +-- call-stack-view.ts     <- Call Stack webview provider (sidebar panel)
        +-- step-detail-view.ts    <- Step Detail webview provider (sidebar panel)
        +-- codewalk-cells-view.ts <- Code Walk Cells webview provider
```

## Key Files

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest — views, commands, menus, configuration, activation events. Version 0.4.0 |
| `tsconfig.json` | TypeScript config (ES2022, Node16, separate from monorepo `tsconfig.base.json`) |
| `esbuild.mjs` | esbuild bundler config for packaging the extension |
| `media/codegraph-icon.svg` | Activity bar icon |
| **Source** | |
| `src/extension.ts` | Entry point. `activate()` registers 3 tree providers, 14 commands (showViewer, showOutput, refreshScenarios, viewScenario, walkScenario, nextStep, prevStep, openStepInEditor, refreshFunctions, searchFunctions, showScenariosForFunction, discoverFromFunction, showScenariosForSymbol, discoverFromSymbol). `deactivate()` disposes logger and core-bridge client. Helper functions: `loadAndWalk()`, `autoOpenCurrentStep()`, `getWordUnderCursor()` |
| `src/core-bridge.ts` | Library bridge to `@codegraph/core`. Singleton `CodeGraphClient` via `getClient()`. `checkAvailability()` probes live DB, falls back to mock mode. Exports: `getClient()`, `resetConnection()`, `dispose()`, `listScenarios()`, `getScenarioView(id)`, `listFunctions(search?)`, `getScenariosForFunction(functionName)`, `discoverFromFunction(functionName)`. Re-exports types: `Scenario`, `ScenarioStep`, `ScenarioView`, `FunctionNode` (as `FunctionInfo`) |
| `src/logger.ts` | Dual logging: VS Code OutputChannel ("CodeGraph Navigator") and datewise files at `.vscode/code-graph/logs/YYYY-MM-DD.log`. Exports: `initLogger(workspaceRoot)`, `getOutputChannel()`, `showOutputChannel()`, `log(level, message, data?)`, `disposeLogger()` |
| `src/decorations.ts` | Editor decorations for step walking. `openStepInEditor()` highlights current step line with inline annotation, marks other steps in the same file with blue left-border. `clearDecorations(editor)` removes all highlights. Internal helper `extractFilePath()` resolves `functionId` format `filePath:startLine` to filesystem path |
| `src/providers/scenarios.ts` | `ScenariosProvider` — tree view showing all scenarios (expandable to show steps). `ScenarioNode` with status icons, `StepPreviewNode` with action icons. Caches `ScenarioView` objects |
| `src/providers/step-walker.ts` | `StepWalkerProvider` — tree view showing current step detail (scenario name, step header, function, action, line, source code, justification, confidence, variables, corrections). `nextStep()`, `prevStep()`, `getCurrentStep()`, `getScenarioView()`, `loadScenario()` |
| `src/providers/functions.ts` | `FunctionsProvider` — tree view showing functions grouped by file (`FileGroupNode` → `FunctionNodeItem`). Supports search filtering via `setSearch(query)`. `getCachedFunctions()` for cached access |
| `src/providers/call-stack-view.ts` | `CallStackViewProvider` — webview provider that renders the current step's call stack as a collapsible sidebar panel (similar to VS Code's Debug Call Stack). Each frame is clickable (navigates to file:line). Hovering shows per-frame variables with types, rationale, confidence, and alternative values. View type: `codegraph.callStack` |
| `src/providers/step-detail-view.ts` | `StepDetailViewProvider` — webview provider that renders full step detail in a rich HTML sidebar panel. Shows AI-generated justification, imagined variable values, correction notes, and metadata in a readable format. View type: `codegraph.stepDetail` |
| `src/skills-installer.ts` | Skills installer module. `registerInstallSkillsCommand()` adds a Command Palette command to install CodeGraph AI skills for Claude (to `~/.claude/skills/`) and Copilot (to `~/.github/copilot-instructions.d/`). Pure TypeScript, cross-platform. QuickPick UI with install/check options |
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
| `codegraph.callStack` | Call Stack | Current step's call stack (webview). Clickable frames navigate to source. Hover for per-frame variable details |
| `codegraph.stepDetail` | Step Detail | Full step detail (webview). AI justification, variables, corrections in readable HTML |

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
| `codegraph.showScenariosForSymbol` | CodeGraph: Show Scenarios for This Function | Editor right-click menu (enablement: `editorHasSelection \|\| editorTextFocus`) |
| `codegraph.discoverFromSymbol` | CodeGraph: Discover Scenarios Starting from This Function | Editor right-click menu (enablement: `editorHasSelection \|\| editorTextFocus`) |
| `codegraph.installSkills` | CodeGraph: Install AI Skills (Claude & Copilot) | Command palette — installs CodeGraph AI skills to ~/.claude/skills/ and ~/.github/copilot-instructions.d/ |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codegraph.autoOpenStep` | boolean | `true` | Auto-open source file when stepping |

## Build & Install

```bash
cd codegraph-navigator
npm install
npm run build                          # tsc compile + esbuild bundle
npx @vscode/vsce package --no-dependencies  # create .vsix
code --install-extension codegraph-navigator-0.4.0.vsix
```

VS Code tasks in `.vscode/tasks.json` wrap these commands:
- **CodeGraph Navigator: Build & Install** — full pipeline (install → build → package → install VSIX)
- **CodeGraph Navigator: Watch** — `esbuild --watch` for development
- **Run CodeGraph Navigator Extension** — F5 launch config for Extension Development Host debugging

## Key Patterns

- **Core library import, not CLI subprocess**: The extension imports `@codegraph/core` directly and creates a `CodeGraphClient` via `core-bridge.ts`. This gives type-safe access to all core engines without parsing CLI stdout
- **Singleton client + DB probe**: `getClient()` creates one `CodeGraphClient` instance. It probes the live DB first; if Neo4j is unreachable, it falls back to mock mode (built-in demo data)
- **Type re-exports**: `core-bridge.ts` re-exports `Scenario`, `ScenarioStep`, `ScenarioView`, `FunctionNode` (as `FunctionInfo`) from `@codegraph/core` so providers don't import core directly
- **OutputChannel logging**: All log entries go to both the VS Code "CodeGraph Navigator" output channel (visible in Output panel) and datewise files at `.vscode/code-graph/logs/`
- **Editor decorations**: `openStepInEditor()` highlights the current step line (yellow background + annotation) and marks other steps in the same file (blue left border + hover tooltip)

## Known Limitations

- Extension activates only when workspace contains `.codegraph.yaml` (via `activationEvents`) — does not check `.vscode/code-graph/codegraph.yaml`
