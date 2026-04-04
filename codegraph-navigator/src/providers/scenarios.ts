/**
 * Scenarios Tree Provider — populates the "Scenarios" sidebar view.
 *
 * Shows a tree of all scenarios. Each scenario node can be expanded
 * to show its steps (lazy-loaded via @codegraph/core when expanded).
 *
 * @module providers/scenarios
 */

import * as vscode from 'vscode';
import * as coreBridge from '../core-bridge.js';
import { log, logEntry, logExit } from '../logger.js';
import type { Scenario, ScenarioStep, ScenarioView } from '@codegraph/core';

/** A node in the scenarios tree — either a scenario or a step */
type ScenarioTreeNode = ScenarioNode | StepPreviewNode;

/** Top-level scenario item */
class ScenarioNode extends vscode.TreeItem {
  constructor(public readonly scenario: Scenario) {
    super(scenario.name, vscode.TreeItemCollapsibleState.Collapsed);
    const tagStr = scenario.tags.length > 0 ? ` ${scenario.tags.join(' ')}` : '';
    this.description = `${scenario.status} | ${(scenario.confidence * 100).toFixed(0)}%${tagStr}`;
    this.tooltip = new vscode.MarkdownString(
      `**${scenario.name}**\n\n` +
      `${scenario.description}\n\n` +
      `- **Status:** ${scenario.status}\n` +
      `- **Entry:** \`${scenario.entryFunction}\`\n` +
      `- **Trigger:** ${scenario.triggerCondition}\n` +
      `- **Confidence:** ${(scenario.confidence * 100).toFixed(0)}%\n` +
      `- **Discovered by:** ${scenario.discoveredBy}\n` +
      `- **Version:** ${scenario.version}\n` +
      (scenario.tags.length > 0 ? `- **Tags:** ${scenario.tags.join(', ')}\n` : '')
    );
    this.contextValue = 'scenario';
    this.iconPath = getStatusIcon(scenario.status);
  }
}

/** A step shown under a scenario (preview — just name and action) */
class StepPreviewNode extends vscode.TreeItem {
  constructor(
    public readonly step: ScenarioStep,
    public readonly scenarioId: string
  ) {
    super(
      `${step.stepNumber}. ${step.functionName}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `${step.action} :${step.line}`;
    this.tooltip = new vscode.MarkdownString(
      `**Step ${step.stepNumber}** — \`${step.functionName}\`\n\n` +
      `- **Action:** ${step.action}\n` +
      `- **Line:** ${step.line}\n` +
      `- **Confidence:** ${(step.confidence * 100).toFixed(0)}%\n\n` +
      (step.sourceCode ? `\`\`\`typescript\n${step.sourceCode}\n\`\`\`\n\n` : '') +
      `**Justification:** ${step.justification}`
    );
    this.contextValue = 'step';
    this.iconPath = getActionIcon(step.action);

    // Click to open file at location
    this.command = {
      command: 'codegraph.openStepInEditor',
      title: 'Open in Editor',
      arguments: [step],
    };
  }
}

/**
 * Get a ThemeIcon for a scenario status.
 */
function getStatusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'draft':
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
    case 'traced':
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
    case 'validated':
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    case 'corrected':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

/**
 * Get a ThemeIcon for a step action.
 */
function getActionIcon(action: string): vscode.ThemeIcon {
  switch (action) {
    case 'call':
      return new vscode.ThemeIcon('call-outgoing');
    case 'branch_taken':
      return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.green'));
    case 'branch_skipped':
      return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.red'));
    case 'dispatch':
      return new vscode.ThemeIcon('symbol-interface');
    case 'return':
      return new vscode.ThemeIcon('call-incoming');
    case 'assign':
      return new vscode.ThemeIcon('symbol-variable');
    default:
      return new vscode.ThemeIcon('circle-small');
  }
}

/**
 * Tree data provider for the Scenarios view.
 *
 * Supports filtering by tags — type "#clipboard" or "#dragDrop #auth"
 * in the search box to show only matching scenarios.
 */
