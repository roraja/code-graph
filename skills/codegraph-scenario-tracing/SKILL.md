---
name: codegraph-scenario-tracing
description: "Use this skill when the user asks to 'trace a scenario', 'trace execution',
  'step through code', 'follow code path', 'codegraph trace', 'trace scenario',
  'walk the call graph', or when they need to trace a scenario's execution path
  through a codebase, making AI-powered branch decisions, virtual dispatch resolutions,
  and variable value imaginations at each step."
---

# CodeGraph Scenario Tracing Skill

Trace a scenario's execution path step-by-step through a codebase, making
intelligent decisions at branch points, resolving virtual dispatch, and
imagining realistic variable values along the way.

## When to Use

Use when the user says:
- "trace scenario", "trace execution path"
- "step through code path", "follow the call graph"
- "codegraph trace `<scenario-id>`"
- "trace from `<function>`"
- "what happens when this scenario runs"

## Domain Context

The ScenarioTracer orchestrates step-by-step tracing of a scenario. Given a
scenario's entry function, it walks through the code:
1. Reads the function source code
2. For each call -> pushes onto the call stack, recurses
3. For each branch -> asks AI to decide which path to take
4. For each virtual dispatch -> asks AI to pick an implementation
5. Records each decision as a ScenarioStep

Three specialized AI agents collaborate during tracing:
- **PathTracerAgent** — decides branches and dispatch targets
- **VariableImaginerAgent** — imagines variable values
- **JustifierAgent** — explains decisions in human-readable form

## Tracing Configuration

```typescript
interface TraceConfig {
  maxDepth: number;           // Maximum call depth (default: 50)
  maxStepsPerFunction: number; // Maximum steps per function (default: 200)
  boringFunctions: string[];   // Glob patterns to skip (e.g. "Logger::*")
  boringNamespaces: string[];  // Namespace prefixes to skip
  focusFunctions: string[];    // Override boring — always trace these
}
```

## Step-by-Step Tracing Process

### 1. Entry Function Resolution
- Find the entry function in the graph by exact `qualifiedName` match
- Fallback: fuzzy match by splitting on `::` or `.` and searching by last segment
- Error if function not found (needs `codegraph index` first)

### 2. Function Tracing (Recursive)
For each function entered:

**a) Depth & loop checks**
- Stop if `depth >= maxDepth`
- Stop if function already visited (loop detection via `visitedFunctions` Set)
- Skip if function matches `boringFunctions` or `boringNamespaces` (unless in `focusFunctions`)

**b) Build call stack frame**
For each parameter of the function, use the **VariableImaginerAgent** to imagine values:

```typescript
// Input to VariableImaginerAgent
{
  variableName: "userId",
  variableType: "string",
  scenario: { scenarioId, scenarioName, scenarioDescription },
  surroundingCode: "<function source>",
  existingState: { /* current variable values */ },
  functionName: "AuthService.validateUser"
}
```

**Expected output:**
```json
{
  "value": "\"usr_abc123\"",
  "justification": "A UUID-style user ID typical for authentication flows",
  "alternatives": ["\"usr_000\"", "\"admin_001\""],
  "confidence": 0.85
}
```

Values should be:
- String literals for display: `'"hello"'`, `'42'`, `'true'`, `'null'`
- Appropriate for the scenario context and variable type
- Consistent with already-known variable state
- Include 1-3 alternative plausible values

**c) Record function entry step** (action: `call`)

**d) Process branches**
For each `BranchNode` in the function, ask the **PathTracerAgent**:

```typescript
// Input to PathTracerAgent
{
  functionSource: "<full source>",
  functionName: "processOrder",
  scenario: { scenarioId, scenarioName, scenarioDescription },
  variableState: { orderTotal: "42.50", isVIP: "false" },
  decisionType: "branch",
  condition: "orderTotal > 100",
  line: 25
}
```

**Expected output:**
```json
{
  "decision": "else",
  "justification": "orderTotal is 42.50 which is less than 100, so the discount threshold is not met",
  "updatedVariableState": { "orderTotal": "42.50", "isVIP": "false", "discountApplied": "false" },
  "confidence": 0.92
}
```

Decision rules:
- For branches: choose `"then"` (condition true) or `"else"` (condition false)
- Consider the scenario context — what makes sense for this user story?
- Update variable state to reflect the decision
- Confidence should reflect how certain the decision is given available context
- If user corrections exist, they override the default decision

