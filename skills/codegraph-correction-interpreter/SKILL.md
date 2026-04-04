---
name: codegraph-correction-interpreter
description: "Use this skill when the user asks to 'correct a scenario', 'fix this step',
  'override branch', 'change variable', 'submit correction', 'codegraph correct',
  'this is wrong', 'actually it should be', or when they provide natural-language
  feedback about a traced scenario step that needs to be interpreted into a structured
  correction rule and applied with cascading re-trace."
---

# CodeGraph Correction Interpreter Skill

Interpret natural-language user corrections about traced scenario steps and
convert them into structured correction rules that can be applied to the graph
database with cascading re-trace of affected downstream steps.

## When to Use

Use when the user says:
- "correct this step", "fix step N"
- "this variable should be ...", "userId is always a UUID"
- "take the else branch here", "always skip this function"
- "actually it should dispatch to FileHandler"
- "codegraph correct `<scenario-id>` --step N --message '...'"
- "this is wrong because..."
- "override this decision"

## Domain Context

When users walk through a traced scenario and disagree with an AI decision,
they provide natural-language corrections. The CorrectionInterpreterAgent
parses these into machine-actionable rules that:
1. Update the affected step in Neo4j
2. Trigger cascading re-traces of downstream steps
3. Persist as reusable rules for future traces

## Correction Types

| Type | Purpose | Example Correction |
|------|---------|-------------------|
| `variable_constraint` | Constrain a variable's value or type | "userId should always be a UUID string" |
| `branch_override` | Force a specific branch direction | "always take the else branch here" |
| `dispatch_override` | Force dispatch to a specific implementation | "use FileHandler, not NetworkHandler" |
| `scenario_note` | Add a note/annotation to the scenario | "this only happens for premium users" |
| `function_skip` | Skip tracing a particular function | "skip all logging functions" |
| `function_include` | Explicitly include a function in the trace | "make sure to trace the validation step" |
| `global_rule` | Add a project-wide tracing rule | "file_count is never zero in production" |

## Correction Scopes

| Scope | Applies To | Persistence |
|-------|-----------|-------------|
| `local` / `step` | Only the current step | Single step |
| `scenario` | All steps in the current scenario | Current scenario only |
| `global` | All scenarios in the project | Project-wide, all future traces |

## Input Shape

```typescript
{
  userMessage: "userId should always be a UUID string",
  context: {
    scenario: {
      scenarioId: "user-login-flow",
      scenarioName: "User Login Flow",
      scenarioDescription: "End-to-end user authentication..."
    },
    currentStep: "Step 3: AuthService.validateCredentials",
    currentFunction: "validateCredentials",
    variableState: {
      userId: "123",
      email: "user@example.com"
    }
  }
}
```

## Output Shape — `StructuredCorrection`

```json
{
  "correctionType": "variable_constraint",
  "target": "userId",
  "rule": "userId should always be a UUID format string (e.g. 'usr_abc123-def456')",
  "scope": "global",
  "confidence": 0.92,
  "clarificationNeeded": false,
  "clarificationQuestion": null
}
```

### Field Details

- **`correctionType`** — one of the 7 types listed above
- **`target`** — what the correction applies to:
  - For `variable_constraint`: the variable name
  - For `branch_override`: the condition or branch identifier
  - For `dispatch_override`: the dispatch call site
  - For `function_skip`/`function_include`: the function name
  - For `scenario_note`: the scenario
  - For `global_rule`: the rule subject
- **`rule`** — the human-readable rule derived from the user's message
- **`scope`** — how broadly to apply: `"local"`, `"scenario"`, or `"global"`
- **`confidence`** — how confident the interpretation is (0.0-1.0)
- **`clarificationNeeded`** — `true` if the message is ambiguous
- **`clarificationQuestion`** — what to ask the user for clarity

## Interpretation Guidelines

### Detecting Correction Type

