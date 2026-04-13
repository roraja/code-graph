# 03 - Standalone CodeWalk HTML Viewer

## Overview

A self-contained, zero-dependency HTML viewer for `.codewalk.json` files. Open `tools/codewalk-viewer.html` in any browser, drag & drop a codewalk file, and interactively walk through the code with line highlights, syntax coloring, variable state, call stack, and AI narrative.

## Design

### Goals
- **Zero setup**: Single HTML file, no build step, no server, no npm install
- **Portable**: Share the HTML file with anyone — works offline
- **Feature-complete**: All data from `.codewalk.json` rendered interactively
- **Familiar**: VS Code Dark+ theme matching the existing VS Code extension and video generator

### Three-Panel Layout
```
┌──────────┬──────────────────────────┬─────────────────┐
│ Cell Nav │      Code Panel          │   Right Panel   │
│ Sidebar  │  (syntax + highlights)   │ (tabs: N/V/CS)  │
│          │                          │                 │
│ ▶ Entry  │  40 │ HRESULT Drag...    │ Narrative       │
│ ⟿ Disp   │  41 │   DWORD key...    │ When the user   │
│   → Call │  42 │   POINTL cur...   │ drags an Out... │
│   → Call │  43 │   DWORD* eff...   │                 │
│     ...  │  44 │ {                  │ Variables       │
│          │  45 │   // Tell...       │ Call Stack      │
└──────────┴──────────────────────────┴─────────────────┘
```

### Data Flow
1. User drops/selects a `.codewalk.json` file
2. JSON parsed → `walk` object extracted (supports v1 `{_format, walk}` and raw format)
3. Cell nav sidebar built with depth-based indentation
4. Active cell rendered: code with line highlights, right panel with narrative/variables/call stack
5. User navigates via clicks, buttons, or keyboard shortcuts

## Implementation

### File: `tools/codewalk-viewer.html`

Single HTML file with three inline sections:

#### CSS (~500 lines)
- CSS custom properties for theming (all colors, fonts, spacing)
- VS Code Dark+ color scheme
- Six highlight type colors: `executed` (blue), `called` (teal), `branched` (orange), `assigned` (yellow), `returned` (green), `skipped` (gray/dimmed)
- Responsive breakpoints: hide sidebar < 900px, hide right panel < 600px
- Custom scrollbar styling

#### HTML
- **Drop zone**: Initial state with drag & drop area and file picker button
- **Viewer**: Top bar (walk name, cell type badge, counter, nav buttons, jump input), main content (sidebar + code + right panel), status bar
- **Shortcuts overlay**: Modal showing all keyboard shortcuts

#### JavaScript (~300 lines)
- `loadWalkData()`: Parses both v1 and raw formats
- `renderCode()`: Renders code lines with gutter numbers, syntax colorization, highlight classes, inline annotations
- `colorize()`: Regex-based C++ syntax coloring (keywords, strings, comments, numbers, preprocessor, namespaces)
- `renderNarrativeTab()`: Markdown-lite rendering (bold, inline code), walk description, tags
- `renderVariablesTab()`: Scope groups, action icons (🆕/✏️/👁), change highlighting, rationale display
- `renderCallStackTab()`: Reversed stack frames, clickable cells, current frame highlight
- Keyboard navigation: ←/→/j/k (prev/next), Home/End, g (jump), 1/2/3 (tabs), ? (help), o (open file)

## Usage

```bash
# Just open in a browser
open tools/codewalk-viewer.html

# Or serve it
python3 -m http.server 8080 -d tools/
# Then visit http://localhost:8080/codewalk-viewer.html
```

Then drag & drop any `.codewalk.json` file onto the page, or click "Open .codewalk.json" to browse.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `→` / `j` | Next cell |
| `←` / `k` | Previous cell |
| `Home` | First cell |
| `End` | Last cell |
| `g` | Focus jump input |
| `1` | Narrative tab |
| `2` | Variables tab |
| `3` | Call Stack tab |
| `?` | Toggle shortcuts |
| `o` | Open file |

## Testing

Tested with the existing codewalk file at:
- `.vscode/code-graph/codewalks/outlook-drag-enter-hfdrop.codewalk.json` (9 cells, C++ code, rich highlights, variables, call stacks)

## Code References

| Component | Reference Source |
|-----------|-----------------|
| Line highlight colors | `codegraph-navigator/src/codewalk-decorations.ts` |
| Cell nav sidebar design | `codegraph-navigator/src/providers/codewalk-cells-view.ts` |
| VS Code Dark+ CSS theme | `skills/codegraph-codewalk-video/codewalk_video.py` |
| Walkthrough UX patterns | `packages/web/src/components/Walkthrough.tsx` |
| Data model / types | `packages/core/src/codewalk/types.ts` |

## Relationship to Other Viewers

| Viewer | Format | Requires | Interactive |
|--------|--------|----------|-------------|
| **VS Code Extension** | `.codewalk.json` | VS Code + extension | Yes |
| **Web SPA** (`Walkthrough.tsx`) | Scenario steps (API) | Server running | Yes |
| **Video Generator** | `.codewalk.json` | Python + Playwright + ffmpeg | No (MP4 output) |
| **HTML Viewer** (this) | `.codewalk.json` | Any browser | Yes |
