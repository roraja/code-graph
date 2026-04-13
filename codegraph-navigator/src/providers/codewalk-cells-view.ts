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
 * Navigation supports branching: when a cell has multiple `nextCellIds`,
 * the viewer presents the user with a choice of which path to explore.
 * A navigation history stack enables correct "Prev" behavior regardless
 * of which branches were taken.
 *
 * @module providers/codewalk-cells-view
 */

import * as vscode from 'vscode';
import { log, logEntry, logExit } from '../logger.js';
import type { CodeWalk, WalkCell, CellStep, BranchOption } from '@codegraph/core';

/**
 * Webview provider for the Code Walk Cells panel.
 */
export class CodeWalkCellsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codegraph.codeWalkCells';

  private view?: vscode.WebviewView;
  private currentWalk?: CodeWalk;
  private currentCellIndex = 0;
  private currentStepIndex = -1; // -1 = no steps / show all

  /**
   * Navigation history — a stack of cell indices the user has visited.
   * When the user navigates forward (including choosing a branch), the
   * current index is pushed. "Prev" pops from this stack, so it always
   * retraces the exact path the user took, regardless of branching.
   */
  private navigationHistory: number[] = [];

  /** Map from cell ID → index in walk.cells for O(1) lookup */
  private cellIdToIndex = new Map<string, number>();

  /** Event fired when the current cell changes (for syncing editor highlights). */
  private _onCellChanged = new vscode.EventEmitter<{ walk: CodeWalk; cell: WalkCell; index: number; stepIndex: number; step?: CellStep } | undefined>();
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
        case 'nextStep':
          this.nextStep();
          break;
        case 'prevStep':
          this.prevStep();
          break;
        case 'goToStep':
          this.goToStepIndex(message.stepIndex);
          break;
        case 'selectBranch':
          this.selectBranch(message.branchIndex);
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
    this.navigationHistory = [];
    const firstCell = walk.cells[0];
    this.currentStepIndex = (firstCell?.steps && firstCell.steps.length > 0) ? 0 : -1;
    this.rebuildCellIdMap();
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
   * Navigate to the next cell (or next sub-step within the current cell).
   *
   * If the current cell has multiple `nextCellIds` (a branch point), this
   * triggers the branch selection UI instead of advancing automatically.
   * If it has exactly one `nextCellId`, it follows that link.
   * If it has no `nextCellIds`, it falls through to the next cell by index.
   */
  nextCell(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    // If cell has sub-steps and we haven't finished them, advance step
    if (cell?.steps && cell.steps.length > 0 && this.currentStepIndex < cell.steps.length - 1) {
      this.currentStepIndex++;
      this.render();
      this.fireCellChanged();
      return;
    }

    // Check for branching via nextCellIds
    if (cell?.nextCellIds && cell.nextCellIds.length > 1) {
      // Multiple next cells — show branch selection UI (already rendered, but
      // if user pressed "Next" button we show an info message directing them to choose)
      vscode.window.showInformationMessage(
        'CodeGraph: This is a branch point. Choose a path from the options below.'
      );
      return;
    }

    // Single explicit next cell
    if (cell?.nextCellIds && cell.nextCellIds.length === 1) {
      const nextId = cell.nextCellIds[0];
      const nextIdx = this.cellIdToIndex.get(nextId);
      if (nextIdx !== undefined) {
        this.navigateForward(nextIdx);
        return;
      }
    }

    // Default: linear navigation
    if (this.currentCellIndex < this.currentWalk.cells.length - 1) {
      this.navigateForward(this.currentCellIndex + 1);
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the last cell.');
    }
  }

  /**
   * Navigate to the previous cell (or previous sub-step within the current cell).
   * Uses the navigation history stack to retrace the user's exact path.
   */
  prevCell(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    // If cell has sub-steps and we're not on the first, go back a step
    if (cell?.steps && cell.steps.length > 0 && this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.render();
      this.fireCellChanged();
      return;
    }

    // Use navigation history to go back
    if (this.navigationHistory.length > 0) {
      const prevIdx = this.navigationHistory.pop()!;
      this.currentCellIndex = prevIdx;
      const prevCell = this.currentWalk.cells[this.currentCellIndex];
      this.currentStepIndex = (prevCell?.steps && prevCell.steps.length > 0) ? 0 : -1;
      this.render();
      this.fireCellChanged();
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the first cell.');
    }
  }

  /**
   * Select a branch when the current cell has multiple nextCellIds.
   */
  selectBranch(branchIndex: number): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (!cell?.nextCellIds || branchIndex < 0 || branchIndex >= cell.nextCellIds.length) return;

    const targetId = cell.nextCellIds[branchIndex];
    const targetIdx = this.cellIdToIndex.get(targetId);
    if (targetIdx !== undefined) {
      log('debug', 'CodeWalkCellsViewProvider: selectBranch', {
        branchIndex,
        targetId,
        targetIdx,
        label: cell.branchOptions?.[branchIndex]?.label ?? targetId,
      });
      this.navigateForward(targetIdx);
    } else {
      vscode.window.showWarningMessage(`CodeGraph: Branch target cell "${targetId}" not found.`);
    }
  }

  /**
   * Navigate to the next sub-step (without crossing cell boundary).
   */
  nextStep(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && this.currentStepIndex < cell.steps.length - 1) {
      this.currentStepIndex++;
      this.render();
      this.fireCellChanged();
    }
  }

  /**
   * Navigate to the previous sub-step (without crossing cell boundary).
   */
  prevStep(): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.render();
      this.fireCellChanged();
    }
  }

  /**
   * Jump to a specific sub-step by index.
   */
  goToStepIndex(stepIndex: number): void {
    if (!this.currentWalk) return;
    const cell = this.currentWalk.cells[this.currentCellIndex];
    if (cell?.steps && stepIndex >= 0 && stepIndex < cell.steps.length) {
      this.currentStepIndex = stepIndex;
      this.render();
      this.fireCellChanged();
    }
  }

  /**
   * Jump to a specific cell by index (resets navigation history from this point).
   */
  goToCell(index: number): void {
    if (!this.currentWalk) return;
    if (index >= 0 && index < this.currentWalk.cells.length) {
      // Push current position to history so user can go back
      this.navigationHistory.push(this.currentCellIndex);
      this.currentCellIndex = index;
      const cell = this.currentWalk.cells[index];
      this.currentStepIndex = (cell?.steps && cell.steps.length > 0) ? 0 : -1;
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
    this.currentStepIndex = -1;
    this.navigationHistory = [];
    this.cellIdToIndex.clear();
    this.render();
    this._onCellChanged.fire(undefined);
  }

  // ---------------------------------------------------------------------------
  // Private: navigation helpers
  // ---------------------------------------------------------------------------

  /** Push current position to history and navigate to a new cell index. */
  private navigateForward(targetIndex: number): void {
    this.navigationHistory.push(this.currentCellIndex);
    this.currentCellIndex = targetIndex;
    const cell = this.currentWalk!.cells[this.currentCellIndex];
    this.currentStepIndex = (cell?.steps && cell.steps.length > 0) ? 0 : -1;
    this.render();
    this.fireCellChanged();
  }

  /** Rebuild the cell ID → index lookup map. */
  private rebuildCellIdMap(): void {
    this.cellIdToIndex.clear();
    if (!this.currentWalk) return;
    for (let i = 0; i < this.currentWalk.cells.length; i++) {
      this.cellIdToIndex.set(this.currentWalk.cells[i].id, i);
    }
  }

  private fireCellChanged(): void {
    if (this.currentWalk) {
      const cell = this.currentWalk.cells[this.currentCellIndex];
      if (cell) {
        const step = (cell.steps && this.currentStepIndex >= 0) ? cell.steps[this.currentStepIndex] : undefined;
        this._onCellChanged.fire({ walk: this.currentWalk, cell, index: this.currentCellIndex, stepIndex: this.currentStepIndex, step });
      }
    }
  }

  private render(): void {
    if (!this.view) return;

    if (!this.currentWalk || this.currentWalk.cells.length === 0) {
      this.view.webview.html = this.getEmptyHtml();
      return;
    }

    this.view.webview.html = this.getWalkHtml(this.currentWalk, this.currentCellIndex, this.currentStepIndex);
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

  private getWalkHtml(walk: CodeWalk, activeIndex: number, stepIndex: number): string {
    const cell = walk.cells[activeIndex];
    if (!cell) return this.getEmptyHtml();

    const totalCells = walk.cells.length;
    const hasSteps = cell.steps && cell.steps.length > 0 && stepIndex >= 0;
    const hasBranching = cell.nextCellIds && cell.nextCellIds.length > 1;
    const canGoBack = this.navigationHistory.length > 0;
    const isEndCell = this.isEndCell(cell, walk);

    // Build narrative — in step mode, show current step prominently
    let narrativeHtml = '';
    if (hasSteps) {
      const step = cell.steps![stepIndex];
      narrativeHtml = `<section class="section">
        <h3>Step ${stepIndex + 1} of ${cell.steps!.length}</h3>
        <div class="narrative">${escapeHtml(step.description)}</div>
      </section>`;
      if (cell.narrative) {
        narrativeHtml += `<section class="section" style="opacity:0.5">
          <h3>Full Narrative</h3>
          <div class="narrative" style="font-size:11px">${escapeHtml(cell.narrative)}</div>
        </section>`;
      }
    } else if (cell.narrative) {
      narrativeHtml = `<section class="section">
          <h3>Explanation</h3>
          <div class="narrative">${escapeHtml(cell.narrative)}</div>
        </section>`;
    }

    // Build steps bar
    let stepsBarHtml = '';
    if (hasSteps) {
      const dots = cell.steps!.map((_s, i) => {
        const cls = i === stepIndex ? 'step-dot-active' : (i < stepIndex ? 'step-dot-visited' : 'step-dot');
        return `<span class="${cls}" data-step="${i}"></span>`;
      }).join('');
      stepsBarHtml = `<div class="steps-bar">
        <button class="step-btn" id="prevStepBtn" ${stepIndex === 0 ? 'disabled' : ''}>&#9664;</button>
        <span class="step-counter">Step ${stepIndex + 1}/${cell.steps!.length}</span>
        <button class="step-btn" id="nextStepBtn" ${stepIndex === cell.steps!.length - 1 ? 'disabled' : ''}>&#9654;</button>
        <div class="step-dots">${dots}</div>
      </div>`;
    }

    // Build branch options UI
    const branchOptionsHtml = hasBranching ? this.renderBranchOptions(cell) : '';

    // Build variables
    const variablesHtml = this.renderVariables(cell);

    // Build call stack
    const callStackHtml = this.renderCallStack(cell);

    // Build cell list (mini nav — tree-aware)
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

    // Navigation path breadcrumb
    const breadcrumbHtml = this.renderBreadcrumb(walk);

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
      <button class="nav-btn" id="prevBtn" ${!canGoBack ? 'disabled' : ''}>&#9650; Prev</button>
      <span class="cell-counter">${activeIndex + 1} / ${totalCells}</span>
      <button class="nav-btn" id="nextBtn" ${isEndCell ? 'disabled' : ''} ${hasBranching ? 'style="opacity:0.3" title="Choose a branch below"' : ''}>&#9660; Next</button>
    </div>
  </div>

  ${breadcrumbHtml}

  <div class="cell-header">
    <span class="badge ${typeClass}">${typeLabel}</span>
    ${hasBranching ? '<span class="badge type-branch-point">BRANCH POINT</span>' : ''}
    <span class="badge ${statusClass}">${cell.status}</span>
    ${confPct ? `<span class="badge ${confClass}">${confPct}</span>` : ''}
    <span class="cell-depth">Depth: ${cell.stackDepth}</span>
  </div>

  <div class="file-ref">${escapeHtml(cell.code.filePath)}:${cell.code.startLine}-${cell.code.endLine}</div>

  ${stepsBarHtml}
  ${narrativeHtml}
  ${branchOptionsHtml}
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

      document.getElementById('prevStepBtn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'prevStep' });
      });

      document.getElementById('nextStepBtn')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'nextStep' });
      });

      document.querySelectorAll('.step-dot-active, .step-dot-visited, .step-dot').forEach(el => {
        el.addEventListener('click', () => {
          const stepIndex = parseInt(el.getAttribute('data-step') || '0', 10);
          vscode.postMessage({ type: 'goToStep', stepIndex });
        });
      });

      document.querySelectorAll('.branch-option-btn').forEach(el => {
        el.addEventListener('click', () => {
          const branchIndex = parseInt(el.getAttribute('data-branch-index') || '0', 10);
          vscode.postMessage({ type: 'selectBranch', branchIndex });
        });
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

  /**
   * Determine if a cell is an end cell (no further navigation possible).
   */
  private isEndCell(cell: WalkCell, walk: CodeWalk): boolean {
    // If it has explicit nextCellIds, it's only an end if the array is empty
    if (cell.nextCellIds) {
      return cell.nextCellIds.length === 0;
    }
    // Otherwise, linear — it's the end if it's the last cell
    return cell.index >= walk.cells.length - 1;
  }

  /**
   * Render the branch options UI for a cell with multiple nextCellIds.
   */
  private renderBranchOptions(cell: WalkCell): string {
    if (!cell.nextCellIds || cell.nextCellIds.length <= 1) return '';

    const options = cell.nextCellIds.map((nextId, i) => {
      const option: BranchOption | undefined = cell.branchOptions?.[i];
      const label = option?.label ?? `Path ${i + 1}`;
      const description = option?.description ?? `Go to ${nextId}`;
      const condition = option?.condition ? `<div class="branch-condition">${escapeHtml(option.condition)}</div>` : '';
      const hint = option?.pathHint ?? 'default';
      const hintClass = `branch-hint-${hint}`;

      return `<div class="branch-option ${hintClass}">
        <button class="branch-option-btn" data-branch-index="${i}">
          <span class="branch-option-icon">${this.getBranchHintIcon(hint)}</span>
          <span class="branch-option-label">${escapeHtml(label)}</span>
        </button>
        <div class="branch-option-desc">${escapeHtml(description)}</div>
        ${condition}
      </div>`;
    }).join('\n');

    return `<section class="section branch-section">
      <h3>Choose a Path</h3>
      <div class="branch-options">${options}</div>
    </section>`;
  }

  /**
   * Render breadcrumb trail showing the path taken through branches.
   */
  private renderBreadcrumb(walk: CodeWalk): string {
    if (this.navigationHistory.length === 0) return '';

    // Show last 5 cells in the path + current
    const pathIndices = [...this.navigationHistory.slice(-5), this.currentCellIndex];
    const crumbs = pathIndices.map((idx, i) => {
      const c = walk.cells[idx];
      if (!c) return '';
      const isLast = i === pathIndices.length - 1;
      const label = this.getCellLabel(c);
      const truncated = this.navigationHistory.length > 5 && i === 0;
      return `<span class="breadcrumb-item ${isLast ? 'breadcrumb-current' : ''}">${truncated ? '... &rarr; ' : ''}${escapeHtml(label)}${isLast ? '' : ' &rarr; '}</span>`;
    }).join('');

    return `<div class="breadcrumb">${crumbs}</div>`;
  }

  private getBranchHintIcon(hint: string): string {
    switch (hint) {
      case 'taken': return '&#10003;';    // checkmark
      case 'skipped': return '&#10007;';  // cross
      case 'error': return '&#9888;';     // warning
      default: return '&#10140;';         // arrow
    }
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
        const actionIcon = v.action === 'created' ? '&#x1F195;'
          : v.action === 'modified' ? '&#x270F;&#xFE0F;'
          : v.action === 'read' ? '&#x1F441;'
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
      const isInHistory = this.navigationHistory.includes(idx);
      const indent = '  '.repeat(cell.stackDepth);
      const typeIcon = this.getCellTypeIcon(cell.type);
      const hasBranch = cell.nextCellIds && cell.nextCellIds.length > 1;
      const branchIcon = hasBranch ? '<span class="cell-branch-icon" title="Branch point">&#9733;</span>' : '';
      return `<div class="cell-item ${isActive ? 'cell-active' : ''} ${isInHistory ? 'cell-visited' : ''}" data-index="${idx}">
        <span class="cell-indent">${indent}</span>
        <span class="cell-icon">${typeIcon}</span>
        <span class="cell-label">${escapeHtml(this.getCellLabel(cell))}</span>
        ${branchIcon}
        <span class="cell-status-dot status-dot-${cell.status}"></span>
      </div>`;
    }).join('\n');
  }

  private getCellLabel(cell: WalkCell): string {
    const func = cell.callStack?.[cell.callStack.length - 1]?.functionName ?? '';
    const shortFunc = func.split('::').pop() ?? func;
    switch (cell.type) {
      case 'entry': return shortFunc || 'Entry';
      case 'call': return `\u2192 ${shortFunc}`;
      case 'branch': return `? Branch`;
      case 'assignment': return `= Assign`;
      case 'return': return `\u2190 Return`;
      case 'dispatch': return `\u27BF Dispatch`;
      case 'block': return `\u25AA Block`;
      case 'note': return `\u270E Note`;
      default: return cell.type;
    }
  }

  private getCellTypeIcon(type: string): string {
    switch (type) {
      case 'entry': return '&#9654;';
      case 'call': return '&rarr;';
      case 'branch': return '?';
      case 'assignment': return '=';
      case 'return': return '&larr;';
      case 'dispatch': return '&#10239;';
      case 'block': return '&#9642;';
      case 'note': return '&#9998;';
      default: return '&middot;';
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
        --purple: var(--vscode-charts-purple, #9c27b0);
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

      /* Breadcrumb trail */
      .breadcrumb {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px;
        font-size: 10px;
        color: var(--muted);
        margin-bottom: 8px;
        padding: 4px 6px;
        background: var(--code-bg);
        border-radius: 4px;
      }
      .breadcrumb-item {
        white-space: nowrap;
      }
      .breadcrumb-current {
        color: var(--link);
        font-weight: 600;
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
      .type-branch-point { background: var(--purple); color: #fff; animation: pulse-badge 2s infinite; }
      .type-assignment { background: #795548; color: #fff; }
      .type-return { background: #607d8b; color: #fff; }
      .type-dispatch { background: #9c27b0; color: #fff; }
      .type-block { background: #455a64; color: #fff; }
      .type-note { background: #78909c; color: #fff; }

      @keyframes pulse-badge {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

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

      /* Branch options */
      .branch-section h3 {
        color: var(--purple);
        border-bottom-color: var(--purple);
      }

      .branch-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .branch-option {
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        transition: border-color 0.15s, background 0.15s;
      }

      .branch-option:hover {
        border-color: var(--link);
        background: var(--hover-bg);
      }

      .branch-hint-taken {
        border-left: 3px solid var(--green);
      }
      .branch-hint-skipped {
        border-left: 3px solid var(--red);
        opacity: 0.8;
      }
      .branch-hint-error {
        border-left: 3px solid var(--yellow);
      }
      .branch-hint-default {
        border-left: 3px solid var(--blue);
      }

      .branch-option-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--badge-bg);
        color: var(--badge-fg);
        border: none;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: var(--font);
        font-weight: 600;
        width: 100%;
        text-align: left;
      }

      .branch-option-btn:hover {
        opacity: 0.85;
      }

      .branch-option-icon {
        font-size: 14px;
        flex-shrink: 0;
      }

      .branch-option-label {
        flex: 1;
      }

      .branch-option-desc {
        font-size: 11px;
        color: var(--muted);
        margin-top: 4px;
        line-height: 1.4;
      }

      .branch-condition {
        font-family: var(--mono);
        font-size: 10px;
        color: var(--muted);
        margin-top: 3px;
        padding: 2px 6px;
        background: var(--code-bg);
        border-radius: 3px;
        display: inline-block;
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
      .cell-item.cell-visited {
        opacity: 0.85;
        border-left: 2px solid var(--green);
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

      .cell-branch-icon {
        color: var(--purple);
        font-size: 10px;
        margin-left: 2px;
        flex-shrink: 0;
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

      /* Steps bar */
      .steps-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--code-bg);
        border-radius: 4px;
        margin-bottom: 8px;
      }
      .step-btn {
        background: var(--badge-bg);
        color: var(--badge-fg);
        border: none;
        padding: 2px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
      }
      .step-btn:hover:not(:disabled) { opacity: 0.85; }
      .step-btn:disabled { opacity: 0.3; cursor: default; }
      .step-counter {
        font-size: 11px;
        font-weight: 600;
        min-width: 60px;
        text-align: center;
      }
      .step-dots {
        display: flex;
        gap: 4px;
        align-items: center;
        margin-left: auto;
      }
      .step-dot, .step-dot-active, .step-dot-visited {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .step-dot { background: var(--muted); opacity: 0.3; }
      .step-dot-visited { background: var(--green); opacity: 0.7; }
      .step-dot-active { background: var(--blue); opacity: 1; transform: scale(1.3); }
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
