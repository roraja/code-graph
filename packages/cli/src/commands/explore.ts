/**
 * `codegraph explore` — Interactive codebase exploration.
 *
 * Flagship interactive command that provides a menu-driven interface for
 * browsing the indexed codebase graph: searching functions, viewing call
 * graphs, browsing scenarios, running AI discovery, and checking system health.
 *
 * Supports a `--mock` flag for demo mode without a Neo4j connection.
 *
 * @module cli/commands/explore
 */

import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadContext,
  loadFullContext,
  handleError,
  printHeader,
  printScenarioSummary,
  printStepDetail,
  printCallTree,
  getMockFunctions,
  getMockScenarios,
  getMockSteps,
  getMockCallers,
  getMockCallees,
  type CLIContext,
  type MockCallRelation,
} from '../helpers.js';
import type { FunctionNode, Scenario, ScenarioStep } from '@codegraph/core';

/** Interface for data providers — either live or mock */
interface ExploreProvider {
  searchFunctions(query: string): Promise<FunctionNode[]>;
  listScenarios(): Promise<Scenario[]>;
  getScenarioSteps(scenarioId: string): Promise<ScenarioStep[]>;
  getCallers(functionName: string): Promise<MockCallRelation[]>;
  getCallees(functionName: string): Promise<MockCallRelation[]>;
  getStats(): Promise<{ nodes: Record<string, number>; relationships: Record<string, number>; totalNodes: number; totalRelationships: number }>;
  runDiscovery(hint?: string): Promise<Array<{ name: string; entryFunction: string; confidence: number; description: string }>>;
  runDoctor(): Promise<Array<{ status: string; message: string }>>;
  disconnect(): Promise<void>;
}

/** Create a mock data provider for demo mode */
function createMockProvider(): ExploreProvider {
  const mockFunctions = getMockFunctions();
  const mockScenarios = getMockScenarios();

  return {
    async searchFunctions(query: string) {
      if (!query) return mockFunctions;
      const q = query.toLowerCase();
      return mockFunctions.filter(
        (f) => f.name.toLowerCase().includes(q) || f.qualifiedName.toLowerCase().includes(q)
      );
    },
    async listScenarios() {
      return mockScenarios;
    },
    async getScenarioSteps(scenarioId: string) {
      return getMockSteps(scenarioId);
    },
    async getCallers(functionName: string) {
      return getMockCallers(functionName);
    },
    async getCallees(functionName: string) {
      return getMockCallees(functionName);
    },
    async getStats() {
      return {
        nodes: { Function: 42, Class: 8, File: 12, Branch: 25, Variable: 67, Scenario: 3 },
        relationships: { CALLS: 89, CONTAINS: 42, EXTENDS: 3, HAS_STEP: 11 },
        totalNodes: 157,
        totalRelationships: 145,
      };
    },
    async runDiscovery(hint?: string) {
      return [
        { name: 'Password Reset Flow', entryFunction: 'AuthService.resetPassword', confidence: 0.78, description: `Discovered via hint: ${hint ?? 'auto'}` },
        { name: 'Token Refresh', entryFunction: 'TokenService.refreshToken', confidence: 0.72, description: 'Auto-discovered from exported functions' },
      ];
    },
    async runDoctor() {
      return [
        { status: 'pass', message: `Node.js ${process.version}` },
        { status: 'pass', message: 'Configuration: mock mode' },
        { status: 'skip', message: 'Neo4j: mock mode (skipped)' },
        { status: 'pass', message: 'AI provider: mock' },
      ];
    },
    async disconnect() {
      // no-op
    },
  };
}

/** Create a live provider that connects to Neo4j */
function createLiveProvider(ctx: CLIContext): ExploreProvider {
  return {
    async searchFunctions(query: string) {
      return ctx.queryEngine.searchFunctions(query, 50);
    },
    async listScenarios() {
      return ctx.scenarioEngine.listScenarios();
    },
    async getScenarioSteps(scenarioId: string) {
      return ctx.scenarioEngine.getSteps(scenarioId);
    },
    async getCallers(functionName: string) {
      const fn = await ctx.queryEngine.getFunctionByName(functionName);
      if (!fn) return [];
      const callers = await ctx.queryEngine.getCallers(fn.id);
      return callers.map((c) => ({
        functionName: c.function.qualifiedName,
        filePath: c.filePath,
        line: c.line,
      }));
    },
    async getCallees(functionName: string) {
      const fn = await ctx.queryEngine.getFunctionByName(functionName);
      if (!fn) return [];
      const callees = await ctx.queryEngine.getCallees(fn.id);
      return callees.map((c) => ({
        functionName: c.function.qualifiedName,
        filePath: c.filePath,
        line: c.line,
      }));
    },
    async getStats() {
      return ctx.queryEngine.getStats();
    },
    async runDiscovery(_hint?: string) {
      return [
        { name: '(Run `codegraph discover` for full AI discovery)', entryFunction: '-', confidence: 0, description: '' },
      ];
    },
    async runDoctor() {
      return [
        { status: 'pass', message: `Node.js ${process.version}` },
        { status: 'pass', message: 'Neo4j: connected' },
      ];
    },
    async disconnect() {
      await ctx.driver.disconnect();
    },
  };
}

