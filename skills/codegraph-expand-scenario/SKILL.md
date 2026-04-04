---
name: codegraph-expand-scenario
description: "Use this skill when the user asks to 'expand scenario', 'expand the walk',
  'extend the trace', 'add more depth', 'expand callstack', 'more coverage',
  'trace deeper', 'trace upstream', 'trace callers', 'expand up', 'expand down',
  'expand both', 'increase depth', 'missing calls', 'incomplete trace',
  'codegraph expand', or when they want to extend an existing scenario's traced
  walk path by discovering and tracing additional caller (upstream) or callee
  (downstream) functions that were not captured in the original trace."
---

# CodeGraph Expand Scenario Skill

Expand an existing scenario's walk path by tracing additional functions
**upstream** (callers of the entry function), **downstream** (callees beyond
the current trace depth), or **both**. This closes coverage gaps where the
original trace started too late or stopped too early.

## When to Use

Use when the user says:
- "expand scenario", "expand the walk path"
- "extend the trace", "add more depth"
- "trace upstream callers", "trace deeper into callees"
- "expand up", "expand down", "expand both"
- "the initial calls are missing", "the trace stopped too early"
- "increase depth", "more coverage"
- "codegraph expand `<scenario>`"
- "expand `<scenario>` up 3"
- "expand `<scenario>` down 5"

## Domain Context

After a scenario is traced (see codegraph-scenario-tracing skill), the walk
path may be incomplete:

- **Missing upstream calls** — the trace starts at `handleRequest`, but the
  real entry point is `ExpressRouter.route` which calls `middleware.auth`
  which calls `handleRequest`. The first two levels are missing.
- **Missing downstream calls** — the trace hit `maxDepth` or a function was
  in `boringFunctions`, so deeper callees were never explored.

Expanding fixes this by querying the Neo4j call graph for callers/callees
of the boundary functions and tracing into them.

## Scenario Lookup

The user provides a scenario by **name** or **ID**. Find the closest match:

1. **Exact ID match** — `getScenario(id)` returns the scenario directly
2. **Exact name match** — list all scenarios, find one whose `name` matches exactly (case-insensitive)
3. **Fuzzy match** — find the scenario whose `name` or `id` has the shortest
   Levenshtein distance or best substring overlap with the user's input
4. **Ambiguous** — if multiple close matches exist, ask the user to clarify

Once matched, load the scenario and its existing steps.

## Expansion Directions

### `up` — Expand Upstream (Callers)

Discovers functions that call the scenario's current entry function and
traces into them, prepending new steps before the existing trace.

**Process:**
1. Identify the **top boundary** — the entry function of the current trace
   (step 1, action `call`)
2. Query the graph for callers:
   ```cypher
   MATCH (caller:Function)-[r:CALLS]->(entry:Function {id: $entryFunctionId})
   RETURN caller, r
   ```
3. For each depth level requested (1..N), repeat: find callers of callers
4. Trace each discovered upstream function using the same tracing process
   as codegraph-scenario-tracing (PathTracerAgent, VariableImaginerAgent,
   JustifierAgent)
5. **Prepend** new steps before the existing steps
6. Update the scenario's `entryFunction` to the new top-level entry
7. Renumber all step numbers sequentially (existing steps shift forward)
8. Update the scenario's `version` and `updatedAt`

**Example:**
```
Before (3 steps):
  Step 1: handleRequest (call)        <- current entry
  Step 2: validateInput (call)
  Step 3: processOrder (call)

After expand up 2:
  Step 1: ExpressRouter.route (call)  <- new entry
  Step 2: middleware.auth (call)      <- new
  Step 3: handleRequest (call)        <- was step 1
  Step 4: validateInput (call)        <- was step 2
  Step 5: processOrder (call)         <- was step 3
```

### `down` — Expand Downstream (Callees)

Discovers functions called by the scenario's current deepest traced
functions and traces into them, appending new steps after the existing trace.

**Process:**
1. Identify the **bottom boundary** — the deepest leaf functions in the
   current trace. These are functions whose `call` step has a corresponding
   `return` step but no callee `call` steps between them (i.e., they were
   leaves — either hit `maxDepth`, were boring, or had no callees at the
   time of tracing)
2. Query the graph for callees of each leaf:
   ```cypher
   MATCH (leaf:Function {id: $leafFunctionId})-[r:CALLS]->(callee:Function)
   RETURN callee, r
   ```
