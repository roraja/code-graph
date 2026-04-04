/**
 * CodeGraph Navigator — VS Code Extension entry point.
 *
 * Uses @codegraph/core directly as a JS API (no CLI shelling out).
 * The core-bridge module wraps the CodeGraphClient from @codegraph/core,
 * handling connection probing, mock fallback, and error handling.
 *
 * Architecture:
 *   - @codegraph/core is a direct npm dependency (monorepo workspace).
 *   - All data comes from the core-bridge which calls CodeGraphClient.
 *   - Three sidebar views: Scenarios, Step Walker, Functions.
 *   - Editor context menu: right-click a function name to find scenarios
 *     or discover new scenarios starting from it.
 *   - Logs: .vscode/code-graph/logs/<YYYY-MM-DD>.log
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { initLogger, log, logEntry, logExit, logError, disposeLogger, showOutputChannel } from './logger.js';
import * as coreBridge from './core-bridge.js';
import { ScenariosProvider } from './providers/scenarios.js';
import { StepWalkerProvider } from './providers/step-walker.js';
import { FunctionsProvider } from './providers/functions.js';
import { openStepInEditor } from './decorations.js';
import type { ScenarioStep, CallRelation } from '@codegraph/core';

export function activate(context: vscode.ExtensionContext): void {
  logEntry('activate', { extensionVersion: context.extension.packageJSON?.version });
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Initialize logging
  if (workspaceRoot) {
    initLogger(workspaceRoot);
  }

  log('info', 'CodeGraph Navigator activating', {
    workspaceRoot,
    extensionVersion: context.extension.packageJSON.version,
  });

  // Check core availability (always true since it's a direct dependency)
  coreBridge.checkAvailability().then((ok) => {
    if (!ok) {
      vscode.window.showWarningMessage(
        'CodeGraph Navigator: @codegraph/core failed to load. ' +
        'Ensure the monorepo is built (npm run build).'
      );
    }
  });

  // --- Providers ---
  const scenariosProvider = new ScenariosProvider();
  const stepWalkerProvider = new StepWalkerProvider();
  const functionsProvider = new FunctionsProvider();

  // Register tree data providers
  const scenariosTreeView = vscode.window.createTreeView('codegraph.scenarios', {
    treeDataProvider: scenariosProvider,
  });
  scenariosTreeView.description = `v${context.extension.packageJSON.version}`;
  context.subscriptions.push(
    scenariosTreeView,
    vscode.window.registerTreeDataProvider('codegraph.stepWalker', stepWalkerProvider),
    vscode.window.registerTreeDataProvider('codegraph.functions', functionsProvider)
  );

  // --- Commands ---

  // Show Code Graph Viewer — focus the sidebar
  log('debug', 'Registering command: codegraph.showViewer');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showViewer', async () => {
      logEntry('cmd:showViewer');
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codegraph-navigator');
        logExit('cmd:showViewer');
      } catch (err) {
        logError('cmd:showViewer', err);
        throw err;
      }
    })
  );

  // Show Output Channel — open the CodeGraph Navigator output panel
  log('debug', 'Registering command: codegraph.showOutput');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showOutput', () => {
      logEntry('cmd:showOutput');
      showOutputChannel();
      logExit('cmd:showOutput');
    })
  );

  // Refresh scenarios
  log('debug', 'Registering command: codegraph.refreshScenarios');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.refreshScenarios', () => {
      logEntry('cmd:refreshScenarios');
      scenariosProvider.refresh();
      logExit('cmd:refreshScenarios');
    })
  );

  // View scenario (opens step walker)
  log('debug', 'Registering command: codegraph.viewScenario');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.viewScenario', async (node: { scenario: { id: string } }) => {
      logEntry('cmd:viewScenario', { scenarioId: node?.scenario?.id });
      try {
        const scenarioId = node?.scenario?.id;
        if (!scenarioId) {
          const input = await vscode.window.showInputBox({
            prompt: 'Enter scenario ID',
            placeHolder: 'e.g., user-login-flow',
          });
          if (!input) { logExit('cmd:viewScenario', 'cancelled'); return; }
          await loadAndWalk(input, scenariosProvider, stepWalkerProvider);
        } else {
          await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider);
        }
        logExit('cmd:viewScenario');
      } catch (err) {
        logError('cmd:viewScenario', err);
        throw err;
      }
    })
  );

  // Walk scenario (same as view, shows in step walker)
  log('debug', 'Registering command: codegraph.walkScenario');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.walkScenario', async (node: { scenario: { id: string } }) => {
      logEntry('cmd:walkScenario', { scenarioId: node?.scenario?.id });
      try {
        const scenarioId = node?.scenario?.id;
        if (!scenarioId) { logExit('cmd:walkScenario', 'no scenarioId'); return; }
        await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider);
        logExit('cmd:walkScenario');
      } catch (err) {
        logError('cmd:walkScenario', err);
        throw err;
      }
    })
  );

  // Next step
  log('debug', 'Registering command: codegraph.nextStep');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.nextStep', () => {
      logEntry('cmd:nextStep');
      stepWalkerProvider.nextStep();
      autoOpenCurrentStep(stepWalkerProvider, workspaceRoot);
      logExit('cmd:nextStep');
    })
  );

  // Previous step
  log('debug', 'Registering command: codegraph.prevStep');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.prevStep', () => {
      logEntry('cmd:prevStep');
      stepWalkerProvider.prevStep();
      autoOpenCurrentStep(stepWalkerProvider, workspaceRoot);
      logExit('cmd:prevStep');
    })
  );

  // Open step in editor
  log('debug', 'Registering command: codegraph.openStepInEditor');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openStepInEditor', async (step: ScenarioStep) => {
      logEntry('cmd:openStepInEditor', { stepNumber: step?.stepNumber, functionName: step?.functionName });
      try {
        if (!step) {
          const currentStep = stepWalkerProvider.getCurrentStep();
          if (currentStep) {
            step = currentStep;
          } else {
            logExit('cmd:openStepInEditor', 'no step');
            return;
          }
        }
        const scenarioView = stepWalkerProvider.getScenarioView();
        await openStepInEditor(step, workspaceRoot, scenarioView?.steps);
        logExit('cmd:openStepInEditor');
      } catch (err) {
        logError('cmd:openStepInEditor', err);
        throw err;
      }
    })
  );

  // Refresh functions
  log('debug', 'Registering command: codegraph.refreshFunctions');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.refreshFunctions', () => {
      logEntry('cmd:refreshFunctions');
      functionsProvider.refresh();
      logExit('cmd:refreshFunctions');
    })
  );

  // Search functions
  log('debug', 'Registering command: codegraph.searchFunctions');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.searchFunctions', async () => {
      logEntry('cmd:searchFunctions');
      try {
        const query = await vscode.window.showInputBox({
          prompt: 'Search functions by name',
          placeHolder: 'e.g., authenticate',
        });
        functionsProvider.setSearch(query || undefined);
        logExit('cmd:searchFunctions', { query });
      } catch (err) {
        logError('cmd:searchFunctions', err);
        throw err;
      }
    })
  );

  // Trace scenario (from tree context menu)
  log('debug', 'Registering command: codegraph.traceScenario');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.traceScenario', async (node: { scenario: { id: string; name: string } }) => {
      const scenarioId = node?.scenario?.id;
      const scenarioName = node?.scenario?.name ?? scenarioId;
      logEntry('cmd:traceScenario', { scenarioId });
      try {
        if (!scenarioId) {
          const input = await vscode.window.showInputBox({
            prompt: 'Enter scenario ID to trace',
            placeHolder: 'e.g., user-login-flow',
          });
          if (!input) { logExit('cmd:traceScenario', 'cancelled'); return; }
          await runTrace(input, input, scenariosProvider, stepWalkerProvider);
        } else {
          await runTrace(scenarioId, scenarioName, scenariosProvider, stepWalkerProvider);
        }
        logExit('cmd:traceScenario');
      } catch (err) {
        logError('cmd:traceScenario', err);
        throw err;
      }
    })
  );

  // Show scenarios for function (from tree context menu)
  log('debug', 'Registering command: codegraph.showScenariosForFunction');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showScenariosForFunction', async (node: { func: { qualifiedName: string } }) => {
      const functionName = node?.func?.qualifiedName;
      logEntry('cmd:showScenariosForFunction', { functionName });
      try {
        if (!functionName) { logExit('cmd:showScenariosForFunction', 'no functionName'); return; }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding scenarios for ${functionName}...` },
          async () => {
            const scenarios = await coreBridge.getScenariosForFunction(functionName);
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
        logExit('cmd:showScenariosForFunction');
      } catch (err) {
        logError('cmd:showScenariosForFunction', err);
        throw err;
      }
    })
  );

  // Discover scenarios from function (from tree context menu)
  log('debug', 'Registering command: codegraph.discoverFromFunction');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.discoverFromFunction', async (node: { func: { qualifiedName: string } }) => {
      const functionName = node?.func?.qualifiedName;
      logEntry('cmd:discoverFromFunction', { functionName });
      try {
        if (!functionName) { logExit('cmd:discoverFromFunction', 'no functionName'); return; }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Discovering scenarios from ${functionName}...`, cancellable: false },
          async () => {
            await coreBridge.discoverFromFunction(functionName);
            scenariosProvider.refresh();
          }
        );
        logExit('cmd:discoverFromFunction');
      } catch (err) {
        logError('cmd:discoverFromFunction', err);
        throw err;
      }
    })
  );

  // Show scenarios for symbol (editor right-click)
  log('debug', 'Registering command: codegraph.showScenariosForSymbol');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showScenariosForSymbol', async () => {
      logEntry('cmd:showScenariosForSymbol');
      try {
        const functionName = getWordUnderCursor();
        if (!functionName) {
          vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
          logExit('cmd:showScenariosForSymbol', 'no word under cursor');
          return;
        }
        log('info', 'Show scenarios for symbol', { functionName });

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding scenarios for "${functionName}"...` },
          async () => {
            const scenarios = await coreBridge.getScenariosForFunction(functionName);
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
        logExit('cmd:showScenariosForSymbol');
      } catch (err) {
        logError('cmd:showScenariosForSymbol', err);
        throw err;
      }
    })
  );

  // Discover scenarios from symbol (editor right-click)
  log('debug', 'Registering command: codegraph.discoverFromSymbol');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.discoverFromSymbol', async () => {
      logEntry('cmd:discoverFromSymbol');
      try {
        const functionName = getWordUnderCursor();
        if (!functionName) {
          vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
          logExit('cmd:discoverFromSymbol', 'no word under cursor');
          return;
        }
        log('info', 'Discover from symbol', { functionName });

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Discovering scenarios from "${functionName}"...`, cancellable: false },
          async () => {
            await coreBridge.discoverFromFunction(functionName);
            scenariosProvider.refresh();
          }
        );
        logExit('cmd:discoverFromSymbol');
      } catch (err) {
        logError('cmd:discoverFromSymbol', err);
        throw err;
      }
    })
  );

  // Find callers of symbol (editor right-click)
  log('debug', 'Registering command: codegraph.findCallers');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.findCallers', async () => {
      logEntry('cmd:findCallers');
      try {
        const functionName = getWordUnderCursor();
        if (!functionName) {
          vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
          logExit('cmd:findCallers', 'no word under cursor');
          return;
        }
        log('info', 'Find callers of symbol', { functionName });

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding callers of "${functionName}"...` },
          async () => {
            const callers = await coreBridge.getCallers(functionName);
            if (callers.length === 0) {
              vscode.window.showInformationMessage(
                `No callers found for "${functionName}".`
              );
              return;
            }
            await showCallRelationQuickPick(callers, `Callers of "${functionName}"`);
          }
        );
        logExit('cmd:findCallers');
      } catch (err) {
        logError('cmd:findCallers', err);
        throw err;
      }
    })
  );

  // Find callees of symbol (editor right-click)
  log('debug', 'Registering command: codegraph.findCallees');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.findCallees', async () => {
      logEntry('cmd:findCallees');
      try {
        const functionName = getWordUnderCursor();
        if (!functionName) {
          vscode.window.showWarningMessage('CodeGraph: Place cursor on a function name first.');
          logExit('cmd:findCallees', 'no word under cursor');
          return;
        }
        log('info', 'Find callees of symbol', { functionName });

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Finding callees of "${functionName}"...` },
          async () => {
            const callees = await coreBridge.getCallees(functionName);
            if (callees.length === 0) {
              vscode.window.showInformationMessage(
                `No callees found for "${functionName}".`
              );
              return;
            }
            await showCallRelationQuickPick(callees, `Callees of "${functionName}"`);
          }
        );
        logExit('cmd:findCallees');
      } catch (err) {
        logError('cmd:findCallees', err);
        throw err;
      }
    })
  );

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      coreBridge.dispose();
    },
  });

  log('info', 'CodeGraph Navigator activated');
  logExit('activate');
}

export function deactivate(): void {
  logEntry('deactivate');
  log('info', 'CodeGraph Navigator deactivated');
  coreBridge.dispose();
  logExit('deactivate');
  disposeLogger();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trace a scenario and reload the updated view in the Step Walker.
 */
