# 18 - Codewalk Sub-Steps Feature

**Date**: 2026-04-12 15:20 UTC
**Prompt**: "The current codewalk viewer is a bit confusion. there is lots of info and not clear where to focus. I want the codewalk cells to have sub-steps which focuses parts within the cell one by one in a sequential manner. A cell should have a list of functionalities with each functionality highlighting the code line it is talking about. There should be another lighter highlight of the function / code block the cell is referring to. But let viewer see one functionality at a time one by one instead of showing all at once making it hard to understand. Keep it simpler. Update the skill / data structs / extension to support this. Then create a codewalk for ImageProcessor in test/fixtures/sample-project/src/processors.ts rooted on test/fixtures/sample-project/ folder"

## 1. Code Reading & Analysis
- `packages/core/src/codewalk/types.ts` — Full read of all codewalk data structures (WalkCell, CodeSlice, LineHighlight, etc.)
- `packages/core/src/index.ts` — Barrel exports for codewalk types
- `tools/codewalk-viewer.html` (1790 lines) — Full standalone HTML viewer with CSS, JS
- `codegraph-navigator/src/codewalk-decorations.ts` (300 lines) — VS Code editor decoration logic
- `codegraph-navigator/src/providers/codewalk-cells-view.ts` (860 lines) — Sidebar webview provider
- `codegraph-navigator/src/extension.ts` — Extension entry point, `openCellInEditor` call sites
- `test/fixtures/sample-project/src/processors.ts` — ImageProcessor class (32 lines)
- `test/fixtures/sample-project/src/types.ts` — FileData, ProcessResult, IFileProcessor interfaces
- `skills/codegraph-codewalk-populate/SKILL.md` — Populate skill documentation
- `skills/codegraph-codewalk-enrich/SKILL.md` — Enrich skill documentation

## 2. Issues Identified
- Codewalk cells show all highlights and narrative at once, making dense cells hard to follow
- No mechanism to focus on individual lines/concepts within a cell
- The viewer overwhelms users with highlight types, variables, and callstack simultaneously

## 3. Plan
- Add a `CellStep` interface and `steps?: CellStep[]` field to `WalkCell`
- Each step has a `description`, `focusLine`, and optional `focusEndLine`
- When `steps` is present, the viewer shows one step at a time:
  - **Strong highlight** on the focused line(s)
  - **Lighter background** on the overall cell code range
  - Step description displayed prominently
  - Progress dots and prev/next navigation
- Arrow keys navigate sub-steps before moving to next cell
- Backward compatible: cells without `steps` work exactly as before

## 4. Changes Made

### `packages/core/src/codewalk/types.ts`
- Added `steps?: CellStep[]` field to `WalkCell` interface
- Added `CellStep` interface: `{ description: string; focusLine: number; focusEndLine?: number }`

### `packages/core/src/index.ts`
- Added `CellStep` to barrel exports

### `tools/codewalk-viewer.html`
- **CSS**: Added `.hl-cell-range` (lighter bg), `.hl-focus` (strong blue), `.steps-bar`, `.step-description`, `.step-dots`, `.step-dot` styles
- **HTML**: Added steps bar between file tab and code area with prev/next buttons, counter, and progress dots
- **JS State**: Added `activeStepIndex` state variable
- **JS Navigation**: Updated `nextCell()`/`prevCell()` to navigate sub-steps before crossing cell boundaries; added `goToStep()` function
- **JS Rendering**: Updated `renderCode()` to use focus highlight in step mode; added `renderStepsBar()` function
- **JS Narrative**: Updated `renderNarrativeTab()` to show current step description prominently when in step mode
- **JS Events**: Added event listeners for step prev/next buttons

### `codegraph-navigator/src/providers/codewalk-cells-view.ts`
- Added `currentStepIndex` state, imported `CellStep` type
- Updated event emitter type to include `stepIndex` and `step`
- Updated `loadWalk()`, `goToCell()`, `clear()` to initialize step index
- Updated `nextCell()`/`prevCell()` to handle sub-steps
- Added `nextStep()`, `prevStep()`, `goToStepIndex()` methods
- Added webview message handlers for step navigation
- Updated HTML template to render steps bar with dots
- Added JavaScript handlers for step navigation buttons/dots
- Added CSS for steps bar, step dots, step buttons

### `codegraph-navigator/src/codewalk-decorations.ts`
- Added `focusedLineDecorationType` decoration (strong blue highlight)
- Updated `openCellInEditor()` to accept optional `activeStep?: CellStep` parameter
- In step mode: applies focused-line decoration and reveals the focused line

### `codegraph-navigator/src/extension.ts`
- Updated `onCellChanged` listener to pass `data.step` to `openCellInEditor()`

### `skills/codegraph-codewalk-populate/SKILL.md`
- Added `CellStep` structure documentation with example
- Added guidance to populate cells with sub-steps
- Added to Important Notes: "Add steps to dense cells"

### `skills/codegraph-codewalk-enrich/SKILL.md`
- Added note about adding sub-steps to dense cells during enrichment

### ImageProcessor Codewalk (v2 multi-file)
Created `test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/`:
- `manifest.codewalk.json` — Walk metadata with 4 cells
- `cell-0.json` — Entry: `process()` method (5 steps)
- `cell-1.json` — Call: `supports()` method (2 steps)
- `cell-2.json` — Call: `resizeImage()` method (3 steps)
- `cell-3.json` — Return: Back in `process()` with result (2 steps)

## 5. Commands Run
- `npm run build` — Initial build failed (missing closing brace in CellStep interface)
- Fixed the syntax error, rebuild: **passed**
- `npx vitest run` (core) — **134 tests passed**
- JSON validation of all 5 codewalk files — **all valid**
- JavaScript syntax check of `codewalk-viewer.html` — initially failed (extra `}`), fixed, **passed**
- Final structure verification — all 4 cells with 12 total sub-steps confirmed

## 6. Result
- Sub-steps feature fully implemented across data structures, standalone viewer, VS Code extension, and skill documentation
- ImageProcessor codewalk created with 4 cells and 12 sub-steps tracing a JPEG processing scenario
- All tests pass, build succeeds, all JSON valid
- Backward compatible: cells without `steps` render exactly as before

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| packages/core/src/codewalk/types.ts | Modified | Added `CellStep` interface and `steps` field to `WalkCell` |
| packages/core/src/index.ts | Modified | Added `CellStep` to barrel exports |
| tools/codewalk-viewer.html | Modified | Added sub-step navigation UI, focus highlighting, step-aware rendering |
| codegraph-navigator/src/providers/codewalk-cells-view.ts | Modified | Added step state, navigation, rendering, CSS |
| codegraph-navigator/src/codewalk-decorations.ts | Modified | Added focused-line decoration, step-aware highlighting |
| codegraph-navigator/src/extension.ts | Modified | Pass step to `openCellInEditor()` |
| skills/codegraph-codewalk-populate/SKILL.md | Modified | Added CellStep docs and guidance |
| skills/codegraph-codewalk-enrich/SKILL.md | Modified | Added sub-steps enrichment note |
| test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/manifest.codewalk.json | Created | Walk manifest |
| test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/cell-0.json | Created | Entry cell with 5 steps |
| test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/cell-1.json | Created | Call cell (supports) with 2 steps |
| test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/cell-2.json | Created | Call cell (resizeImage) with 3 steps |
| test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/cell-3.json | Created | Return cell with 2 steps |
