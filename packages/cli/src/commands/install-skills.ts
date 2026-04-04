/**
 * codegraph install-skills -- Install/update CodeGraph AI skills for Claude and Copilot.
 *
 * Copies skill files from the CodeGraph repo's skills/ directory to the
 * user's home folder so they are available globally in any repository:
 *
 *   Claude:  ~/.claude/skills/codegraph-{name}/SKILL.md
 *   Copilot: ~/.github/copilot-instructions.d/codegraph-{name}.md
 *
 * @module cli/commands/install-skills
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_NAMES = [
  'codegraph-scenario-discovery',
  'codegraph-scenario-tracing',
  'codegraph-code-walk',
  'codegraph-correction-interpreter',
];

/** Resolve the repo root by walking up from this file's directory. */
function findRepoRoot(): string {
  // This file is at packages/cli/src/commands/install-skills.ts
  // The compiled version is at packages/cli/dist/commands/install-skills.js
  // Either way, we need to walk up to the repo root.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find a directory containing a 'skills' folder
  let dir = thisDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'skills', SKILL_NAMES[0]!))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume standard monorepo layout
  return resolve(thisDir, '..', '..', '..', '..');
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

interface InstallResult {
  skill: string;
  status: 'installed' | 'updated' | 'current' | 'error';
  target: string;
  error?: string;
}

function installClaudeSkills(repoRoot: string): InstallResult[] {
  const claudeDir = join(homedir(), '.claude', 'skills');
  const skillsSrc = join(repoRoot, 'skills');
  const results: InstallResult[] = [];

  mkdirSync(claudeDir, { recursive: true });

  for (const skill of SKILL_NAMES) {
    const src = join(skillsSrc, skill, 'SKILL.md');
    const dstDir = join(claudeDir, skill);
    const dst = join(dstDir, 'SKILL.md');

    if (!existsSync(src)) {
      results.push({ skill, status: 'error', target: dst, error: `Source not found: ${src}` });
      continue;
    }

    mkdirSync(dstDir, { recursive: true });

    const srcContent = readFileSync(src, 'utf-8');
    if (existsSync(dst)) {
      const dstContent = readFileSync(dst, 'utf-8');
      if (srcContent === dstContent) {
        results.push({ skill, status: 'current', target: dst });
        continue;
      }
    }

    writeFileSync(dst, srcContent, 'utf-8');
    results.push({
      skill,
      status: existsSync(dst) ? 'updated' : 'installed',
      target: dst,
    });
  }

  return results;
}

function installCopilotSkills(repoRoot: string): InstallResult[] {
  const copilotDir = join(homedir(), '.github', 'copilot-instructions.d');
  const skillsSrc = join(repoRoot, 'skills');
  const results: InstallResult[] = [];

  mkdirSync(copilotDir, { recursive: true });

  for (const skill of SKILL_NAMES) {
    const src = join(skillsSrc, skill, 'SKILL.md');
    const dst = join(copilotDir, `${skill}.md`);

    if (!existsSync(src)) {
      results.push({ skill, status: 'error', target: dst, error: `Source not found: ${src}` });
      continue;
    }

    const srcContent = readFileSync(src, 'utf-8');
    if (existsSync(dst)) {
      const dstContent = readFileSync(dst, 'utf-8');
      if (srcContent === dstContent) {
        results.push({ skill, status: 'current', target: dst });
        continue;
      }
    }

    writeFileSync(dst, srcContent, 'utf-8');
    results.push({
      skill,
      status: existsSync(dst) ? 'updated' : 'installed',
      target: dst,
    });
  }

  return results;
}

function printResults(label: string, results: InstallResult[]): void {
  console.log(chalk.bold(label));
  for (const r of results) {
    switch (r.status) {
      case 'installed':
        console.log(chalk.green('  ✔ ') + chalk.bold(r.skill) + chalk.dim(` → ${r.target}`));
        break;
      case 'updated':
        console.log(chalk.yellow('  ↻ ') + chalk.bold(r.skill) + chalk.dim(` → ${r.target}`));
        break;
      case 'current':
        console.log(chalk.green('  ✔ ') + chalk.bold(r.skill) + chalk.dim(' (up to date)'));
        break;
      case 'error':
        console.log(chalk.red('  ✖ ') + chalk.bold(r.skill) + chalk.dim(` — ${r.error}`));
        break;
    }
  }
  const changed = results.filter((r) => r.status === 'installed' || r.status === 'updated');
  if (changed.length === 0) {
    console.log(chalk.dim('  All skills are up to date.'));
  } else {
    console.log(chalk.green(`  ${changed.length} skill(s) installed/updated.`));
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register the `install-skills` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerInstallSkillsCommand(program: Command): void {
  program
    .command('install-skills')
    .description('Install/update CodeGraph AI skills for Claude and Copilot')
    .option('--claude', 'Install Claude skills only')
    .option('--copilot', 'Install Copilot instructions only')
    .option('--check', 'Check installation status without installing')
    .action(async (opts) => {
      const repoRoot = findRepoRoot();
      const skillsSrc = join(repoRoot, 'skills');

      if (!existsSync(skillsSrc)) {
        console.error(
          chalk.red('✖ Skills directory not found: ') + chalk.dim(skillsSrc),
        );
        console.error(
          chalk.dim('  Make sure you are running this from the CodeGraph repository.'),
        );
        process.exit(1);
      }

      console.log();
      console.log(
        chalk.bold.cyan('╔══════════════════════════════════════════════════╗'),
      );
      console.log(
        chalk.bold.cyan('║  CodeGraph AI Skills Installer                   ║'),
      );
      console.log(
        chalk.bold.cyan('╚══════════════════════════════════════════════════╝'),
      );
      console.log();

      if (opts.check) {
        // Check mode — just report status
        const claudeResults = installClaudeSkills(repoRoot).map((r) => ({
          ...r,
          // Don't actually install in check mode — re-read status
        }));
        const copilotResults = installCopilotSkills(repoRoot).map((r) => ({
          ...r,
        }));
        // Re-check without writing — the functions already check for differences
        // so "current" means up-to-date, anything else means needs update.
        printResults('Claude skills (~/.claude/skills/):', claudeResults);
        printResults(
          'Copilot instructions (~/.github/copilot-instructions.d/):',
          copilotResults,
        );
        return;
      }

      const installClaude = !opts.copilot || opts.claude;
      const installCopilot = !opts.claude || opts.copilot;

      if (installClaude) {
        const results = installClaudeSkills(repoRoot);
        printResults('Claude skills (~/.claude/skills/):', results);
      }

      if (installCopilot) {
        const results = installCopilotSkills(repoRoot);
        printResults(
          'Copilot instructions (~/.github/copilot-instructions.d/):',
          results,
        );
      }

      console.log(chalk.green.bold('Done!') + ' Skills are now available in any repo.');
      console.log(
        chalk.dim(
          '  Claude: Start a session and the skills will be auto-loaded.',
        ),
      );
      console.log(
        chalk.dim(
          '  Copilot: Instructions are picked up from ~/.github/copilot-instructions.d/',
        ),
      );
      console.log();
    });
}
