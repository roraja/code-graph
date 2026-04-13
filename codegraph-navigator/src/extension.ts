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
 *   - Five sidebar views: Scenarios, Step Walker, Step Detail (webview), Call Stack (webview), Functions.
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
import { StepDetailViewProvider } from './providers/step-detail-view.js';
import { CallStackViewProvider } from './providers/call-stack-view.js';
import { FunctionsProvider } from './providers/functions.js';
import { CodeWalkCellsViewProvider } from './providers/codewalk-cells-view.js';
import { openStepInEditor } from './decorations.js';
import { openCellInEditor } from './codewalk-decorations.js';
import { registerInstallSkillsCommand } from './skills-installer.js';
import type { ScenarioStep, CallRelation, CallStackFrame, CodeWalk } from '@codegraph/core';

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
  const stepDetailViewProvider = new StepDetailViewProvider();
  const callStackViewProvider = new CallStackViewProvider();
  const functionsProvider = new FunctionsProvider();
  const codeWalkCellsViewProvider = new CodeWalkCellsViewProvider();

  // Register tree data providers
  const scenariosTreeView = vscode.window.createTreeView('codegraph.scenarios', {
    treeDataProvider: scenariosProvider,
  });
  scenariosTreeView.description = `v${context.extension.packageJSON.version}`;
  context.subscriptions.push(
    scenariosTreeView,
    vscode.window.registerTreeDataProvider('codegraph.stepWalker', stepWalkerProvider),
    vscode.window.registerWebviewViewProvider(StepDetailViewProvider.viewType, stepDetailViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(CallStackViewProvider.viewType, callStackViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider('codegraph.functions', functionsProvider),
    vscode.window.registerWebviewViewProvider(CodeWalkCellsViewProvider.viewType, codeWalkCellsViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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

  // Filter scenarios by tags
  log('debug', 'Registering command: codegraph.filterScenarios');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.filterScenarios', async () => {
      logEntry('cmd:filterScenarios');
      try {
        const current = scenariosProvider.getFilterText();
        const query = await vscode.window.showInputBox({
          prompt: 'Filter scenarios by tags (e.g., #clipboard #dragDrop). Leave empty to clear.',
          placeHolder: '#clipboard #auth',
          value: current,
        });
        if (query === undefined) {
          // User cancelled — do nothing
          logExit('cmd:filterScenarios', 'cancelled');
          return;
        }
        scenariosProvider.setFilter(query || undefined);
        // Update the tree view description to show active filter
        if (query) {
          scenariosTreeView.description = `Filter: ${query}`;
        } else {
          scenariosTreeView.description = `v${context.extension.packageJSON.version}`;
        }
        logExit('cmd:filterScenarios', { query });
      } catch (err) {
        logError('cmd:filterScenarios', err);
        throw err;
      }
    })
  );

  // Add tags to a scenario
  log('debug', 'Registering command: codegraph.addTags');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.addTags', async (node: { scenario: { id: string; name: string; tags: string[] } }) => {
      const scenarioId = node?.scenario?.id;
      const scenarioName = node?.scenario?.name ?? scenarioId;
      const currentTags = node?.scenario?.tags ?? [];
      logEntry('cmd:addTags', { scenarioId });
      try {
        if (!scenarioId) { logExit('cmd:addTags', 'no scenarioId'); return; }
        const input = await vscode.window.showInputBox({
          prompt: `Add tags to "${scenarioName}" (space-separated, e.g., #clipboard #dragDrop)`,
          placeHolder: '#clipboard #dragDrop #cl-232445',
          value: currentTags.length > 0 ? currentTags.join(' ') + ' ' : '',
        });
        if (input === undefined) { logExit('cmd:addTags', 'cancelled'); return; }

        // Parse all #tags from the input
        const tagMatches = input.match(/#\S+/g);
        if (!tagMatches || tagMatches.length === 0) {
          vscode.window.showWarningMessage('No tags provided. Tags must start with # (e.g., #clipboard).');
          logExit('cmd:addTags', 'no tags');
          return;
        }

        await coreBridge.addTags(scenarioId, tagMatches);
        scenariosProvider.refresh();
        vscode.window.showInformationMessage(`Tags added to "${scenarioName}": ${tagMatches.join(' ')}`);
        logExit('cmd:addTags', { tags: tagMatches });
      } catch (err) {
        logError('cmd:addTags', err);
        throw err;
      }
    })
  );

  // Set tags on a scenario (replace all)
  log('debug', 'Registering command: codegraph.setTags');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.setTags', async (node: { scenario: { id: string; name: string; tags: string[] } }) => {
      const scenarioId = node?.scenario?.id;
      const scenarioName = node?.scenario?.name ?? scenarioId;
      const currentTags = node?.scenario?.tags ?? [];
      logEntry('cmd:setTags', { scenarioId });
      try {
        if (!scenarioId) { logExit('cmd:setTags', 'no scenarioId'); return; }
        const input = await vscode.window.showInputBox({
          prompt: `Set tags for "${scenarioName}" (replaces existing tags, space-separated)`,
          placeHolder: '#clipboard #dragDrop',
          value: currentTags.join(' '),
        });
        if (input === undefined) { logExit('cmd:setTags', 'cancelled'); return; }

        // Parse all #tags from the input (empty input clears tags)
        const tagMatches = input.match(/#\S+/g) ?? [];

        await coreBridge.setTags(scenarioId, tagMatches);
        scenariosProvider.refresh();
        if (tagMatches.length > 0) {
          vscode.window.showInformationMessage(`Tags set on "${scenarioName}": ${tagMatches.join(' ')}`);
        } else {
          vscode.window.showInformationMessage(`Tags cleared on "${scenarioName}".`);
        }
        logExit('cmd:setTags', { tags: tagMatches });
      } catch (err) {
        logError('cmd:setTags', err);
        throw err;
      }
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
          await loadAndWalk(input, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
        } else {
          await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
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
        await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
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
      try {
        stepWalkerProvider.nextStep();
        autoOpenCurrentStep(stepWalkerProvider, stepDetailViewProvider, callStackViewProvider, workspaceRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', 'cmd:nextStep failed', { error: msg });
      }
      logExit('cmd:nextStep');
    })
  );

  // Previous step
  log('debug', 'Registering command: codegraph.prevStep');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.prevStep', () => {
      logEntry('cmd:prevStep');
      try {
        stepWalkerProvider.prevStep();
        autoOpenCurrentStep(stepWalkerProvider, stepDetailViewProvider, callStackViewProvider, workspaceRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', 'cmd:prevStep failed', { error: msg });
      }
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

  // Open call stack frame in editor (navigate to a specific stack frame)
  log('debug', 'Registering command: codegraph.openCallStackFrame');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openCallStackFrame', async (frame: CallStackFrame) => {
      logEntry('cmd:openCallStackFrame', {
        functionName: frame?.functionName,
        filePath: frame?.filePath,
        line: frame?.line,
      });
      try {
        if (!frame || !frame.filePath) {
          logExit('cmd:openCallStackFrame', 'no frame');
          return;
        }

        // Resolve the file path (may be relative to workspace)
        let filePath = frame.filePath;
        if (!filePath.startsWith('/') && workspaceRoot) {
          const path = await import('node:path');
          filePath = path.join(workspaceRoot, filePath);
        }

        const uri = vscode.Uri.file(filePath);
        const line = Math.max(0, frame.line - 1);
        await vscode.window.showTextDocument(uri, {
          selection: new vscode.Range(line, 0, line, 0),
          preview: false,
        });
        logExit('cmd:openCallStackFrame');
      } catch (err) {
        logError('cmd:openCallStackFrame', err);
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`CodeGraph: Could not open file — ${message}`);
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
          await runTrace(input, input, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
        } else {
          await runTrace(scenarioId, scenarioName, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
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
              await loadAndWalk(picked.id, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
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
              await loadAndWalk(picked.id, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
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

  // --- Code Walk Commands ---

  // Open Code Walk for a scenario (from scenario context menu) or standalone
  log('debug', 'Registering command: codegraph.openCodeWalk');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openCodeWalk', async (node?: { scenario: { id: string; name: string } }) => {
      const scenarioId = node?.scenario?.id;
      const scenarioName = node?.scenario?.name ?? scenarioId;
      logEntry('cmd:openCodeWalk', { scenarioId });
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: scenarioId ? `Loading code walk for "${scenarioName}"...` : 'Loading code walks...' },
          async () => {
            let walk: CodeWalk | null = null;

            // Try by scenarioId first
            if (scenarioId) {
              walk = await coreBridge.getCodeWalkForScenario(scenarioId);
            }

            // If no walk found by scenarioId, show a picker of all walks
            if (!walk) {
              const walks = await coreBridge.listCodeWalks();
              if (walks.length === 0) {
                vscode.window.showWarningMessage(
                  'CodeGraph: No code walks found. Create one with the codewalk-populate skill.'
                );
                return;
              }
              if (walks.length === 1) {
                // Only one walk, use it directly
                walk = walks[0];
              } else {
                const picked = await vscode.window.showQuickPick(
                  walks.map(w => ({
                    label: w.name,
                    description: `${w.cells.length} cells`,
                    detail: w.description,
                    walkId: w.id,
                  })),
                  { placeHolder: 'Select a code walk' }
                );
                if (!picked) { logExit('cmd:openCodeWalk', 'cancelled'); return; }
                walk = await coreBridge.getCodeWalk(picked.walkId);
              }
            }

            if (!walk) {
              logExit('cmd:openCodeWalk', 'not found');
              return;
            }

            codeWalkCellsViewProvider.loadWalk(walk);
            // Focus the code walk view
            await vscode.commands.executeCommand('codegraph.codeWalkCells.focus');
            // Open the first cell in editor
            const firstCell = codeWalkCellsViewProvider.getCurrentCell();
            if (firstCell) {
              await openCellInEditor(firstCell, workspaceRoot, walk);
            }
          }
        );
        logExit('cmd:openCodeWalk');
      } catch (err) {
        logError('cmd:openCodeWalk', err);
        throw err;
      }
    })
  );

  // Open a Code Walk directly by ID
  log('debug', 'Registering command: codegraph.openCodeWalkById');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openCodeWalkById', async (walkOrId?: CodeWalk | string) => {
      logEntry('cmd:openCodeWalkById');
      try {
        let walk: CodeWalk | null = null;

        if (typeof walkOrId === 'string') {
          walk = await coreBridge.getCodeWalk(walkOrId);
        } else if (walkOrId && typeof walkOrId === 'object' && 'cells' in walkOrId) {
          walk = walkOrId;
        } else {
          // Show a picker
          const walks = await coreBridge.listCodeWalks();
          if (walks.length === 0) {
            vscode.window.showInformationMessage('CodeGraph: No code walks found.');
            logExit('cmd:openCodeWalkById', 'no walks');
            return;
          }
          const picked = await vscode.window.showQuickPick(
            walks.map(w => ({
              label: w.name,
              description: `${w.cells.length} cells`,
              detail: w.description,
              walkId: w.id,
            })),
            { placeHolder: 'Select a code walk' }
          );
          if (!picked) { logExit('cmd:openCodeWalkById', 'cancelled'); return; }
          walk = await coreBridge.getCodeWalk(picked.walkId);
        }

        if (!walk) {
          vscode.window.showWarningMessage('CodeGraph: Code walk not found.');
          logExit('cmd:openCodeWalkById', 'not found');
          return;
        }

        codeWalkCellsViewProvider.loadWalk(walk);
        await vscode.commands.executeCommand('codegraph.codeWalkCells.focus');
        const firstCell = codeWalkCellsViewProvider.getCurrentCell();
        if (firstCell) {
          await openCellInEditor(firstCell, workspaceRoot, walk);
        }
        logExit('cmd:openCodeWalkById');
      } catch (err) {
        logError('cmd:openCodeWalkById', err);
        throw err;
      }
    })
  );

  // Code Walk: Next Cell
  log('debug', 'Registering command: codegraph.nextCell');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.nextCell', () => {
      logEntry('cmd:nextCell');
      try {
        codeWalkCellsViewProvider.nextCell();
        const cell = codeWalkCellsViewProvider.getCurrentCell();
        const walk = codeWalkCellsViewProvider.getWalk();
        if (cell && walk) {
          openCellInEditor(cell, workspaceRoot, walk);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', 'cmd:nextCell failed', { error: msg });
      }
      logExit('cmd:nextCell');
    })
  );

  // Code Walk: Previous Cell
  log('debug', 'Registering command: codegraph.prevCell');
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.prevCell', () => {
      logEntry('cmd:prevCell');
      try {
        codeWalkCellsViewProvider.prevCell();
        const cell = codeWalkCellsViewProvider.getCurrentCell();
        const walk = codeWalkCellsViewProvider.getWalk();
        if (cell && walk) {
          openCellInEditor(cell, workspaceRoot, walk);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('error', 'cmd:prevCell failed', { error: msg });
      }
      logExit('cmd:prevCell');
    })
  );

  // Sync cell changes from webview to editor
  codeWalkCellsViewProvider.onCellChanged((data) => {
    if (data) {
      openCellInEditor(data.cell, workspaceRoot, data.walk, data.step);
    }
  });

  // --- Install Skills Command ---
  log('debug', 'Registering command: codegraph.installSkills');
  context.subscriptions.push(registerInstallSkillsCommand(context));

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
  stepWalkerProvider: StepWalkerProvider,
  stepDetailViewProvider: StepDetailViewProvider,
  callStackViewProvider: CallStackViewProvider
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
      await loadAndWalk(scenarioId, scenariosProvider, stepWalkerProvider, stepDetailViewProvider, callStackViewProvider);
    }
  );
  logExit('runTrace');
}

