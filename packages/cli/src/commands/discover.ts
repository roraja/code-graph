/**
 * `codegraph discover` — Discover scenarios in the indexed codebase.
 *
 * Uses the ScenarioDiscoveryAgent to identify likely user-facing scenarios,
 * saves them to the graph, then automatically traces each scenario to
 * generate step-by-step execution data.
 *
 * When `--function <name>` is provided, discovers scenarios that *involve*
 * that function — not necessarily starting from it. The function can appear
 * anywhere in the execution path. Callers and callees of the target are
 * gathered from the graph to give the AI upstream/downstream context.
 *
 * When the AI provider is the Copilot CLI, the prompt is kept minimal
 * (just the user hint and function names) so copilot can search the
 * codebase itself using its tools. Function source code is NOT embedded
 * in the prompt — copilot reads it directly from disk.
 *
 * @module cli/commands/discover
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { FunctionSummary, ScenarioDiscoveryInput } from '@codegraph/core';
import {
  loadFullContext,
  handleError,
  startSpinner,
  formatDuration,
  gracefulExit,
  printHeader,
} from '../helpers.js';

/**
 * Extract a likely function name from a discovery hint.
 *
 * Supports patterns like:
 *   - "GetUrlFromHDrop function in ui/base/clipboard/clipboard_util_win.cc:77"
 *   - "ClassName::MethodName"
 *   - "functionName"
 */
function extractFunctionNameFromHint(hint: string): string | null {
  // Try "FunctionName function in ..." pattern
  const funcInMatch = hint.match(/^(\S+)\s+function\s+in\s+/i);
  if (funcInMatch) return funcInMatch[1];

  // Try first word if it looks like a qualified name (contains ::)
  const qualifiedMatch = hint.match(/(\w+(?:::\w+)+)/);
  if (qualifiedMatch) return qualifiedMatch[1];

  // Try first word if it looks like a function name (PascalCase or camelCase)
  const firstWord = hint.split(/\s+/)[0];
  if (firstWord && /^[A-Za-z_]\w*$/.test(firstWord)) return firstWord;

  return null;
}

/**
 * Convert a graph FunctionNode to the lightweight FunctionSummary shape
 * used by the discovery agent.
 */
function toFunctionSummary(f: {
  id: string;
  name: string;
  qualifiedName?: string;
  signature: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  returnType?: string;
  visibility?: string;
  language?: string;
  documentation?: string;
  sourceCode?: string;
  isAsync?: boolean;
  isAbstract?: boolean;
  parameters?: Array<{ name: string; type: string; isOptional: boolean; defaultValue?: string }>;
}): FunctionSummary {
  return {
    id: f.id,
    name: f.qualifiedName || f.name,
    qualifiedName: f.qualifiedName,
    signature: f.signature,
    filePath: f.filePath,
    startLine: f.startLine,
    endLine: f.endLine,
    returnType: f.returnType,
    visibility: f.visibility,
    language: f.language,
    documentation: f.documentation,
    sourceCode: f.sourceCode,
    isAsync: f.isAsync,
    isAbstract: f.isAbstract,
    parameters: f.parameters,
  };
}

