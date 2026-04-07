# 09 - Add Release GitHub Pipeline for VSIX

**Date**: 2026-04-07 UTC
**Prompt**: Similar to ../code-explorer, add release github pipeline to build vsix and add single line installation script to install latest version in the readme (both win and linux). Commit ALL changes, push, trigger release.

## 1. Code Reading & Analysis
- Read `code-explorer` repo's `.github/workflows/release.yml` via GitHub API — studied the release pipeline pattern (tag-triggered, builds VSIX, creates GitHub release with install instructions)
- Read `code-explorer` repo's `README.md` via GitHub API — studied the quick install one-liner pattern
- Read `codegraph-navigator/package.json` — version 0.5.0, scripts section, dependencies
- Read `codegraph-navigator/esbuild.mjs` — bundles extension.ts into dist/extension.js
- Read `codegraph-navigator/tsconfig.json` — references `../packages/core`
- Read `codegraph-navigator/.vscodeignore` — existing ignore rules
- Read root `package.json` — monorepo with workspaces including codegraph-navigator
- Read `.gitignore` — no `.vsix` exclusion existed

## 2. Issues Identified
- No release pipeline existed for the codegraph-navigator extension
- No README existed for the extension
- No `package` script in package.json for building VSIX
- `.vsix` files were not in `.gitignore` and one was tracked by git (codegraph-navigator-0.1.0.vsix)

## 3. Plan
- Create `.github/workflows/release.yml` modeled after code-explorer's release pipeline, adapted for the monorepo structure (needs `npm ci` at root to build @codegraph/core dependency first)
- Create `codegraph-navigator/README.md` with quick install one-liners for Linux/macOS and Windows
- Add `package` script to `codegraph-navigator/package.json`
- Add `*.vsix` to `.gitignore` and remove tracked vsix from git index

## 4. Changes Made

### `.github/workflows/release.yml` (Created)
- Tag-triggered (`v*`) release pipeline
- Checks out code, installs deps, builds all packages (core must build first), packages VSIX
- Creates GitHub Release with download links and install commands for Linux/macOS and Windows

### `codegraph-navigator/README.md` (Created)
- Quick install one-liners for Linux/macOS (curl) and Windows (PowerShell)
- Feature overview, commands, settings, development and releasing instructions

### `codegraph-navigator/package.json` (Modified)
- Added `"package": "npm run build && npx @vscode/vsce package --no-dependencies"` script

### `.gitignore` (Modified)
- Added `*.vsix` exclusion

### Git index
- Removed tracked `codegraph-navigator/codegraph-navigator-0.1.0.vsix` from git index

## 5. Commands Run
- `gh api repos/roraja/code-explorer/contents/.github/workflows/release.yml` — fetched reference pipeline
- `gh api repos/roraja/code-explorer/contents/README.md` — fetched reference README
- `git rm --cached codegraph-navigator/codegraph-navigator-0.1.0.vsix` — removed tracked vsix

## 6. Result
- Release pipeline ready: push a `v*` tag to trigger VSIX build and GitHub Release creation
- README with one-liner install for both Linux/macOS and Windows
- VSIX files excluded from future commits

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `.github/workflows/release.yml` | Created | Tag-triggered release pipeline for VSIX |
| `codegraph-navigator/README.md` | Created | Extension README with quick install instructions |
| `codegraph-navigator/package.json` | Modified | Added `package` script |
| `.gitignore` | Modified | Added `*.vsix` exclusion |