/**
 * Load a scenario and display it in the Step Walker + Step Detail + Call Stack.
 */
async function loadAndWalk(
  scenarioId: string,
  scenariosProvider: ScenariosProvider,
  stepWalkerProvider: StepWalkerProvider,
  stepDetailViewProvider: StepDetailViewProvider,
  callStackViewProvider: CallStackViewProvider
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

      // Auto-open the first step and show detail + call stack
      const firstStep = stepWalkerProvider.getCurrentStep();
      if (firstStep) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        await openStepInEditor(firstStep, workspaceRoot, view.steps);
        stepDetailViewProvider.showStep(firstStep, view);
        callStackViewProvider.showStep(firstStep, view);
      }
    }
  );
  logExit('loadAndWalk');
}

/**
 * Auto-open the current step in the editor and update the detail + call stack views.
 */
function autoOpenCurrentStep(
  stepWalkerProvider: StepWalkerProvider,
  stepDetailViewProvider: StepDetailViewProvider,
  callStackViewProvider: CallStackViewProvider,
  workspaceRoot: string | undefined
): void {
  logEntry('autoOpenCurrentStep');
  const step = stepWalkerProvider.getCurrentStep();
  if (step) {
    log('debug', 'autoOpenCurrentStep: opening step', { stepNumber: step.stepNumber, functionName: step.functionName });
    const scenarioView = stepWalkerProvider.getScenarioView();
    openStepInEditor(step, workspaceRoot, scenarioView?.steps);
    stepDetailViewProvider.showStep(step, scenarioView);
    callStackViewProvider.showStep(step, scenarioView);
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
