/**
 * Step Walker Provider — populates the "Step Walker" sidebar view.
 *
 * When a user selects "Walk Scenario" on a scenario, this view shows
 * the current step in detail with variable state, justification, source
 * code, and confidence. Prev/Next buttons let users step through.
 *
 * @module providers/step-walker
 */

import * as vscode from 'vscode';
import { log } from '../logger.js';
import type { ScenarioStep, ScenarioView } from '@codegraph/core';

/** Node types in the step walker tree */
type WalkerNode = StepHeaderNode | PropertyNode | VariableNode;

/** The current step header */
class StepHeaderNode extends vscode.TreeItem {
  constructor(
    public readonly step: ScenarioStep,
    public readonly totalSteps: number
  ) {
    super(
      `Step ${step.stepNumber} / ${totalSteps}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `${step.functionName} — ${step.action}`;
    this.contextValue = 'step';
    this.iconPath = new vscode.ThemeIcon('debug-step-into');
    this.command = {
      command: 'codegraph.openStepInEditor',
      title: 'Open in Editor',
      arguments: [step],
    };
  }
}

/** A property row (Source Code, Justification, Confidence, etc.) */
class PropertyNode extends vscode.TreeItem {
  constructor(label: string, value: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.tooltip = value;
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

/** A variable in the variable state */
class VariableNode extends vscode.TreeItem {
  constructor(name: string, value: unknown) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.description = String(value);
    this.tooltip = `${name} = ${JSON.stringify(value, null, 2)}`;
    this.iconPath = new vscode.ThemeIcon('symbol-variable');
  }
}

/**
 * Tree data provider for the Step Walker view.
 */
export class StepWalkerProvider implements vscode.TreeDataProvider<WalkerNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WalkerNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private scenarioView: ScenarioView | undefined;
  private currentStepIndex = 0;

  /**
   * Load a scenario into the walker.
   */
  loadScenario(view: ScenarioView): void {
    this.scenarioView = view;
    this.currentStepIndex = 0;
    this._onDidChangeTreeData.fire();
    log('info', `Step walker loaded scenario: ${view.scenario.name}`, {
      steps: view.steps.length,
    });
  }

  /**
   * Get the current step (for opening in editor).
   */
  getCurrentStep(): ScenarioStep | undefined {
    if (!this.scenarioView) { return undefined; }
    return this.scenarioView.steps[this.currentStepIndex];
  }

  /**
   * Get the current scenario view.
   */
  getScenarioView(): ScenarioView | undefined {
    return this.scenarioView;
  }

  /**
   * Advance to the next step.
   */
  nextStep(): void {
    if (!this.scenarioView) { return; }
    if (this.currentStepIndex < this.scenarioView.steps.length - 1) {
      this.currentStepIndex++;
      this._onDidChangeTreeData.fire();
      log('debug', `Step walker: next -> step ${this.currentStepIndex + 1}`);
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the last step.');
    }
  }

  /**
   * Go to the previous step.
   */
  prevStep(): void {
    if (!this.scenarioView) { return; }
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this._onDidChangeTreeData.fire();
      log('debug', `Step walker: prev -> step ${this.currentStepIndex + 1}`);
    } else {
      vscode.window.showInformationMessage('CodeGraph: Already at the first step.');
    }
  }

  getTreeItem(element: WalkerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WalkerNode): Promise<WalkerNode[]> {
    if (element) { return []; }

    if (!this.scenarioView || this.scenarioView.steps.length === 0) {
      return [
        new PropertyNode(
          'No scenario loaded',
          'Right-click a scenario and select "Walk Scenario"',
          'info'
        ),
      ];
    }

    const step = this.scenarioView.steps[this.currentStepIndex];
    if (!step) { return []; }

    const totalSteps = this.scenarioView.steps.length;
    const nodes: WalkerNode[] = [];

    // Scenario name
    nodes.push(
      new PropertyNode(
        'Scenario',
        this.scenarioView.scenario.name,
        'book'
      )
    );

    // Step header (clickable to open in editor)
    nodes.push(new StepHeaderNode(step, totalSteps));

    // Function
    nodes.push(
      new PropertyNode('Function', step.functionName, 'symbol-function')
    );

    // Action
    nodes.push(
      new PropertyNode('Action', step.action, 'arrow-right')
    );

    // Line
    nodes.push(
      new PropertyNode('Line', String(step.line), 'location')
    );

    // Source code
    if (step.sourceCode) {
      nodes.push(
        new PropertyNode('Source', step.sourceCode, 'code')
      );
    }

    // Justification
    nodes.push(
      new PropertyNode('Justification', step.justification, 'comment')
    );

    // Confidence
    const confPct = (step.confidence * 100).toFixed(0) + '%';
    const confIcon = step.confidence >= 0.8 ? 'pass' : step.confidence >= 0.5 ? 'warning' : 'error';
    nodes.push(
      new PropertyNode('Confidence', confPct, confIcon)
    );

    // Variables
    const vars = step.variableState;
    if (vars && Object.keys(vars).length > 0) {
      nodes.push(
        new PropertyNode('--- Variables ---', '', 'symbol-variable')
      );
      for (const [name, value] of Object.entries(vars)) {
        nodes.push(new VariableNode(name, value));
      }
    }

    // Correction info
    if (step.correctedBy) {
      nodes.push(
        new PropertyNode(
          'Corrected by',
          `${step.correctedBy}${step.correctionNote ? ': ' + step.correctionNote : ''}`,
          'edit'
        )
      );
    }

    return nodes;
  }
}