async function runTrace(
  scenarioId: string,
  scenarioName: string,
  scenariosProvider: ScenariosProvider,
  stepWalkerProvider: StepWalkerProvider
): Promise<void> {
  logEntry('runTrace', { scenarioId });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Tracing scenario "${scenarioName}"...`,
      cancellable: false,
    },
    async () => {
      const result = await coreBridge.traceScenario(scenarioId);
      if (!result) {
        log('warn', 'runTrace: trace returned null', { scenarioId });
        logExit('runTrace', 'failed');
        return;
      }

      log('info', 'runTrace: trace complete', { scenarioId, ...result });

      vscode.window.showInformationMessage(
        `CodeGraph: Traced "${scenarioName}" — ${result.steps} step(s) in ${result.durationMs}ms.`
      );

      // Refresh the scenarios tree and reload the traced scenario in the walker
      scenariosProvider.refresh();
      await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider);
    }
  );
  logExit('runTrace');
}

/**
 * Load a scenario and display it in the Step Walker.
 */
async function loadAndWalk(
  scenarioId: string,
  scenariosProvider: ScenariosProvider,
  stepWalkerProvider: StepWalkerProvider
): Promise<void> {
  logEntry('loadAndWalk', { scenarioId });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Loading scenario ${scenarioId}...` },
    async () => {
      const view = await scenariosProvider.getScenarioView(scenarioId);
      if (!view) {
        log('warn', 'loadAndWalk: scenario view not found', { scenarioId });
        vscode.window.showErrorMessage(`CodeGraph: Scenario "${scenarioId}" not found.`);
        logExit('loadAndWalk', 'not found');
        return;
      }
      log('debug', 'loadAndWalk: view loaded', { scenarioId, stepCount: view.steps.length });
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
  logExit('loadAndWalk');
}

