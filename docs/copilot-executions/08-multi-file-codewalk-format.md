# 08 - Multi-File Code Walk Format (V2)

**Date**: 2026-04-06 18:00 UTC
**Prompt**: "Currently, the code walk json is a single large file, which makes it slow and error prone for AI agents to generate the file. Can we just do one change - instead of a single large file, have multiple json files, one for each cell, defined in the codewalk scenario folder. Modify the skills/ (the one which are installed) to use this new struct and the extension also. Keep backward compatible. Allow both, single large file and multiple json files for each cell."

## 1. Code Reading & Analysis

- `packages/core/src/codewalk/types.ts` — The full type definitions for CodeWalk, WalkCell, CodeWalkFileData (v1 format). Lines 1-245.
- `packages/core/src/codewalk/file-reader.ts` — The CodeWalkFileReader class that reads/writes `.codewalk.json` files. Only supported v1 single-file format. Lines 1-172.
- `packages/core/src/codewalk/index.ts` — Barrel exports for the codewalk module.
- `packages/core/src/index.ts` — Main barrel exports for @codegraph/core.
- `packages/core/src/api.ts` — CodeGraphClient that uses CodeWalkFileReader (lines ~420-725).
- `codegraph-navigator/src/core-bridge.ts` — VS Code extension bridge that calls listCodeWalks/getCodeWalk/getCodeWalkForScenario on the client.
- `codegraph-navigator/src/extension.ts` — Extension registration including openCodeWalk commands (lines ~626-793).
- `codegraph-navigator/src/codewalk-decorations.ts` — Editor decorations for code walk cells (no changes needed).
- `codegraph-navigator/src/providers/codewalk-cells-view.ts` — Webview for displaying cells (no changes needed).
- `skills/codegraph-codewalk-populate/SKILL.md` — Skill instructions for AI agents creating code walks.
- `skills/codegraph-codewalk-enrich/SKILL.md` — Skill instructions for enriching existing code walks.
- `.claude/skills/codewalk-populate/skills/SKILL.md` — Installed copy of the populate skill.
- `.claude/skills/codewalk-enrich/skills/SKILL.md` — Installed copy of the enrich skill.
- `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` — Existing v1 walk (526 lines, 9 cells).

## 2. Issues Identified

- **Single-file bottleneck**: The v1 format requires AI agents to produce the entire walk as one giant JSON file. For walks with 9+ cells, this is a ~500-line JSON that must be assembled atomically. AI agents often make JSON syntax errors in large files, and the entire walk must be regenerated on any error.
- **No incremental writes**: Agents can't write cell-by-cell — they must construct the full array and write everything at once.
- **No file-reader support for directories**: The `getCodeWalkFiles()` method only looked for `*.codewalk.json` files, ignoring subdirectories entirely.

## 3. Plan

**Approach**: Add a v2 multi-file format alongside the existing v1, with full backward compatibility:

1. **types.ts** — Add `CodeWalkManifest` (v2 format) and `CodeWalkCellFileData` (individual cell files) interfaces. Keep `CodeWalkFileData` (v1) unchanged.
2. **file-reader.ts** — Rewrite to discover both v1 files and v2 directories. Both resolve to the same `CodeWalk` in-memory type. Add `saveCodeWalkMultiFile()` and `saveCellFile()` methods.
3. **Barrel exports** — Re-export new types from index files.
4. **Skills** — Update all 4 skill files (2 source, 2 installed) to document both formats with v2 as preferred for new walks.
5. **Extension** — NO changes needed. The extension only uses the `CodeWalk` type from `CodeWalkFileReader` methods, which returns the same type regardless of storage format.

**Alternatives rejected**:
- Migration script (v1 → v2): Not needed since both are supported.
- Making v2 the only format: Breaks backward compat.

## 4. Changes Made

### `packages/core/src/codewalk/types.ts`
- Added `CodeWalkManifest` interface (v2 manifest format: `_format: 'codegraph-codewalk-v2'`, walk metadata without cells, `cellIds` array)
- Added `CodeWalkCellFileData` interface (individual cell file: `_format: 'codegraph-cell-v1'`, `walkId`, `cell`)
- Kept `CodeWalkFileData` (v1) completely unchanged

