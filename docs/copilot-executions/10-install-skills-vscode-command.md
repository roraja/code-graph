# 10 - Add VS Code Command to Install Claude/Copilot Skills

**Date**: 2026-04-07 UTC
**Prompt**: "Add vscode command to install claude/copilot skills (not just .vscode tasks.json) but anyone who installed the extension should be able to install the claude skills using the vscode command"

## 1. Code Reading & Analysis
- `.context/FLOORPLAN.md` — Located the VS Code extension domain routing
- `codegraph-navigator/package.json` — Extension manifest, existing commands (24 commands), activation events, contributes section
- `codegraph-navigator/src/extension.ts` — Full 986-line entry point, command registration pattern, provider setup
- `skills/` directory — 7 skill SKILL.md files: scenario-discovery, scenario-tracing, code-walk, correction-interpreter, codewalk-populate, codewalk-enrich, expand-scenario
- `.claude/` directory — Existing Claude skills structure: `~/.claude/skills/<name>/SKILL.md` pattern, `settings.json` with `enabledPlugins`
- `.claude/skills/update-context/.claude-plugin/plugin.json` — Plugin metadata format
- `scripts/install-skills.sh` — Existing bash installer script (213 lines) that copies skills to `~/.claude/skills/` and `~/.github/copilot-instructions.d/`
- `.vscode/tasks.json` — Existing tasks that invoke install-skills.sh with various flags (--claude, --copilot, --check)
- `.github/copilot-instructions.md` — Copilot's instruction file
- `codegraph-navigator/esbuild.mjs` — Bundle config (CJS, node platform, single bundle)

## 2. Issues Identified
- **No VS Code command for skill installation**: Users need to know about tasks.json or the shell script to install skills. Anyone who just installs the VSIX extension has no way to install skills from the Command Palette.
- **Missing skill in install-skills.sh**: `codegraph-expand-scenario` exists in `skills/` but is not listed in the `SKILL_DIRS` array of `scripts/install-skills.sh` (line 34-41).
- **Platform dependency**: The existing bash script won't work on Windows. A TypeScript implementation in the extension works cross-platform.

## 3. Plan
- Add a `codegraph.installSkills` command to `package.json` contributes.commands
- Create `src/skills-installer.ts` — a pure TypeScript module that:
  - Discovers the skills/ source directory (from workspace or extension path)
  - Provides QuickPick UI with options: Both, Claude only, Copilot only, Check Status
  - Copies SKILL.md files to `~/.claude/skills/<name>/SKILL.md` (Claude) and `~/.github/copilot-instructions.d/<name>.md` (Copilot)
  - Shows an output channel with status details when checking
  - Reports install/update/current counts via notifications
- Register the command in `extension.ts`
- Fix `install-skills.sh` to include `codegraph-expand-scenario`
- Alternative rejected: Shelling out to the bash script — not cross-platform, adds fragile path dependency

## 4. Changes Made

### `codegraph-navigator/package.json`
- **Added command declaration** for `codegraph.installSkills` with title "CodeGraph: Install AI Skills (Claude & Copilot)" in contributes.commands array

### `codegraph-navigator/src/skills-installer.ts` (NEW)
- Created ~280-line module implementing the full install logic natively in TypeScript
- `SKILL_NAMES` constant — all 7 skill directory names
- `findSkillsSourceDir()` — locates skills/ from workspace folder or extension path
- `installClaudeSkill()` / `installCopilotSkill()` — copy with diff-based skip (only copy if changed)
- `checkSkillStatus()` — reports current/outdated/missing for each target
- `registerInstallSkillsCommand()` — QuickPick UI with 4 options, progress notifications, output channel for status report
- Cross-platform: uses `node:fs`, `node:path`, `node:os` — no bash dependency

### `codegraph-navigator/src/extension.ts`
- **Added import** for `registerInstallSkillsCommand` from `./skills-installer.js`
- **Registered the command** via `context.subscriptions.push(registerInstallSkillsCommand(context))` before the cleanup section (line 796-798)

### `scripts/install-skills.sh`
- **Added `codegraph-expand-scenario`** to the `SKILL_DIRS` array (was missing)

## 5. Commands Run
- `cd codegraph-navigator && npx tsc -p tsconfig.json --noEmit` — **PASS** (clean, no errors)
- `npm run build` — **PASS** (compile + bundle, dist/extension.js 15.4mb)

## 6. Result
- The `codegraph.installSkills` command is now available in the VS Code Command Palette
- Anyone who installs the extension can type "CodeGraph: Install AI Skills" to:
  - Install skills for both Claude and Copilot
  - Install for Claude only or Copilot only
  - Check installation status with detailed output
- The implementation is cross-platform (no bash dependency)
- The existing bash script and tasks.json are preserved as alternative entry points
- `codegraph-expand-scenario` is now included in both the bash script and TS installer

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `codegraph-navigator/package.json` | Modified | Added `codegraph.installSkills` command declaration |
| `codegraph-navigator/src/skills-installer.ts` | Created | Pure TypeScript skills installer module (~280 lines) |
| `codegraph-navigator/src/extension.ts` | Modified | Import and register the installSkills command |
| `scripts/install-skills.sh` | Modified | Added missing `codegraph-expand-scenario` to SKILL_DIRS |
