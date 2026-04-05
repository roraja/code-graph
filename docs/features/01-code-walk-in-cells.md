# 01 — Code Walk in Cells

## Overview

Code Walk in Cells implements a Jupyter-notebook-style execution walkthrough for codebases. Instead of the existing flat `ScenarioStep[]` model, code walks use an ordered sequence of **cells** where each cell represents a meaningful chunk of execution — entering a function, evaluating a branch, assigning variables, etc.

This is the implementation of **Idea 4** from `docs/next/code-walk-data-structures.md`.

## Design

### Why Cells?

- **LLMs produce cells naturally** — when an LLM explains code, it already thinks in chunks ("first the function is entered... then it calls findByEmail... then the branch is evaluated..."). Each chunk is a cell.
- **Partial population is first-class** — each cell has a `status` (skeleton/partial/complete/corrected). A static analyzer can produce skeleton cells, an AI enrichment pass upgrades them.
- **Code slices > line numbers** — a cell shows a 3-15 line snippet of actual source code with per-line highlights.
- **Flat array with parent references** — easy to serialize and paginate, but `parentCellId` reconstructs the call hierarchy.
- **No mandatory dependency on static analyzers** — AI reads code directly. clangd/IntelliSense can speed things up but are never required.

### Data Structures

All types are in `packages/core/src/codewalk/types.ts`:

| Type | Purpose |
|------|---------|
| `CodeWalk` | Top-level container: id, name, cells, meta |
| `WalkCell` | A single execution chunk: code, narrative, state, callStack |
| `CellType` | What the cell represents: entry, call, branch, assignment, return, dispatch, block, note |
| `CellStatus` | How complete: skeleton, partial, complete, corrected |
| `CodeSlice` | Source code with file path, line range, text, and highlights |
| `LineHighlight` | A highlighted line: type (executed/branched/assigned/called/returned/skipped) + annotation |
| `CellState` | Variable state organized by scope with change tracking |
| `CellVariable` | A variable with value, type, changed flag, action, source, rationale |
| `CellCallStackFrame` | A frame in the call stack with function name, file, line, depth |
| `DataSource` | Provenance: who produced this data (tool, agent, timestamp, confidence) |

### Storage

Code walks are stored as `.codewalk.json` files in `.vscode/code-graph/codewalks/`:

```
.vscode/code-graph/codewalks/
  outlook-drag-enter-hfdrop.codewalk.json
  user-login-flow.codewalk.json
```

File format:
```json
{
  "_format": "codegraph-codewalk-v1",
  "walk": { /* CodeWalk */ }
}
```

## Implementation

### Core Layer (`packages/core/src/codewalk/`)

- `types.ts` — All TypeScript interfaces and types
- `file-reader.ts` — `CodeWalkFileReader` class for disk I/O
- `index.ts` — Barrel exports

### API Layer (`packages/core/src/api.ts`)

`CodeGraphClient` gains three new methods:
- `listCodeWalks()` — List all code walks from disk
- `getCodeWalk(id)` — Get a walk by ID
- `getCodeWalkForScenario(scenarioId)` — Get the walk associated with a scenario

### VS Code Extension (`codegraph-navigator/`)

#### New Sidebar: Code Walk

A new activity bar container `codegraph-codewalk` with a single webview view `codegraph.codeWalkCells`.

#### Code Walk Cells Webview (`providers/codewalk-cells-view.ts`)

Rich HTML webview that renders:
- **Header**: Walk name + cell counter + ▲/▼ navigation
- **Cell type badge**: Color-coded by type (entry=blue, branch=orange, etc.)
- **Code block**: Source code with per-line highlights and annotations
- **Narrative**: AI explanation in blockquote style
- **Variables**: Grouped by scope, change icons (🆕/✏️/👁), types, values
- **Call stack**: Most-recent-first with current frame highlighted
- **Cell list**: Mini navigation showing all cells indented by stack depth

#### Editor Decorations (`codewalk-decorations.ts`)

7 decoration types for different line highlight styles:
| Highlight Type | Visual |
|---------------|--------|
| `executed` | Blue background + left border |
| `branched` | Orange background + left border |
| `assigned` | Brown background + left border |
| `called` | Light blue background + left border |
| `returned` | Gray background + left border |
| `skipped` | Red background + left border (dimmed) |

Also shows other cells in the same file with subtle left-border markers.

#### Commands

| Command | Trigger |
|---------|---------|
| `codegraph.openCodeWalk` | Right-click scenario → "Open Code Walk" |
| `codegraph.openCodeWalkById` | Command palette / API |
| `codegraph.nextCell` | ▼ button or command |
| `codegraph.prevCell` | ▲ button or command |

### Skills (`.claude/skills/`)

Two installable skills for AI agent population:

#### `codewalk-populate`
Creates new `.codewalk.json` files. Documents the full data structure with:
- Every interface definition
- Cell type guidance table
- Complete example cell
- Step-by-step procedure

#### `codewalk-enrich`
Enriches existing skeleton/partial cells by adding:
- Narrative explanations
- Variable state with imagined values
- Call stacks
- Line highlights

## Usage

### Viewing a Code Walk

1. Open the CodeGraph sidebar
2. Right-click a scenario → "Open Code Walk"
3. Navigate cells with ▲/▼ buttons
4. Editor highlights the current cell's lines

### Creating a Code Walk (via AI skill)

1. Install the `codewalk-populate` skill
2. Ask: "Create a code walk for the user login flow starting from AuthService.authenticateUser"
3. The AI reads the source code and produces a `.codewalk.json` file

### Enriching a Code Walk (via AI skill)

1. Install the `codewalk-enrich` skill
2. Ask: "Enrich the skeleton cells in the login code walk"
3. The AI adds narratives, variables, and call stacks to incomplete cells

## Testing

- Core types: compile-time verified via `tsc --noEmit`
- File reader: verified via Node.js script reading the sample codewalk
- All 134 existing unit tests continue to pass

## Code References

| Component | File |
|-----------|------|
| Types | `packages/core/src/codewalk/types.ts` |
| File Reader | `packages/core/src/codewalk/file-reader.ts` |
| API Methods | `packages/core/src/api.ts` (listCodeWalks, getCodeWalk, getCodeWalkForScenario) |
| Cells Webview | `codegraph-navigator/src/providers/codewalk-cells-view.ts` |
| Decorations | `codegraph-navigator/src/codewalk-decorations.ts` |
| Extension | `codegraph-navigator/src/extension.ts` (commands, registration) |
| Core Bridge | `codegraph-navigator/src/core-bridge.ts` (bridge functions) |
| Package Config | `codegraph-navigator/package.json` (sidebar, views, commands, menus) |
| Sample Data | `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` |
| Populate Skill | `.claude/skills/codewalk-populate/skills/SKILL.md` |
| Enrich Skill | `.claude/skills/codewalk-enrich/skills/SKILL.md` |