### `packages/core/src/codewalk/file-reader.ts`
- Complete rewrite of the file reader to support both formats:
  - **`discoverWalkSources()`** — Scans the codewalks directory for both v1 `.codewalk.json` files AND v2 directories (containing `manifest.codewalk.json`)
  - **`loadFromSource()`** — Dispatches to `loadV1()` or `loadV2()` based on source type
  - **`loadV1()`** — Same logic as before (read single JSON file)
  - **`loadV2()`** — Reads manifest, then loads each cell file by ID in order. Also auto-discovers extra cell files not in the manifest (for robustness when agents add cells incrementally)
  - **`saveCodeWalkMultiFile()`** — New method to write a walk as directory + manifest + individual cell files
  - **`saveCellFile()`** — New method to write a single cell file (for incremental enrichment)
- All existing public methods (`listCodeWalks`, `getCodeWalk`, `getCodeWalkForScenario`, `getCell`, `saveCodeWalk`) remain backward-compatible with the same signatures

### `packages/core/src/codewalk/index.ts`
- Added re-exports for `CodeWalkManifest` and `CodeWalkCellFileData`

### `packages/core/src/index.ts`
- Added re-exports for `CodeWalkManifest` and `CodeWalkCellFileData`

### `skills/codegraph-codewalk-populate/SKILL.md`
- Replaced "Output File" section with "Output File — Two Formats" documenting both v1 and v2
- v2 marked as PREFERRED with full manifest and cell file structure examples
- Updated "Step 5: Save" to show both v1 and v2 save procedures

### `.claude/skills/codewalk-populate/skills/SKILL.md`
- Same updates as above (installed copy)

### `skills/codegraph-codewalk-enrich/SKILL.md`
- Updated "When to Use" to mention both formats
- Updated "Step 1: Read" to explain how to find v1 vs v2 walks
- Updated "Step 7: Save" to explain per-cell saves for v2

### `.claude/skills/codewalk-enrich/skills/SKILL.md`
- Same updates as above (installed copy)

## 5. Commands Run

| Command | Result |
|---------|--------|
| `cd packages/core && npx tsc --noEmit` | Pass (no errors) |
| `cd packages/core && npx vitest run` | 134 tests passed (3 files) |
| `npm run build` (core) | Success |
| `cd codegraph-navigator && npx tsc --noEmit` | Pass (no errors) |

## 6. Result

Successfully added v2 multi-file code walk format with full backward compatibility:

- **V1 still works**: Existing `.codewalk.json` files load without changes
- **V2 supported**: New walks can be stored as directories with individual cell files
- **Transparent to consumers**: `CodeWalkFileReader` returns the same `CodeWalk` type regardless of format
- **Extension unchanged**: The VS Code extension works with both formats automatically
- **Skills updated**: AI agents now know about both formats and prefer v2 for new walks
- **Incremental writes**: Agents can write cells one at a time in v2 format

### V2 directory layout:
```
.vscode/code-graph/codewalks/<walk-id>/
  manifest.codewalk.json   ← walk metadata + ordered cellIds
  cell-0.json              ← individual cell
  cell-1.json              ← individual cell
  ...
```

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/codewalk/types.ts` | Modified | Added CodeWalkManifest and CodeWalkCellFileData types |
| `packages/core/src/codewalk/file-reader.ts` | Rewritten | Support both v1 and v2 formats, added saveCodeWalkMultiFile() and saveCellFile() |
| `packages/core/src/codewalk/index.ts` | Modified | Added re-exports for new types |
| `packages/core/src/index.ts` | Modified | Added re-exports for new types |
| `skills/codegraph-codewalk-populate/SKILL.md` | Modified | Documented v1+v2 formats, v2 preferred |
| `skills/codegraph-codewalk-enrich/SKILL.md` | Modified | Updated for both formats |
| `.claude/skills/codewalk-populate/skills/SKILL.md` | Modified | Installed copy, same as above |
| `.claude/skills/codewalk-enrich/skills/SKILL.md` | Modified | Installed copy, same as above |
| `docs/copilot-executions/08-multi-file-codewalk-format.md` | Created | This execution log |
