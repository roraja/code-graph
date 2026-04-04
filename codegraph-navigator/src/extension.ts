/**
 * CodeGraph Navigator — VS Code Extension entry point.
 *
 * A lightweight sidebar extension that shells out to the globally installed
 * `codegraph` CLI to explore scenarios, walk through execution traces
 * step-by-step, and browse functions in the code graph.
 *
 * Architecture:
 *   - The CLI is the primary interface; this extension is a thin UI layer.
 *   - All data comes from `codegraph <command> --format json` via cli-bridge.
 *   - Three sidebar views: Scenarios, Step Walker, Functions.
 *   - Editor context menu: right-click a function name to find scenarios
 *     or discover new scenarios starting from it.
 *   - Logs: .vscode/code-graph/logs/<YYYY-MM-DD>.log
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { initLogger, log, disposeLogger, showOutputChannel } from './logger.js';
import * as cliBridge from './cli-bridge.js';
import { ScenariosProvider } from './providers/scenarios.js';
import { StepWalkerProvider } from './providers/step-walker.js';
import { FunctionsProvider } from './providers/functions.js';
import { openStepInEditor } from './decorations.js';
import type { ScenarioStep } from './types.js';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Initialize logging
  if (workspaceRoot) {
    initLogger(workspaceRoot);
  }

  log('info', 'CodeGraph Navigator activating', {
    workspaceRoot,
    extensionVersion: '0.1.0',
  });

  // Check CLI availability
  cliBridge.checkCLI().then((ok) => {
    if (!ok) {
      vscode.window.showWarningMessage(
        'CodeGraph Navigator: `codegraph` CLI not found in PATH. ' +
        'Install it globally or set codegraph.cliPath in settings.'
      );
    }
  });

  // --- Providers ---
  const scenariosProvider = new ScenariosProvider();
  const stepWalkerProvider = new StepWalkerProvider();
  const functionsProvider = new FunctionsProvider();

  // Register tree data providers
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codegraph.scenarios', scenariosProvider),
    vscode.window.registerTreeDataProvider('codegraph.stepWalker', stepWalkerProvider),
    vscode.window.registerTreeDataProvider('codegraph.functions', functionsProvider)
  );

  // --- Commands ---

  // Show Code Graph Viewer — focus the sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showViewer', async () => {
      log('info', 'Show Code Graph Viewer');
      await vscode.commands.executeCommand('workbench.view.extension.codegraph-navigator');
    })
  );

  // Show Output Channel — open the CodeGraph Navigator output panel
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showOutput', () => {
      showOutputChannel();
    })
  );

  // Refresh scenarios
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.refreshScenarios', () => {
      scenariosProvider.refresh();
    })
  );

  // View scenario (opens step walker)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.viewScenario', async (node: { scenario: { id: string } }) => {
      const scenarioId = node?.scenario?.id;
      if (!scenarioId) {
        const input = await vscode.window.showInputBox({
          prompt: 'Enter scenario ID',
          placeHolder: 'e.g., user-login-flow',
        });
        if (!input) { return; }
        await loadAndWalk(input, scenariosProvider, stepWalkerProvider);
      } else {
        await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider);
      }
    })
  );

  // Walk scenario (same as view, shows in step walker)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.walkScenario', async (node: { scenario: { id: string } }) => {
      const scenarioId = node?.scenario?.id;
      if (!scenarioId) { return; }
      await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider);
    })
  );

  // Next step
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.nextStep', () => {
      stepWalkerProvider.nextStep();
      autoOpenCurrentStep(stepWalkerProvider, workspaceRoot);
    })
  );

  // Previous step
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.prevStep', () => {
      stepWalkerProvider.prevStep();
      autoOpenCurrentStep(stepWalkerProvider, workspaceRoot);
    })
  );

  // Open step in editor
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openStepInEditor', async (step: ScenarioStep) => {
      if (!step) {
        const currentStep = stepWalkerProvider.getCurrentStep();
        if (currentStep) {
          step = currentStep;
        } else {
          return;
        }
      }
      const scenarioView = stepWalkerProvider.getScenarioView();
      await openStepInEditor(step, workspaceRoot, scenarioView?.steps);
    })
  );

  // Refresh functions
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.refreshFunctions', () => {
      functionsProvider.refresh();
    })
  );

  // Search functions
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.searchFunctions', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search functions by name',
        placeHolder: 'e.g., authenticate',
      });
      functionsProvider.setSearch(query || undefined);
    })
  );

  // Show scenarios for function (from tree context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showScenariosForFunction', async (node: { func: { qualifiedName: string } }) => {
      const functionName = node?.func?.qualifiedName;
      if (!functionName) { return; }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Finding scenarios for ${functionName}...` },
        async () => {
          const scenarios = await cliBridge.getScenariosForFunction(functionName);
          if (scenarios.length === 0) {
            vscode.window.showInformationMessage(
              `No scenarios found involving ${functionName}. Try discovering new scenarios.`
            );
            return;
          }
          const picked = await vscode.window.showQuickPick(
            scenarios.map((s) => ({
              label: s.name,
              description: `${s.status} | ${(s.confidence * 100).toFixed(0)}%`,
              detail: s.description,
              id: s.id,
            })),
            { placeHolder: 'Select a scenario to walk' }
          );
          if (picked) {
            await loadAndWalk(picked.id, scenariosProvider, stepWalkerProvider);
          }
        }
      );
    })
  );

  // Discover scenarios from function (from tree context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.discoverFromFunction', async (node: { func: { qualifiedName: string } }) => {
      const functionName = node?.func?.qualifiedName;
      if (!functionName) { return; }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Discovering scenarios from ${functionName}...`, cancellable: false },
        async () => {
          await cliBridge.discoverFromFunction(functionName);
          scenariosProvider.refresh();
        }
      );
    })
  );

  // Show scenarios for symbol (editor right-click)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showScenariosForSymbol', async () => {
      const functionName = getWordUnderCursor();
      if (!functionName) {
        vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
        return;
      }
      log('info', 'Show scenarios for symbol', { functionName });

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Finding scenarios for "${functionName}"...` },
        async () => {
          const scenarios = await cliBridge.getScenariosForFunction(functionName);
          if (scenarios.length === 0) {
            vscode.window.showInformationMessage(
              `No scenarios found involving "${functionName}".`
            );
            return;
          }
          const picked = await vscode.window.showQuickPick(
            scenarios.map((s) => ({
              label: s.name,
              description: `${s.status} | ${(s.confidence * 100).toFixed(0)}%`,
              detail: s.description,
              id: s.id,
            })),
            { placeHolder: 'Select a scenario to walk' }
          );
          if (picked) {
            await loadAndWalk(picked.id, scenariosProvider, stepWalkerProvider);
          }
        }
      );
    })
  );

  // Discover scenarios from symbol (editor right-click)
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.discoverFromSymbol', async () => {
      const functionName = getWordUnderCursor();
      if (!functionName) {
        vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
        return;
      }
      log('info', 'Discover from symbol', { functionName });

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Discovering scenarios from "${functionName}"...`, cancellable: false },
        async () => {
          await cliBridge.discoverFromFunction(functionName);
          scenariosProvider.refresh();
        }
      );
    })
  );

  log('info', 'CodeGraph Navigator activated');
}

export function deactivate(): void {
  log('info', 'CodeGraph Navigator deactivated');
  disposeLogger();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a scenario and display it in the Step Walker.
 */
