# 01 - Call Stack Empty / Not Updating for Manually-Authored Scenarios

## Problem Statement

Two related issues with the Call Stack sidebar panel in the VS Code extension:

1. **Empty state for manual scenarios**: When walking a manually-authored scenario (JSON file without tracer-generated `callStack` data), the panel always shows "No call stack — Walk a traced scenario to see the call stack here."

2. **Not updating on step navigation**: Even when the call stack initially displays, pressing Next/Prev does not update the view — it stays stuck showing the old call stack.

## Root Cause Analysis

### Issue 1: Missing `callStack` property

The `CallStackViewProvider.render()` method checked `step.callStack` — a property only populated by `ScenarioTracer.trace()` at runtime. Manually-authored scenario JSON files never include this field, so `render()` always short-circuited to the empty state.

### Issue 2: Webview lifecycle

VS Code deallocates webview view documents (the iframe content) when they are not visible (collapsed, scrolled out of view, or tab switched). When `showStep()` was called while the webview was in this deallocated state, setting `.html` on the webview had no visible effect. When the view became visible again, `resolveWebviewView` was called but the old HTML (from before deallocation) was gone.

Neither `onDidDispose` nor `onDidChangeVisibility` were handled, and `retainContextWhenHidden` was not set on the registration.

## Solution Implemented

### Call stack derivation (Issue 1)

Added `deriveCallStack()` to `CallStackViewProvider` that reconstructs call stack frames from step history:
- `call`/`dispatch` → push frame (or update top if same function)
- `return` → pop top frame (if function matches)
- `branch_taken`/`branch_skipped`/`assign` → update top frame line, or push new frame if function changed (handles implicit function transitions in manual scenarios)
- Converts step `variableState` to `FrameVariable` records with synthesized metadata
- Explicit `step.callStack` (from tracer) always takes priority

### Webview lifecycle (Issue 2)

1. Set `retainContextWhenHidden: true` on both webview view registrations (`StepDetailViewProvider` and `CallStackViewProvider`) to prevent document deallocation
2. Added `onDidDispose` handler to null out stale `this.view` reference
3. Added `onDidChangeVisibility` handler to re-render when the view becomes visible again

## Code References

| File | Change |
|------|--------|
| `codegraph-navigator/src/providers/call-stack-view.ts` | `deriveCallStack()`, `variableStateToFrameVariables()`, `inferType()`, `onDidDispose`/`onDidChangeVisibility` handlers, updated `showStep()` signature |
| `codegraph-navigator/src/providers/step-detail-view.ts` | `onDidDispose`/`onDidChangeVisibility` handlers |
| `codegraph-navigator/src/extension.ts` | Pass `ScenarioView` to `callStackViewProvider.showStep()`, `retainContextWhenHidden: true` on both webview registrations |
