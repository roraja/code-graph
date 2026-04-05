/**
 * Call Stack Webview — renders the current step's call stack as a dedicated
 * collapsible sidebar panel, similar to VS Code's Debug Call Stack.
 *
 * Each frame is clickable (navigates to that file:line). Hovering over a
 * frame shows rich AI analysis: per-frame variables with types, rationale,
 * confidence, and alternative values the AI considered.
 *
 * @module providers/call-stack-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from '../logger.js';
import type { ScenarioStep, ScenarioView, CallStackFrame, FrameVariable } from '@codegraph/core';

/**
 * Webview provider that renders the call stack in the sidebar.
 */
export class CallStackViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codegraph.callStack';

  private view?: vscode.WebviewView;
  private currentStep?: ScenarioStep;
  private scenarioView?: ScenarioView;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    logEntry('CallStackViewProvider.resolveWebviewView');
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'openFrame') {
        const frame = message.frame as CallStackFrame;
        log('debug', 'CallStackViewProvider: openFrame message received', {
          functionName: frame.functionName,
          filePath: frame.filePath,
          line: frame.line,
        });
        vscode.commands.executeCommand('codegraph.openCallStackFrame', frame);
      }
    });

    // Clear the stale reference when this webview is disposed so that
    // future showStep() calls skip the dead view and queue state for the
    // next resolveWebviewView.
    webviewView.onDidDispose(() => {
      log('debug', 'CallStackViewProvider: webview disposed');
      this.view = undefined;
    });

    // Re-render when the view becomes visible again (e.g. panel expanded,
    // sidebar tab switched back). The webview document may have been
    // deallocated while hidden, so we need to push the current state.
    webviewView.onDidChangeVisibility(() => {
      log('debug', 'CallStackViewProvider: visibility changed', { visible: webviewView.visible });
      if (webviewView.visible) {
        this.render();
      }
    });

    this.render();
    logExit('CallStackViewProvider.resolveWebviewView');
  }

  /**
   * Update the view with a new step's call stack.
   *
   * If the step has an explicit `callStack` (from the tracer), it is used
   * directly. Otherwise, a call stack is derived from the step history in
   * the scenario view by replaying `call` / `return` actions up to the
   * current step.
   *
   * @param step - The current scenario step
   * @param scenarioView - Optional full scenario view (needed for derivation)
   */
  showStep(step: ScenarioStep, scenarioView?: ScenarioView): void {
    logEntry('CallStackViewProvider.showStep', {
      stepNumber: step.stepNumber,
      functionName: step.functionName,
      callStackDepth: step.callStack?.length ?? 0,
      hasDerivedFallback: !step.callStack && !!scenarioView,
    });
    this.currentStep = step;
    this.scenarioView = scenarioView;
    this.render();
    logExit('CallStackViewProvider.showStep');
  }

  /**
   * Clear the view.
   */
  clear(): void {
    logEntry('CallStackViewProvider.clear');
    this.currentStep = undefined;
    this.scenarioView = undefined;
    this.render();
    logExit('CallStackViewProvider.clear');
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    if (!this.currentStep) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    try {
      // Use the explicit callStack if available; otherwise derive from step history
      let callStack = this.currentStep.callStack;
      if ((!callStack || callStack.length === 0) && this.scenarioView) {
        callStack = this.deriveCallStack(this.currentStep, this.scenarioView);
      }

      if (!callStack || callStack.length === 0) {
        this.view.webview.html = this.getEmptyHtml();
        return;
      }

      this.view.webview.html = this.getCallStackHtml(this.currentStep, callStack);
    } catch (err) {
      log('warn', 'CallStackViewProvider: render failed', {
        error: err instanceof Error ? err.message : String(err),
        stepNumber: this.currentStep.stepNumber,
      });
      this.view.webview.html = this.getEmptyHtml();
    }
  }

  /**
   * Derive a call stack from the step history when `step.callStack` is not
   * present (e.g. for manually-authored scenario JSON files).
   *
   * Replays all steps up to and including the current step. Each `call` or
   * `dispatch` action pushes a frame; each `return` action pops the top
   * frame. Steps with other actions (branch_taken, branch_skipped, assign)
   * update the top frame's line number in-place.
   *
   * The result approximates what the ScenarioTracer would have produced.
   */
  private deriveCallStack(
    currentStep: ScenarioStep,
    scenarioView: ScenarioView,
  ): CallStackFrame[] {
    const stack: CallStackFrame[] = [];

    for (const step of scenarioView.steps) {
      // Extract file path from functionId (format: "path/to/file.cc:lineNum")
      const filePath = step.functionId.includes(':')
        ? step.functionId.split(':').slice(0, -1).join(':')
        : step.functionId;

      switch (step.action) {
        case 'call':
        case 'dispatch': {
          // If the top frame is in the same function, update its line
          // instead of pushing a duplicate (e.g. sequential calls within
          // the same function body).
          const top = stack[stack.length - 1];
          if (top && top.functionName === step.functionName) {
            top.line = step.line;
          } else {
            stack.push({
              depth: stack.length,
              functionId: step.functionId,
              functionName: step.functionName,
              filePath,
              line: step.line,
              variables: this.variableStateToFrameVariables(step.variableState),
            });
          }
          break;
        }

        case 'return': {
          // Pop the frame that is returning — but only if the function
          // matches the top of the stack.
          const top = stack[stack.length - 1];
          if (top && top.functionName === step.functionName) {
            stack.pop();
          }
          break;
        }

        // branch_taken, branch_skipped, assign — stay in the same frame
        default: {
          const top = stack[stack.length - 1];
          if (top && top.functionName === step.functionName) {
            // Same function: update line and merge variables
            top.line = step.line;
            const newVars = this.variableStateToFrameVariables(step.variableState);
            for (const [name, fv] of Object.entries(newVars)) {
              top.variables[name] = fv;
            }
          } else if (top && top.functionName !== step.functionName) {
            // Different function without an explicit 'call' step — the
            // manually-authored scenario jumped to a new function implicitly.
            // Push a new frame so the call stack reflects the actual function.
            stack.push({
              depth: stack.length,
              functionId: step.functionId,
              functionName: step.functionName,
              filePath,
              line: step.line,
              variables: this.variableStateToFrameVariables(step.variableState),
            });
          }
          break;
        }
      }

      // Stop once we've processed the current step
      if (step.stepNumber === currentStep.stepNumber) {
        break;
      }
    }

    // If the stack is empty (e.g. the very first step isn't a 'call'),
    // add at least the current step's function as a frame.
    if (stack.length === 0) {
      const filePath = currentStep.functionId.includes(':')
        ? currentStep.functionId.split(':').slice(0, -1).join(':')
        : currentStep.functionId;
      stack.push({
        depth: 0,
        functionId: currentStep.functionId,
        functionName: currentStep.functionName,
        filePath,
        line: currentStep.line,
        variables: this.variableStateToFrameVariables(currentStep.variableState),
      });
    }

    return stack;
  }

  /**
   * Convert a step's `variableState` (Record<string, unknown>) into
   * `FrameVariable` records suitable for the call stack display.
   *
   * Since manually-authored steps don't have full FrameVariable metadata
   * (type, rationale, alternatives, confidence), we synthesize them from
   * the plain values.
   */
  private variableStateToFrameVariables(
    variableState: Record<string, unknown> | undefined | null,
  ): Record<string, FrameVariable> {
    const result: Record<string, FrameVariable> = {};
    if (!variableState) return result;
    for (const [name, value] of Object.entries(variableState)) {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      result[name] = {
        value: strValue,
        type: inferType(value),
        rationale: '', // not available for derived frames
        alternatives: [],
        confidence: 1.0,
      };
    }
    return result;
  }

  private getEmptyHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="empty">
    <p>No call stack</p>
    <p class="hint">Walk a traced scenario to see the call stack here.</p>
  </div>