3. For each depth level requested (1..N), trace into the discovered callees
4. **Insert** new steps between the leaf function's `call` and `return` steps,
   or **append** after the last step if the return step was at the end
5. Renumber step numbers sequentially
6. Update the scenario's `version` and `updatedAt`

**Example:**
```
Before (4 steps):
  Step 1: handleRequest (call)
  Step 2: processOrder (call)
  Step 3: processOrder (return)       <- leaf, no callees traced
  Step 4: handleRequest (return)

After expand down 2:
  Step 1: handleRequest (call)
  Step 2: processOrder (call)
  Step 3: db.saveOrder (call)         <- new callee of processOrder
  Step 4: db.saveOrder (return)       <- new
  Step 5: emailService.notify (call)  <- new callee of processOrder
  Step 6: emailService.notify (return)<- new
  Step 7: processOrder (return)       <- was step 3
  Step 8: handleRequest (return)      <- was step 4
```

### `both` — Expand Both Directions

Runs upstream expansion first, then downstream expansion. The depth
parameter applies independently to each direction, or separate depths
can be specified.

## Input Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `scenario` | Yes | — | Scenario name or ID (fuzzy matched) |
| `direction` | No | `both` | `up`, `down`, or `both` |
| `depth` | No | `3` | Number of additional call levels to expand |
| `upDepth` | No | `depth` | Override depth for upstream expansion only |
| `downDepth` | No | `depth` | Override depth for downstream expansion only |
| `skipBoring` | No | `true` | Respect `boringFunctions` / `boringNamespaces` from config |
| `focusFunctions` | No | `[]` | Additional functions to always include |

## Expansion Configuration

Expansion reuses the scenario's existing `TraceConfig` from `.codegraph.yaml`,
with overrides:

```typescript
interface ExpandConfig {
  /** Direction to expand */
  direction: 'up' | 'down' | 'both';
  /** Depth levels for upstream expansion */
  upDepth: number;
  /** Depth levels for downstream expansion */
  downDepth: number;
  /** Max total steps after expansion (safety limit, default: 500) */
  maxTotalSteps: number;
  /** Respect boringFunctions from TraceConfig (default: true) */
  skipBoring: boolean;
  /** Additional focus functions for this expansion */
  focusFunctions: string[];
}
```

## Step Renumbering & Consistency

After expansion:
1. **Renumber** all steps sequentially starting from 1
2. **Update step IDs** to match new numbering: `<scenario-id>-step-<N>`
3. **Rebuild NEXT relationships** between consecutive steps
4. **Preserve corrections** — any step that was corrected retains its
   `correctedBy`, `correctionNote`, and overridden values
5. **Update call stack frames** — prepended steps get new frames; existing
   steps' `callStack[].depth` values shift to reflect the new entry point
6. **Maintain variable state consistency** — upstream steps establish variable
   values that flow into the existing steps; downstream steps inherit the
   variable state from the leaf they extend

## Identifying Boundary Functions

### Top Boundary (for upstream expansion)
The entry function is found from:
- `scenario.entryFunction` — the qualified name of the entry function
- Or step 1 of the trace (the first `call` action step)

### Bottom Boundary (for downstream expansion)
Leaf functions are identified by analyzing the step sequence:
- Find all `call` steps whose corresponding `return` step has no intervening
  `call` steps for different functions — these are the leaves
- Alternatively, find the functions at maximum `callStack.depth` in any step

### Caller/Callee Discovery via Neo4j
```cypher
-- Find callers of a function (upstream)
MATCH (caller:Function)-[:CALLS]->(f:Function {qualifiedName: $name})
RETURN caller

-- Find callees of a function (downstream)
MATCH (f:Function {qualifiedName: $name})-[:CALLS]->(callee:Function)
RETURN callee

-- Multi-hop upstream (find callers of callers, up to N levels)
MATCH path = (ancestor:Function)-[:CALLS*1..N]->(f:Function {qualifiedName: $name})
RETURN [n IN nodes(path) | n.qualifiedName] AS chain, length(path) AS depth
ORDER BY depth

-- Multi-hop downstream
MATCH path = (f:Function {qualifiedName: $name})-[:CALLS*1..N]->(descendant:Function)
RETURN [n IN nodes(path) | n.qualifiedName] AS chain, length(path) AS depth
ORDER BY depth
```

## Tracing Expanded Functions

Each newly discovered function is traced using the same process as the
codegraph-scenario-tracing skill:

