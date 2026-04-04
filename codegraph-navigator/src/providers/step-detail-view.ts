/**
 * Step Detail Webview — renders the current scenario step's AI explanation,
 * variable state, source code, and metadata in a rich HTML sidebar panel.
 *
 * The tree-based Step Walker truncates long text. This webview gives the
 * user a full, readable view of the AI-generated justification, imagined
 * variable values, and correction notes for the current step.
 *
 * @module providers/step-detail-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from '../logger.js';
import type { ScenarioStep, ScenarioView } from '@codegraph/core';

/**
 * Webview provider that renders full step detail in the sidebar.
 */
export class StepDetailViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codegraph.stepDetail';

  private view?: vscode.WebviewView;
  private currentStep?: ScenarioStep;
  private scenarioView?: ScenarioView;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    logEntry('StepDetailViewProvider.resolveWebviewView');
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: false,
    };

    this.render();
    logExit('StepDetailViewProvider.resolveWebviewView');
  }

  /**
   * Update the view with a new step.
   */
  showStep(step: ScenarioStep, scenarioView?: ScenarioView): void {
    logEntry('StepDetailViewProvider.showStep', {
      stepNumber: step.stepNumber,
      functionName: step.functionName,
    });
    this.currentStep = step;
    this.scenarioView = scenarioView;
    this.render();
    logExit('StepDetailViewProvider.showStep');
  }

  /**
   * Clear the view.
   */
  clear(): void {
    logEntry('StepDetailViewProvider.clear');
    this.currentStep = undefined;
    this.scenarioView = undefined;
    this.render();
    logExit('StepDetailViewProvider.clear');
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    if (!this.currentStep) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    this.view.webview.html = this.getStepHtml(
      this.currentStep,
      this.scenarioView,
    );
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
    <span class="empty-icon">$(book)</span>
    <p>No step selected</p>
    <p class="hint">Walk a scenario to see AI explanations here.</p>
  </div>
</body>
</html>`;
  }

  private getStepHtml(step: ScenarioStep, scenarioView?: ScenarioView): string {
    const totalSteps = scenarioView?.steps.length ?? '?';
    const scenarioName = scenarioView?.scenario.name ?? '';
    const confPct = (step.confidence * 100).toFixed(0);
    const confClass =
      step.confidence >= 0.8
        ? 'confidence-high'
        : step.confidence >= 0.5
          ? 'confidence-mid'
          : 'confidence-low';

    const actionLabel = this.formatAction(step.action);
    const actionClass = `action-${step.action.replace('_', '-')}`;

    // Build variable state HTML
    let variablesHtml = '';
    const vars = step.variableState;
    if (vars && Object.keys(vars).length > 0) {
      const rows = Object.entries(vars)
        .map(
          ([name, value]) =>
            `<tr><td class="var-name">${escapeHtml(name)}</td><td class="var-value">${escapeHtml(formatValue(value))}</td></tr>`,
        )
        .join('\n');
      variablesHtml = `
      <section class="section">
        <h3>Variables</h3>
        <table class="var-table">
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    }

    // Build source code HTML
    let sourceHtml = '';
    if (step.sourceCode) {
      sourceHtml = `
      <section class="section">
        <h3>Source Code</h3>
        <pre class="source-code"><code>${escapeHtml(step.sourceCode)}</code></pre>
      </section>`;
    }

    // Build correction HTML
    let correctionHtml = '';
    if (step.correctedBy) {
      correctionHtml = `
      <section class="section correction-section">
        <h3>Correction</h3>
        <p class="correction-by">Corrected by: <strong>${escapeHtml(step.correctedBy)}</strong></p>
        ${step.correctionNote ? `<p class="correction-note">${escapeHtml(step.correctionNote)}</p>` : ''}
      </section>`;
    }

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  ${scenarioName ? `<div class="scenario-name">${escapeHtml(scenarioName)}</div>` : ''}

  <div class="step-header">
    <span class="step-badge">Step ${step.stepNumber} / ${totalSteps}</span>
    <span class="badge ${actionClass}">${actionLabel}</span>
    <span class="badge ${confClass}">${confPct}%</span>
  </div>

  <div class="function-name">${escapeHtml(step.functionName)}</div>
  <div class="line-info">Line ${step.line}</div>

  <section class="section explanation-section">
    <h3>AI Explanation</h3>
    <div class="explanation">${escapeHtml(step.justification)}</div>
  </section>

  ${sourceHtml}
  ${variablesHtml}
  ${correctionHtml}
