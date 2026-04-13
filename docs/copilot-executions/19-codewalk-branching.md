# 19 - Codewalk Branching Support (Tree Structure)

**Date**: 2026-04-13 13:30 UTC
**Prompt**: Add branching/tree structure to codewalks. Each cell can point to one or more next cells. When there are multiple next cells (branch point), the VS Code UI asks the user to select which path to explore. Implement this for the resize-image-walk to demonstrate branching.

## 1. Code Reading & Analysis

### Files Read:
- `.vscode/code-graph/codewalks/resize-image-walk/manifest.codewalk.json` — V2 manifest with 6 cells
- `.vscode/code-graph/codewalks/resize-image-walk/cell-0.json` through `cell-5.json` — All existing cells
- `packages/core/src/codewalk/types.ts` — Core type definitions (CodeWalk, WalkCell, CellStep, etc.)
- `packages/core/src/codewalk/file-reader.ts` — File reader for v1/v2 formats
- `packages/core/src/codewalk/index.ts` — Barrel exports for codewalk module
- `packages/core/src/index.ts` — Main barrel exports
- `codegraph-navigator/src/providers/codewalk-cells-view.ts` — Webview provider (534 lines)
- `codegraph-navigator/src/providers/step-walker.ts` — Step walker tree provider
- `codegraph-navigator/src/codewalk-decorations.ts` — Editor decorations for code walk
- `test/fixtures/sample-project/src/processors.ts` — Source code being walked
- `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` — Another codewalk for reference

### Key Findings:
- The existing schema was purely linear: `WalkCell` had `parentCellId` for call hierarchy but no forward links
- Navigation was index-based: `nextCell()` just incremented `currentCellIndex`
- The `supports()` check in `processors.ts` (line 7) is a natural branch point with two paths

## 2. Issues Identified
- **No branching support**: The schema had no way to express "from this cell, you can go to A or B"
- **Linear navigation only**: `nextCell()` and `prevCell()` were purely index-based
- **No navigation history**: When cells were skipped or jumped to, there was no way to go back correctly
- **No branch point UI**: No way to show the user a choice of paths

## 3. Plan

### Schema Design (types.ts)
Add two new optional fields to `WalkCell`:
- `nextCellIds?: string[]` — IDs of cells that can follow this one. Empty = end cell, single = linear, multiple = branch point
- `branchOptions?: BranchOption[]` — Human-readable descriptions of each branch option

Add a new interface:
- `BranchOption` — with `label`, `description`, `condition?`, `pathHint?` for rich branch selection UI

### Navigation Design (codewalk-cells-view.ts)
- Add `navigationHistory: number[]` — a stack tracking the user's path through the walk
- Add `cellIdToIndex: Map<string, number>` — O(1) lookup for cell navigation
- `nextCell()`: Check `nextCellIds`. If multiple, prompt user. If single, follow it. If none, use linear fallback.
- `prevCell()`: Pop from `navigationHistory` instead of decrementing index
- New `selectBranch(branchIndex)` method for choosing a path
- New `'selectBranch'` message type from webview

### UI Design
- Branch options rendered as cards with icon, label, description, and condition
- Breadcrumb trail showing the path taken
- "BRANCH POINT" badge on branch cells
- Star icon on branch cells in the cell list
- Visited cells highlighted in the cell list

### Demo Data (resize-image-walk)
Restructure from 6 linear cells to 8 cells with a tree:
```
cell-0 (entry) → cell-1 (call supports) → cell-2 (inside supports) → cell-3 (BRANCH)
                                                                        ├─ cell-4 (resizeImage) → cell-5 (return success) [END]
                                                                        └─ cell-6 (error block) → cell-7 (return error) [END]
```

## 4. Changes Made

### packages/core/src/codewalk/types.ts
- Added `nextCellIds?: string[]` to `WalkCell` interface (lines ~97-107) — array of possible next cell IDs
- Added `branchOptions?: BranchOption[]` to `WalkCell` interface (lines ~109-115) — descriptions for each branch
- Added new `BranchOption` interface with `label`, `description`, `condition?`, `pathHint?` fields

### packages/core/src/codewalk/index.ts
- Added `CellStep` and `BranchOption` to barrel exports

### packages/core/src/index.ts
- Added `BranchOption` to the codewalk type exports

### codegraph-navigator/src/providers/codewalk-cells-view.ts (complete rewrite)
Major changes:
- Added `navigationHistory: number[]` for tracking user's path through branches
- Added `cellIdToIndex: Map<string, number>` for O(1) cell lookup
- Rewrote `nextCell()` to check `nextCellIds` and handle branching
- Rewrote `prevCell()` to use navigation history stack
- Added `selectBranch(branchIndex)` method
- Added `navigateForward(targetIndex)` helper
- Added `rebuildCellIdMap()` helper
- Added `renderBranchOptions(cell)` — renders branch selection cards
- Added `renderBreadcrumb(walk)` — shows navigation path
- Added `isEndCell(cell, walk)` — detects terminal cells
- Added `getBranchHintIcon(hint)` — icon for branch path hints
- Added `'selectBranch'` message handler
- Updated `loadWalk()` to reset history and rebuild cell map
- Updated `clear()` to reset history and cell map
- Updated `goToCell()` to push to navigation history
- Added CSS for branch options, breadcrumb, branch-point badge, visited cells, pulse animation
- Updated cell list rendering to show branch indicators (star icon) and visited state
- Updated import to include `BranchOption` type