/**
 * Auto-open the current step in the editor when navigating.
 */
function autoOpenCurrentStep(
  stepWalkerProvider: StepWalkerProvider,
  workspaceRoot: string | undefined
): void {
  logEntry('autoOpenCurrentStep');
  const step = stepWalkerProvider.getCurrentStep();
  if (step) {
    log('debug', 'autoOpenCurrentStep: opening step', { stepNumber: step.stepNumber, functionName: step.functionName });
    const scenarioView = stepWalkerProvider.getScenarioView();
    openStepInEditor(step, workspaceRoot, scenarioView?.steps);
  } else {
    log('debug', 'autoOpenCurrentStep: no current step');
  }
  logExit('autoOpenCurrentStep');
}

/**
 * Get the word (function name) under the cursor in the active editor.
 */
function getWordUnderCursor(): string | undefined {
  logEntry('getWordUnderCursor');
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    logExit('getWordUnderCursor', null);
    return undefined;
  }

  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position);
  if (!wordRange) {
    logExit('getWordUnderCursor', null);
    return undefined;
  }

  const word = editor.document.getText(wordRange);
  logExit('getWordUnderCursor', word);
  return word;
}

/**
 * Show a QuickPick list of call relations (callers or callees) and
 * navigate to the selected function in the editor.
 */
async function showCallRelationQuickPick(
  relations: CallRelation[],
  title: string
): Promise<void> {
  logEntry('showCallRelationQuickPick', { title, count: relations.length });

  const items = relations.map((rel) => ({
    label: rel.function.qualifiedName,
    description: `${rel.filePath}:${rel.line}`,
    detail: rel.callExpression,
    relation: rel,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: title,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (picked) {
    log('info', 'Opening call relation', {
      qualifiedName: picked.relation.function.qualifiedName,
      filePath: picked.relation.filePath,
      line: picked.relation.line,
    });

    const uri = vscode.Uri.file(picked.relation.filePath);
    const line = Math.max(0, picked.relation.line - 1);
    await vscode.window.showTextDocument(uri, {
      selection: new vscode.Range(line, 0, line, 0),
      preview: false,
    });
  }

  logExit('showCallRelationQuickPick');
}