export class ScenariosProvider implements vscode.TreeDataProvider<ScenarioTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ScenarioTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cache of loaded scenario views (scenario + steps) */
  private viewCache = new Map<string, ScenarioView>();

  /** Current tag filter (empty = show all) */
  private filterTags: string[] = [];

  /** Current raw filter text for display */
  private filterText = '';

  refresh(): void {
    logEntry('ScenariosProvider.refresh');
    this.viewCache.clear();
    this._onDidChangeTreeData.fire();
    log('info', 'Scenarios tree refreshed');
    logExit('ScenariosProvider.refresh');
  }

  /**
   * Set a search/filter string. Extracts "#tag" tokens for tag filtering.
   * Setting `undefined` or empty string clears the filter.
   */
  setFilter(query: string | undefined): void {
    logEntry('ScenariosProvider.setFilter', { query });
    this.filterText = query?.trim() ?? '';
    this.filterTags = [];

    if (this.filterText) {
      // Extract all #tag tokens from the query
      const tagMatches = this.filterText.match(/#\S+/g);
      if (tagMatches) {
        this.filterTags = tagMatches.map(t => t.toLowerCase());
      }
    }

    log('info', 'Scenarios filter updated', { filterText: this.filterText, filterTags: this.filterTags });
    this._onDidChangeTreeData.fire();
    logExit('ScenariosProvider.setFilter');
  }

  /** Get the current filter text */
  getFilterText(): string {
    return this.filterText;
  }

  getTreeItem(element: ScenarioTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ScenarioTreeNode): Promise<ScenarioTreeNode[]> {
    if (!element) {
      logEntry('ScenariosProvider.getChildren', { elementType: 'root' });
      // Root level — list all scenarios
      try {
        let scenarios = await coreBridge.listScenarios();

        // Apply tag filter if set
        if (this.filterTags.length > 0) {
          scenarios = scenarios.filter(s =>
            this.filterTags.every(filterTag =>
              s.tags.some(scenarioTag => scenarioTag === filterTag)
            )
          );
        }

        logExit('ScenariosProvider.getChildren', { count: scenarios.length, filtered: this.filterTags.length > 0 });
        return scenarios.map((s) => new ScenarioNode(s));
      } catch (err) {
        log('error', 'Failed to load scenarios for tree', {
          error: err instanceof Error ? err.message : String(err),
        });
        logExit('ScenariosProvider.getChildren', { count: 0, error: true });
        return [];
      }
    }

    if (element instanceof ScenarioNode) {
      const scenarioId = element.scenario.id;
      logEntry('ScenariosProvider.getChildren', { elementType: 'scenario', scenarioId });
      // Expanding a scenario — load its steps
      try {
        let view = this.viewCache.get(scenarioId);
        const cacheHit = !!view;
        if (!view) {
          view = await coreBridge.getScenarioView(scenarioId) ?? undefined;
          if (view) {
            this.viewCache.set(scenarioId, view);
          }
        }
        if (view) {
          log('debug', 'ScenariosProvider.getChildren: loaded steps', { scenarioId, cacheHit, stepCount: view.steps.length });
          logExit('ScenariosProvider.getChildren', { count: view.steps.length });
          return view.steps.map((step) => new StepPreviewNode(step, scenarioId));
        }
      } catch (err) {
        log('error', `Failed to load steps for scenario ${scenarioId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      logExit('ScenariosProvider.getChildren', { count: 0 });
      return [];
    }

    logExit('ScenariosProvider.getChildren', { count: 0 });
    return [];
  }

  /**
   * Get a cached scenario view, or load it.
   */
  async getScenarioView(scenarioId: string): Promise<ScenarioView | undefined> {
    logEntry('ScenariosProvider.getScenarioView', { scenarioId });
    let view = this.viewCache.get(scenarioId);
    if (view) {
      log('debug', 'ScenariosProvider.getScenarioView: cache hit', { scenarioId });
      logExit('ScenariosProvider.getScenarioView', 'cache hit');
      return view;
    }
    log('debug', 'ScenariosProvider.getScenarioView: cache miss, loading', { scenarioId });
    const loaded = await coreBridge.getScenarioView(scenarioId);
    if (loaded) {
      this.viewCache.set(scenarioId, loaded);
      view = loaded;
    }
    logExit('ScenariosProvider.getScenarioView', view ? 'loaded' : 'not found');
    return view;
  }
}
