# 02 - Update Context Files to Match Latest Code

**Date**: 2026-04-04 13:43 UTC
**Prompt**: Update context files as per latest code

## 1. Code Reading & Analysis

All context files read:
- `.context/FLOORPLAN.md` — routing table
- `.context/domains/core.md` — core engine reference
- `.context/domains/cli.md` — CLI commands reference
- `.context/domains/server.md` — server API reference
- `.context/domains/web.md` — web UI reference
- `.context/domains/testing.md` — testing reference
- `.context/domains/vscode-extension.md` — VS Code extension reference
- `.context/processes/new-feature.md` — new feature workflow
- `.context/processes/add-parser.md` — parser workflow
- `.context/processes/add-cli-command.md` — CLI command workflow
- `.context/processes/debug-failure.md` — debug workflow
- `CLAUDE.md` — project guidance

All source directories explored via parallel agents:
- `packages/core/src/` — all parser, graph, ai, scenario, correction, config files + api.ts
- `packages/cli/src/` — all 18 command files + helpers.ts + index.ts
- `packages/server/src/` — index.ts, context.ts, graphql/, rest/
- `packages/web/src/` — App.tsx, api.ts, types.ts, stores/, components/
- `codegraph-navigator/src/` — extension.ts, core-bridge.ts, logger.ts, decorations.ts, providers/
- `test/` — unit, e2e, fixtures
- Root config files — package.json, tsconfig.base.json, foreman.yaml, README.md

## 2. Issues Identified

1. **FLOORPLAN.md L45**: Web package described as "REST API" only; actually uses REST + GraphQL (Apollo Client)
2. **FLOORPLAN.md L48**: VS Code extension described as "shells out to CLI"; now imports @codegraph/core directly
3. **core.md**: Missing `src/api.ts` (CodeGraphClient public facade) from key files
4. **core.md**: Missing AI default provider note (default is `copilot`, not `openai`)
5. **cli.md**: Missing `createProvider()` from helpers.ts exports list
6. **cli.md**: query command subcommands (callers/callees/path) not clearly documented
7. **server.md**: Missing REST endpoints: `GET /api/config`, `GET /api/graph/:scenarioId`
8. **server.md**: CreateScenarioInput field count says 5, actually 6
9. **web.md**: Incorrectly states "REST API (not GraphQL)" — uses both
10. **web.md**: Missing Apollo Client and React Router DOM from tech stack
11. **web.md**: Missing `fetchConfig()` API function
12. **vscode-extension.md (MAJOR)**: Architecture changed from CLI subprocess to @codegraph/core library import
13. **vscode-extension.md**: `cli-bridge.ts` → `core-bridge.ts` with completely different API
14. **vscode-extension.md**: `types.ts` removed (types come from @codegraph/core)
15. **vscode-extension.md**: `codegraph.cliPath` setting removed (no longer needed)
16. **vscode-extension.md**: Version 0.1.0 → 0.4.0
17. **vscode-extension.md**: Command count says 13, actually 14
18. **vscode-extension.md**: Known limitations reference CLI subprocess model (no longer applies)
19. **testing.md**: Fixture file count wrong (7 files, not 6); missing empty directories
20. **CLAUDE.md**: C++ parser described as "clangd" but is regex-based; missing CopilotCLIProvider
21. **CLAUDE.md**: Missing CodeGraphClient/api.ts from architecture diagram
22. **CLAUDE.md**: Config path in troubleshooting only mentions `.codegraph.yaml`
23. **processes/new-feature.md**: VS Code extension step references CLI bridge pattern

## 3. Plan

Update all context files to match the actual codebase. Work through each file systematically, fixing all identified discrepancies. No alternative approaches needed — straightforward documentation sync.

## 4. Changes Made

### `.context/FLOORPLAN.md`
- **L45**: "REST API" → "REST API + GraphQL"
- **L48**: "shells out to `codegraph` CLI, no code dependency" → "imports @codegraph/core directly, no CLI subprocess dependency"
- **L98-99**: Updated VS Code extension troubleshooting entries (removed CLI bridge references, added core build dependency note)

### `.context/domains/core.md`
- Added `src/api.ts` key file entry documenting CodeGraphClient, createCodeGraphClient, CodeGraphClientOptions, ScenarioView, FunctionInfo
- Updated config locations pattern to note default AI provider is `copilot`; added `editor` section
- Added "Public API facade" pattern description
- Added "New public API method" to Adding New Functionality section

