# 05 - Install Deps, Build, Install Extension

**Date**: 2026-04-05 UTC
**Prompt**: "Install deps, build, install ext"

## 1. Code Reading & Analysis
- Read `package.json` (root) — workspace structure with 5 workspaces: core, cli, server, web, codegraph-navigator
- Read `packages/cli/package.json` — missing `@codegraph/server` dependency
- Read `packages/cli/src/commands/serve.ts` (lines 1–50) — dynamic `import('@codegraph/server')` at line 43
- Read `packages/cli/tsconfig.json` — extends `tsconfig.base.json`, no special paths
- Read `tsconfig.base.json` — strict mode, ES2022 target, Node16 module resolution
- Listed `codegraph-navigator/` directory — found pre-built `codegraph-navigator-0.1.0.vsix` (stale)

## 2. Issues Identified
- **CLI build failure** (`packages/cli/src/commands/serve.ts:43`): `TS2307: Cannot find module '@codegraph/server'`
  - Root cause: `@codegraph/server` was not listed as a dependency in `packages/cli/package.json`, so TypeScript couldn't resolve the module for the dynamic `import('@codegraph/server')` call
- **Stale VSIX**: Pre-built `codegraph-navigator-0.1.0.vsix` was outdated vs `package.json` version `0.4.0`

## 3. Plan
1. Run `npm install` to install all workspace dependencies
2. Run `npm run build` — expect CLI build failure
3. Fix CLI by adding `@codegraph/server` as a dependency of `@codegraph/cli`
4. Re-install and rebuild
5. Package a fresh VSIX and install the VS Code extension

## 4. Changes Made
- **`packages/cli/package.json`**: Added `"@codegraph/server": "0.1.0"` to dependencies so TypeScript can resolve the dynamic import in `serve.ts`

## 5. Commands Run
| Command | Result |
|---------|--------|
| `npm install` | ✅ 577 packages installed |
| `npm run build` (1st attempt) | ❌ CLI failed: TS2307 Cannot find module '@codegraph/server' |
| Edit `packages/cli/package.json` | Added `@codegraph/server` dependency |
| `npm install` (2nd) | ✅ 1 package changed |
| `npm run build` (2nd) | ✅ All 5 workspaces built successfully |
| `npx @vscode/vsce package --no-dependencies` | ✅ Packaged `codegraph-navigator-0.4.0.vsix` (2.45 MB) |
| `code --install-extension codegraph-navigator-0.4.0.vsix --force` | ✅ Successfully installed |
| `code --list-extensions \| grep codegraph` | ✅ `codegraph.codegraph-navigator` confirmed |

## 6. Result
- All dependencies installed
- All 5 workspace packages build successfully (core, cli, server, web, codegraph-navigator)
- VS Code extension `codegraph.codegraph-navigator` v0.4.0 installed and verified
- One fix required: added missing `@codegraph/server` dependency to CLI package

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `packages/cli/package.json` | Modified | Added `@codegraph/server: "0.1.0"` dependency to fix TS2307 build error |
| `codegraph-navigator/codegraph-navigator-0.4.0.vsix` | Created | Fresh VSIX package built from current source |