/**
 * Register the `explore` command on the CLI program.
 */
export function registerExploreCommand(program: Command): void {
  program
    .command('explore')
    .description('Interactive codebase exploration')
    .option('--mock', 'Use mock data (demo mode, no Neo4j required)', false)
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        let provider: ExploreProvider;
        if (opts.mock) {
          console.log(chalk.yellow('  Running in mock/demo mode'));
          provider = createMockProvider();
        } else {
          const ctx = await loadContext(configPath);
          provider = createLiveProvider(ctx);
        }

        await runExploreLoop(provider);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

/**
 * Main interactive menu loop.
 */
async function runExploreLoop(provider: ExploreProvider): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const printBanner = () => {
    console.log();
    console.log(chalk.bold('╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold('║  ') + chalk.bold.cyan('CodeGraph Explorer') + chalk.bold('                                         ║'));
    console.log(chalk.bold('╚══════════════════════════════════════════════════════════════╝'));
    console.log();
  };

  printBanner();

  let running = true;
  while (running) {
    console.log(chalk.bold('? What would you like to do?'));
    console.log(`  ${chalk.cyan('1')} 🔍 Search functions`);
    console.log(`  ${chalk.cyan('2')} 📋 Browse scenarios`);
    console.log(`  ${chalk.cyan('3')} 🌳 View call graph for a function`);
    console.log(`  ${chalk.cyan('4')} 🔄 Discover new scenarios (AI)`);
    console.log(`  ${chalk.cyan('5')} 📊 View graph statistics`);
    console.log(`  ${chalk.cyan('6')} 🏥 System health check`);
    console.log(`  ${chalk.cyan('7')} ❌ Exit`);
    console.log();

    const choice = (await rl.question(chalk.cyan('Choice: '))).trim();

    switch (choice) {
      case '1':
        await handleSearchFunctions(rl, provider);
        break;
      case '2':
        await handleBrowseScenarios(rl, provider);
        break;
      case '3':
        await handleCallGraph(rl, provider);
        break;
      case '4':
        await handleDiscovery(rl, provider);
        break;
      case '5':
        await handleStats(provider);
        break;
      case '6':
        await handleDoctor(provider);
        break;
      case '7':
      case 'q':
      case 'quit':
      case 'exit':
        running = false;
        break;
      default:
        console.log(chalk.red('  Invalid choice. Enter 1-7.'));
    }
    console.log();
  }

  rl.close();
  await provider.disconnect();
  console.log(chalk.dim('Goodbye!'));
}

async function handleSearchFunctions(
  rl: readline.Interface,
  provider: ExploreProvider
): Promise<void> {
  const query = (await rl.question(chalk.cyan('  Search term: '))).trim();
  const results = await provider.searchFunctions(query);

  if (results.length === 0) {
    console.log(chalk.yellow('  No functions found.'));
    return;
  }

  printHeader('Search Results');
  const table = new Table({
    head: ['#', 'Name', 'File', 'Line', 'Async', 'Exported'].map((h) => chalk.cyan(h)),
    colWidths: [4, 35, 30, 7, 7, 10],
    wordWrap: true,
  });
  results.forEach((f, i) => {
    table.push([
      String(i + 1),
      f.qualifiedName,
      f.filePath,
      String(f.startLine),
      f.isAsync ? '✔' : '',
      f.isExported ? '✔' : '',
    ]);
  });
  console.log(table.toString());

  // Allow selecting a function for detail
  const sel = (await rl.question(chalk.cyan('  Select # for details (or Enter to skip): '))).trim();
  const idx = parseInt(sel, 10) - 1;
  if (idx >= 0 && idx < results.length) {
    const fn = results[idx]!;
    console.log();
    console.log(chalk.bold('Function Detail:'));
    console.log(`  ${chalk.dim('Name:')}       ${chalk.cyan(fn.qualifiedName)}`);
    console.log(`  ${chalk.dim('Signature:')}  ${fn.signature}`);
    console.log(`  ${chalk.dim('File:')}       ${fn.filePath}:${fn.startLine}-${fn.endLine}`);
    console.log(`  ${chalk.dim('Return:')}     ${fn.returnType}`);
    console.log(`  ${chalk.dim('Visibility:')} ${fn.visibility}`);
    console.log(`  ${chalk.dim('Params:')}     ${fn.parameters.map((p) => `${p.name}: ${p.type}`).join(', ') || '(none)'}`);
    if (fn.documentation) {
      console.log(`  ${chalk.dim('Docs:')}       ${fn.documentation}`);
    }

    // Show callers/callees
    const callers = await provider.getCallers(fn.qualifiedName);
    const callees = await provider.getCallees(fn.qualifiedName);
    printCallTree(fn.qualifiedName, callers, callees);
  }
}

async function handleBrowseScenarios(
  rl: readline.Interface,
  provider: ExploreProvider
): Promise<void> {
  const scenarios = await provider.listScenarios();
  if (scenarios.length === 0) {
    console.log(chalk.yellow('  No scenarios found.'));
    return;
  }

  printHeader('Scenarios');
  const table = new Table({
    head: ['#', 'ID', 'Name', 'Status', 'Confidence'].map((h) => chalk.cyan(h)),
    colWidths: [4, 25, 28, 12, 12],
    wordWrap: true,
  });
  scenarios.forEach((s, i) => {
    const statusColors: Record<string, (t: string) => string> = {
      draft: chalk.dim, traced: chalk.blue, validated: chalk.green, corrected: chalk.yellow,
    };
    const color = statusColors[s.status] ?? chalk.white;
    table.push([
      String(i + 1),
      s.id,
      s.name,
      color(s.status),
      (s.confidence * 100).toFixed(0) + '%',
    ]);
  });
  console.log(table.toString());

  const sel = (await rl.question(chalk.cyan('  Select # to view (or Enter to skip): '))).trim();
  const idx = parseInt(sel, 10) - 1;
  if (idx >= 0 && idx < scenarios.length) {
    const scenario = scenarios[idx]!;
    console.log();
    printScenarioSummary(scenario);

    const steps = await provider.getScenarioSteps(scenario.id);
    if (steps.length > 0) {
      console.log();
      console.log(chalk.bold(`  Steps (${steps.length}):`));
      for (const step of steps) {
        printStepDetail(step, steps.length);
      }
    } else {
      console.log(chalk.dim('  No steps traced yet.'));
    }
  }
}

async function handleCallGraph(
  rl: readline.Interface,
  provider: ExploreProvider
): Promise<void> {
  const name = (await rl.question(chalk.cyan('  Function name: '))).trim();
  if (!name) return;

  const callers = await provider.getCallers(name);
  const callees = await provider.getCallees(name);

  if (callers.length === 0 && callees.length === 0) {
    console.log(chalk.yellow(`  No call graph data found for "${name}".`));
    return;
  }

  printCallTree(name, callers, callees);
}

async function handleDiscovery(
  rl: readline.Interface,
  provider: ExploreProvider
): Promise<void> {
  const hint = (await rl.question(chalk.cyan('  Discovery hint (or Enter for auto): '))).trim();
  console.log(chalk.dim('  Discovering scenarios...'));
  const results = await provider.runDiscovery(hint || undefined);

  if (results.length === 0) {
    console.log(chalk.yellow('  No scenarios discovered.'));
    return;
  }

  printHeader('Discovered Scenarios');
  const table = new Table({
    head: ['Name', 'Entry Function', 'Confidence'].map((h) => chalk.cyan(h)),
    colWidths: [30, 35, 12],
    wordWrap: true,
  });
  for (const s of results) {
    const conf = (s.confidence * 100).toFixed(0) + '%';
    table.push([s.name, s.entryFunction, conf]);
  }
  console.log(table.toString());
}

async function handleStats(provider: ExploreProvider): Promise<void> {
  const stats = await provider.getStats();

  printHeader('Graph Statistics');
  const nodeTable = new Table({
    head: [chalk.cyan('Node Type'), chalk.cyan('Count')],
    colAligns: ['left', 'right'],
    colWidths: [30, 15],
  });
  for (const [label, count] of Object.entries(stats.nodes)) {
    nodeTable.push([label, String(count)]);
  }
  nodeTable.push([chalk.bold('Total Nodes'), chalk.bold(String(stats.totalNodes))]);
  console.log(nodeTable.toString());

  console.log();
  const relTable = new Table({
    head: [chalk.cyan('Relationship'), chalk.cyan('Count')],
    colAligns: ['left', 'right'],
    colWidths: [30, 15],
  });
  for (const [relType, count] of Object.entries(stats.relationships)) {
    relTable.push([relType, String(count)]);
  }
  relTable.push([chalk.bold('Total Relationships'), chalk.bold(String(stats.totalRelationships))]);
  console.log(relTable.toString());
}

async function handleDoctor(provider: ExploreProvider): Promise<void> {
  printHeader('System Health Check');
  const checks = await provider.runDoctor();
  for (const check of checks) {
    switch (check.status) {
      case 'pass':
        console.log(chalk.green('  ✔ ') + check.message);
        break;
      case 'fail':
        console.log(chalk.red('  ✖ ') + check.message);
        break;
      case 'warn':
        console.log(chalk.yellow('  ⚠ ') + check.message);
        break;
      default:
        console.log(chalk.dim('  ○ ') + chalk.dim(check.message));
    }
  }
}
