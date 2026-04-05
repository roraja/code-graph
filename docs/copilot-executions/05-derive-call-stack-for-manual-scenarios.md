# 05 - Derive Call Stack for Manual Scenarios + Fix Webview Lifecycle

**Date**: 2026-04-05 12:32 UTC
**Prompt**: "No call stack — Walk a traced scenario to see the call stack here. This comes even though I am walking code and there is callstack in json, any issue? [...] Yes, implement Option B [...] I see the callstack sometimes. It is not getting updated when I move forward or backwards in code stepping"

## 1. Code Reading & Analysis

| File | Purpose |
|------|---------|
| `codegraph-navigator/src/providers/call-stack-view.ts` | Call stack webview — checks `step.callStack` and renders frames or empty state |
| `codegraph-navigator/src/providers/step-walker.ts` | Step walker tree — walks through steps, has `getScenarioView()` |
| `codegraph-navigator/src/providers/step-detail-view.ts` | Step detail webview — already receives `ScenarioView` via `showStep()` |
| `codegraph-navigator/src/extension.ts` (lines 55-72, 255-276, 670-731) | Provider registration, nextStep/prevStep commands, `loadAndWalk()`, `autoOpenCurrentStep()` |
| `codegraph-navigator/src/core-bridge.ts` (lines 41-92, 143-160) | Client singleton — creates `CodeGraphClient`, probes DB availability |
| `packages/core/src/scenario/engine.ts` (lines 44-99, 280-304, 444-481) | `CallStackFrame`, `FrameVariable`, `ScenarioStep` types; `recordToStep()` |
| `packages/core/src/scenario/tracer.ts` (lines 60-80, 390-425, 431-460) | `TraceContext.callStackFrames` — how the tracer builds call stack at runtime |
| `packages/core/src/scenario/file-reader.ts` (lines 50-65, 313-335) | JSON file reader — `toSteps()` maps `callStack` from JSON to step objects |
| `packages/core/src/api.ts` (lines 116-253, 597-619) | `getMockSteps()` — mock data has no `callStack`; `getScenarioView()` — file reader path |
| `scenarios/async-clipboard-read-text.json` | Manually-authored scenario — 15 steps, none have `callStack` property |
| `node_modules/@types/vscode/index.d.ts` (lines 10227-10293, 11754-11777) | `WebviewView` interface, `registerWebviewViewProvider` options with `retainContextWhenHidden` |

Key findings:
- `ScenarioTracer.trace()` populates `callStack` on each step (tracer.ts:402-423). Manual JSON files and mock data never include this field.
- VS Code webview views deallocate their iframe when hidden (collapsed/scrolled out). No `retainContextWhenHidden` was set. No `onDidDispose` or `onDidChangeVisibility` handlers existed.

## 2. Issues Identified

1. **`call-stack-view.ts:83`** — `render()` short-circuits to empty state when `step.callStack` is undefined or empty, which is always the case for manually-authored scenarios.
2. **`call-stack-view.ts:57`** — `showStep()` only accepts a single `ScenarioStep`, not the full `ScenarioView`, so it cannot reconstruct the call stack from step history.
3. **`extension.ts:703,726`** — Both call sites pass only the step, not the scenario view.
4. **`extension.ts:69-70`** — Both webview view registrations lack `retainContextWhenHidden`, causing VS Code to deallocate the webview document when it's not visible. HTML set while hidden is lost.
5. **`call-stack-view.ts` and `step-detail-view.ts`** — No `onDidDispose` handler to clear stale `this.view` references. No `onDidChangeVisibility` handler to re-render when the view becomes visible again.

## 3. Plan

**Phase 1: Call stack derivation** (Option B)
- Add `deriveCallStack()` to `CallStackViewProvider` that replays step actions up to current step
- Expand `showStep()` signature to accept optional `ScenarioView`
- Update both call sites in `extension.ts`
- Handle edge cases: implicit function transitions in branch/assign steps

**Phase 2: Webview lifecycle fix**
- Set `retainContextWhenHidden: true` in `registerWebviewViewProvider` options
- Add `onDidDispose` handler to null out stale `this.view`
- Add `onDidChangeVisibility` handler to re-render on visibility change
- Apply to both `CallStackViewProvider` and `StepDetailViewProvider`

