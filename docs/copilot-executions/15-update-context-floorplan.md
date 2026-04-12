# 15 - Update Context Floorplan

**Date**: 2026-04-12 14:30 UTC
**Prompt**: "update-context-floorplan" — Refresh `.context/FLOORPLAN.md` and `.context/domains/*.md` to reflect the latest repo structure.

## 1. Code Reading & Analysis
- Read `.context/FLOORPLAN.md` — the top-level routing file
- Read all 6 domain files: `core.md`, `cli.md`, `server.md`, `web.md`, `testing.md`, `vscode-extension.md`
- Listed all top-level directories: found `skills/`, `tools/`, `logs/`, `scenarios/`, `scripts/` not documented in floorplan
- Listed `skills/*/SKILL.md` frontmatter — 9 skills found (including `codegraph-codewalk-video`)
- Listed `packages/core/src/` — found new `codewalk/` directory not in core.md
- Listed `packages/server/src/rest/` — found new `codewalk-viewer.ts` not in server.md
- Checked VS Code extension version — 0.6.0 (was 0.4.0 in docs)
- Listed `test/fixtures/` — found `sample-cpp-project/` not in testing.md
- Listed `docs/` subdirs — found `learn/`, `next/` subdirs
- Checked `foreman.yaml` — root-level config for markdown viewer

## 2. Issues Identified
1. **FLOORPLAN.md** missing top-level structure tree, skills inventory, tools listing, and codewalk routing entry
2. **domains/core.md** missing `codewalk/` layer in architecture diagram and key files table
3. **domains/server.md** missing `codewalk-viewer.ts` file and `/codewalk` route in architecture diagram
4. **domains/vscode-extension.md** version 0.4.0 is stale (now 0.6.0)
5. **domains/testing.md** missing `sample-cpp-project/` fixture

## 3. Plan
- Surgical edits only — update factual/structural parts, preserve existing prose
- Add new sections to FLOORPLAN.md for skills, tools, and top-level structure
- Add codewalk layer to core.md architecture + key files
- Add codewalk-viewer to server.md architecture + key files
- Bump version in vscode-extension.md
- Add C++ fixture to testing.md

## 4. Changes Made

### `.context/FLOORPLAN.md`
- Updated intro paragraph to mention skills/, tools/, scripts/
- Added codewalk routing entry to Domain Routing Table
- Added "Top-Level Structure" section with full directory tree
- Added "Skills" section with 9-row inventory table
- Added "Standalone Tools" section listing tools/ and scripts/ files

### `.context/domains/core.md`
- Added `codewalk/` layer to architecture diagram (between scenario/ and correction/)
- Added 3 key file entries: `codewalk/types.ts`, `codewalk/file-reader.ts`, `codewalk/index.ts`

### `.context/domains/server.md`
- Added `src/rest/codewalk-viewer.ts` to key files table
- Added `Codewalk viewer (/codewalk)` line to architecture diagram

### `.context/domains/vscode-extension.md`
- Updated version from 0.4.0 to 0.6.0 in package.json reference and install command

### `.context/domains/testing.md`
- Added `test/fixtures/sample-cpp-project/` to fixtures list

## 5. Commands Run
- `ls` commands to scan directory structure — all succeeded
- `head` to read SKILL.md frontmatter for all 9 skills
- `grep` to verify all edits landed correctly in updated files

## 6. Result
All 5 context files updated with surgical edits. No sections were rewritten unnecessarily.
Existing prose, guardrails, patterns, and navigation instructions preserved intact.

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `.context/FLOORPLAN.md` | Modified | Added codewalk routing, top-level structure tree, skills inventory, tools listing |
| `.context/domains/core.md` | Modified | Added codewalk/ layer to architecture + 3 key file entries |
| `.context/domains/server.md` | Modified | Added codewalk-viewer.ts file + /codewalk route in architecture |
| `.context/domains/vscode-extension.md` | Modified | Version 0.4.0 → 0.6.0 |
| `.context/domains/testing.md` | Modified | Added sample-cpp-project fixture |
