# 05 - Standalone Code Walk Extension

## Overview

A minimal, **standalone** VS Code extension (`codewalk/`) for browsing code walks
— notebook-style, step-by-step execution walkthroughs — without any of the heavy
CodeGraph runtime stack. Unlike `codegraph-navigator`, which bundles
`@codegraph/core` (Neo4j driver, AI providers, scenario/correction engines), this
extension reads `.codewalk.json` files **directly from disk** and has **no runtime
npm dependencies** (only Node built-ins + the VS Code API).

It is the lightweight consumer half of the code walk system: AI agents author
walks via the bundled skills; this extension renders and navigates them.

## Design

### Why a separate extension

`@codegraph/core` eagerly imports Neo4j/AI through its barrel (`src/index.ts`), so
tree-shaking can't strip it from a VSIX. Code walks, however, only require:

- the codewalk **types** (dependency-free), and
- a **filesystem reader** for `.codewalk.json` (v1 single-file and v2 multi-file).

So the minimal modules were inlined into a fresh extension instead of depending on
core. Result: a 38 KB VSIX with no transitive runtime dependencies.

### Module layout (`codewalk/src/`)

| Module | Responsibility |
|--------|----------------|
| `codewalk-types.ts` | Inlined copy of the codewalk type definitions (no deps) |
| `codewalk-file-reader.ts` | Read-only reader; discovers and parses v1/v2 walks |
| `logger.ts` | Self-contained logger → OutputChannel + datewise file logs |
| `codewalk-decorations.ts` | Editor highlights for the current cell / sub-step |
| `codewalk-cells-view.ts` | The sidebar webview panel (navigation + rendering) |
| `skills-installer.ts` | Installs bundled SKILL.md files for Claude/Copilot |
| `extension.ts` | Activation + command wiring |

### Data flow

```
.vscode/code-graph/codewalks/*.codewalk.json
        │  (read-only, on demand)
        ▼
CodeWalkFileReader ──► CodeWalkCellsViewProvider (webview)
                              │  onCellChanged
                              ▼
                    codewalk-decorations (editor highlights)
```

## Implementation Details

### Read-only file reader

Ported from `packages/core/src/codewalk/file-reader.ts` with the write methods
removed and the winston `createModuleLogger` swapped for the local `log()`. It
transparently handles both on-disk formats:

- **V1**: `<walk-id>.codewalk.json` (full walk inline)
- **V2**: `<walk-id>/manifest.codewalk.json` + `cell-*.json` (one file per cell)

Cells are loaded in manifest order; any extra cell files not listed in the
manifest are also picked up, then everything is sorted by `cell.index`.

### Improved panel UI

The webview was rewritten (vs. the navigator's `codewalk-cells-view.ts`) with:

- **Code rendering** — the original computed `renderCodeSlice()` but never placed
  it in the HTML; the new panel renders the code slice with per-line highlight
  classes (`hl-executed`, `hl-branched`, …) and a stronger marker for the active
  sub-step's focus range.
- **Sticky header** with up/down nav buttons and an `N / total` counter.
- **Progress bar** showing position through the walk.
- **Card-based sections** (Explanation, Code, Variables, Call Stack, Cells) for
  clearer visual grouping, using VS Code theme variables.
- **Clickable file reference** that opens the source at the cell's location.
- **Variable rows** with action icons (created/modified/read) and rationale
  tooltips; changed variables are emphasized.
- **Branch-aware navigation** — branch points show a "Choose a Path" card; the
  navigation-history stack makes "Prev" retrace the exact route.
- **Keyboard navigation** — `↑`/`↓` or `j`/`k`.
- **Empty state** with an "Open Code Walk" call-to-action button.

### Install skills command

`Code Walk: Install AI Skills (Claude & Copilot)` copies the bundled
`skills/<name>/SKILL.md` files to `~/.claude/skills/<name>/SKILL.md` and/or
`~/.github/copilot-instructions.d/<name>.md`. The source-dir resolver checks the
**bundled** `extensionPath/skills` first (so it works from the installed VSIX),
then falls back to a workspace/monorepo layout. Bundled skills:
`codegraph-code-walk`, `codegraph-codewalk-populate`, `codegraph-codewalk-enrich`,
`codegraph-codewalk-podcast`.

## Usage

```bash
cd codewalk
npm install
npm run build        # tsc --noEmit + esbuild bundle
npm run package      # produces codewalk-<version>.vsix
```

In VS Code: open the **Code Walk** activity-bar container → **Open Code Walk** →
pick a walk. Navigate with the header buttons, the arrow keys, or the cell list.
Run **Code Walk: Install AI Skills** to set up the authoring skills.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codewalk.autoOpenCell` | `true` | Open and highlight the source file when navigating cells |

## Testing

- **Type-check + bundle**: `npm run build` passes with no errors (esbuild output
  `dist/extension.js`, ~78 KB).
- **Packaging**: `vsce package --no-dependencies` produces a 38 KB VSIX with
  `skills/` and `media/` included and source/maps excluded.
- **Reader smoke test**: with `vscode` stubbed, `CodeWalkFileReader` was run
  against the repo's own `.vscode/code-graph/codewalks/` and correctly parsed all
  6 fixtures (mixed v1/v2), loaded cells in order, and round-tripped
  `getCodeWalk`.

End-to-end UI behavior requires launching the extension in VS Code and is not
covered by headless tests.

## Code References

- Extension root: `codewalk/`
- Entry point: `codewalk/src/extension.ts`
- Panel: `codewalk/src/codewalk-cells-view.ts`
- Reader: `codewalk/src/codewalk-file-reader.ts`
- Source modules this was extracted from: `codegraph-navigator/src/*`,
  `packages/core/src/codewalk/*`