1. **Build call stack frame** — imagine parameter values with VariableImaginerAgent
2. **Record function entry** — `call` action step
3. **Process branches** — PathTracerAgent decides branch direction
4. **Process callees** — recurse (respecting the expansion depth limit)
5. **Record function return** — `return` action step

The scenario context (name, description, trigger condition) is passed to
all AI agents so they make contextually appropriate decisions.

## Quality Guidelines

### Upstream Expansion
- Prefer callers that represent real entry points (route handlers, event
  listeners, CLI commands) over internal helper functions
- If multiple callers exist, prefer the one that best matches the scenario's
  trigger condition and description
- If ambiguous, present the candidates to the user and ask which caller chain
  to follow
- Stop expanding upstream when you reach a true entry point (exported
  function with no callers, or a framework hook like `app.get(...)`)

### Downstream Expansion
- Prioritize callees that add meaningful logic (validation, persistence,
  external service calls) over utility functions
- Respect the configured `boringFunctions` and `boringNamespaces` unless
  the user explicitly includes them via `focusFunctions`
- When a leaf function has many callees, trace them in source-order
  (by line number of the call expression)

### Variable State Continuity
- **Upstream**: new upstream steps must establish variable values that are
  consistent with what the existing entry function expects. Examine the
  existing step 1's variable state and work backwards.
- **Downstream**: new downstream steps inherit the variable state from the
  leaf function they extend. Continue with the same values and add new
  variables as discovered.

## Integration with CodeGraph

### CLI Usage
```bash
codegraph expand user-login-flow                    # Expand both directions, depth 3
codegraph expand user-login-flow --direction up      # Only expand upstream
codegraph expand user-login-flow --direction down    # Only expand downstream
codegraph expand user-login-flow --depth 5           # Expand 5 levels both ways
codegraph expand "User Login" --up-depth 2 --down-depth 4  # Different depths per direction
codegraph expand user-login --focus "db.*"           # Include db functions even if boring
```

### After Expansion
- Updated steps are saved to Neo4j (old steps replaced, new steps created)
- `HAS_STEP` and `NEXT` relationships are rebuilt
- Scenario's `entryFunction` is updated if upstream expansion found a new entry
- Scenario `version` is incremented
- Scenario status remains `traced` (or changes to `traced` if it was `corrected`)
- Updated scenario is persisted to `.vscode/code-graph/scenarios/<scenario-id>.json`
- Users can `codegraph walk <id>` to walk the expanded trace
- Users can `codegraph correct <id>` to fix any AI decisions in the new steps

### Scenario Storage
Expanded scenarios are stored in `.vscode/code-graph/scenarios/` as JSON files
(one per scenario, named `<scenario-id>.json`). The JSON file contains the full
scenario metadata and all steps including the newly expanded ones.

### Expansion Metadata
Each expansion is recorded in the scenario JSON with a summary:
```json
{
  "expansions": [
    {
      "timestamp": "2026-04-05T10:30:00Z",
      "direction": "both",
      "upDepth": 2,
      "downDepth": 3,
      "stepsBefore": 8,
      "stepsAfter": 15,
      "newFunctions": ["ExpressRouter.route", "middleware.auth", "db.saveOrder"]
    }
  ]
}
```

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Entry function has no callers | Skip upstream expansion, log a message |
| Leaf functions have no callees | Skip downstream expansion, log a message |
| Multiple callers at a level | Ask user to choose, or expand the most relevant based on scenario description |
| Circular calls detected | Skip already-visited functions (same as tracing) |
| Expansion would exceed `maxTotalSteps` | Stop early, warn the user |
| Scenario not found (fuzzy) | List close matches and ask the user to pick |
| Scenario has no steps yet | Suggest running `codegraph trace` first |
| Expanded function was previously boring | Include it if user explicitly requested, otherwise skip |

## Response Format

When acting as the expand agent, return a JSON summary of the expansion:

```json
{
  "scenarioId": "user-login-flow",
  "direction": "both",
  "upDepth": 2,
  "downDepth": 3,
  "previousEntryFunction": "handleRequest",
  "newEntryFunction": "ExpressRouter.route",
  "stepsBefore": 8,
  "stepsAfter": 15,
  "newUpstreamFunctions": ["ExpressRouter.route", "middleware.auth"],
  "newDownstreamFunctions": ["db.saveOrder", "emailService.notify", "logger.info"],
  "leafFunctionsExpanded": ["processOrder", "validateInput"],
  "skippedFunctions": ["Logger::debug"],
  "warnings": []
}
```

No markdown fences, no extra commentary.
