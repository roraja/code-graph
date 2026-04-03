/**
 * `codegraph export` — Export a scenario in multiple formats.
 *
 * Supports:
 *   - json: Full scenario + steps as JSON (AI-consumable)
 *   - markdown: Human-readable markdown report
 *   - mermaid: Mermaid.js flowchart of the call graph
 *   - cypher: Cypher queries to recreate the scenario in Neo4j
 *
 * @module cli/commands/export
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadContext,
  handleError,
  startSpinner,
  gracefulExit,
  getMockScenarios,
  getMockSteps,
} from '../helpers.js';
import type { Scenario, ScenarioStep } from '@codegraph/core';

type ExportFormat = 'json' | 'markdown' | 'mermaid' | 'cypher';

/**
 * Register the `export` command on the CLI program.
 */
export function registerExportCommand(program: Command): void {
  program
    .command('export <scenario-id>')
    .description('Export a scenario in various formats')
    .requiredOption('--format <format>', 'Export format: json, markdown, mermaid, cypher')
    .option('--mock', 'Use mock data (demo mode)', false)
    .action(async (scenarioId: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;
      const format = opts.format as ExportFormat;

      if (!['json', 'markdown', 'mermaid', 'cypher'].includes(format)) {
        console.error(chalk.red(`✖ Invalid format: ${format}. Use: json, markdown, mermaid, cypher`));
        process.exit(1);
      }

      try {
        let scenario: Scenario | null = null;
        let steps: ScenarioStep[] = [];

        if (opts.mock) {
          const scenarios = getMockScenarios();
          scenario = scenarios.find((s) => s.id === scenarioId) ?? null;
          steps = getMockSteps(scenarioId);
        } else {
          const ctx = await loadContext(configPath);
          const spinner = startSpinner('Loading scenario...');
          scenario = await ctx.scenarioEngine.getScenario(scenarioId);
          if (scenario) {
            steps = await ctx.scenarioEngine.getSteps(scenarioId);
          }
          spinner.succeed('Scenario loaded');

          if (!scenario) {
            console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
            await gracefulExit(ctx.driver, 1);
            return;
          }

          console.log(exportScenario(scenario, steps, format));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        if (!scenario) {
          console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
          process.exit(1);
        }

        console.log(exportScenario(scenario, steps, format));
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

function exportScenario(scenario: Scenario, steps: ScenarioStep[], format: ExportFormat): string {
  switch (format) {
    case 'json':
      return exportJSON(scenario, steps);
    case 'markdown':
      return exportMarkdown(scenario, steps);
    case 'mermaid':
      return exportMermaid(scenario, steps);
    case 'cypher':
      return exportCypher(scenario, steps);
  }
}

function exportJSON(scenario: Scenario, steps: ScenarioStep[]): string {
  return JSON.stringify(
    {
      _format: 'codegraph-scenario-v1',
      scenario: {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        status: scenario.status,
        confidence: scenario.confidence,
        entryFunction: scenario.entryFunction,
        triggerCondition: scenario.triggerCondition,
        discoveredBy: scenario.discoveredBy,
        version: scenario.version,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
      },
      steps: steps.map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        functionId: s.functionId,
        functionName: s.functionName,
        line: s.line,
        action: s.action,
        sourceCode: s.sourceCode ?? null,
        justification: s.justification,
        confidence: s.confidence,
        variableState: s.variableState,
        correctedBy: s.correctedBy ?? null,
        correctionNote: s.correctionNote ?? null,
      })),
    },
    null,
    2
  );
}

function exportMarkdown(scenario: Scenario, steps: ScenarioStep[]): string {
  const lines: string[] = [];
  lines.push(`# Scenario: ${scenario.name}`);
  lines.push('');
  lines.push(`> ${scenario.description}`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **ID** | \`${scenario.id}\` |`);
  lines.push(`| **Status** | ${scenario.status} |`);
  lines.push(`| **Confidence** | ${(scenario.confidence * 100).toFixed(0)}% |`);
  lines.push(`| **Entry Function** | \`${scenario.entryFunction}\` |`);
  lines.push(`| **Trigger** | ${scenario.triggerCondition} |`);
  lines.push(`| **Discovered By** | ${scenario.discoveredBy} |`);
  lines.push(`| **Version** | ${scenario.version} |`);
  lines.push(`| **Created** | ${scenario.createdAt} |`);
  lines.push(`| **Updated** | ${scenario.updatedAt} |`);
  lines.push('');

  if (steps.length > 0) {
    lines.push('## Execution Steps');
    lines.push('');
    lines.push('| Step | Function | Action | Line | Confidence |');
    lines.push('|------|----------|--------|------|------------|');
    for (const step of steps) {
      lines.push(
        `| ${step.stepNumber} | \`${step.functionName}\` | ${step.action} | ${step.line} | ${(step.confidence * 100).toFixed(0)}% |`
      );
    }
    lines.push('');

    lines.push('## Step Details');
    lines.push('');
    for (const step of steps) {
      lines.push(`### Step ${step.stepNumber}: ${step.functionName}`);
      lines.push('');
      lines.push(`- **Action:** ${step.action}`);
      lines.push(`- **Line:** ${step.line}`);
      lines.push(`- **Confidence:** ${(step.confidence * 100).toFixed(0)}%`);
      lines.push('');
      if (step.sourceCode) {
        lines.push('```typescript');
        lines.push(step.sourceCode);
        lines.push('```');
        lines.push('');
      }
      lines.push(`**Justification:** ${step.justification}`);
      lines.push('');
      if (Object.keys(step.variableState).length > 0) {
        lines.push('**Variable State:**');
        lines.push('');
        for (const [k, v] of Object.entries(step.variableState)) {
          lines.push(`- \`${k}\` = \`${JSON.stringify(v)}\``);
        }
        lines.push('');
      }
      if (step.correctedBy) {
        lines.push(`> ✎ Corrected by: ${step.correctedBy} — ${step.correctionNote ?? ''}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

function exportMermaid(scenario: Scenario, steps: ScenarioStep[]): string {
  const lines: string[] = [];
  lines.push(`%% CodeGraph Scenario: ${scenario.name}`);
  lines.push('flowchart TD');

  if (steps.length === 0) {
    lines.push(`  A["${scenario.entryFunction}"]`);
    return lines.join('\n');
  }

  // Create nodes and edges
  const seen = new Set<string>();
  for (const step of steps) {
    const nodeId = sanitizeMermaidId(step.functionName);
    if (!seen.has(nodeId)) {
      const label = `${step.functionName}`;
      const shape = step.action === 'branch_taken' || step.action === 'branch_skipped'
        ? `{${label}}`
        : `["${label}"]`;
      lines.push(`  ${nodeId}${shape}`);
      seen.add(nodeId);
    }
  }

  // Add edges between consecutive steps
  for (let i = 0; i < steps.length - 1; i++) {
    const from = sanitizeMermaidId(steps[i]!.functionName);
    const to = sanitizeMermaidId(steps[i + 1]!.functionName);
    const label = steps[i + 1]!.action;
    lines.push(`  ${from} -->|"${label}"| ${to}`);
  }

  return lines.join('\n');
}

function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

function exportCypher(scenario: Scenario, steps: ScenarioStep[]): string {
  const lines: string[] = [];
  lines.push(`// CodeGraph Cypher export for scenario: ${scenario.name}`);
  lines.push(`// Re-run these queries in a Neo4j browser to recreate the scenario.`);
  lines.push('');

  // Create scenario node
  lines.push(`CREATE (s:Scenario {`);
  lines.push(`  id: '${escCypher(scenario.id)}',`);
  lines.push(`  name: '${escCypher(scenario.name)}',`);
  lines.push(`  description: '${escCypher(scenario.description)}',`);
  lines.push(`  discoveredBy: '${scenario.discoveredBy}',`);
  lines.push(`  confidence: ${scenario.confidence},`);
  lines.push(`  status: '${scenario.status}',`);
  lines.push(`  entryFunction: '${escCypher(scenario.entryFunction)}',`);
  lines.push(`  triggerCondition: '${escCypher(scenario.triggerCondition)}',`);
  lines.push(`  version: ${scenario.version},`);
  lines.push(`  createdAt: '${scenario.createdAt}',`);
  lines.push(`  updatedAt: '${scenario.updatedAt}'`);
  lines.push(`});`);
  lines.push('');

  for (const step of steps) {
    lines.push(`// Step ${step.stepNumber}`);
    lines.push(`MATCH (s:Scenario {id: '${escCypher(scenario.id)}'})`);
    lines.push(`CREATE (step:ScenarioStep {`);
    lines.push(`  id: '${escCypher(step.id)}',`);
    lines.push(`  stepNumber: ${step.stepNumber},`);
    lines.push(`  functionId: '${escCypher(step.functionId)}',`);
    lines.push(`  functionName: '${escCypher(step.functionName)}',`);
    lines.push(`  line: ${step.line},`);
    lines.push(`  action: '${step.action}',`);
    lines.push(`  justification: '${escCypher(step.justification)}',`);
    lines.push(`  variableState: '${escCypher(JSON.stringify(step.variableState))}',`);
    lines.push(`  sourceCode: '${escCypher(step.sourceCode ?? '')}',`);
    lines.push(`  confidence: ${step.confidence}`);
    lines.push(`})`);
    lines.push(`CREATE (s)-[:HAS_STEP {order: ${step.stepNumber}}]->(step);`);
    lines.push('');
  }

  // Add NEXT edges
  for (let i = 0; i < steps.length - 1; i++) {
    lines.push(`MATCH (s1:ScenarioStep {id: '${escCypher(steps[i]!.id)}'})`);
    lines.push(`MATCH (s2:ScenarioStep {id: '${escCypher(steps[i + 1]!.id)}'})`);
    lines.push(`CREATE (s1)-[:NEXT]->(s2);`);
  }

  return lines.join('\n');
}

function escCypher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