Record step with action `branch_taken` or `branch_skipped`.

**e) Process call edges**
For each callee:
- If `callee.isAbstract` → resolve virtual dispatch (see below)
- Otherwise → recurse into the callee

**Virtual dispatch resolution:**
```typescript
{
  functionSource: "<caller source>",
  functionName: "EventBus.dispatch",
  scenario: { ... },
  variableState: { ... },
  decisionType: "dispatch",
  dispatchTargets: ["FileHandler::handle", "NetworkHandler::handle", "UIHandler::handle"]
}
```

**Expected output:**
```json
{
  "decision": "FileHandler::handle",
  "justification": "The scenario involves file uploads, so the FileHandler implementation is the appropriate dispatch target",
  "updatedVariableState": { ... },
  "confidence": 0.88
}
```

Record step with action `dispatch`, then recurse into the chosen implementation.

**f) Record function return step** (action: `return`)

### 3. Call Stack Tracking

Each step includes a full call stack snapshot:

```typescript
interface CallStackFrame {
  depth: number;          // 0 = entry function
  functionId: string;
  functionName: string;   // qualified name
  filePath: string;
  line: number;           // current line in this frame
  variables: Record<string, FrameVariable>;
}

interface FrameVariable {
  value: string;          // imagined value as display string
  type: string;           // declared type
  rationale: string;      // why this value was chosen
  alternatives: string[]; // other plausible values
  confidence: number;     // 0.0-1.0
}
```

## ScenarioStep Shape

Each traced step produces:

```typescript
{
  id: "scenario-id-step-N",
  scenarioId: "user-login-flow",
  stepNumber: N,
  functionId: "src/auth/login.ts:15",
  functionName: "AuthService.authenticateUser",
  line: 18,
  action: "call" | "branch_taken" | "branch_skipped" | "dispatch" | "return" | "assign",
  justification: "Human-readable explanation of this step",
  variableState: { email: "\"user@example.com\"", isValid: "true" },
  sourceCode: "const user = await this.userRepo.findByEmail(email);",
  confidence: 0.95,
  callStack: [ /* CallStackFrame[] snapshot */ ]
}
```

## Trace Result

```typescript
{
  scenarioId: "user-login-flow",
  steps: ScenarioStep[],
  functionsTraversed: 12,
  branchDecisions: 5,
  dispatchesResolved: 1,
  durationMs: 3400
}
```

## Quality Guidelines

### Branch Decisions
- Always consider the scenario's narrative — which branch makes sense for this user story?
- Use variable state to evaluate conditions when possible
- For ambiguous conditions, prefer the happy path unless the scenario is explicitly an error scenario
- Explain your reasoning in the justification
- Flag low-confidence decisions (< 0.5) so users know to review them

### Variable Imagination
- Values should be realistic for the domain (e.g. valid email formats, UUIDs, realistic counts)
- Be consistent across steps — if `userId` is `"usr_123"` in step 1, keep it that way
- Consider the scenario description for domain-specific values
- Provide meaningful alternatives that would lead to different code paths

### Virtual Dispatch
- Choose the implementation that matches the scenario's domain
- Consider the variable types and state to narrow down candidates
- If uncertain, prefer the most common/default implementation

## Integration with CodeGraph

### CLI Usage
```bash
codegraph trace user-login-flow              # Trace a scenario
codegraph trace user-login-flow --max-depth 20  # Limit depth
```

### After Tracing
- Steps are saved to Neo4j as `ScenarioStep` nodes
- Linked to scenario via `HAS_STEP` relationship
- Consecutive steps linked via `NEXT` relationship
- Scenario status updated from `draft` to `traced`
- Scenario and steps are also persisted as JSON files in `.vscode/code-graph/scenarios/<scenario-id>.json`
- Users can `codegraph walk <id>` to step through interactively
- Users can `codegraph correct <id>` to submit corrections

### Scenario Storage
Scenarios are stored in `.vscode/code-graph/scenarios/` as JSON files (one per scenario). This local storage enables version control, portability between machines, and offline access without a running Neo4j instance.

## Response Format

For PathTracer decisions: Respond ONLY with a JSON object. No markdown fences.
For VariableImaginer: Respond ONLY with a JSON object. No markdown fences.
