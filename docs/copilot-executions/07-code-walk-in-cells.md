# 07 — Code Walk in Cells (Idea 4)

**Date**: 2026-04-05 13:30 UTC
**Prompt**: Implement idea 4 - code walk in cells idea of docs/next/code-walk-data-structures.md. Add a new sidebar for this codewalk feature. For a scenario, right click and let me also open its codewalk in cells. While walking, navigate cell wise only. While on a cell, highlight the lines which this cell refers to. Show the AI explanation, the variables being changed, created, referred. Show callstack also. Add skills (installable) which clearly mentions the data structure of the cells when asking to populate. Don't rely on static analyzers like clangd. Implement and create code walk in cells for the existing outlook drag enter hfdrop scenario.

## 1. Code Reading & Analysis

- `docs/next/code-walk-data-structures.md` — Read in full (1033 lines). Idea 4 (Notebook-Style Cells) is the recommended approach. Understood the WalkCell, CodeSlice, CellState, CellVariable, LineHighlight structures.
- `codegraph-navigator/src/extension.ts` — Read in full. Understood the activation flow, provider registration, command registration pattern (810 lines).
- `codegraph-navigator/package.json` — Read in full. Understood the viewsContainers, views, commands, menus structure.
- `codegraph-navigator/src/providers/scenarios.ts` — Understood tree data provider pattern and context menu items (viewItem == scenario).
- `codegraph-navigator/src/providers/step-walker.ts` — Understood the step navigation model (nextStep/prevStep) and tree rendering.
- `codegraph-navigator/src/providers/step-detail-view.ts` — Understood webview view provider pattern and HTML rendering.
- `codegraph-navigator/src/providers/call-stack-view.ts` — Understood rich webview with message passing and frame rendering.
- `codegraph-navigator/src/decorations.ts` — Understood editor decoration pattern (line highlights, gutter icons, step annotations).
- `codegraph-navigator/src/core-bridge.ts` — Understood the bridge pattern (getClient → method calls).
- `packages/core/src/scenario/engine.ts` — Understood Scenario, ScenarioStep, CallStackFrame types.
- `packages/core/src/scenario/file-reader.ts` — Understood disk-based JSON reading pattern.
- `packages/core/src/api.ts` — Understood CodeGraphClient facade and how to add new methods.
- `packages/core/src/index.ts` — Understood barrel export pattern.
- `.claude/skills/update-context/skills/SKILL.md` — Understood skill file format (YAML frontmatter + markdown body).

## 2. Issues Identified

No bugs — this is a greenfield feature implementation. Key design decisions:
- Idea 4 (Notebook Cells) chosen per the design doc's own recommendation
- New sidebar container needed (separate from existing CodeGraph Navigator)
- Right-click on scenario needs a new "Open Code Walk" context menu item
- Cell navigation must be cell-wise only (not line-wise)
- Line highlighting must use cell's `highlights` array for per-line decoration types
- Skills must document the full data structure so AI agents can produce correct JSON

## 3. Plan

1. **Core types** — Create `packages/core/src/codewalk/types.ts` with all cell data structures
2. **Core file reader** — Create `packages/core/src/codewalk/file-reader.ts` to read `.codewalk.json`
3. **Core barrel export** — Update `packages/core/src/index.ts` to export codewalk types
4. **Core API** — Add `listCodeWalks`, `getCodeWalk`, `getCodeWalkForScenario` to CodeGraphClient
5. **VS Code webview** — Create `codewalk-cells-view.ts` webview provider with cell rendering
6. **VS Code decorations** — Create `codewalk-decorations.ts` for per-line highlighting
7. **VS Code extension** — Register new sidebar, commands, context menu items
8. **VS Code package.json** — Add sidebar container, views, commands, menus
9. **Core bridge** — Add codewalk API functions to core-bridge.ts
10. **Skills** — Create `codewalk-populate` and `codewalk-enrich` skills
11. **Sample data** — Create the Outlook DragEnter/HFDrop code walk JSON

## 4. Changes Made

### packages/core/src/codewalk/types.ts (NEW)
All cell data structures: CodeWalk, WalkCell, WalkMeta, WalkContributor, CellType, CellStatus, CodeSlice, LineHighlight, CellState, CellScope, CellVariable, CellCallStackFrame, DataSource, CodeLocation, CellCorrection, CodeWalkFileData.

### packages/core/src/codewalk/file-reader.ts (NEW)
CodeWalkFileReader class that reads `.codewalk.json` files from `.vscode/code-graph/codewalks/`. Methods: listCodeWalks(), getCodeWalk(id), getCodeWalkForScenario(scenarioId), getCell(walkId, index), saveCodeWalk(walk).

### packages/core/src/codewalk/index.ts (NEW)
Barrel export for the codewalk module.

### packages/core/src/index.ts (MODIFIED)
Added exports for all codewalk types and CodeWalkFileReader.

### packages/core/src/api.ts (MODIFIED)
- Added CodeWalkFileReader import and field
- Added listCodeWalks(), getCodeWalk(id), getCodeWalkForScenario(scenarioId) methods to CodeGraphClient

### codegraph-navigator/src/providers/codewalk-cells-view.ts (NEW)
Webview provider that renders code walk cells with:
- Cell-wise navigation (▲/▼ buttons, cell list)
- Code slice with per-line highlighting by type (executed, branched, assigned, called, returned, skipped)
- AI narrative/explanation section
- Variable state with scopes, change flags, action icons (🆕 created, ✏️ modified, 👁 read)
- Call stack display (most recent first, current frame highlighted)
- Mini cell list for quick navigation with indent by stack depth

