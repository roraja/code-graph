---
name: codegraph-scenario-discovery
description: "Use this skill when the user asks to 'discover scenarios', 'find scenarios',
  'what scenarios exist', 'discover code paths', 'find use cases', 'scenario discovery',
  'codegraph discover', or when they want to identify realistic user-facing scenarios
  from a parsed codebase stored in a Neo4j graph database. Analyzes entry points,
  call graphs, branch points, and class hierarchies to propose concrete execution
  paths with confidence scores."
---

# CodeGraph Scenario Discovery Skill

Discover realistic, user-facing scenarios from a parsed codebase by analyzing
structural data (entry points, call graphs, branch points, class hierarchies)
and proposing concrete execution paths that exercise meaningful code.

## When to Use

Use when the user says:
- "discover scenarios", "find scenarios"
- "what scenarios exist in this codebase"
- "discover code paths", "find use cases"
- "codegraph discover", "scenario discovery"
- "find scenarios involving `<function>`"
- "discover scenarios with hint `<text>`"

## Domain Context

CodeGraph is a system that parses codebases into a Neo4j graph database
(functions, calls, branches, virtual dispatch, data flow), then uses AI agents
to discover usage scenarios, trace execution paths, and provide step-by-step
walkthroughs. This skill embodies the **ScenarioDiscoveryAgent**.

## Input Data Shape

The discovery agent receives structural context with these sections:

### Entry Points (`entryPoints: FunctionSummary[]`)
Top-level functions that external actors invoke (route handlers, main functions,
CLI commands). Each has:
- `id` — unique identifier
- `name` / `qualifiedName` — e.g. `handleFileDrop`, `DropHandler::handleFileDrop`
- `signature` — full signature with params and return type
- `filePath`, `startLine`, `endLine` — location
- `returnType`, `visibility`, `language`, `isAsync`, `isAbstract`
- `documentation` — JSDoc / comment docs
- `sourceCode` — truncated to 800 chars max
- `parameters` — array of `{ name, type, isOptional, defaultValue }`

### Event Handlers (`eventHandlers: FunctionSummary[]`)
Functions that respond to events (user interactions, messages, lifecycle hooks).
Same shape as entry points.

### Public APIs (`publicAPIs: FunctionSummary[]`)
Exported functions available to external consumers.

### Call Graph (`callGraph: CallEdgeSummary[]`)
Edges showing which functions call which:
- `caller` — qualified name of the calling function
- `callee` — qualified name of the called function
- `isVirtualDispatch` — whether this is a virtual/dynamic dispatch call

Limited to 60 edges max in the prompt.

### Branch Points (`branchPoints: BranchSummary[]`)
Decision points inside functions:
- `functionName` — containing function's qualified name
- `type` — "if", "switch_case", "ternary", etc.
- `condition` — the condition expression as source text
- `line` — line number
- `hasElse` — whether an else/default branch exists

Limited to 40 branch points max.

### Class Hierarchy (`classes: ClassSummary[]`, `inheritances: InheritanceSummary[]`)
- Classes: `name`, `isAbstract`, `isInterface`, `methods[]`, `filePath`, `documentation`
- Inheritances: `child`, `parent`, `type` ("extends" | "implements")

### Codebase Summary (`codebaseSummary: CodebaseSummary`)
High-level orientation:
- `projectDescription`, `languages[]`, `totalFunctions`, `totalClasses`, `totalFiles`
- `moduleGroups[]` — distinct file path prefixes

### Target Function Mode (optional)
When `targetFunction` is set, discover scenarios that **involve** that function
anywhere in the execution path (not just starting from it):
- `targetFunction` — the function to find scenarios for
- `targetCallers` — functions that call the target (upstream context)
- `targetCallees` — functions called by the target (downstream context)

## Output Shape — `DiscoveredScenario[]`

Return a JSON array. Each scenario object MUST have:

