/**
 * Code Walk Cells Webview — renders a code walk as notebook-style cells
 * in a dedicated sidebar panel.
 *
 * Each cell shows:
 * - The code slice with highlighted lines
 * - AI narrative/explanation
 * - Variable state (changed, created, read)
 * - Call stack at that point
 *
 * Navigation is cell-wise: ▲/▼ moves between cells, and the editor
 * opens the corresponding file with the cell's lines highlighted.
 *
 * @module providers/codewalk-cells-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from '../logger.js';
import type { CodeWalk, WalkCell } from '@codegraph/core';

/**
 * Webview provider for the Code Walk Cells panel.
 */
export class CodeWalkCellsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codegraph.codeWalkCells';

  private view?: vscode.WebviewView;
  private currentWalk?: CodeWalk;
  private currentCellIndex = 0;

  /** Event fired when the current cell changes (for syncing editor highlights). */
  private _onCellChanged = new vscode.EventEmitter<{ walk: CodeWalk; cell: WalkCell; index: number } | undefined>();
  readonly onCellChanged = this._onCellChanged.event;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    logEntry('CodeWalkCellsViewProvider.resolveWebviewView');
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'navigateToCell':
          this.goToCell(message.index);
          break;
        case 'nextCell':
          this.nextCell();
          break;
        case 'prevCell':
          this.prevCell();
          break;
        case 'openFrame': {
          const filePath = message.filePath as string;
          const line = message.line as number;
          if (filePath && line) {
            log('debug', 'CodeWalkCellsViewProvider: openFrame', { filePath, line });
            vscode.commands.executeCommand('codegraph.openCallStackFrame', {
              functionName: message.functionName ?? '',
              filePath,
              line,
            });
          }
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.render();
      }
    });

    this.render();
    logExit('CodeWalkCellsViewProvider.resolveWebviewView');
  }

  /**
   * Load a code walk into the cells view.
   */
  loadWalk(walk: CodeWalk): void {
    logEntry('CodeWalkCellsViewProvider.loadWalk', { walkId: walk.id, cellCount: walk.cells.length });
    this.currentWalk = walk;
    this.currentCellIndex = 0;
    this.render();
    this.fireCellChanged();
    logExit('CodeWalkCellsViewProvider.loadWalk');
  }

  /**
   * Get the currently loaded walk.
   */
  getWalk(): CodeWalk | undefined {
    return this.currentWalk;
  }

  /**
   * Get the current cell.
   */
  getCurrentCell(): WalkCell | undefined {
    if (!this.currentWalk) return undefined;
    return this.currentWalk.cells[this.currentCellIndex];
  }

  /**
   * Get the current cell index.
   */
  getCurrentCellIndex(): number {
    return this.currentCellIndex;
  }

  /**
   * Navigate to the next cell.
   */
  nextCell(): void {
    if (!this.currentWalk) return;
    if (this.currentCellIndex < this.currentWalk.cells.length - 1) {
      this.currentCellIndex++;
      this.render();
      this.fireCellChanged();
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the last cell.');
    }
  }

  /**
   * Navigate to the previous cell.
   */
  prevCell(): void {
    if (!this.currentWalk) return;
    if (this.currentCellIndex > 0) {
      this.currentCellIndex--;
      this.render();
      this.fireCellChanged();
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the first cell.');
    }
  }

  /**
   * Jump to a specific cell by index.
   */
  goToCell(index: number): void {
    if (!this.currentWalk) return;
    if (index >= 0 && index < this.currentWalk.cells.length) {
      this.currentCellIndex = index;
      this.render();
      this.fireCellChanged();
    }
  }

  /**
   * Clear the view.
   */
  clear(): void {
    this.currentWalk = undefined;
    this.currentCellIndex = 0;
    this.render();
    this._onCellChanged.fire(undefined);
  }

  private fireCellChanged(): void {
    if (this.currentWalk) {
      const cell = this.currentWalk.cells[this.currentCellIndex];
      if (cell) {
        this._onCellChanged.fire({ walk: this.currentWalk, cell, index: this.currentCellIndex });
      }
    }
  }

  private render(): void {
    if (!this.view) return;

    if (!this.currentWalk || this.currentWalk.cells.length === 0) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    this.view.webview.html = this.getWalkHtml(this.currentWalk, this.currentCellIndex);
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
    <p>No code walk loaded</p>
    <p class="hint">Right-click a scenario and select "Open Code Walk" to get started.</p>
  </div>
</body>
</html>`;
  }

  private getWalkHtml(walk: CodeWalk, activeIndex: number): string {
    const cell = walk.cells[activeIndex];
    if (!cell) return this.getEmptyHtml();

    const totalCells = walk.cells.length;

    // Build narrative
    const narrativeHtml = cell.narrative
      ? `<section class="section">
          <h3>Explanation</h3>
          <div class="narrative">${escapeHtml(cell.narrative)}</div>
        </section>`
      : '';

    // Build variables
    const variablesHtml = this.renderVariables(cell);

    // Build call stack
    const callStackHtml = this.renderCallStack(cell);

    // Build cell list (mini nav)
    const cellListHtml = this.renderCellList(walk, activeIndex);

    // Cell type badge
    const typeLabel = this.formatCellType(cell.type);
    const typeClass = `type-${cell.type}`;

    // Status badge
    const statusClass = `status-${cell.status}`;

    // Confidence
    const confPct = cell.confidence !== undefined ? (cell.confidence * 100).toFixed(0) + '%' : '';
    const confClass = cell.confidence !== undefined
      ? (cell.confidence >= 0.8 ? 'conf-high' : cell.confidence >= 0.5 ? 'conf-mid' : 'conf-low')
      : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="walk-header">
    <div class="walk-name">${escapeHtml(walk.name)}</div>
    <div class="cell-nav">
      <button class="nav-btn" id="prevBtn" ${activeIndex === 0 ? 'disabled' : ''}>▲ Prev</button>
      <span class="cell-counter">${activeIndex + 1} / ${totalCells}</span>
      <button class="nav-btn" id="nextBtn" ${activeIndex === totalCells - 1 ? 'disabled' : ''}>▼ Next</button>
    </div>
  </div>

  <div class="cell-header">
    <span class="badge ${typeClass}">${typeLabel}</span>
    <span class="badge ${statusClass}">${cell.status}</span>
    ${confPct ? `<span class="badge ${confClass}">${confPct}</span>` : ''}
    <span class="cell-depth">Depth: ${cell.stackDepth}</span>
  </div>

  <div class="file-ref">${escapeHtml(cell.code.filePath)}:${cell.code.startLine}-${cell.code.endLine}</div>

  ${narrativeHtml}
  ${variablesHtml}
  ${callStackHtml}

  <section class="section">
    <h3>Cells</h3>
    <div class="cell-list">${cellListHtml}</div>
  </section>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();

      document.getElementById('prevBtn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'prevCell' });
      });

      document.getElementById('nextBtn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'nextCell' });
      });

      document.querySelectorAll('.cell-item').forEach(el => {
        el.addEventListener('click', () => {
          const index = parseInt(el.getAttribute('data-index') || '0', 10);
          vscode.postMessage({ type: 'navigateToCell', index });
        });
      });

      document.querySelectorAll('.stack-frame-clickable').forEach(el => {
        el.addEventListener('click', () => {
          const filePath = el.getAttribute('data-filepath');
          const line = parseInt(el.getAttribute('data-line') || '0', 10);
          const functionName = el.getAttribute('data-funcname') || '';
          if (filePath && line) {
            vscode.postMessage({ type: 'openFrame', filePath, line, functionName });
          }
        });
      });
    })();
  </script>
</body>
</html>`;
  }

  private renderCodeSlice(cell: WalkCell): string {
    const lines = cell.code.text.split('\n');
    const highlights = new Map<number, { type: string; annotation?: string }>();
    if (cell.code.highlights) {
      for (const h of cell.code.highlights) {
        highlights.set(h.line, { type: h.type, annotation: h.annotation });
      }
    }

    return lines.map((line, idx) => {
      const lineNum = cell.code.startLine + idx;
      const highlight = highlights.get(lineNum);
      const hlClass = highlight ? `hl-${highlight.type}` : '';
      const annotation = highlight?.annotation
        ? `<span class="line-annotation">${escapeHtml(highlight.annotation)}</span>`
        : '';
      return `<div class="code-line ${hlClass}"><span class="line-num">${lineNum}</span><span class="line-code">${escapeHtml(line)}</span>${annotation}</div>`;
    }).join('\n');
  }

  private renderVariables(cell: WalkCell): string {
    if (!cell.state || !cell.state.scopes || cell.state.scopes.length === 0) return '';

    const scopeHtmls = cell.state.scopes.map(scope => {
      const varRows = Object.entries(scope.variables).map(([name, v]) => {
        const actionIcon = v.action === 'created' ? '🆕'
          : v.action === 'modified' ? '✏️'
          : v.action === 'read' ? '👁'
          : '';
        const changedClass = v.changed ? 'var-changed' : '';
        return `<div class="var-row ${changedClass}">
          <span class="var-action">${actionIcon}</span>
          <span class="var-name">${escapeHtml(name)}</span>
          ${v.type ? `<span class="var-type">${escapeHtml(v.type)}</span>` : ''}
          <span class="var-value">${escapeHtml(v.value)}</span>
        </div>`;
      }).join('\n');

      return `<div class="scope-group">
        <div class="scope-name">${escapeHtml(scope.name)}</div>
        ${varRows}
      </div>`;
    }).join('\n');

    // Changes summary
    let changesHtml = '';
    if (cell.state.changes && cell.state.changes.length > 0) {
      changesHtml = `<div class="changes-summary">
        <div class="changes-label">Changes:</div>
        ${cell.state.changes.map(c => `<div class="change-item">${escapeHtml(c)}</div>`).join('\n')}
      </div>`;
    }

    return `<section class="section">
      <h3>Variables</h3>
      ${scopeHtmls}
      ${changesHtml}
    </section>`;
  }

  private renderCallStack(cell: WalkCell): string {
    if (!cell.callStack || cell.callStack.length === 0) return '';

    const frames = cell.callStack.slice().reverse(); // most recent first
    const framesHtml = frames.map((frame, idx) => {
      const isTop = idx === 0;
      const fileName = frame.filePath.split('/').pop() ?? frame.filePath;
      return `<div class="stack-frame stack-frame-clickable ${isTop ? 'stack-frame-current' : ''}" data-filepath="${escapeHtml(frame.filePath)}" data-line="${frame.line}" data-funcname="${escapeHtml(frame.functionName)}">
        <span class="stack-depth">#${frame.depth}</span>
        <span class="stack-name">${escapeHtml(frame.functionName)}</span>
        <span class="stack-loc">${escapeHtml(fileName)}:${frame.line}</span>
      </div>`;
    }).join('\n');

    return `<section class="section">
      <h3>Call Stack</h3>
      <div class="stack-frames">${framesHtml}</div>
    </section>`;
  }

  private renderCellList(walk: CodeWalk, activeIndex: number): string {
    return walk.cells.map((cell, idx) => {
      const isActive = idx === activeIndex;
      const indent = '  '.repeat(cell.stackDepth);
      const typeIcon = this.getCellTypeIcon(cell.type);
      return `<div class="cell-item ${isActive ? 'cell-active' : ''}" data-index="${idx}">
        <span class="cell-indent">${indent}</span>
        <span class="cell-icon">${typeIcon}</span>
        <span class="cell-label">${escapeHtml(this.getCellLabel(cell))}</span>
        <span class="cell-status-dot status-dot-${cell.status}"></span>
      </div>`;
    }).join('\n');
  }

  private getCellLabel(cell: WalkCell): string {
    const func = cell.callStack?.[cell.callStack.length - 1]?.functionName ?? '';
    const shortFunc = func.split('::').pop() ?? func;
    switch (cell.type) {
      case 'entry': return shortFunc || 'Entry';
      case 'call': return `→ ${shortFunc}`;
      case 'branch': return `? Branch`;
      case 'assignment': return `= Assign`;
      case 'return': return `← Return`;
      case 'dispatch': return `⟿ Dispatch`;
      case 'block': return `▪ Block`;
      case 'note': return `✎ Note`;
      default: return cell.type;
    }
  }

  private getCellTypeIcon(type: string): string {
    switch (type) {
      case 'entry': return '▶';
      case 'call': return '→';
      case 'branch': return '?';
      case 'assignment': return '=';
      case 'return': return '←';
      case 'dispatch': return '⟿';
      case 'block': return '▪';
      case 'note': return '✎';
      default: return '·';
    }
  }

  private formatCellType(type: string): string {
    switch (type) {
      case 'entry': return 'Entry';
      case 'call': return 'Call';
      case 'branch': return 'Branch';
      case 'assignment': return 'Assignment';
      case 'return': return 'Return';
      case 'dispatch': return 'Dispatch';
      case 'block': return 'Block';
      case 'note': return 'Note';
      default: return type;
    }
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
        --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
        --narrative-bg: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
        --narrative-border: var(--vscode-textBlockQuote-border, var(--blue));
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: var(--font);
        font-size: 13px;
        color: var(--fg);
        background: var(--bg);
        padding: 8px 10px;
        line-height: 1.5;
      }

      .empty {
        text-align: center;
        padding: 32px 16px;
        color: var(--muted);
      }
      .empty p { margin: 4px 0; }
      .empty .hint { font-size: 11px; opacity: 0.7; }

      /* Walk header */
      .walk-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
        flex-wrap: wrap;
        gap: 6px;
      }

      .walk-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--link);
      }

      .cell-nav {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .nav-btn {
        background: var(--badge-bg);
        color: var(--badge-fg);
        border: none;
        padding: 3px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-family: var(--font);
      }
      .nav-btn:hover:not(:disabled) { opacity: 0.85; }
      .nav-btn:disabled { opacity: 0.4; cursor: default; }

      .cell-counter {
        font-size: 12px;
        font-weight: 600;
        min-width: 50px;
        text-align: center;
      }

      /* Cell header */
      .cell-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .badge {
        display: inline-block;
        font-size: 10px;
        padding: 1px 7px;
        border-radius: 10px;
        background: var(--badge-bg);
        color: var(--badge-fg);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .type-entry { background: var(--blue); color: #fff; }
      .type-call { background: #2196f3; color: #fff; }
      .type-branch { background: #ff9800; color: #fff; }
      .type-assignment { background: #795548; color: #fff; }
      .type-return { background: #607d8b; color: #fff; }
      .type-dispatch { background: #9c27b0; color: #fff; }
      .type-block { background: #455a64; color: #fff; }
      .type-note { background: #78909c; color: #fff; }

      .status-skeleton { background: var(--muted); color: #fff; }
      .status-partial { background: var(--yellow); color: #000; }
      .status-complete { background: var(--green); color: #fff; }
      .status-corrected { background: #e91e63; color: #fff; }

      .conf-high { background: var(--green); color: #fff; }
      .conf-mid { background: var(--yellow); color: #000; }
      .conf-low { background: var(--red); color: #fff; }

      .cell-depth {
        font-size: 10px;
        color: var(--muted);
        margin-left: auto;
      }

      .file-ref {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        margin-bottom: 10px;
      }

      /* Sections */
      .section { margin-bottom: 14px; }
      .section h3 {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted);
        margin-bottom: 6px;
        border-bottom: 1px solid var(--border);
        padding-bottom: 3px;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .file-path {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        font-weight: 400;
      }

      /* Code block */
      .code-block {
        background: var(--code-bg);
        border-radius: 4px;
        padding: 6px 0;
        overflow-x: auto;
        font-family: var(--mono);
        font-size: 12px;
        line-height: 1.6;
      }

      .code-line {
        display: flex;
        align-items: baseline;
        padding: 0 10px;
        min-height: 20px;
      }

      .code-line.hl-executed { background: rgba(33, 150, 243, 0.12); border-left: 3px solid var(--blue); }
      .code-line.hl-branched { background: rgba(255, 152, 0, 0.12); border-left: 3px solid var(--yellow); }
      .code-line.hl-assigned { background: rgba(121, 85, 72, 0.15); border-left: 3px solid #795548; }
      .code-line.hl-called { background: rgba(33, 150, 243, 0.18); border-left: 3px solid #42a5f5; }
      .code-line.hl-returned { background: rgba(96, 125, 139, 0.12); border-left: 3px solid #607d8b; }
      .code-line.hl-skipped { background: rgba(244, 67, 54, 0.08); border-left: 3px solid var(--red); opacity: 0.6; }

      .line-num {
        color: var(--muted);
        min-width: 36px;
        text-align: right;
        margin-right: 12px;
        user-select: none;
        flex-shrink: 0;
        font-size: 10px;
      }

      .line-code {
        white-space: pre;
        flex: 1;
      }

      .line-annotation {
        font-size: 10px;
        color: var(--muted);
        margin-left: 16px;
        font-style: italic;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* Narrative */
      .narrative {
        background: var(--narrative-bg);
        border-left: 3px solid var(--narrative-border);
        padding: 10px 12px;
        border-radius: 0 4px 4px 0;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      /* Variables */
      .scope-group { margin-bottom: 8px; }
      .scope-name {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        color: var(--muted);
        margin-bottom: 3px;
        font-weight: 600;
      }

      .var-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 2px 6px;
        font-family: var(--mono);
        font-size: 11px;
        border-radius: 3px;
        flex-wrap: wrap;
      }

      .var-row.var-changed {
        background: rgba(255, 152, 0, 0.1);
        border-left: 2px solid var(--yellow);
      }

      .var-action { font-size: 10px; width: 16px; flex-shrink: 0; }
      .var-name { color: var(--link); font-weight: 600; flex-shrink: 0; }
      .var-type {
        font-size: 9px;
        color: var(--muted);
        background: rgba(128,128,128,0.12);
        padding: 0 4px;
        border-radius: 3px;
      }
      .var-value {
        color: var(--fg);
        word-break: break-all;
        flex: 1;
        min-width: 0;
      }

      .changes-summary {
        margin-top: 6px;
        padding: 6px 8px;
        background: rgba(255, 152, 0, 0.06);
        border-radius: 4px;
        border: 1px solid rgba(255, 152, 0, 0.2);
      }
      .changes-label {
        font-size: 10px;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 3px;
        font-weight: 600;
      }
      .change-item {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--fg);
        padding: 1px 0;
      }

      /* Call stack */
      .stack-frames {
        display: flex;
        flex-direction: column;
      }

      .stack-frame {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        font-size: 11px;
        border-left: 3px solid transparent;
      }

      .stack-frame-current {
        border-left-color: var(--blue);
        background: var(--active-bg);
        font-weight: 600;
      }

      .stack-frame-clickable {
        cursor: pointer;
        transition: background 0.1s;
      }

      .stack-frame-clickable:hover {
        background: var(--hover-bg);
      }

      .stack-depth {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        min-width: 18px;
      }

      .stack-name {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--link);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stack-loc {
        font-size: 10px;
        color: var(--muted);
        margin-left: auto;
        white-space: nowrap;
      }

      /* Cell list / mini nav */
      .cell-list {
        max-height: 200px;
        overflow-y: auto;
      }

      .cell-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        cursor: pointer;
        font-size: 11px;
        border-radius: 3px;
        transition: background 0.1s;
      }

      .cell-item:hover { background: var(--hover-bg); }
      .cell-item.cell-active {
        background: var(--active-bg);
        font-weight: 600;
      }

      .cell-indent {
        white-space: pre;
        font-family: var(--mono);
        color: var(--border);
      }

      .cell-icon {
        width: 14px;
        text-align: center;
        font-size: 10px;
        color: var(--muted);
      }

      .cell-label {
        font-family: var(--mono);
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cell-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-left: auto;
        flex-shrink: 0;
      }

      .status-dot-skeleton { background: var(--muted); }
      .status-dot-partial { background: var(--yellow); }
      .status-dot-complete { background: var(--green); }
      .status-dot-corrected { background: #e91e63; }
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
