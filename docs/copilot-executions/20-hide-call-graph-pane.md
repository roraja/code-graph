# 20 - Hide Call Graph Pane

**Date**: 2026-05-20 11:25 UTC
**Prompt**: "Can you simplify code-graph. Currently it depends on Neo4j and it has 2 panes. I want to keep only the codewalk scenario page and hide the other pane (code graph)"

## 1. Code Reading & Analysis

- `.context/FLOORPLAN.md` — confirmed package layout: core, cli, server, web, codegraph-navigator
- `.context/domains/web.md` — confirmed web UI structure, Zustand stores, key components, and that `CallGraph.tsx` is the Cytoscape-based call graph visualization
- `packages/web/src/App.tsx` — confirmed routes: `/`, `/scenario/:id` → `ScenarioDetail`, `/scenario/:id/walk` → `Walkthrough`
- `packages/web/src/components/ScenarioDetail.tsx` (lines 1–203) — confirmed the two-tab layout: "📊 Call Graph" (uses `CallGraph` + source-code side panel) and "🚶 Walkthrough" (uses `Walkthrough` + `CorrectionChat`). Both tabs were driven by the same Neo4j-backed scenario data
- `packages/web/src/components/Walkthrough.tsx` (lines 1–50) — confirmed the walkthrough is the "codewalk scenario page" the user wants to keep
- `packages/web/src/components/ScenarioList.tsx` — landing page, still useful (lists scenarios so user can pick one to walk through)
- `packages/web/src/api.ts` — REST client (left untouched per user scope)
- `packages/core/src/codewalk/` (`index.ts`, `file-reader.ts`) — file-based `.codewalk.json` reader, independent of Neo4j
- Grep `from.*CallGraph|import.*CallGraph` after the edit → confirmed `CallGraph` is no longer imported anywhere in `packages/web/src`

## 2. Issues Identified

- `packages/web/src/components/ScenarioDetail.tsx` had a tab bar with two tabs: Call Graph and Walkthrough. The user wants only the Walkthrough surface shown
- Default tab was `'graph'`, so users landed on the call graph first

## 3. Plan

After clarifying scope with the user (three options offered: UI-only, UI + backend swap, full Neo4j removal), the user chose **UI-only**.

Therefore the minimal, surgical change:

1. In `ScenarioDetail.tsx`, remove the tab bar entirely and render only the Walkthrough + CorrectionChat
2. Remove now-unused imports (`useState`, `CallGraph`, `OpenInVSCode`, `GraphNode`) and the styles that supported only the graph view
3. Leave `CallGraph.tsx`, `useGraphStore`, REST graph endpoints, and Neo4j backend completely untouched (per chosen scope). The `CallGraph` component becomes orphaned but tree-shakes out of the production bundle
4. Verify the web package still builds cleanly

Alternatives rejected:
- Deleting `CallGraph.tsx` and the graph store — out of scope (user picked UI-only) and would touch more files than needed
- Removing Neo4j — explicitly out of scope

## 4. Changes Made

### `packages/web/src/components/ScenarioDetail.tsx`

Reduced from 203 lines to 56 lines.

**Before** (key parts):
- Imported `useState`, `CallGraph`, `OpenInVSCode`, and `GraphNode` type
- Held `activeTab` (`'graph' | 'walkthrough'`, default `'graph'`) and `selectedNode` state
- Rendered a tab bar with two clickable tabs
- Rendered either the graph panel (call graph + source-code side panel) or the walkthrough panel based on `activeTab`

**After**:
- Imports only `React`, routing hooks, `Walkthrough`, `CorrectionChat`, `useScenarioStore`
- No local state — always renders the Walkthrough + CorrectionChat
- No tab bar; container straight into the walkthrough wrapper

Exact diff summary:
- Removed imports: `useState`, `CallGraph`, `OpenInVSCode`, `GraphNode`
- Removed styles: `tabs`, `tab`, `tabActive`, `graphPanel`, `graphMain`, `sidePanel`, `sidePanelTitle`, `sourceCode`, `nodeInfo`, `nodeLabel`, `nodeMeta`, `placeholder`
- Removed state: `activeTab`, `selectedNode`
- Removed JSX: entire tab bar (lines 127–146 in original), entire graph view block (lines 149–186 in original)
- Updated the component doc comment to reflect that the call graph pane has been removed

