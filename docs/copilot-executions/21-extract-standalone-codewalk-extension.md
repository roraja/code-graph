# 21 - Extract Standalone Code Walk Extension

**Date**: 2026-06-18 22:35 UTC
**Prompt**: Extract a simpler code-walk extension from code-graph which has minimal code to support code walk and doesn't include the complex code-graph dependencies. Keep the extension minimal. Try to improve the UI of the codewalk panel. Make sure to include install skills command.

## 1. Code Reading & Analysis

Explored the existing extension and codewalk surface to identify the minimal slice needed:

- `codegraph-navigator/package.json` — existing extension manifest. Depends on `@codegraph/core` (heavy: Neo4j, AI, scenarios, GraphQL). Declares ~30 commands, most unrelated to code walks.
- `codegraph-navigator/src/extension.ts` (855 lines) — wires 5 sidebar views + scenarios/functions/step-walker. Only the Code Walk container + `codeWalkCells` webview + `nextCell`/`prevCell`/`openCodeWalk`/`installSkills` are codewalk-related.
- `codegraph-navigator/src/providers/codewalk-cells-view.ts` (1339 lines) — the panel webview. **Key finding:** `renderCodeSlice()` is defined (line 621) but **never called** in `getWalkHtml()` — the panel never actually showed code.
- `codegraph-navigator/src/codewalk-decorations.ts` — editor highlight logic; depends only on `@codegraph/core` types + logger.
- `codegraph-navigator/src/skills-installer.ts` — installs SKILL.md files to `~/.claude/skills/` and `~/.github/copilot-instructions.d/`. Listed 8 skills; only 4 are codewalk-related.
- `codegraph-navigator/src/core-bridge.ts` — wraps `CodeGraphClient`; the only codewalk methods used are `listCodeWalks` / `getCodeWalk` / `getCodeWalkForScenario`, which ultimately delegate to `CodeWalkFileReader` (pure filesystem reads).
- `packages/core/src/codewalk/types.ts` — pure TypeScript types, **zero dependencies**.
- `packages/core/src/codewalk/file-reader.ts` — reads v1 (single-file) and v2 (multi-file) `.codewalk.json`. Only dependency is `createModuleLogger` (winston) + the types.
- `skills/` — confirmed 4 codewalk skills exist: `codegraph-code-walk`, `codegraph-codewalk-populate`, `codegraph-codewalk-enrich`, `codegraph-codewalk-podcast`.

Conclusion: code walks need only **types + file reader (read-only) + cells webview + decorations + logger + skills installer**. The entire `@codegraph/core` dependency (and its Neo4j/AI/server stack) is unnecessary at runtime.

## 2. Issues Identified

1. **Heavy dependency**: `codegraph-navigator` bundles all of `@codegraph/core` into the VSIX. The codewalk feature only reads JSON files from disk.
2. **Code slice never rendered**: `codewalk-cells-view.ts` computed but never displayed the code, the most important content of a walk.
3. **Coupled skills installer**: tied to a monorepo layout (`extensionPath/../skills`); a standalone extension can't rely on that and must bundle skills.
4. **Winston logging dependency** in `file-reader.ts` pulls in a heavy logger; not needed for a small extension.

## 3. Plan

Create a new top-level `codewalk/` extension with no `@codegraph/core` (or any runtime npm) dependency:

- Inline the codewalk **types** (dependency-free copy).
- Port the file reader as **read-only**, replacing winston with a self-contained logger.
- Port decorations + write a self-contained logger.
- **Rewrite** the cells webview with an improved UI and actually render the code slice.
- Bundle the 4 codewalk skills into the extension; update the installer to find `extensionPath/skills` first.
- Minimal `extension.ts` registering only: open / openById / refresh / nextCell / prevCell / openFrame / showOutput / installSkills.
- Build with tsc (type-check) + esbuild (bundle), verify with `vsce package`.

Alternative considered: keep depending on `@codegraph/core` but tree-shake. Rejected — `@codegraph/core` imports Neo4j/AI eagerly through its barrel, defeating tree-shaking and keeping the VSIX large. A clean inline copy of the ~3 needed modules is smaller and truly decoupled.

## 4. Changes Made

New extension at `codewalk/`. No existing files modified (additive extraction).

New files:

- `codewalk/package.json` — manifest. `publisher: codewalk`, id `codewalk`, view container `codewalk` with webview `codewalk.cells`. Commands: `codewalk.open`, `codewalk.refresh`, `codewalk.nextCell`, `codewalk.prevCell`, `codewalk.showOutput`, `codewalk.installSkills`. **No dependencies block** (dev-only). Activation: `workspaceContains:.vscode/code-graph/codewalks` and `**/*.codewalk.json`.
- `codewalk/tsconfig.json` — `noEmit` type-check config (esbuild does the bundling).
- `codewalk/esbuild.mjs` — bundles `src/extension.ts` → `dist/extension.js`, external only `vscode`.
- `codewalk/.vscodeignore`, `codewalk/.gitignore`, `codewalk/LICENSE`, `codewalk/README.md`.
- `codewalk/media/icon.svg` — copied from navigator.
- `codewalk/src/codewalk-types.ts` — inlined copy of `packages/core/src/codewalk/types.ts` (no deps).
- `codewalk/src/logger.ts` — self-contained logger (OutputChannel "Code Walk" + datewise file logs).
- `codewalk/src/codewalk-file-reader.ts` — read-only port (`listCodeWalks` / `getCodeWalk` / `getCodeWalkForScenario` / `getCell`); winston `createModuleLogger` replaced with local `log()`.
- `codewalk/src/codewalk-decorations.ts` — port of navigator decorations; type import switched to `./codewalk-types.js`.
- `codewalk/src/codewalk-cells-view.ts` — **rewritten** webview provider. Improvements: sticky nav header, progress bar, breadcrumb, card-based sections, **renders the code slice** (with per-line highlights + active sub-step focus), clickable file ref to open in editor, improved variable rows (action icons + rationale tooltips), keyboard navigation (↑/↓/j/k), polished empty state with an "Open Code Walk" button, auto-scroll of the active cell in the mini-list. Message protocol preserved; `openFrame` retargeted to `codewalk.openFrame`.
- `codewalk/src/skills-installer.ts` — port trimmed to the 4 codewalk skills; `findSkillsSourceDir` now checks `extensionPath/skills` (bundled) first; command id `codewalk.installSkills`.
- `codewalk/src/extension.ts` — minimal entry point: instantiates `CodeWalkFileReader`, registers the webview + 8 commands, wires `onCellChanged` → editor decorations, respects the `codewalk.autoOpenCell` setting.
- `codewalk/skills/<4 skills>/SKILL.md` — bundled copies for installation.

## 5. Commands Run

| Command | Result |
|---------|--------|
| `npm install` (in `codewalk/`) | OK — 6 dev packages, 0 vulnerabilities |
| `npm run build` (`tsc --noEmit` + esbuild) | **Pass** — no type errors; `dist/extension.js` 78.6 KB |
| `npx @vscode/vsce package --no-dependencies` | **Pass** — `codewalk-0.1.0.vsix`, 12 files, 38.17 KB; skills/ + media/ included, `.map` excluded |
| esbuild smoke test of `CodeWalkFileReader` (vscode stubbed) against `/home/roraja/src/code-graph` | **Pass** — found 6 walks (v1 + v2), cells loaded in order, `getCodeWalk` roundtrip ok |

Smoke output excerpt:
```
walks found: 6
 - resize-image-walk | "ImageProcessor.resizeImage ..." | cells=8
 - DND-RampUp-architecture-drop-e2e | ... | cells=13
getCodeWalk roundtrip ok: true
```

Temporary smoke-test artifacts and the VSIX were removed after verification.

## 6. Result

A new, fully standalone `codewalk/` VS Code extension that supports code walks with **no `@codegraph/core` / Neo4j / AI / server dependencies** — it reads `.codewalk.json` files directly. The panel UI was substantially improved (notably, code is now rendered). The `Code Walk: Install AI Skills` command ships with the 4 codewalk skills bundled in the VSIX. Type-check, bundle, packaging, and a reader smoke test all pass.

Remaining/follow-up: the extension is not yet registered in the root build scripts (intentionally standalone; build via `cd codewalk && npm run build`). End-to-end UI interaction requires running the extension in VS Code (not verifiable headlessly).

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| codewalk/package.json | Created | Minimal extension manifest, no runtime deps |
| codewalk/tsconfig.json | Created | Type-check-only TS config |
| codewalk/esbuild.mjs | Created | Bundler config |
| codewalk/.vscodeignore | Created | VSIX exclusions |
| codewalk/.gitignore | Created | Ignore dist/node_modules/vsix |
| codewalk/LICENSE | Created | MIT (copied) |
| codewalk/README.md | Created | Extension docs |
| codewalk/media/icon.svg | Created | Activity-bar icon (copied) |
| codewalk/src/codewalk-types.ts | Created | Inlined codewalk types (no deps) |
| codewalk/src/logger.ts | Created | Self-contained logger |
| codewalk/src/codewalk-file-reader.ts | Created | Read-only walk reader (no winston) |
| codewalk/src/codewalk-decorations.ts | Created | Editor highlight (ported) |
| codewalk/src/codewalk-cells-view.ts | Created | Rewritten, improved panel webview |
| codewalk/src/skills-installer.ts | Created | Trimmed installer, bundled-skills aware |
| codewalk/src/extension.ts | Created | Minimal entry point |
| codewalk/skills/*/SKILL.md | Created | 4 bundled codewalk skills |
