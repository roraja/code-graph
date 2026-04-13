# 13 - CodeWalk Server Integration

**Date**: 2026-04-11 00:00 UTC
**Prompt**: "If I run code-graph cli serve command in a project folder, it should serve a web app on a port where I can explore all codewalks"

## 1. Code Reading & Analysis
- Read `packages/cli/src/commands/serve.ts` — CLI serve command, dynamically imports `@codegraph/server` and starts it. Shows host/port/GraphQL/REST URLs.
- Read `packages/server/src/index.ts` — Express server setup: REST routes, Apollo GraphQL, optional static web UI from `packages/web/dist`.
- Read `packages/server/src/rest/routes.ts` — REST API routes: health, config, stats, scenarios (list/get/discover/trace), corrections, functions, graph. No codewalk endpoints existed.
- Read `packages/server/src/context.ts` — ServerContext factory: connects Neo4j, creates parser, AI agents, engines. Had `ScenarioFileReader` but no `CodeWalkFileReader`.
- Read `packages/web/src/App.tsx` — React SPA routes: `/` (ScenarioList), `/scenario/:id` (detail), `/scenario/:id/walk` (Walkthrough). No codewalk routes.
- Read `packages/core/src/codewalk/file-reader.ts` — `CodeWalkFileReader` class: `listCodeWalks()`, `getCodeWalk(id)`, `getCell()`. Handles v1 and v2 formats transparently.
- Read `packages/core/src/codewalk/index.ts` — barrel exports `CodeWalkFileReader` and all types.

## 2. Issues Identified
- No REST API endpoints for codewalks — the server only served scenarios
- No `CodeWalkFileReader` in `ServerContext` — it was only used by the VS Code extension
- No web page to browse/view codewalks from the server — only the standalone HTML viewer existed (requires drag & drop)
- The existing web SPA (`packages/web`) uses React + GraphQL for scenarios but has no codewalk support

## 3. Plan
Three changes needed:
1. **Add `CodeWalkFileReader` to `ServerContext`** — so the server can read codewalks from disk
2. **Add REST API endpoints** for codewalks: `GET /api/codewalks` (list), `GET /api/codewalks/:id` (full walk), `GET /api/codewalks/:id/cells/:index` (single cell)
3. **Add server-rendered HTML pages** at `/codewalks` (list page) and `/codewalks/:id` (interactive viewer) — these fetch from the REST API and render the same viewer experience, no React build required

## 4. Changes Made

### `packages/server/src/context.ts`
- Added `CodeWalkFileReader` to imports
- Added `codeWalkFileReader: CodeWalkFileReader` to `ServerContext` interface
- Instantiated `new CodeWalkFileReader(projectRoot ?? process.cwd())` in `createServerContext()`
- Added to return object

### `packages/server/src/rest/routes.ts`
- Added three new REST endpoints in a "Code Walks" section:
  - `GET /api/codewalks` — lists all walks with summary (no cell data)
  - `GET /api/codewalks/:id` — returns full walk in v1 format
  - `GET /api/codewalks/:id/cells/:index` — returns a single cell

### `packages/server/src/rest/codewalk-viewer.ts` (NEW)
- Created `createCodeWalkViewerRouter()` with two routes:
  - `GET /codewalks` — Serves an HTML list page that fetches from `/api/codewalks` and renders a card grid with walk name, description, cell count, tags, entry point, date
  - `GET /codewalks/:id` — Serves a full interactive viewer page that fetches from `/api/codewalks/:id` and renders the three-panel viewer (sidebar, code with highlights, narrative/variables/callstack tabs)

### `packages/server/src/index.ts`
- Imported `createCodeWalkViewerRouter`
- Mounted the codewalk viewer router on the Express app
- Added `/codewalks` URL to the server startup log

### `packages/cli/src/commands/serve.ts`
- Added CodeWalks URL to the CLI output shown after server starts

## 5. Commands Run
- `npx tsc --noEmit -p packages/server/tsconfig.json` — passed, no errors
- `npx tsc --noEmit -p packages/cli/tsconfig.json` — passed, no errors

## 6. Result
Running `codegraph serve` in a project folder now:
1. Starts the server with REST + GraphQL + CodeWalk viewer
2. Shows `CodeWalks: http://localhost:3000/codewalks` in the console output
3. At `/codewalks`: displays a card grid of all code walks found in `.vscode/code-graph/codewalks/` (both v1 and v2 formats)
4. Clicking a card navigates to `/codewalks/:id` which renders the full interactive viewer with code highlighting, cell navigation, variables, call stack, etc.
5. No build step needed for the viewer — it's server-rendered HTML that fetches from the REST API

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `packages/server/src/context.ts` | Modified | Added `CodeWalkFileReader` to `ServerContext` |
| `packages/server/src/rest/routes.ts` | Modified | Added 3 REST API endpoints for codewalks |
| `packages/server/src/rest/codewalk-viewer.ts` | Created | Server-rendered HTML viewer pages (list + viewer) |
| `packages/server/src/index.ts` | Modified | Mounted codewalk viewer router, added URL to logs |
| `packages/cli/src/commands/serve.ts` | Modified | Added CodeWalks URL to CLI output |
| `docs/copilot-executions/13-codewalk-server-integration.md` | Created | This execution log |