async function loadAndWalk(
  scenarioId: string,
  scenariosProvider: ScenariosProvider,
  stepWalkerProvider: StepWalkerProvider
): Promise<void> {
  log('info', `Walking scenario: ${scenarioId}`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Loading scenario ${scenarioId}...` },
    async () => {
      const view = await scenariosProvider.getScenarioView(scenarioId);
      if (!view) {
        vscode.window.showErrorMessage(`CodeGraph: Scenario "${scenarioId}" not found.`);
        return;
      }
      stepWalkerProvider.loadScenario(view);

      // Focus the step walker view
      await vscode.commands.executeCommand('codegraph.stepWalker.focus');

      // Auto-open the first step
      const firstStep = stepWalkerProvider.getCurrentStep();
      if (firstStep) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        await openStepInEditor(firstStep, workspaceRoot, view.steps);
      }
    }
  );
}

/**
 * Auto-open the current step in the editor when navigating.
 */
function autoOpenCurrentStep(
  stepWalkerProvider: StepWalkerProvider,
  workspaceRoot: string | undefined
): void {
  const step = stepWalkerProvider.getCurrentStep();
  if (step) {
    const scenarioView = stepWalkerProvider.getScenarioView();
    openStepInEditor(step, workspaceRoot, scenarioView?.steps);
  }
}

/**
 * Get the word (function name) under the cursor in the active editor.
 */
function getWordUnderCursor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }

  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position);
  if (!wordRange) { return undefined; }

  return editor.document.getText(wordRange);
}
