/**
 * Skills Installer — Install/update CodeGraph AI skills for Claude and Copilot.
 *
 * Reads skill SKILL.md files from the repo's skills/ directory and copies them to:
 *   - Claude:  ~/.claude/skills/<skill-name>/SKILL.md
 *   - Copilot: ~/.github/copilot-instructions.d/<skill-name>.md
 *
 * This is a pure TypeScript implementation that works cross-platform (no bash dependency).
 * It's the programmatic equivalent of scripts/install-skills.sh, invokable as a VS Code command.
 *
 * @module skills-installer
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { log, logEntry, logExit, logError } from './logger.js';

/** All CodeGraph skill directory names (must match skills/ subdirectories). */
const SKILL_NAMES = [
  'codegraph-scenario-discovery',
  'codegraph-scenario-tracing',
  'codegraph-code-walk',
  'codegraph-correction-interpreter',
  'codegraph-codewalk-populate',
  'codegraph-codewalk-enrich',
  'codegraph-expand-scenario',
  'codegraph-codewalk-podcast',
] as const;

type SkillName = (typeof SKILL_NAMES)[number];

interface SkillInstallResult {
  skill: SkillName;
  status: 'installed' | 'updated' | 'current' | 'error';
  message?: string;
}

type InstallTarget = 'claude' | 'copilot';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

function getCopilotInstructionsDir(): string {
  return path.join(os.homedir(), '.github', 'copilot-instructions.d');
}

/**
 * Find the skills/ source directory. We try multiple strategies:
 * 1. Workspace folder + /skills
 * 2. Extension path + /../skills (when installed from the monorepo)
 */