### codegraph-navigator/src/codewalk-decorations.ts (NEW)
Editor decoration module with 7 decoration types for different line highlight types. Opens the cell's file, applies:
1. Overall cell range highlight (subtle background)
2. Per-line highlights from cell.code.highlights (distinct colors per type)
3. Other cells in the same file (subtle markers)

### codegraph-navigator/src/extension.ts (MODIFIED)
- Imported CodeWalkCellsViewProvider and openCellInEditor
- Registered codeWalkCellsViewProvider
- Added commands: codegraph.openCodeWalk, codegraph.openCodeWalkById, codegraph.nextCell, codegraph.prevCell
- Wired onCellChanged event to sync editor highlighting

### codegraph-navigator/src/core-bridge.ts (MODIFIED)
- Added CodeWalk type import/export
- Added listCodeWalks(), getCodeWalk(), getCodeWalkForScenario() bridge functions

### codegraph-navigator/package.json (MODIFIED)
- Version bumped 0.4.0 → 0.5.0
- Added new activity bar container "codegraph-codewalk" (Code Walk sidebar)
- Added view "codegraph.codeWalkCells" (webview type)
- Added 4 commands: openCodeWalk, openCodeWalkById, nextCell, prevCell
- Added context menu item "Open Code Walk" on scenario right-click
- Added ▲/▼ navigation buttons on Code Walk Cells view title bar

### .vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json (NEW)
8-cell code walk tracing the Outlook DragEnter → HFDrop flow through:
- Cell 0: Entry — WebContentsViewAura::OnDragEntered
- Cell 1: Call — PrepareDropData (OLE → DropData with CF_FILEDESCRIPTOR + virtual files)
- Cell 2: Return — Back in OnDragEntered, stores DropData, sends IPC
- Cell 3: Call — RenderViewHostImpl::DragTargetDragEnter (security filtering, virtual file tokens)
- Cell 4: Call — DragController::DragEnteredOrUpdated (creates DataTransfer, adds virtual file entries)
- Cell 5: Branch — DispatchDragEvent (JavaScript dragenter handler, preventDefault check)
- Cell 6: Return — DragOperation::kCopy, cursor feedback
- Cell 7: Note — Summary of the 3-boundary flow

### .claude/skills/codewalk-populate/skills/SKILL.md (NEW)
Installable skill that documents the full WalkCell data structure with all interfaces, type references, a procedure for creating cells, and an example cell.

### .claude/skills/codewalk-enrich/skills/SKILL.md (NEW)
Installable skill for enriching skeleton/partial cells with narrative, variables, call stacks, and highlights.

## 5. Commands Run

| Command | Result |
|---------|--------|
| `cd packages/core && npx tsc --noEmit` | ✅ Clean (0 errors) |
| `cd packages/core && npm run build` | ✅ Clean build |
| `cd codegraph-navigator && npx tsc --noEmit` | ✅ Clean (0 errors after core build) |
| `npm run build` (root) | ✅ All packages built |
| `cd packages/core && npx vitest run` | ✅ 134 tests passed |
| JSON validation of codewalk file | ✅ Valid, 8 cells |
| CodeWalkFileReader test | ✅ Lists 1 walk, finds by ID and scenario ID |

## 6. Result

Successfully implemented the Code Walk in Cells feature (Idea 4 from the design doc):

- **New sidebar**: "Code Walk" activity bar with a "Code Walk Cells" webview panel
- **Right-click on scenario**: "Open Code Walk" context menu item loads the associated codewalk
- **Cell-wise navigation**: ▲/▼ buttons move between cells only (no line-by-line stepping)
- **Line highlighting**: Each cell's `highlights` array drives distinct editor decorations (executed=blue, branched=orange, assigned=brown, called=light blue, returned=gray, skipped=red)
- **AI explanation**: Narrative section rendered in blockquote style
- **Variables**: Grouped by scope, with change flags (🆕/✏️/👁), types, values, and rationale
- **Call stack**: Shown with current frame highlighted, depth indicators
- **Skills**: Two installable skills (codewalk-populate and codewalk-enrich) with complete data structure documentation
- **Sample data**: Full 8-cell code walk for the Outlook DragEnter/HFDrop scenario

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/codewalk/types.ts` | Created | All cell data structures (CodeWalk, WalkCell, CellState, etc.) |
| `packages/core/src/codewalk/file-reader.ts` | Created | Disk-based reader for `.codewalk.json` files |
| `packages/core/src/codewalk/index.ts` | Created | Barrel export for codewalk module |
| `packages/core/src/index.ts` | Modified | Added codewalk type exports |
| `packages/core/src/api.ts` | Modified | Added codewalk methods to CodeGraphClient |
| `codegraph-navigator/src/providers/codewalk-cells-view.ts` | Created | Webview provider for cell rendering |
| `codegraph-navigator/src/codewalk-decorations.ts` | Created | Editor decorations for cell line highlighting |
| `codegraph-navigator/src/extension.ts` | Modified | Registered codewalk provider, commands, events |
| `codegraph-navigator/src/core-bridge.ts` | Modified | Added codewalk bridge functions |
| `codegraph-navigator/package.json` | Modified | Added sidebar, views, commands, menus |
| `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` | Created | 8-cell Outlook DragEnter/HFDrop code walk |
| `.claude/skills/codewalk-populate/skills/SKILL.md` | Created | Skill for creating code walks with full data structure docs |
| `.claude/skills/codewalk-enrich/skills/SKILL.md` | Created | Skill for enriching skeleton/partial cells |