### `.context/domains/cli.md`
- Added `createProvider()` to helpers.ts export list
- Clarified query command: "query callers/callees/path — Query the graph (3 subcommands)"

### `.context/domains/server.md`
- Added `GET /api/config` and `GET /api/graph/:scenarioId` REST endpoints
- Replaced generic input type list with detailed field counts for all 4 input types

### `.context/domains/web.md`
- Changed scope: "REST API (not GraphQL)" → "REST API + GraphQL using Apollo Client"
- Added Apollo Client and React Router DOM to tech stack
- Added `fetchConfig()` to API client functions
- Updated patterns: "REST API client" → "Dual API clients" with description

### `.context/domains/vscode-extension.md` (MAJOR REWRITE)
- Rewrote scope: "shells out to CLI" → "imports @codegraph/core directly"
- Rewrote architecture: removed CLI subprocess model, documented CodeGraphClient usage
- Replaced `cli-bridge.ts` with `core-bridge.ts` documentation (9 exports, 4 type re-exports)
- Removed `src/types.ts` entry (file no longer exists)
- Added `esbuild.mjs` to key files
- Updated `extension.ts`: 13 → 14 commands, documented helper functions
- Updated `logger.ts`: added `getOutputChannel()` export
- Updated `providers/functions.ts`: added `getCachedFunctions()` method
- Updated `providers/step-walker.ts`: added `getScenarioView()` method
- Removed `codegraph.cliPath` setting (no longer exists)
- Updated build instructions: added esbuild bundle step, version 0.4.0
- Updated Watch command: "tsc --watch" → "esbuild --watch"
- Rewrote Key Patterns: CLI bridge → core library import, subprocess → singleton client
- Replaced 3 CLI-specific known limitations with 1 activation event limitation

### `.context/domains/testing.md`
- Updated fixture count: "6 files" → "7 files" with explicit listing
- Added `test/fixtures/ai-responses/` (empty) and `test/integration/` (empty) entries

### `.context/processes/new-feature.md`
- Updated VS Code extension step: CLI bridge references → core-bridge.ts / CodeGraphClient references
- Updated VSIX version: 0.1.0 → 0.4.0

### `CLAUDE.md`
- Updated architecture: "Four npm workspace packages" → "Four npm workspace packages plus a VS Code extension"
- Added `codegraph-navigator` to dependency flow diagram
- Fixed C++ parser: "clangd" → "regex-based"
- Added CopilotCLI to AI providers
- Added `api.ts` layer to core engine layers diagram
- Updated AI provider abstraction pattern: added CopilotCLIProvider, noted default provider is `copilot`
- Updated config loading pattern: added `.vscode/code-graph/codegraph.yaml` as primary path
- Added pattern #9: Public API facade (CodeGraphClient)
- Fixed troubleshooting: config path includes both locations

## 5. Commands Run

No build/test commands needed — documentation-only changes.

## 6. Result

All 10 context files updated to match the current codebase state. Major changes:
- VS Code extension documentation fully rewritten to reflect the architectural shift from CLI subprocess to direct @codegraph/core library import
- Web UI documentation corrected to show dual REST + GraphQL API usage
- Core documentation expanded to include the CodeGraphClient public API facade
- Server documentation completed with 2 missing REST endpoints
- CLAUDE.md updated with accurate architecture diagram and patterns

No remaining issues — all identified discrepancies have been addressed.

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `.context/FLOORPLAN.md` | Modified | Fixed web API description, VS Code extension architecture, troubleshooting entries |
| `.context/domains/core.md` | Modified | Added api.ts facade, AI default provider, public API pattern |
| `.context/domains/cli.md` | Modified | Added createProvider(), clarified query subcommands |
| `.context/domains/server.md` | Modified | Added 2 missing REST endpoints, fixed input type field counts |
| `.context/domains/web.md` | Modified | Fixed API communication (REST + GraphQL), added tech stack entries |
| `.context/domains/vscode-extension.md` | Modified | Major rewrite: CLI subprocess → @codegraph/core library import |
| `.context/domains/testing.md` | Modified | Updated fixture counts, added empty directory entries |
| `.context/processes/new-feature.md` | Modified | Updated VS Code extension step for new architecture |
| `CLAUDE.md` | Modified | Added VS Code ext to architecture, fixed parser/AI/config descriptions |