## 4. Changes Made

### `codegraph-navigator/src/providers/call-stack-view.ts`

1. **Import**: Added `ScenarioView` to the import from `@codegraph/core`
2. **State**: Added `private scenarioView?: ScenarioView` field
3. **`resolveWebviewView()`**: Added `onDidDispose` handler (clears `this.view`) and `onDidChangeVisibility` handler (re-renders when visible)
4. **`showStep()`**: Extended signature to `showStep(step, scenarioView?)`, stores `scenarioView`
5. **`clear()`**: Also clears `scenarioView`
6. **`render()`**: If `step.callStack` is missing, calls `deriveCallStack()` with the scenario view. Falls back to empty state only if derivation also produces nothing.
7. **`getCallStackHtml()`**: Changed from `getCallStackHtml(step)` to `getCallStackHtml(step, callStack)` — accepts call stack as parameter
8. **New `deriveCallStack()`**: Replays step history to reconstruct frames:
   - `call`/`dispatch` → push frame (or update top if same function)
   - `return` → pop top frame (if function matches)
   - `branch_*`/`assign` → update top frame line, or push new frame if function name changed
   - Fallback: if stack is empty after replay, push current step as a single frame
9. **New `variableStateToFrameVariables()`**: Converts `Record<string, unknown>` to `Record<string, FrameVariable>` with synthesized type/confidence
10. **New `inferType()` helper**: Infers type labels from runtime values

### `codegraph-navigator/src/providers/step-detail-view.ts`

1. **`resolveWebviewView()`**: Added `onDidDispose` handler and `onDidChangeVisibility` handler

### `codegraph-navigator/src/extension.ts`

1. **Line 69-70 (registration)**: Added `{ webviewOptions: { retainContextWhenHidden: true } }` to both `registerWebviewViewProvider` calls
2. **Line 703**: `callStackViewProvider.showStep(firstStep)` → `callStackViewProvider.showStep(firstStep, view)`
3. **Line 726**: `callStackViewProvider.showStep(step)` → `callStackViewProvider.showStep(step, scenarioView)`

## 5. Commands Run

| Command | Result |
|---------|--------|
| `cd codegraph-navigator && npx tsc --noEmit` | Clean — no errors (run 3 times during iteration) |
| `npm run build` (in codegraph-navigator) | Success — compile + bundle (run 3 times) |
| `cd packages/core && CODEGRAPH_AI_MOCK=true npx vitest run` | 134 tests passed (3 files) |
| `node -e "..." (deriveCallStack simulation)` | Verified 1-11 frames for all 15 steps |
| `npx vsce package --no-dependencies` | codegraph-navigator-0.4.0.vsix (2.45MB) |
| `code --install-extension ... --force` | Extension installed on SSH: edge_bugs5 |

## 6. Result

Two bugs fixed:

1. **Call stack derivation**: The Call Stack sidebar now auto-derives call stack frames from step history when `step.callStack` is not present. For the Chromium clipboard scenario (15 steps), stepping through shows progressive call stacks from 1 frame (step 1) to 11 frames (steps 14-15).

2. **Webview lifecycle**: Both webview views (Step Detail and Call Stack) now:
   - Retain context when hidden (`retainContextWhenHidden: true`)
   - Handle disposal gracefully (`onDidDispose`)
   - Re-render when becoming visible (`onDidChangeVisibility`)

## 7. Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `codegraph-navigator/src/providers/call-stack-view.ts` | Modified | Added call stack derivation, webview lifecycle handlers |
| `codegraph-navigator/src/providers/step-detail-view.ts` | Modified | Added webview lifecycle handlers |
| `codegraph-navigator/src/extension.ts` | Modified | `retainContextWhenHidden`, pass `ScenarioView` to call stack |
| `docs/bug-fixes/01-call-stack-empty-for-manual-scenarios.md` | Created | Bug fix documentation |
| `docs/copilot-executions/05-derive-call-stack-for-manual-scenarios.md` | Created | This execution log |
