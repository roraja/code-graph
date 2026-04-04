# 03 - Sidebar Version Display

**Date**: 2026-04-04 13:50 UTC
**Prompt**: "The sidebar title should show the version of extension (0.4.0 or the one) installed"

## 1. Code Reading & Analysis
- `codegraph-navigator/package.json` — View container title defined as `"CodeGraph"` at line 27; version is `"0.4.0"` at line 5
- `codegraph-navigator/src/extension.ts` — `activate()` function at line 28; hardcoded `extensionVersion: '0.4.0'` at line 38; tree providers registered via `registerTreeDataProvider` at lines 57–61

## 2. Issues Identified
- **Sidebar title missing version**: The view container title in `package.json` was just `"CodeGraph"` with no version indicator
- **Hardcoded version in extension.ts**: Line 38 hardcoded `'0.4.0'` instead of reading from `context.extension.packageJSON.version`

## 3. Plan
- Update the static view container title in `package.json` to include `v0.4.0` (VS Code doesn't support dynamic container titles)
- Switch the Scenarios view from `registerTreeDataProvider` to `createTreeView` to set a dynamic `description` showing the version
- Replace hardcoded version string in `extension.ts` with `context.extension.packageJSON.version`

## 4. Changes Made

### `codegraph-navigator/package.json` (line 27)
- Before: `"title": "CodeGraph"`
- After: `"title": "CodeGraph v0.4.0"`

### `codegraph-navigator/src/extension.ts` (line 38)
- Before: `extensionVersion: '0.4.0'`
- After: `extensionVersion: context.extension.packageJSON.version`

### `codegraph-navigator/src/extension.ts` (lines 56–61)
- Before: All three providers registered via `registerTreeDataProvider`
- After: Scenarios view uses `createTreeView` with `description` set to `v${version}`, other two remain as `registerTreeDataProvider`

## 5. Commands Run
- `cd codegraph-navigator && npm run compile` → exited 0, no errors

## 6. Result
- The sidebar container title now shows "CODEGRAPH V0.4.0" at the top
- The Scenarios section header also dynamically shows the version via `TreeView.description`
- The hardcoded version in extension.ts now reads from package.json metadata

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| codegraph-navigator/package.json | Modified | Added `v0.4.0` to view container title |
| codegraph-navigator/src/extension.ts | Modified | Dynamic version reading + TreeView description |
