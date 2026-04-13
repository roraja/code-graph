# 12 - Standalone CodeWalk HTML Viewer

**Date**: 2026-04-11 00:00 UTC
**Prompt**: "For this tool, for codewalk, is there an html based viewer which can walk through the code, highlight lines and code sections along the way" → "Yes" (build it) → "What if codewalk format is v2, in folders with multi json, would it support that" (add v2 support)

## 1. Code Reading & Analysis
- Read `codegraph-navigator/src/providers/codewalk-cells-view.ts` — VS Code webview panel that renders cells with HTML/CSS, line highlights, variables, call stack, cell navigation. Used as design reference for the standalone viewer.
- Read `codegraph-navigator/src/codewalk-decorations.ts` — editor decoration types for line highlighting (executed, branched, assigned, called, returned, skipped). Used color scheme as reference.
- Read `skills/codegraph-codewalk-video/codewalk_video.py` — Python video generator that renders cells as 1920x1080 HTML pages with VS Code Dark+ theme, syntax coloring, side panel. Used CSS/layout as design reference.
- Read `packages/web/src/components/Walkthrough.tsx` — React web SPA walkthrough component for scenario steps (older format, not codewalk cells). Noted design patterns: tabbed side panel, code highlighting, keyboard navigation.
- Read `packages/core/src/codewalk/types.ts` — Full TypeScript type definitions for CodeWalk, WalkCell, CodeSlice, LineHighlight, CellState, CellScope, CellVariable, CellCallStackFrame, DataSource, CellCorrection, CodeWalkFileData (v1), CodeWalkManifest (v2), CodeWalkCellFileData.
- Read `packages/core/src/codewalk/file-reader.ts` — CodeWalkFileReader class that handles both v1 and v2 formats. Used as reference for v2 assembly logic: reads manifest → iterates cellIds → loads each cell file → sorts by index → picks up extra cell files not in manifest.
- Read `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` — Real-world v1 example with 9 cells, rich highlights, variables with rationale, call stacks, narrative with markdown formatting. Used as test data reference.
- Searched `packages/web/src/` and `packages/server/src/` for existing codewalk viewer — confirmed none exists for the cell-based format.

## 2. Issues Identified
- No standalone HTML viewer existed for `.codewalk.json` files
- The VS Code extension viewer requires VS Code; the web SPA uses the older scenario-step format; the video generator only produces static screenshots
- Users who receive a `.codewalk.json` file have no way to interactively browse it without installing the VS Code extension
- **V2 format gap**: Initial viewer only supported v1 single-file format. V2 multi-file format (folder with `manifest.codewalk.json` + individual `cell-*.json` files) requires folder upload support in the browser.

## 3. Plan
### Phase 1: Build v1 viewer
- Build a single self-contained HTML file with inline CSS and JS (zero dependencies, zero build step)
- Support drag & drop and file picker to load `.codewalk.json` files
- VS Code Dark+ inspired theme matching existing viewers
- Three-panel layout: cell nav sidebar, code panel with line highlights, tabbed right panel (narrative/variables/call stack)
- Keyboard navigation

### Phase 2: Add v2 multi-file support
- Add "Open v2 Folder" button with `<input webkitdirectory>` attribute
- Handle folder drag & drop using `DataTransferItem.webkitGetAsEntry()` + recursive directory traversal
- Detect v2 manifest (`_format: 'codegraph-codewalk-v2'`), read cell files in cellIds order
- Pick up extra cell files not in manifest (matching `file-reader.ts` behavior)
- Sort assembled cells by index
- Graceful fallback: if folder contains v1 file instead, load that

## 4. Changes Made

### New file: `tools/codewalk-viewer.html` (Phase 1 + Phase 2)
- Single self-contained HTML file (~1790 lines)
- **CSS** (~500 lines): VS Code Dark+ theme with custom properties, three-panel responsive layout, highlight type colors, scrollbar styling, keyboard shortcuts overlay
- **HTML**: Drop zone (with both v1 file and v2 folder buttons), main viewer with topbar/sidebar/code/right-panel/statusbar, shortcuts overlay
- **JavaScript** (~550 lines):
  - **v1 loading**: File reading (drag & drop + file picker), JSON parsing, format detection
  - **v2 loading**: `handleFolderFiles()` — finds manifest, reads cellIds, loads each cell file, picks up extras, sorts by index, assembles full CodeWalk. `handleDrop()` — detects folder drops via `webkitGetAsEntry()`. `traverseDirectory()` — recursively reads directory entries. `readFileAsText()` — Promise wrapper for FileReader.
  - **Rendering**: Cell navigation, code rendering with syntax colorization, three tabbed panels
  - **Navigation**: Keyboard shortcuts, cell sidebar, call stack frame clicking

Key v2 assembly logic (matches `file-reader.ts`):
1. Find `manifest.codewalk.json` in the file list
2. Parse manifest, extract `cellIds` array
3. Load each cell file by `${cellId}.json` filename
4. Pick up any extra `.json` files not listed in `cellIds`
5. Sort all cells by `index`
6. Assemble into a full `CodeWalk` object and hand to `loadWalkData()`

## 5. Commands Run
- `Glob **/*codewalk*` — found existing codewalk files
- `Glob **/*viewer*` — checked for existing viewers
- `Grep codewalk.*viewer` — found only VS Code webview
- `Grep codewalk` in `packages/web/src/` — found Walkthrough.tsx (older format)
- `Grep codewalk` in `packages/server/src/` — none found
- `Glob tools/*` — confirmed directory was empty before
- `wc -l tools/codewalk-viewer.html` — verified 1790 lines
- `grep` for v2-related identifiers — verified all references wired correctly

## 6. Result
Created a fully functional standalone HTML CodeWalk viewer at `tools/codewalk-viewer.html` supporting both v1 and v2 formats. Features:
- Zero dependencies, opens directly in any browser
- **v1**: Drag & drop or file picker for single `.codewalk.json` files
- **v2**: "Open v2 Folder" button or folder drag & drop for multi-file codewalk directories
- VS Code Dark+-themed three-panel layout
- Line-level highlights with 6 color-coded types + inline annotations
- C++ syntax colorization
- Cell navigation sidebar with depth indentation
- Tabbed right panel: Narrative (markdown), Variables (scoped, with change tracking), Call Stack (clickable frames)
- Full keyboard navigation with help overlay
- Responsive layout for smaller screens
- Graceful error handling with helpful messages for format issues

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `tools/codewalk-viewer.html` | Created | Standalone HTML CodeWalk viewer with v1 + v2 support |
| `docs/copilot-executions/12-standalone-codewalk-html-viewer.md` | Created | This execution log |
| `docs/features/03-standalone-codewalk-viewer.md` | Created | Feature documentation |
