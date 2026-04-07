# 02 - Install AI Skills via VS Code Command

## Overview

Added a VS Code Command Palette command (`codegraph.installSkills`) that lets anyone with the CodeGraph Navigator extension install the project's AI skills for Claude Code and GitHub Copilot — without needing to know about the bash script or tasks.json.

## Design

### Problem
Previously, installing CodeGraph AI skills required one of:
1. Running `bash scripts/install-skills.sh` manually from the terminal
2. Knowing about the VS Code tasks in `.vscode/tasks.json` and invoking them via "Run Task"

Both approaches assume the user has the repository cloned and knows where to look. Anyone who just installed the VSIX extension couldn't discover this functionality.

### Solution
A first-class VS Code command that:
- Appears in the Command Palette as **"CodeGraph: Install AI Skills (Claude & Copilot)"**
- Shows a QuickPick with four options: Install Both, Claude Only, Copilot Only, Check Status
- Implements the install logic natively in TypeScript (cross-platform, no bash dependency)
- Uses VS Code's progress notifications and output channels for feedback

### Install Targets

| Target | Destination | Format |
|--------|------------|--------|
| Claude | `~/.claude/skills/<skill-name>/SKILL.md` | Directory per skill with SKILL.md |
| Copilot | `~/.github/copilot-instructions.d/<skill-name>.md` | Flat file per skill |

### Skills Installed (7 total)
1. `codegraph-scenario-discovery` — Discover realistic scenarios from parsed codebase
2. `codegraph-scenario-tracing` — Trace execution paths through code
3. `codegraph-code-walk` — Interactive step-by-step walkthroughs
4. `codegraph-correction-interpreter` — Interpret natural-language corrections
5. `codegraph-codewalk-populate` — Create cell-based code walks
6. `codegraph-codewalk-enrich` — Enrich existing code walk cells
7. `codegraph-expand-scenario` — Extend traced walk paths upstream/downstream

## Implementation

### Module: `codegraph-navigator/src/skills-installer.ts`

The installer module:
- **`findSkillsSourceDir(context)`** — Locates the `skills/` directory by checking the workspace folder first, then the extension's parent directory (monorepo layout)
- **`installClaudeSkill()` / `installCopilotSkill()`** — Diff-based copy: only overwrites if content has changed, reports installed/updated/current status
- **`checkSkillStatus()`** — Reports current/outdated/missing for each skill across both targets
- **`registerInstallSkillsCommand(context)`** — Registers the VS Code command with QuickPick UI, progress notifications, and an output channel for detailed status reports

### Integration
- Command registered in `extension.ts` via `context.subscriptions.push(registerInstallSkillsCommand(context))`
- Command declared in `package.json` contributes.commands
- No additional dependencies — uses only Node.js built-ins (`fs`, `path`, `os`) and VS Code API

## Usage

1. Open VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type **"CodeGraph: Install AI Skills"**
3. Choose an option:
   - **Install for Both** — Installs to `~/.claude/skills/` and `~/.github/copilot-instructions.d/`
   - **Install for Claude Only** — Installs to `~/.claude/skills/`
   - **Install for Copilot Only** — Installs to `~/.github/copilot-instructions.d/`
   - **Check Status** — Shows which skills are installed, outdated, or missing (with "Install Now" button)

## Testing

- TypeScript compilation: `npx tsc --noEmit` passes cleanly
- Full build: `npm run build` succeeds (compile + esbuild bundle)
- Manual verification: command appears in package.json contributes

## Code References

| File | Purpose |
|------|---------|
| `codegraph-navigator/src/skills-installer.ts` | Core installer module |
| `codegraph-navigator/src/extension.ts` | Command registration (line ~797) |
| `codegraph-navigator/package.json` | Command declaration |
| `scripts/install-skills.sh` | Bash equivalent (also updated to include expand-scenario) |
| `skills/` | Source skill SKILL.md files |