/**
 * Register the `discover` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerDiscoverCommand(program: Command): void {
  program
    .command('discover')
    .description('Discover scenarios in the indexed codebase')
    .option('--hint <text>', 'Provide a hint to guide discovery')
    .option(
      '--function <name>',
      'Discover scenarios that involve (call) this function, not just ones starting from it',
    )
    .option('--count <n>', 'Maximum number of scenarios to discover', '5')
    .option('--no-trace', 'Skip automatic tracing of discovered scenarios')
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadFullContext(configPath);

        const targetFunctionName: string | undefined = opts.function;
        const isTargetMode = !!targetFunctionName;

        const spinnerText = isTargetMode
          ? `Finding scenarios involving "${targetFunctionName}"...`
          : 'Analyzing codebase for scenarios...';
        const spinner = startSpinner(spinnerText);

        // Build a lightweight list of function names from the graph.
        // We do NOT include source code or full details — the AI provider
        // (Copilot CLI) will search/read the codebase itself using its tools.
        // This keeps the prompt small and lets copilot do deep analysis.
        const allFunctions = await ctx.queryEngine.searchFunctions('', 100);

        // If a hint is provided, also search for hint-related functions
        let hintFunctions: typeof allFunctions = [];
        if (opts.hint) {
          const funcName = extractFunctionNameFromHint(opts.hint);
          if (funcName) {
            hintFunctions = await ctx.queryEngine.searchFunctions(funcName, 20);
          }
        }

        // Merge: hint functions first, then general (deduplicated)
        const seenIds = new Set<string>();
        const mergedFunctions = [...hintFunctions, ...allFunctions].filter(
          (f) => {
            if (seenIds.has(f.id)) return false;
            seenIds.add(f.id);
            return true;
          }
        );

        // Send minimal function info: name, signature, file path only.
        // No source code — copilot reads files directly.
        const entryPoints = mergedFunctions.map((f) => toFunctionSummary(f));

        // Build the discovery input
        const discoveryInput: ScenarioDiscoveryInput = {
          entryPoints,
          eventHandlers: [],
          publicAPIs: entryPoints,
          userHint: opts.hint,
        };

        // --function mode: find the target, its callers, and callees
        if (isTargetMode) {
          // Resolve the target function from the graph
          const targetFunc =
            (await ctx.queryEngine.getFunctionByName(targetFunctionName)) ??
            mergedFunctions.find(
              (f) =>
                f.name === targetFunctionName ||
                f.qualifiedName === targetFunctionName ||
                f.qualifiedName?.endsWith(`::${targetFunctionName}`) ||
                f.qualifiedName?.endsWith(`.${targetFunctionName}`) ||
                f.name.includes(targetFunctionName) ||
                f.qualifiedName?.includes(targetFunctionName),
            );

          if (!targetFunc) {
            spinner.fail(
              `Function "${targetFunctionName}" not found in the graph. ` +
              `Try running ${chalk.cyan('codegraph index')} first.`,
            );
            await gracefulExit(ctx.driver, 1);
            return;
          }

          discoveryInput.targetFunction = toFunctionSummary(targetFunc);

          // Gather callers (upstream context)
          const callerRelations = await ctx.queryEngine.getCallers(targetFunc.id);
          discoveryInput.targetCallers = callerRelations.map((r) =>
            toFunctionSummary(r.function),
          );

          // Gather callees (downstream context)
          const calleeRelations = await ctx.queryEngine.getCallees(targetFunc.id);
          discoveryInput.targetCallees = calleeRelations.map((r) =>
            toFunctionSummary(r.function),
          );
        }

        const scenarios = await ctx.discoveryAgent.discover(discoveryInput);

        const targetLabel = isTargetMode
          ? ` involving ${chalk.cyan(targetFunctionName)}`
          : '';
        spinner.succeed(
          `Discovered ${chalk.bold(String(scenarios.length))} scenarios${targetLabel}`
        );

        if (scenarios.length === 0) {
          const tip = isTargetMode
            ? `  No scenarios found involving "${targetFunctionName}". Try adding a --hint.`
            : '  No scenarios found. Try adding a --hint.';
          console.log(chalk.yellow(tip));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        const maxCount = parseInt(opts.count, 10);
        const toProcess = scenarios.slice(0, maxCount);

        // Save discovered scenarios to the graph
        const saveSpinner = startSpinner('Saving scenarios...');
        const savedIds: string[] = [];
        for (const s of toProcess) {
          const created = await ctx.scenarioEngine.createScenario({
            name: s.name,
            description: s.description,
            entryFunction: s.entryFunction,
            triggerCondition: s.triggerCondition,
            discoveredBy: 'ai',
            confidence: s.confidence,
          });
          savedIds.push(created.id);
        }
        saveSpinner.succeed(`${savedIds.length} scenarios saved to graph`);

        // Auto-trace each discovered scenario (unless --no-trace)
        if (opts.trace !== false) {
          console.log();
          printHeader('Tracing Scenarios');

          for (let i = 0; i < savedIds.length; i++) {
            const scenarioId = savedIds[i];
            const scenario = await ctx.scenarioEngine.getScenario(scenarioId);
            if (!scenario) continue;

            const traceSpinner = startSpinner(
              `[${i + 1}/${savedIds.length}] Tracing: ${scenario.name}...`
            );
            const startTime = Date.now();

            try {
              const result = await ctx.scenarioTracer.trace(scenario, {
                maxDepth: 50,
              });

              await ctx.scenarioEngine.saveSteps(scenarioId, result.steps);

              const duration = Date.now() - startTime;
              traceSpinner.succeed(
                `[${i + 1}/${savedIds.length}] ${scenario.name} — ` +
                `${result.steps.length} steps, ` +
                `${result.functionsTraversed} functions, ` +
                `${result.branchDecisions} branches ` +
                `(${formatDuration(duration)})`
              );
            } catch (traceErr) {
              const msg = traceErr instanceof Error ? traceErr.message : String(traceErr);
              traceSpinner.fail(
                `[${i + 1}/${savedIds.length}] ${scenario.name} — trace failed: ${msg}`
              );
              // Continue to next scenario — don't abort the whole run
            }
          }
        }

        // Display table
        console.log();
        printHeader(
          isTargetMode
            ? `Scenarios Involving ${targetFunctionName}`
            : 'Discovered Scenarios',
        );
        const table = new Table({
          head: [
            chalk.cyan('Name'),
            chalk.cyan('Entry Function'),
            chalk.cyan('Confidence'),
            chalk.cyan('Trigger'),
          ],
          colWidths: [30, 30, 12, 40],
          wordWrap: true,
        });

        for (const s of toProcess) {
          const confidence = (s.confidence * 100).toFixed(0) + '%';
          const confColor =
            s.confidence >= 0.8
              ? chalk.green(confidence)
              : s.confidence >= 0.5
                ? chalk.yellow(confidence)
                : chalk.red(confidence);

          table.push([s.name, s.entryFunction, confColor, s.triggerCondition]);
        }

        console.log(table.toString());

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