| User Says | Likely Type |
|-----------|------------|
| "X should be Y", "X is always Y", "X is never Y" | `variable_constraint` |
| "take the else", "take the other branch", "condition is false" | `branch_override` |
| "use X implementation", "dispatch to X", "call X not Y" | `dispatch_override` |
| "note: ...", "remember that ...", "context: ..." | `scenario_note` |
| "skip X", "ignore X", "don't trace X" | `function_skip` |
| "include X", "trace X", "don't skip X" | `function_include` |
| "always ...", "in general ...", "project-wide ..." | `global_rule` |

### Detecting Scope

| Indicator | Scope |
|-----------|-------|
| "here", "at this step", "in this branch" | `local` |
| "in this scenario", "for this flow" | `scenario` |
| "always", "never", "project-wide", "everywhere" | `global` |
| No scope indicator given | Default to `global` |

### When Clarification is Needed

Set `clarificationNeeded: true` when:
- The user's message is too vague to determine the correction type
- Multiple interpretations are possible and choosing wrong would be harmful
- The target variable/function cannot be identified from context
- The scope is ambiguous and matters for correctness

Example clarification questions:
- "Do you want this to apply only to this step, or across all scenarios?"
- "Which variable are you referring to — userId or requestId?"
- "Should I override the branch to always take 'then', or only in this scenario?"

## Correction Application

### For `variable_constraint`
- Update `variableState` at the targeted step
- Mark step as corrected (`correctedBy`, `correctionNote`)
- Trigger re-trace of downstream steps

### For `branch_override`
- Flip the branch action: `branch_taken` <-> `branch_skipped`
- Update justification to `[CORRECTED] <user message>`
- Mark step as corrected
- Trigger re-trace of downstream steps

### For `dispatch_override`
- Update justification to `[CORRECTED] <user message>`
- Mark step as corrected
- Trigger re-trace of downstream steps

### For `scenario_note`
- Append note to scenario description: `\n[Note] <user message>`
- No re-trace needed

### For `function_skip` / `function_include`
- Stored as config for next re-trace
- Maps to `boringFunctions` / `focusFunctions` in `TraceConfig`

### For `global_rule`
- Stored in Neo4j as a `Correction` node with `scope: "global"`
- Applied during all future traces

## Cascading Re-trace

Re-trace is triggered for correction types: `branch_override`, `dispatch_override`, `variable_constraint`.

When a re-trace happens:
1. Scenario status changes from `traced` -> `corrected`
2. All steps from the correction point onward are regenerated
3. The correction is applied as a constraint during re-tracing
4. Scenario version number increments

## Graph Storage

```cypher
// Correction node
CREATE (c:Correction {
  id: "corr-1234567890-abc",
  type: "variable_constraint",
  prompt: "userId should always be a UUID",
  rule: "userId format is UUID",
  scope: "global",
  target: '{"variableName": "userId"}',
  appliedAt: "2024-01-16T15:00:00Z",
  userId: "cli-user"
})

// Links to affected scenario
MATCH (c:Correction {id: $id}), (s:Scenario {id: $scenarioId})
CREATE (c)-[:APPLIES_TO]->(s)

// Links to affected function
MATCH (c:Correction {id: $id}), (f:Function {id: $functionId})
CREATE (c)-[:APPLIES_TO]->(f)
```

### Local Storage
Scenarios (including corrections and re-traced steps) are also stored as JSON files in `.vscode/code-graph/scenarios/` (one file per scenario, named `<scenario-id>.json`). When a correction triggers a re-trace, the updated scenario is persisted both to Neo4j and to the local JSON file.

## Integration with CodeGraph

### CLI Usage
```bash
codegraph correct user-login-flow --step 3 --message "userId should be a UUID"
```

### Interactive Usage (during walk)
```
walk> correct
  Correction message: userId should always be a UUID string
  Correction applied
  Type: variable_constraint
  Rule: userId format is UUID
  Scope: global
  Affected: 1 step(s)
  Re-trace triggered. Downstream steps will be updated.
```

## Response Format

Respond ONLY with a JSON object containing: `correctionType`, `target`, `rule`,
`scope`, `confidence`, `clarificationNeeded`, and optionally `clarificationQuestion`.
No markdown fences, no extra text.