### .vscode/code-graph/codewalks/resize-image-walk/ (all 8 files)
- `manifest.codewalk.json` — Updated to reference 8 cells, added "#branching" tag
- `cell-0.json` — Added `nextCellIds: ["cell-1"]`, updated narrative to be branch-aware
- `cell-1.json` — Added `nextCellIds: ["cell-2"]`
- `cell-2.json` — Added `nextCellIds: ["cell-3"]`, made narrative generic for both paths
- `cell-3.json` — **THE BRANCH POINT**: `nextCellIds: ["cell-4", "cell-6"]` with `branchOptions` for "Supported type (JPEG)" and "Unsupported type (BMP)"
- `cell-4.json` — Added `nextCellIds: ["cell-5"]`, narrative explains this is the supported-type path
- `cell-5.json` — Added `nextCellIds: []` (terminal), narrative tells user to go back to try other branch
- `cell-6.json` — **NEW**: Unsupported type path, shows error block with BMP file, `nextCellIds: ["cell-7"]`
- `cell-7.json` — **NEW**: Return error result, `nextCellIds: []` (terminal)

## 5. Commands Run
- `cd packages/core && npx tsc --noEmit` — Clean, no errors
- `npm run build` (from root) — All 5 packages build successfully (core, cli, server, web, extension)
- `cd packages/core && npx vitest run` — 134 tests pass (3 test files)
- `node /tmp/test-codewalk.cjs` — Verified codewalk file reader loads all 8 cells correctly with branching metadata

## 6. Result

### What was achieved:
1. **Schema extension**: `WalkCell` now supports tree-structured navigation via `nextCellIds` and `branchOptions`
2. **VS Code UI**: When a cell has multiple next cells, the viewer shows interactive branch selection cards with labels, descriptions, conditions, and path hints (taken/skipped/error/default)
3. **Navigation history**: A stack-based navigation system ensures "Prev" always retraces the exact path, regardless of which branches were taken
4. **Breadcrumb trail**: Shows the user's current path through the walk
5. **Visual indicators**: Branch point cells get a purple "BRANCH POINT" badge, star icon in cell list, and visited cells get a green border
6. **Demo walk**: The resize-image-walk now has a branch at the `supports()` check, allowing users to explore both the "supported JPEG" path (resize + success) and the "unsupported BMP" path (error return)

### Backward compatibility:
- All fields are optional — existing codewalks without `nextCellIds` continue to work with linear navigation
- The file reader didn't need changes — it already reads cell properties as-is
- Existing tests all pass

### Remaining / follow-up:
- The codewalk generator skills (codegraph-codewalk-populate, etc.) should be updated to support generating branching walks
- Could add a visual tree/graph visualization in the cell list showing the branch structure
- Could add keyboard shortcuts for branch selection (1, 2, 3 keys)

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| packages/core/src/codewalk/types.ts | Modified | Added `nextCellIds`, `branchOptions` to WalkCell, added `BranchOption` interface |
| packages/core/src/codewalk/index.ts | Modified | Added `CellStep`, `BranchOption` to barrel exports |
| packages/core/src/index.ts | Modified | Added `BranchOption` to codewalk type exports |
| codegraph-navigator/src/providers/codewalk-cells-view.ts | Modified | Complete rewrite with branching navigation, history stack, branch UI |
| .vscode/code-graph/codewalks/resize-image-walk/manifest.codewalk.json | Modified | Updated for 8 cells with branching |
| .vscode/code-graph/codewalks/resize-image-walk/cell-0.json | Modified | Added nextCellIds |
| .vscode/code-graph/codewalks/resize-image-walk/cell-1.json | Modified | Added nextCellIds |
| .vscode/code-graph/codewalks/resize-image-walk/cell-2.json | Modified | Added nextCellIds, generic narrative |
| .vscode/code-graph/codewalks/resize-image-walk/cell-3.json | Modified | **Branch point** with 2 nextCellIds and branchOptions |
| .vscode/code-graph/codewalks/resize-image-walk/cell-4.json | Modified | Added nextCellIds |
| .vscode/code-graph/codewalks/resize-image-walk/cell-5.json | Modified | Terminal cell (nextCellIds: []) |
| .vscode/code-graph/codewalks/resize-image-walk/cell-6.json | Created | New: unsupported type path (error block) |
| .vscode/code-graph/codewalks/resize-image-walk/cell-7.json | Created | New: error return result (terminal) |
| docs/copilot-executions/19-codewalk-branching.md | Created | This execution log |
