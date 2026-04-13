# 04 - Codewalk Sub-Steps

## Overview

Sub-steps break codewalk cells into sequential focus points, guiding the viewer through dense code one concept at a time instead of showing everything at once.

## Design

### Problem
Codewalk cells often contain 5-15 lines of code with multiple highlights, a long narrative, variable state, and call stack. This overwhelms users who can't tell where to look first.

### Solution
Each `WalkCell` can optionally have a `steps` array of `CellStep` objects:

```typescript
interface CellStep {
  description: string;       // What this line/concept does
  focusLine: number;         // Line to highlight strongly (1-based)
  focusEndLine?: number;     // Optional end line for multi-line focus
}
```

When `steps` is present:
- The viewer shows **one step at a time**
- The **focused line** gets a strong blue highlight
- The **rest of the cell** gets a subtle lighter background
- Progress dots show position within the cell's steps
- Arrow keys navigate sub-steps before crossing cell boundaries

When `steps` is absent, cells render exactly as before (backward compatible).

## Implementation

### Data Layer (`packages/core/src/codewalk/types.ts`)
- `CellStep` interface added
- `steps?: CellStep[]` field added to `WalkCell`
- Exported via barrel in `packages/core/src/index.ts`

### Standalone Viewer (`tools/codewalk-viewer.html`)
- Steps bar with dots, counter, and prev/next buttons between file tab and code area
- Step description shown below the steps bar
- `renderCode()` switches to focus mode when steps exist
- `nextCell()`/`prevCell()` navigate sub-steps before crossing cell boundaries
- Narrative tab shows current step prominently, full narrative dimmed below

### VS Code Extension
- `codewalk-cells-view.ts`: Tracks `currentStepIndex`, renders steps bar, handles step messages
- `codewalk-decorations.ts`: New `focusedLineDecorationType` decoration; `openCellInEditor()` accepts `activeStep` parameter
- `extension.ts`: Passes step to decoration function on cell change

### Skills
- `codegraph-codewalk-populate/SKILL.md`: Documents `CellStep` structure, when to add steps
- `codegraph-codewalk-enrich/SKILL.md`: Notes sub-steps as enrichment option

## Usage

### Creating a codewalk with sub-steps

Add `steps` to any cell with 3+ conceptually distinct lines:

```json
{
  "id": "cell-0",
  "type": "entry",
  "code": { "filePath": "src/app.ts", "startLine": 10, "endLine": 20, "text": "..." },
  "steps": [
    { "description": "Initialize the config loader", "focusLine": 11 },
    { "description": "Validate the config against the schema", "focusLine": 13 },
    { "description": "Return the validated config object", "focusLine": 18, "focusEndLine": 20 }
  ]
}
```

### Viewer navigation
- **Right arrow / j**: Next step (or next cell if at last step)
- **Left arrow / k**: Previous step (or previous cell if at first step)
- **Click dots**: Jump to specific step
- **Step nav buttons**: Navigate within current cell only

## Testing

- All 134 unit tests pass
- Build succeeds for all packages + extension
- ImageProcessor sample codewalk validates as correct JSON
- Backward compatible: cells without steps render unchanged

## Code References

- Types: `packages/core/src/codewalk/types.ts` (CellStep interface)
- Viewer: `tools/codewalk-viewer.html` (renderStepsBar, renderCode focus mode)
- Extension view: `codegraph-navigator/src/providers/codewalk-cells-view.ts`
- Decorations: `codegraph-navigator/src/codewalk-decorations.ts` (focusedLineDecorationType)
- Sample walk: `test/fixtures/sample-project/.vscode/code-graph/codewalks/image-processor-process/`