## 5. Commands Run

- `ls /home/roraja/src/code-graph/docs/copilot-executions/ | tail -5` → confirmed last execution log was `19-codewalk-branching.md`, so next index is `20-`
- `grep -l 'from.*CallGraph|import.*CallGraph' packages/web/src` → no matches after the edit (confirms `CallGraph` is fully orphaned in the source tree)
- `cd packages/web && npm run build` → succeeded
  - `tsc -b` passed
  - `vite build`: 343 modules transformed, `dist/assets/index-CN38_8-c.js` = 365.42 kB (gzip 111.81 kB). Bundle shrank because Cytoscape and the CallGraph component tree-shake out

No tests were run because the change only removes dead branches in a single React component; no test exercises `ScenarioDetail`'s tab state. Lint not run (no logic changes that would surface new lint issues).

## 6. Result

- Web UI now renders only the codewalk/walkthrough surface on `/scenario/:id`
- Call Graph tab and its supporting "selected node + source code" side panel are gone from the UI
- `CallGraph.tsx`, `useGraphStore`, the graph REST endpoints, and Neo4j remain in the codebase — per the user's "UI only" choice. They are no longer reachable from any rendered route but the backend still serves them in case other consumers (CLI, VS Code extension) rely on them
- Verification: `npm run build` in `packages/web` is green

Follow-ups the user may want later (not done now):
- Delete `packages/web/src/components/CallGraph.tsx`, `packages/web/src/stores/graph.ts`, and remove the Cytoscape dependency from `packages/web/package.json` to truly slim the package
- Remove the `/api/graph/:scenarioId` REST + GraphQL endpoint on the server
- Strip the Neo4j layer from core (a much larger refactor affecting scenario engine, indexer, tracer)

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/web/src/components/ScenarioDetail.tsx` | Modified | Removed the two-tab layout (Call Graph + Walkthrough). Now always renders only the Walkthrough + CorrectionChat. Removed all graph-related imports, state, styles, and JSX |
| `codegraph-navigator/package.json` | Modified | Removed the `codegraph-navigator` activity-bar container and its 5 views (Scenarios, Step Walker, Step Detail, Call Stack, Functions). Kept only the `codegraph-codewalk` container with the Code Walk Cells webview |
| `docs/copilot-executions/20-hide-call-graph-pane.md` | Created | This execution log |

---

## Follow-up turn: VS Code extension

**Prompt (follow-up)**: "Did you hide the codegraph vscode window and keep codewalk window" → "I just want to keep the codewalk activity bar container"

### Code reading
- `.context/domains/vscode-extension.md` — confirmed the extension declares two activity-bar containers in `package.json`: `codegraph-navigator` (5 Neo4j-backed views) and `codegraph-codewalk` (file-based Code Walk Cells webview)
- `codegraph-navigator/package.json` lines 22–69 — confirmed the `viewsContainers.activitybar` and `views` sections

### Change made
- `codegraph-navigator/package.json`: removed the `codegraph-navigator` entry from `viewsContainers.activitybar` and removed its entire `views.codegraph-navigator` array (Scenarios, Step Walker, Step Detail, Call Stack, Functions). Kept the `codegraph-codewalk` container + the `codegraph.codeWalkCells` webview unchanged
- Left commands, menu contributions, and provider source files in place (per UI-only scope chosen by the user). Registering TreeDataProviders for view IDs that no longer exist in the manifest is a safe no-op in VS Code

### Verification
- `python3 -c "import json; json.load(open('package.json'))"` → JSON OK
- `npm run build` in `codegraph-navigator` → green (`tsc -p tsconfig.json` + `node esbuild.mjs`). Bundle: `dist/extension.js` 15.4mb

### Result
After re-installing the VSIX, only the **Code Walk** activity-bar icon remains; the old CodeGraph activity bar (Scenarios/Step Walker/etc.) is gone from the sidebar.