</body>
</html>`;
  }

  private formatAction(
    action: 'call' | 'branch_taken' | 'branch_skipped' | 'dispatch' | 'return' | 'assign',
  ): string {
    switch (action) {
      case 'call':
        return 'Call';
      case 'branch_taken':
        return 'Branch Taken';
      case 'branch_skipped':
        return 'Branch Skipped';
      case 'dispatch':
        return 'Dispatch';
      case 'return':
        return 'Return';
      case 'assign':
        return 'Assign';
      default:
        return String(action);
    }
  }

  private getBaseStyles(): string {
    return /* css */ `
      :root {
        --font: var(--vscode-font-family, system-ui, sans-serif);
        --fg: var(--vscode-foreground);
        --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
        --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.35)));
        --muted: var(--vscode-descriptionForeground);
        --link: var(--vscode-textLink-foreground);
        --badge-bg: var(--vscode-badge-background);
        --badge-fg: var(--vscode-badge-foreground);
        --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
        --green: var(--vscode-charts-green, #4caf50);
        --yellow: var(--vscode-charts-yellow, #ff9800);
        --red: var(--vscode-charts-red, #f44336);
        --blue: var(--vscode-charts-blue, #2196f3);
        --explanation-bg: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
        --explanation-border: var(--vscode-textBlockQuote-border, var(--blue));
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: var(--font);
        font-size: 13px;
        color: var(--fg);
        background: var(--bg);
        padding: 12px 14px;
        line-height: 1.5;
      }

      .empty {
        text-align: center;
        padding: 32px 16px;
        color: var(--muted);
      }
      .empty p { margin: 4px 0; }
      .empty .hint { font-size: 11px; opacity: 0.7; }

      .scenario-name {
        font-size: 11px;
        color: var(--muted);
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .step-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }

      .step-badge {
        font-weight: 600;
        font-size: 13px;
      }

      .badge {
        display: inline-block;
        font-size: 11px;
        padding: 1px 7px;
        border-radius: 10px;
        background: var(--badge-bg);
        color: var(--badge-fg);
        font-weight: 500;
      }

      .action-call { background: var(--blue); color: #fff; }
      .action-branch-taken { background: var(--green); color: #fff; }
      .action-branch-skipped { background: var(--red); color: #fff; }
      .action-dispatch { background: #9c27b0; color: #fff; }
      .action-return { background: #607d8b; color: #fff; }
      .action-assign { background: #795548; color: #fff; }

      .confidence-high { background: var(--green); color: #fff; }
      .confidence-mid { background: var(--yellow); color: #000; }
      .confidence-low { background: var(--red); color: #fff; }

      .function-name {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 14px;
        font-weight: 600;
        color: var(--link);
        margin-bottom: 2px;
        word-break: break-all;
      }

      .line-info {
        font-size: 11px;
        color: var(--muted);
        margin-bottom: 12px;
      }

      .section {
        margin-bottom: 14px;
      }

      .section h3 {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
        margin-bottom: 6px;
        border-bottom: 1px solid var(--border);
        padding-bottom: 3px;
      }

      .explanation-section {
        margin-bottom: 16px;
      }

      .explanation {
        background: var(--explanation-bg);
        border-left: 3px solid var(--explanation-border);
        padding: 10px 12px;
        border-radius: 0 4px 4px 0;
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .source-code {
        background: var(--code-bg);
        padding: 8px 10px;
        border-radius: 4px;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        line-height: 1.4;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .var-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .var-table tr {
        border-bottom: 1px solid var(--border);
      }

      .var-table td {
        padding: 3px 6px;
        vertical-align: top;
      }

      .var-name {
        font-family: var(--vscode-editor-font-family, monospace);
        color: var(--link);
        white-space: nowrap;
        font-weight: 500;
        width: 1%;
      }

      .var-value {
        font-family: var(--vscode-editor-font-family, monospace);
        word-break: break-all;
      }

      .correction-section {
        background: rgba(255, 152, 0, 0.08);
        border: 1px solid rgba(255, 152, 0, 0.3);
        border-radius: 4px;
        padding: 8px 10px;
      }

      .correction-section h3 {
        border-bottom: none;
        margin-bottom: 4px;
      }

      .correction-by {
        font-size: 12px;
        margin-bottom: 4px;
      }

      .correction-note {
        font-size: 12px;
        font-style: italic;
        color: var(--muted);
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

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
