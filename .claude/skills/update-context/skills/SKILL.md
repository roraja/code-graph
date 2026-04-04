---
name: update-context
description: "This skill should be used when the user asks to 'update context files',
  'refresh context', 'update floorplan', 'sync context with code', 'update domain contexts',
  'update FLOORPLAN.md', or when the codebase has changed and documentation needs to
  reflect the current state. Walks through all source files and updates .context/FLOORPLAN.md
  and all .context/domains/*.md files to accurately describe the current implementation."
---

# Update Context

Walk through the codebase and update all context documentation files to reflect the current state of the code. This includes `.context/FLOORPLAN.md` (the workspace floorplan) and all domain context files in `.context/domains/`.

## Context File Locations

These are the files that must be reviewed and updated:

| File | Scope |
|------|-------|
| `.context/FLOORPLAN.md` | Top-level routing table, package dependency flow, global guardrails, troubleshooting |
| `.context/domains/core.md` | Core engine — parsers, graph layer, AI agents, scenario/correction engines |
| `.context/domains/cli.md` | CLI package — 18 Commander.js commands, helpers, context factories |
| `.context/domains/server.md` | API server — Express + Apollo GraphQL, REST routes, server context |
| `.context/domains/web.md` | Web UI — React + Vite SPA, Cytoscape.js, Zustand stores |
| `.context/domains/testing.md` | Testing strategy — Vitest, unit/integration/E2E, mock factories, fixtures |

## Process Context Files

Also check these for accuracy (but only update if workflows have changed):

| File | Scope |
|------|-------|
| `.context/processes/new-feature.md` | End-to-end feature addition workflow |
| `.context/processes/add-parser.md` | Adding a new language parser |
| `.context/processes/add-cli-command.md` | Adding a new CLI command |
| `.context/processes/debug-failure.md` | Debugging test/build/runtime failures |

## Procedure

Follow these steps in order:

### Step 1: Inventory Current Files

Scan the project to find all source files. Run:
```
find packages -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' | sort
find test -type f -name '*.ts' -not -path '*/node_modules/*' | sort
```

Compare against the file lists in each context file. Identify:
- New files not documented in any context
- Files listed in context that no longer exist
- Files whose role has changed

### Step 2: Read Key Source Files

For each package, read the actual source files to understand current state:
- Check class/function names, method signatures, imports
- Check constructor parameters (dependency injection)
- Check which features are implemented vs stubbed
- Check barrel exports in `src/index.ts` of each package

### Step 3: Update FLOORPLAN.md

Update `.context/FLOORPLAN.md` with:
- **Domain routing table**: Add/remove entries for new/deleted modules
- **Process routing table**: Add entries for any new workflows
- **Package dependency flow**: Update if new packages or dependency changes
- **Global guardrails**: Verify against actual code patterns and `tsconfig.base.json`
- **Troubleshooting**: Add any new common issues discovered

### Step 4: Update Each Domain Context

For each `.context/domains/*.md`:

1. **Key files table**: List all files in the package/module with one-line descriptions. Remove deleted files, add new files.
2. **Architecture**: Update layer diagrams if dependencies changed.
3. **Patterns**: Update with current patterns based on actual code.
4. **Adding new functionality**: Verify instructions are still accurate.

### Step 5: Check for New Domains

If new packages or significant modules were created:
1. Create a new `.context/domains/<name>.md` file
2. Add a routing entry in `.context/FLOORPLAN.md`
3. Follow the same format as existing domain context files

### Step 6: Verify Accuracy

For each updated file, verify:
- File paths referenced actually exist
- Class/interface names match the actual code
- Feature statuses match reality
- Key file tables are complete

## Writing Guidelines

- Use present tense ("Parses TypeScript files" not "Will parse TypeScript files")
- Be specific about what is implemented vs planned
- Include actual file names and class names from the code
- Keep each domain context focused on its package's scope
- Use tables for structured information (modules, methods, features)
- Mark stubs and placeholders clearly