```
{
  "id": "kebab-case-identifier",        // e.g. "user-uploads-large-file"
  "name": "Short Human Name",           // 3-8 words
  "description": "Detailed 2-4 sentences explaining: (a) WHO triggers, (b) WHAT they do and WHY, (c) expected outcome, (d) key decision points exercised",
  "entryFunction": "ExactQualifiedName", // MUST match a function from the input
  "triggerCondition": "specific event or action that starts it",
  "confidence": 0.85,                   // float 0.0-1.0, use >0.8 only with clear code evidence
  "expectedPath": ["Func1", "Func2"],   // optional: ordered call sequence
  "category": "authentication",          // optional: grouping tag
  "pathType": "happy"                    // optional: "happy" | "error" | "edge-case"
}
```

## Quality Criteria

### What makes a GOOD scenario
- Represents a real-world interaction a human user, API consumer, or external system would trigger
- Starts at a clear entry point and follows a non-trivial path through multiple functions
- Exercises important decision points (branches, dispatch) in the code
- Has a clear trigger condition and expected outcome
- Covers both happy paths AND important error / edge-case paths

### What makes a BAD scenario (avoid these)
- Trivial getters/setters or utility functions with no meaningful logic
- Duplicate or near-duplicate of an already-discovered scenario
- Scenarios that only touch one function with no branches or calls
- Scenarios with vague descriptions like "user does something"
- Internal implementation details that no external actor would trigger directly

### Diversity requirements
- Include a mix of happy-path, error-handling, and edge-case scenarios
- Cover different functional areas / modules of the codebase
- If async functions exist, include at least one scenario that exercises async flows
- If class hierarchies with virtual dispatch exist, include a scenario that exercises polymorphism

## Analysis Strategy

### Standard Mode
1. Study the entry points to understand what external actors can trigger
2. Follow the call graph to see which functions are reachable and what paths are possible
3. Look at branch conditions to identify interesting decision points with different outcomes
4. Consider error conditions: what happens when validation fails, data is missing, or exceptions occur
5. Check class hierarchies for polymorphic dispatch opportunities
6. Read function documentation and parameter types to understand domain semantics

### Target Function Mode
1. Study the TARGET FUNCTION to understand what it does
2. Look at the CALLERS — these tell you who invokes it and under what conditions
3. Trace UPWARD from callers to find top-level entry points that eventually reach the target
4. For each entry point to target path, determine the trigger condition and branch decisions
5. Consider different calling contexts: what arguments are passed? What state variations exist?
6. Look at the CALLEES — what downstream effects does it have?
7. Every proposed scenario MUST include the target function in the execution path
8. Show different reasons WHY the target function would be called

## Integration with CodeGraph

After discovery, scenarios are:
1. Saved to Neo4j as `Scenario` nodes with status `draft`
2. Also persisted as JSON files in `.vscode/code-graph/scenarios/` (one file per scenario, named `<scenario-id>.json`)
3. Automatically traced by the `ScenarioTracer` (see codegraph-scenario-tracing skill)
4. Steps are saved as `ScenarioStep` nodes linked by `HAS_STEP` and `NEXT` relationships
5. Users can walk through traces interactively and submit corrections

### Scenario Storage
Scenarios are stored in two locations:
- **Neo4j**: Graph database for querying, tracing, and relationship traversal
- **`.vscode/code-graph/scenarios/`**: Local JSON files for version control, portability, and offline access. Each scenario is saved as `<scenario-id>.json` in this directory.

### Scenario Lifecycle
`draft` -> `traced` -> `validated` | `corrected` -> `validated`

### CLI Usage
```bash
codegraph discover                          # Discover all scenarios
codegraph discover --hint "file upload"     # Guide discovery with a hint
codegraph discover --function handleDrop    # Find scenarios involving a function
codegraph discover --count 10               # Discover up to 10 scenarios
codegraph discover --no-trace               # Skip auto-tracing
```

## Response Format

Respond ONLY with a JSON array. No markdown fences, no commentary, no extra text.
Sort scenarios by descending confidence.
