# 11 - Add Podcast Skill to VS Code Skills Installer

**Date**: 2026-04-11 02:00 UTC
**Prompt**: "skills/codegraph-codewalk-podcast this skill is not getting installed" — the codewalk-podcast skill was not being installed by the VS Code extension's "Install Skills" command.

## 1. Code Reading & Analysis
- Read `skills/codegraph-codewalk-podcast/SKILL.md` — confirmed the skill source file exists with proper YAML frontmatter
- Listed `skills/` directory — confirmed `codegraph-codewalk-podcast` is present alongside 7 other skill directories
- Read `codegraph-navigator/src/skills-installer.ts` — found the `SKILL_NAMES` constant (line 21-29) that enumerates all skills the installer knows about
- Read `codegraph-navigator/src/extension.ts` — confirmed `registerInstallSkillsCommand` is registered (line 798)
- Checked `~/.claude/skills/` — confirmed the podcast skill was not installed there, while all 7 other codegraph skills were present

## 2. Issues Identified
- **File**: `codegraph-navigator/src/skills-installer.ts`, line 21-29
- **Problem**: The `SKILL_NAMES` array is a hardcoded list of skill directory names. When `codegraph-codewalk-podcast` was added to the `skills/` directory, it was never added to this array.
- **Root cause**: The installer iterates over `SKILL_NAMES` (line 144) to decide which skills to install. Since `codegraph-codewalk-podcast` wasn't in the list, it was silently skipped.

## 3. Plan
- Add `'codegraph-codewalk-podcast'` to the `SKILL_NAMES` array
- Rebuild the extension
- No alternatives needed — this is a straightforward missing entry

## 4. Changes Made
- **File**: `codegraph-navigator/src/skills-installer.ts`
  - **What changed**: Added `'codegraph-codewalk-podcast'` as the 8th entry in the `SKILL_NAMES` array (line 29)
  - **Why**: The installer only processes skills listed in this array; the new podcast skill was missing

```diff
 const SKILL_NAMES = [
   'codegraph-scenario-discovery',
   'codegraph-scenario-tracing',
   'codegraph-code-walk',
   'codegraph-correction-interpreter',
   'codegraph-codewalk-populate',
   'codegraph-codewalk-enrich',
   'codegraph-expand-scenario',
+  'codegraph-codewalk-podcast',
 ] as const;
```

## 5. Commands Run
- `cd codegraph-navigator && npm run build` — **passed** (compiled TypeScript + bundled with esbuild, 828ms)

## 6. Result
- The `codegraph-codewalk-podcast` skill will now be installed when running the "CodeGraph: Install AI Skills" command from the VS Code Command Palette
- It will be copied to `~/.claude/skills/codegraph-codewalk-podcast/SKILL.md` (Claude) and/or `~/.github/copilot-instructions.d/codegraph-codewalk-podcast.md` (Copilot)
- The extension needs to be reloaded in VS Code for the rebuilt bundle to take effect

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| `codegraph-navigator/src/skills-installer.ts` | Modified | Added `codegraph-codewalk-podcast` to `SKILL_NAMES` array |