function findSkillsSourceDir(context: vscode.ExtensionContext): string | undefined {
  // Strategy 1: workspace folder
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const candidate = path.join(workspaceRoot, 'skills');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Strategy 2: extension's own path (monorepo layout: codegraph-navigator/../skills)
  const extensionDir = context.extensionPath;
  const candidate = path.join(extensionDir, '..', 'skills');
  if (fs.existsSync(candidate)) {
    return path.resolve(candidate);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// File comparison
// ---------------------------------------------------------------------------

function filesAreEqual(fileA: string, fileB: string): boolean {
  try {
    if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
      return false;
    }
    const contentA = fs.readFileSync(fileA, 'utf-8');
    const contentB = fs.readFileSync(fileB, 'utf-8');
    return contentA === contentB;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

function installClaudeSkill(skillName: SkillName, srcDir: string): SkillInstallResult {
  const srcFile = path.join(srcDir, skillName, 'SKILL.md');
  const dstDir = path.join(getClaudeSkillsDir(), skillName);
  const dstFile = path.join(dstDir, 'SKILL.md');

  if (!fs.existsSync(srcFile)) {
    return { skill: skillName, status: 'error', message: `Source not found: ${srcFile}` };
  }

  fs.mkdirSync(dstDir, { recursive: true });

  if (filesAreEqual(srcFile, dstFile)) {
    return { skill: skillName, status: 'current' };
  }

  const existed = fs.existsSync(dstFile);
  fs.copyFileSync(srcFile, dstFile);
  return { skill: skillName, status: existed ? 'updated' : 'installed' };
}

function installCopilotSkill(skillName: SkillName, srcDir: string): SkillInstallResult {
  const srcFile = path.join(srcDir, skillName, 'SKILL.md');
  const dstDir = getCopilotInstructionsDir();
  const dstFile = path.join(dstDir, `${skillName}.md`);

  if (!fs.existsSync(srcFile)) {
    return { skill: skillName, status: 'error', message: `Source not found: ${srcFile}` };
  }

  fs.mkdirSync(dstDir, { recursive: true });

  if (filesAreEqual(srcFile, dstFile)) {
    return { skill: skillName, status: 'current' };
  }

  const existed = fs.existsSync(dstFile);
  fs.copyFileSync(srcFile, dstFile);
  return { skill: skillName, status: existed ? 'updated' : 'installed' };
}

function installSkills(targets: InstallTarget[], srcDir: string): Map<InstallTarget, SkillInstallResult[]> {
  const results = new Map<InstallTarget, SkillInstallResult[]>();

  for (const target of targets) {
    const targetResults: SkillInstallResult[] = [];
    for (const skill of SKILL_NAMES) {
      const result = target === 'claude'
        ? installClaudeSkill(skill, srcDir)
        : installCopilotSkill(skill, srcDir);
      targetResults.push(result);
    }
    results.set(target, targetResults);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

interface SkillStatusInfo {
  skill: SkillName;
  status: 'current' | 'outdated' | 'missing';
}

function checkSkillStatus(srcDir: string): { claude: SkillStatusInfo[]; copilot: SkillStatusInfo[] } {
  const claudeResults: SkillStatusInfo[] = [];
  const copilotResults: SkillStatusInfo[] = [];

  for (const skill of SKILL_NAMES) {
    const srcFile = path.join(srcDir, skill, 'SKILL.md');

    // Claude
    const claudeDst = path.join(getClaudeSkillsDir(), skill, 'SKILL.md');
    if (!fs.existsSync(claudeDst)) {
      claudeResults.push({ skill, status: 'missing' });
    } else if (filesAreEqual(srcFile, claudeDst)) {
      claudeResults.push({ skill, status: 'current' });
    } else {
      claudeResults.push({ skill, status: 'outdated' });
    }

    // Copilot
    const copilotDst = path.join(getCopilotInstructionsDir(), `${skill}.md`);
    if (!fs.existsSync(copilotDst)) {
      copilotResults.push({ skill, status: 'missing' });
    } else if (filesAreEqual(srcFile, copilotDst)) {
      copilotResults.push({ skill, status: 'current' });
    } else {
      copilotResults.push({ skill, status: 'outdated' });
    }
  }

  return { claude: claudeResults, copilot: copilotResults };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatInstallResults(results: Map<InstallTarget, SkillInstallResult[]>): string {
  const lines: string[] = [];

  for (const [target, skillResults] of results) {
    const targetLabel = target === 'claude' ? 'Claude' : 'Copilot';
    const installed = skillResults.filter(r => r.status === 'installed').length;
    const updated = skillResults.filter(r => r.status === 'updated').length;
    const current = skillResults.filter(r => r.status === 'current').length;
    const errors = skillResults.filter(r => r.status === 'error').length;

    const parts: string[] = [];
    if (installed > 0) { parts.push(`${installed} installed`); }
    if (updated > 0) { parts.push(`${updated} updated`); }
    if (current > 0) { parts.push(`${current} up-to-date`); }
    if (errors > 0) { parts.push(`${errors} failed`); }

    lines.push(`${targetLabel}: ${parts.join(', ')}`);
  }

  return lines.join(' | ');
}

// ---------------------------------------------------------------------------
// VS Code command handler
// ---------------------------------------------------------------------------

interface InstallOption {
  label: string;
  description: string;
  action: 'both' | 'claude' | 'copilot' | 'check';
}

const INSTALL_OPTIONS: InstallOption[] = [
  {
    label: '$(cloud-download) Install for Both (Claude & Copilot)',
    description: 'Install skills to ~/.claude/skills/ and ~/.github/copilot-instructions.d/',
    action: 'both',
  },
  {
    label: '$(sparkle) Install for Claude Only',
    description: 'Install skills to ~/.claude/skills/',
    action: 'claude',
  },
  {
    label: '$(copilot) Install for Copilot Only',
    description: 'Install instructions to ~/.github/copilot-instructions.d/',
    action: 'copilot',
  },
  {
    label: '$(info) Check Installation Status',
    description: 'Show which skills are installed, outdated, or missing',
    action: 'check',
  },
];

/**
 * Register the codegraph.installSkills command.
 *
 * This command can be invoked from the Command Palette by anyone who has
 * the extension installed — no need to know about scripts/install-skills.sh
 * or tasks.json.
 */
export function registerInstallSkillsCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('codegraph.installSkills', async () => {
    logEntry('cmd:installSkills');

    try {
      // Find the skills source directory
      const srcDir = findSkillsSourceDir(context);
      if (!srcDir) {
        vscode.window.showErrorMessage(
          'CodeGraph: Could not find the skills/ directory. ' +
          'Make sure you have the CodeGraph repository open or the extension is installed from the monorepo.'
        );
        logExit('cmd:installSkills', 'skills dir not found');
        return;
      }

      log('info', 'Found skills source directory', { srcDir });

      // Show QuickPick
      const picked = await vscode.window.showQuickPick(INSTALL_OPTIONS, {
        placeHolder: 'Choose what to install',
        title: 'CodeGraph: Install AI Skills',
      });

      if (!picked) {
        logExit('cmd:installSkills', 'cancelled');
        return;
      }

      log('info', 'Install skills action selected', { action: picked.action });

      if (picked.action === 'check') {
        // Show status in an output channel
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Checking AI skills status...' },
          async () => {
            const status = checkSkillStatus(srcDir);

            const claudeMissing = status.claude.filter(s => s.status !== 'current').length;
            const copilotMissing = status.copilot.filter(s => s.status !== 'current').length;

            if (claudeMissing === 0 && copilotMissing === 0) {
              vscode.window.showInformationMessage(
                `CodeGraph: All ${SKILL_NAMES.length} skills are up to date for both Claude and Copilot.`
              );
            } else {
              // Build a detailed report using an output channel
              const channel = vscode.window.createOutputChannel('CodeGraph Skills Status');
              channel.clear();
              channel.appendLine('CodeGraph AI Skills Status');
              channel.appendLine('='.repeat(50));

              for (const [target, skills] of Object.entries(status) as [string, SkillStatusInfo[]][]) {
                const targetLabel = target === 'claude'
                  ? `Claude (~/.claude/skills/)`
                  : `Copilot (~/.github/copilot-instructions.d/)`;
                channel.appendLine(`\n${targetLabel}:`);

                for (const s of skills) {
                  const icon = s.status === 'current' ? '[OK]' : s.status === 'outdated' ? '[OUTDATED]' : '[MISSING]';
                  channel.appendLine(`  ${icon} ${s.skill}`);
                }
              }

              channel.appendLine(`\nRun "CodeGraph: Install AI Skills" to install/update.`);
              channel.show(true);

              const totalIssues = claudeMissing + copilotMissing;
              const action = await vscode.window.showWarningMessage(
                `CodeGraph: ${totalIssues} skill(s) need attention. See Output panel for details.`,
                'Install Now'
              );
              if (action === 'Install Now') {
                // Re-run with 'both'
                const results = installSkills(['claude', 'copilot'], srcDir);
                const summary = formatInstallResults(results);
                vscode.window.showInformationMessage(`CodeGraph Skills: ${summary}`);
              }
            }
          }
        );
        logExit('cmd:installSkills', 'check complete');
        return;
      }

      // Install
      const targets: InstallTarget[] =
        picked.action === 'both' ? ['claude', 'copilot'] : [picked.action];

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Installing CodeGraph AI skills...` },
        async () => {
          const results = installSkills(targets, srcDir);

          // Check for errors
          const allResults = [...results.values()].flat();
          const errors = allResults.filter(r => r.status === 'error');

          if (errors.length > 0) {
            const errorMsg = errors.map(e => `${e.skill}: ${e.message}`).join(', ');
            log('warn', 'Some skills failed to install', { errors: errorMsg });
            vscode.window.showWarningMessage(`CodeGraph: Some skills had errors: ${errorMsg}`);
          }

          const summary = formatInstallResults(results);
          log('info', 'Skills install complete', { summary });
          vscode.window.showInformationMessage(`CodeGraph Skills: ${summary}`);
        }
      );

      logExit('cmd:installSkills');
    } catch (err) {
      logError('cmd:installSkills', err);
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CodeGraph: Failed to install skills — ${message}`);
    }
  });
}