</body>
</html>`;
  }

  private getCallStackHtml(step: ScenarioStep, callStack: CallStackFrame[]): string {
    const frames = callStack.slice().reverse(); // most recent first
    const totalFrames = frames.length;

    const framesHtml = frames
      .map((frame, idx) => this.renderFrame(frame, idx, totalFrames))
      .join('\n');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="header">
    <span class="header-label">Step ${step.stepNumber}</span>
    <span class="header-depth">${totalFrames} frame${totalFrames !== 1 ? 's' : ''}</span>
  </div>

  <div class="frames">
    ${framesHtml}
  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      // Click to navigate
      document.querySelectorAll('.frame-header').forEach(el => {
        el.addEventListener('click', (e) => {
          // Don't navigate if clicking the expand toggle
          if (e.target.closest('.frame-toggle')) return;
          const frameEl = el.closest('.frame');
          const frameData = frameEl?.getAttribute('data-frame');
          if (frameData) {
            try {
              const frame = JSON.parse(frameData);
              vscode.postMessage({ type: 'openFrame', frame });
            } catch (err) {
              console.error('Failed to parse frame data', err);
            }
          }
        });
      });

      // Toggle expand/collapse for frame details
      document.querySelectorAll('.frame-toggle').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const frameEl = el.closest('.frame');
          if (frameEl) {
            frameEl.classList.toggle('expanded');
          }
        });
      });
    })();
  </script>
</body>
</html>`;
  }

  private renderFrame(frame: CallStackFrame, idx: number, total: number): string {
    const isTopFrame = idx === 0;
    const frameClass = isTopFrame ? 'frame expanded frame-current' : 'frame';
    const fileName = frame.filePath.split('/').pop() ?? frame.filePath;
    const depthLabel = `#${total - idx - 1}`;
    const frameJson = escapeHtml(JSON.stringify(frame));

    // Build variables detail section
    const variableEntries = Object.entries(frame.variables ?? {});
    let detailHtml = '';

    if (variableEntries.length > 0) {
      const varsHtml = variableEntries
        .map(([name, fv]) => this.renderFrameVariable(name, fv))
        .join('\n');
      detailHtml = `
        <div class="frame-detail">
          <div class="detail-section">
            <div class="detail-heading">Variables</div>
            ${varsHtml}
          </div>
        </div>`;
    } else {
      detailHtml = `
        <div class="frame-detail">
          <div class="detail-empty">No variables in this frame</div>
        </div>`;
    }

    return `<div class="${frameClass}" data-frame="${frameJson}">
      <div class="frame-header" title="${escapeHtml(frame.filePath)}:${frame.line}">
        <span class="frame-toggle">${variableEntries.length > 0 ? '▶' : '·'}</span>
        <span class="frame-depth">${depthLabel}</span>
        <span class="frame-name">${escapeHtml(frame.functionName)}</span>
        <span class="frame-location">${escapeHtml(fileName)}:${frame.line}</span>
      </div>
      ${detailHtml}
    </div>`;
  }

  private renderFrameVariable(name: string, fv: FrameVariable): string {
    const confPct = (fv.confidence * 100).toFixed(0);
    const confClass =
      fv.confidence >= 0.8 ? 'conf-high' :
      fv.confidence >= 0.5 ? 'conf-mid' : 'conf-low';

    let alternativesHtml = '';
    if (fv.alternatives && fv.alternatives.length > 0) {
      const altList = fv.alternatives
        .map(a => `<span class="alt-value">${escapeHtml(a)}</span>`)
        .join('');
      alternativesHtml = `
        <div class="var-alts">
          <span class="var-alts-label">Also considered:</span>
          ${altList}
        </div>`;
    }

    return `<div class="var-row">
      <div class="var-header">
        <span class="var-name">${escapeHtml(name)}</span>
        <span class="var-type">${escapeHtml(fv.type)}</span>
        <span class="var-value">${escapeHtml(fv.value)}</span>
        <span class="var-conf ${confClass}">${confPct}%</span>
      </div>
      <div class="var-rationale">${escapeHtml(fv.rationale)}</div>
      ${alternativesHtml}
    </div>`;
  }

  private getBaseStyles(): string {
    return /* css */ `
      :root {
        --font: var(--vscode-font-family, system-ui, sans-serif);
        --mono: var(--vscode-editor-font-family, monospace);
        --fg: var(--vscode-foreground);
        --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
        --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
        --muted: var(--vscode-descriptionForeground);
        --link: var(--vscode-textLink-foreground);
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --green: var(--vscode-charts-green, #4caf50);
        --yellow: var(--vscode-charts-yellow, #ff9800);
        --red: var(--vscode-charts-red, #f44336);
        --blue: var(--vscode-charts-blue, #2196f3);
        --hover-bg: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
        --active-bg: var(--vscode-list-activeSelectionBackground, rgba(0,120,215,0.15));
        --detail-bg: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: var(--font);
        font-size: 13px;
        color: var(--fg);
        background: var(--bg);
        padding: 8px 0;
        line-height: 1.5;
      }

      .empty {
        text-align: center;
        padding: 24px 16px;
        color: var(--muted);
      }
      .empty p { margin: 4px 0; }
      .empty .hint { font-size: 11px; opacity: 0.7; }

      /* Header */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px 8px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 4px;
      }

      .header-label {
        font-weight: 600;
        font-size: 12px;
      }

      .header-depth {
        font-size: 11px;
        color: var(--muted);
      }

      /* Frames */
      .frames {
        display: flex;
        flex-direction: column;
      }

      .frame {
        border-left: 3px solid transparent;
      }

      .frame-current {
        border-left-color: var(--blue);
      }

      .frame-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 14px 5px 11px;
        cursor: pointer;
        transition: background 0.1s;
        min-height: 26px;
      }

      .frame-header:hover {
        background: var(--hover-bg);
      }

      .frame-current > .frame-header {
        background: var(--active-bg);
        font-weight: 600;
      }

      .frame-toggle {
        flex-shrink: 0;
        width: 14px;
        font-size: 9px;
        color: var(--muted);
        cursor: pointer;
        text-align: center;
        transition: transform 0.15s;
        user-select: none;
      }

      .frame.expanded .frame-toggle {
        transform: rotate(90deg);
      }

      .frame-depth {
        flex-shrink: 0;
        font-size: 10px;
        font-family: var(--mono);
        color: var(--muted);
        min-width: 22px;
      }

      .frame-name {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--link);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .frame-location {
        font-size: 11px;
        color: var(--muted);
        white-space: nowrap;
        margin-left: auto;
        flex-shrink: 0;
      }

      /* Frame detail (expanded) */
      .frame-detail {
        display: none;
        padding: 6px 14px 10px 37px;
        border-top: 1px solid var(--border);
        background: var(--detail-bg);
      }

      .frame.expanded .frame-detail {
        display: block;
      }

      .detail-heading {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
        margin-bottom: 6px;
        font-weight: 600;
      }

      .detail-empty {
        font-size: 11px;
        color: var(--muted);
        font-style: italic;
        padding: 4px 0;
      }

      /* Variable rows */
      .var-row {
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border);
      }

      .var-row:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }

      .var-header {
        display: flex;
        align-items: baseline;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 3px;
      }

      .var-name {
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--link);
      }

      .var-type {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        background: rgba(128,128,128,0.12);
        padding: 0 4px;
        border-radius: 3px;
      }

      .var-value {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--fg);
        margin-left: auto;
      }

      .var-conf {
        font-size: 10px;
        padding: 0 5px;
        border-radius: 8px;
        font-weight: 500;
      }

      .conf-high { background: var(--green); color: #fff; }
      .conf-mid { background: var(--yellow); color: #000; }
      .conf-low { background: var(--red); color: #fff; }

      .var-rationale {
        font-size: 11px;
        color: var(--muted);
        line-height: 1.5;
        padding-left: 2px;
      }

      .var-alts {
        margin-top: 4px;
        padding-left: 2px;
        display: flex;
        align-items: baseline;
        gap: 4px;
        flex-wrap: wrap;
      }

      .var-alts-label {
        font-size: 10px;
        color: var(--muted);
        font-style: italic;
      }

      .alt-value {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--muted);
        background: rgba(128,128,128,0.1);
        padding: 0 4px;
        border-radius: 3px;
      }
    `;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Infer a rough type label from a runtime value.
 * Used when deriving call stack frames from step variableState,
 * which stores plain unknown values rather than typed FrameVariables.
 */
function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    // Heuristic: if the string looks like a type annotation (e.g.
    // "<ScriptState* — current JS execution context>"), report it as-is
    if (value.startsWith('<') && value.endsWith('>')) return value;
    return 'string';
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}
