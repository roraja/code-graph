/**
 * Scenarios Tree Provider — populates the "Scenarios" sidebar view.
 *
 * Shows a tree of all scenarios. Each scenario node can be expanded
 * to show its steps (lazy-loaded via CLI when expanded).
 *
 * @module providers/scenarios
 */

import * as vscode from 'vscode';
import * as cliBridge from '../cli-bridge.js';
import { log } from '../logger.js';
import type { Scenario, ScenarioStep, ScenarioView } from '../types.js';

/** A node in the scenarios tree — either a scenario or a step */
type ScenarioTreeNode = ScenarioNode | StepPreviewNode;

/** Top-level scenario item */
class ScenarioNode extends vscode.TreeItem {
  constructor(public readonly scenario: Scenario) {
    super(scenario.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${scenario.status} | ${(scenario.confidence * 100).toFixed(0)}%`;
    this.tooltip = new vscode.MarkdownString(
      `**${scenario.name}**\n\n` +
      `${scenario.description}\n\n` +
      `- **Status:** ${scenario.status}\n` +
      `- **Entry:** \`${scenario.entryFunction}\`\n` +
      `- **Trigger:** ${scenario.triggerCondition}\n` +
      `- **Confidence:** ${(scenario.confidence * 100).toFixed(0)}%\n` +
      `- **Discovered by:** ${scenario.discoveredBy}\n` +
      `- **Version:** ${scenario.version}`
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
 */
export class ScenariosProvider implements vscode.TreeDataProvider<ScenarioTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ScenarioTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cache of loaded scenario views (scenario + steps) */
  private viewCache = new Map<string, ScenarioView>();

  refresh(): void {
    this.viewCache.clear();
    this._onDidChangeTreeData.fire();
    log('info', 'Scenarios tree refreshed');
  }

  getTreeItem(element: ScenarioTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ScenarioTreeNode): Promise<ScenarioTreeNode[]> {
    if (!element) {
      // Root level — list all scenarios
      try {
        const scenarios = await cliBridge.listScenarios();
        return scenarios.map((s) => new ScenarioNode(s));
      } catch (err) {
        log('error', 'Failed to load scenarios for tree', {
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    }

    if (element instanceof ScenarioNode) {
      // Expanding a scenario — load its steps
      const scenarioId = element.scenario.id;
      try {
        let view = this.viewCache.get(scenarioId);
        if (!view) {
          view = await cliBridge.getScenarioView(scenarioId) ?? undefined;
          if (view) {
            this.viewCache.set(scenarioId, view);
          }
        }
        if (view) {
          return view.steps.map((step) => new StepPreviewNode(step, scenarioId));
        }
      } catch (err) {
        log('error', `Failed to load steps for scenario ${scenarioId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return [];
    }

    return [];
  }

  /**
   * Get a cached scenario view, or load it.
   */
  async getScenarioView(scenarioId: string): Promise<ScenarioView | undefined> {
    let view = this.viewCache.get(scenarioId);
    if (!view) {
      const loaded = await cliBridge.getScenarioView(scenarioId);
      if (loaded) {
        this.viewCache.set(scenarioId, loaded);
        view = loaded;
      }
    }
    return view;
  }
}
