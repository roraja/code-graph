# Code Walk Data Structures — Design Exploration

**Status:** Proposal
**Date:** 2026-04-05
**Problem:** The current `ScenarioStep[]` flat-array model is tightly coupled to AI tracing and hard for agents to populate incrementally. We need a data structure optimized for: (1) AI/LLM/agent population from static analysis tools (clangd, IntelliSense), (2) partial fillability, (3) human correction, (4) scalability across large codebases, and (5) a browsable debugging experience with variable inspection, call stacks, and forward/backward navigation.

---

## Current State

Today, a code walk is a `ScenarioStep[]` — a flat ordered array where each step has:

```ts
interface ScenarioStep {
  id: string;
  scenarioId: string;
  stepNumber: number;        // sequential ordering
  functionId: string;
  functionName: string;
  line: number;
  action: 'call' | 'branch_taken' | 'branch_skipped' | 'dispatch' | 'return' | 'assign';
  justification: string;     // AI explanation
  variableState: Record<string, unknown>;  // flat key-value snapshot
  sourceCode?: string;
  confidence: number;
  callStack?: CallStackFrame[];
  correctedBy?: string;
  correctionNote?: string;
}
```

### What works
- Simple sequential model — easy to render in CLI and VS Code
- Call stack frames exist (added recently)
- Corrections are supported per-step

### What doesn't work
- **Flat array** — no inherent tree structure for call/return nesting; the call stack is a parallel data structure bolted on
- **All-or-nothing** — a step must be fully populated; there's no concept of "I know the function call but not the variable values yet"
- **Variable state is a snapshot, not a timeline** — you can't see how `x` changed from step 3 to step 7
- **No diff between steps** — jumping forward/backward requires the UI to re-derive what changed
- **Coupled to AI tracing** — the structure assumes the AI tracer produced everything; a human or static analysis tool can't easily contribute partial data
- **No provenance** — you can't tell which fields came from clangd, which from AI, which from human correction

---

## Design Goals

| Goal | Description |
|------|-------------|
| **Partially fillable** | An agent can populate structure (calls, branches) from static analysis, then a second pass fills in variable values, then a third adds explanations. No field should be "required" for the walk to be usable. |
| **Correctable** | Any field should be individually correctable with provenance (who changed it, when, why). Corrections should not require re-generating the whole walk. |
| **Scalable** | Must handle walks with 1000+ steps across 100+ files. Lazy loading, pagination, and partial materialization should be natural. |
| **Browsable** | Support forward/backward stepping, jump-to-step, call stack inspection, variable watches, and breakpoint-like bookmarks — the UX of a debugger, but on stored data. |
| **Agent-friendly** | The structure should be easy for an LLM to produce in a single pass or incrementally. JSON-serializable. No circular references. Clear field semantics. |
| **Tool-agnostic provenance** | Every piece of data should carry its source: `clangd`, `intellisense`, `ai:gpt-4`, `human:roraja`, etc. |

---

## Idea 1: Layered Frame Model (Debugger-Native)

**Core insight:** Model the walk as a sequence of **frames** (like debugger stack frames), where each frame is a location + variable snapshot, and frames are grouped by **thread of execution**. Separate the _structure_ (what was called) from the _annotations_ (why, variable values) into distinct layers that can be populated independently.

### Data Structure

```ts
/** A code walk is a timeline of execution frames */
interface CodeWalk {
  id: string;
  name: string;
  description: string;
  entryPoint: CodeLocation;
  createdAt: string;
  updatedAt: string;

  /** The execution timeline — ordered sequence of frame snapshots */
  timeline: ExecutionFrame[];

  /** Metadata about what tools/agents contributed to this walk */
  contributors: Contributor[];

  /** User-defined bookmarks ("breakpoints") for quick navigation */
  bookmarks: Bookmark[];
}

/** A single point in the execution timeline */
interface ExecutionFrame {
  id: string;
  index: number;                    // sequential position in timeline
  location: CodeLocation;           // where we are
  action: FrameAction;              // what happened

  /** The call stack at this point — derived from call/return actions */
  callStack: StackFrame[];

  /** Variable state — layered by scope */
  variables?: VariableScope[];

  /** AI or human explanation */
  explanation?: Annotation;

  /** What changed relative to the previous frame */
  delta?: FrameDelta;

  /** Confidence in this frame's accuracy (0.0 - 1.0) */
  confidence?: number;

  /** Provenance: what produced this frame */
  source: DataSource;

  /** Corrections applied to this frame */
  corrections?: Correction[];
}

interface CodeLocation {
  filePath: string;
  line: number;
  column?: number;
  sourceText?: string;             // the actual source line
  functionName?: string;           // qualified name of containing function
  // Stable anchoring (from stable-code-locations.md Idea 7)
  contentHash?: string;
  symbolPath?: string[];
}

type FrameAction =
  | { type: 'call'; target: string; arguments?: ArgumentValue[] }
  | { type: 'return'; value?: string }
  | { type: 'branch'; condition: string; taken: boolean }
  | { type: 'assign'; variable: string; value: string; previousValue?: string }
  | { type: 'dispatch'; interface: string; resolvedTo: string }
  | { type: 'throw'; exception: string }
  | { type: 'catch'; exception: string };

interface StackFrame {
  depth: number;
  functionName: string;
  location: CodeLocation;
  /** Variables local to this stack frame */
  locals?: Record<string, VariableValue>;
}

interface VariableScope {
  scope: 'local' | 'parameter' | 'member' | 'global' | 'closure';
  variables: Record<string, VariableValue>;
}

interface VariableValue {
  value: string;                    // display value
  type?: string;                   // declared/inferred type
  source: DataSource;              // who provided this value
  confidence?: number;
  rationale?: string;              // why this value (AI explanation)
  alternatives?: string[];         // other possible values
  /** For objects/arrays: expandable children */
  children?: Record<string, VariableValue>;
}

interface FrameDelta {
  /** Variables that changed from previous frame */
  variableChanges: Array<{
    name: string;
    scope: string;
    oldValue?: string;
    newValue: string;
  }>;
  /** Stack frames pushed or popped */
  stackChange: 'push' | 'pop' | 'same';
  /** Files that changed (for multi-file jumps) */
  fileChanged: boolean;
}

interface DataSource {
  tool: string;                    // 'clangd' | 'intellisense' | 'ai:gpt-4' | 'human' | 'typescript-parser'
  agent?: string;                  // specific agent name
  timestamp: string;
  confidence: number;
}

interface Annotation {
  text: string;
  source: DataSource;
}

interface Bookmark {
  frameIndex: number;
  label: string;
  color?: string;
}

interface Contributor {
  tool: string;
  fieldsPopulated: string[];       // which fields this tool filled
  timestamp: string;
}

interface Correction {
  field: string;                   // which field was corrected
  oldValue: unknown;
  newValue: unknown;
  author: string;
  timestamp: string;
  reason?: string;
}

interface ArgumentValue {
  name?: string;
  value: string;
  type?: string;
}
```

### Example (Partial, agent-populated in 2 passes)

**Pass 1 — clangd/static analysis (structure only):**

```json
{
  "id": "walk-user-login",
  "name": "User Login Flow",
  "entryPoint": { "filePath": "src/auth/login.ts", "line": 18, "functionName": "AuthService.authenticateUser" },
  "timeline": [
    {
      "id": "f1",
      "index": 0,
      "location": { "filePath": "src/auth/login.ts", "line": 18, "functionName": "AuthService.authenticateUser" },
      "action": { "type": "call", "target": "UserRepository.findByEmail" },
      "callStack": [
        { "depth": 0, "functionName": "AuthService.authenticateUser", "location": { "filePath": "src/auth/login.ts", "line": 18 } }
      ],
      "source": { "tool": "clangd", "timestamp": "2026-04-05T10:00:00Z", "confidence": 1.0 }
    },
    {
      "id": "f2",
      "index": 1,
      "location": { "filePath": "src/auth/login.ts", "line": 55, "functionName": "AuthService.validateCredentials" },
      "action": { "type": "call", "target": "bcrypt.compare" },
      "callStack": [
        { "depth": 0, "functionName": "AuthService.authenticateUser", "location": { "filePath": "src/auth/login.ts", "line": 18 } },
        { "depth": 1, "functionName": "AuthService.validateCredentials", "location": { "filePath": "src/auth/login.ts", "line": 55 } }
      ],
      "source": { "tool": "clangd", "timestamp": "2026-04-05T10:00:00Z", "confidence": 1.0 }
    },
    {
      "id": "f3",
      "index": 2,
      "location": { "filePath": "src/auth/login.ts", "line": 60, "functionName": "AuthService.validateCredentials" },
      "action": { "type": "branch", "condition": "isValid", "taken": true },
      "callStack": [
        { "depth": 0, "functionName": "AuthService.authenticateUser", "location": { "filePath": "src/auth/login.ts", "line": 18 } },
        { "depth": 1, "functionName": "AuthService.validateCredentials", "location": { "filePath": "src/auth/login.ts", "line": 60 } }
      ],
      "source": { "tool": "clangd", "timestamp": "2026-04-05T10:00:00Z", "confidence": 1.0 }
    }
  ],
  "contributors": [
    { "tool": "clangd", "fieldsPopulated": ["location", "action", "callStack"], "timestamp": "2026-04-05T10:00:00Z" }
  ],
  "bookmarks": []
}
```

**Pass 2 — AI enrichment (adds variables, explanations, deltas):**

```json
{
  "timeline[0].variables": [
    {
      "scope": "parameter",
      "variables": {
        "email": { "value": "\"user@example.com\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.9, "timestamp": "2026-04-05T10:01:00Z" }, "rationale": "Typical user login scenario" },
        "password": { "value": "\"***\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "2026-04-05T10:01:00Z" } }
      }
    }
  ],
  "timeline[0].explanation": {
    "text": "Entry point: authenticateUser is called when the user submits the login form.",
    "source": { "tool": "ai:gpt-4", "timestamp": "2026-04-05T10:01:00Z", "confidence": 0.95 }
  },
  "timeline[1].delta": {
    "variableChanges": [{ "name": "hash", "scope": "local", "newValue": "\"$2b$10$...\"" }],
    "stackChange": "push",
    "fileChanged": false
  }
}
```

### Pros
- **Debugger-native** — maps directly to the UX concepts (stack frames, locals, watches, stepping)
- **Naturally partial** — every field except `id`, `index`, `location`, `action`, and `source` is optional
- **Provenance per-value** — `DataSource` on every variable value and every frame means you always know who said what
- **Delta-based navigation** — `FrameDelta` makes forward/backward stepping efficient; the UI only applies diffs
- **Rich variable model** — scoped variables with children support expanding objects in a watch panel
- **Corrections are surgical** — correct a single field on a single frame without touching anything else
- **Scalable** — timeline is an array; can be paginated, lazily loaded, or streamed
- **Action types are richer** — `throw`/`catch`, argument values, previous values on assign

### Cons
- **More verbose** — each frame carries more data than the current `ScenarioStep`
- **Call stack is redundant** — the full call stack is repeated on every frame (could be derived from call/return actions, but then you lose random-access)
- **Delta computation** — someone has to compute `FrameDelta` during population; if you skip it, the UI must derive it
- **Migration cost** — existing `ScenarioStep[]` data needs a converter

---

## Idea 2: Event Log with Materialized Views

**Core insight:** Store the walk as an **append-only event log** (like an event-sourced system). Each event is a small, atomic fact: "function X was called", "variable Y was set to Z", "branch condition C was evaluated to true". Views (full frame snapshots, variable timelines, call trees) are **materialized on demand** from the log.

### Data Structure

```ts
/** The walk is a log of events */
interface CodeWalkLog {
  id: string;
  name: string;
  description: string;
  entryPoint: CodeLocation;
  events: WalkEvent[];
  /** Materialized views — cached, rebuilt on demand */
  views?: {
    timeline?: MaterializedFrame[];     // full frame snapshots
    callTree?: CallTreeNode;            // hierarchical call tree
    variableHistory?: VariableTimeline[];  // per-variable change log
  };
}

/** A single atomic event in the walk */
type WalkEvent =
  | CallEvent
  | ReturnEvent
  | BranchEvent
  | AssignEvent
  | DispatchEvent
  | AnnotationEvent
  | CorrectionEvent;

interface BaseEvent {
  seq: number;                     // monotonic sequence number
  timestamp: string;               // when this event was recorded
  source: DataSource;              // who produced this event
  location: CodeLocation;
}

interface CallEvent extends BaseEvent {
  type: 'call';
  callee: string;                  // qualified function name
  arguments?: Record<string, string>;
}

interface ReturnEvent extends BaseEvent {
  type: 'return';
  value?: string;
}

interface BranchEvent extends BaseEvent {
  type: 'branch';
  condition: string;
  taken: boolean;
  confidence?: number;
  justification?: string;
}

interface AssignEvent extends BaseEvent {
  type: 'assign';
  variable: string;
  value: string;
  previousValue?: string;
  valueType?: string;
}

interface DispatchEvent extends BaseEvent {
  type: 'dispatch';
  interfaceName: string;
  resolvedImplementation: string;
  confidence?: number;
}

interface AnnotationEvent extends BaseEvent {
  type: 'annotation';
  targetSeq: number;              // which event this annotates
  text: string;
}

interface CorrectionEvent extends BaseEvent {
  type: 'correction';
  targetSeq: number;              // which event is being corrected
  field: string;
  oldValue: unknown;
  newValue: unknown;
  author: string;
  reason?: string;
}

/** Materialized view: full state at a point in time */
interface MaterializedFrame {
  atSeq: number;
  location: CodeLocation;
  callStack: { functionName: string; location: CodeLocation }[];
  variables: Record<string, { value: string; type?: string; scope: string }>;
  pendingAnnotations: string[];
}

/** Materialized view: call hierarchy */
interface CallTreeNode {
  functionName: string;
  location: CodeLocation;
  callSeq: number;
  returnSeq?: number;
  children: CallTreeNode[];
  variables?: Record<string, string>;
}

/** Materialized view: one variable over time */
interface VariableTimeline {
  name: string;
  type?: string;
  changes: Array<{
    seq: number;
    value: string;
    location: CodeLocation;
    source: DataSource;
  }>;
}
```

### Example

```json
{
  "id": "walk-user-login",
  "events": [
    { "seq": 0, "type": "call", "callee": "AuthService.authenticateUser", "arguments": { "email": "user@example.com" }, "location": { "filePath": "src/auth/login.ts", "line": 18 }, "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "2026-04-05T10:00:00Z" } },
    { "seq": 1, "type": "assign", "variable": "email", "value": "\"user@example.com\"", "valueType": "string", "location": { "filePath": "src/auth/login.ts", "line": 19 }, "source": { "tool": "ai:gpt-4", "confidence": 0.9, "timestamp": "2026-04-05T10:01:00Z" } },
    { "seq": 2, "type": "call", "callee": "UserRepository.findByEmail", "arguments": { "email": "user@example.com" }, "location": { "filePath": "src/auth/login.ts", "line": 20 }, "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "2026-04-05T10:00:00Z" } },
    { "seq": 3, "type": "return", "value": "{ id: 'usr_123', email: 'user@example.com' }", "location": { "filePath": "src/db/repository.ts", "line": 35 }, "source": { "tool": "ai:gpt-4", "confidence": 0.85, "timestamp": "2026-04-05T10:01:00Z" } },
    { "seq": 4, "type": "branch", "condition": "isValid", "taken": true, "confidence": 0.88, "justification": "Password matches in the happy-path scenario", "location": { "filePath": "src/auth/login.ts", "line": 60 }, "source": { "tool": "ai:gpt-4", "confidence": 0.88, "timestamp": "2026-04-05T10:01:00Z" } },
    { "seq": 5, "type": "annotation", "targetSeq": 0, "text": "Entry point: called when user submits login form", "location": { "filePath": "src/auth/login.ts", "line": 18 }, "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "2026-04-05T10:01:00Z" } },
    { "seq": 6, "type": "correction", "targetSeq": 1, "field": "value", "oldValue": "\"user@example.com\"", "newValue": "\"admin@corp.com\"", "author": "roraja", "reason": "Testing with admin account", "location": { "filePath": "src/auth/login.ts", "line": 19 }, "source": { "tool": "human", "confidence": 1.0, "timestamp": "2026-04-05T11:00:00Z" } }
  ]
}
```

### Pros
- **Append-only** — agents just keep emitting events; no need to update existing data. Perfect for streaming / real-time population
- **Naturally partial** — static analysis emits `call`/`return` events, AI emits `assign`/`annotation`/`branch` events. They don't need to coordinate
- **Corrections are first-class events** — full audit trail, no data loss, easy undo (just drop the correction event)
- **Variable timeline is free** — filter events by `type === 'assign' && variable === 'x'` to get the full history
- **Call tree is derivable** — pair up `call`/`return` events by nesting to build a tree
- **Highly scalable** — append-only logs can be stored in any database, file, or stream. Natural pagination by `seq` range

### Cons
- **Materialization cost** — every "give me the current state at step N" requires replaying events 0..N. Needs caching/snapshotting for large walks
- **No random access without snapshots** — jumping to step 500 means processing 500 events (or pre-computing snapshots every K events)
- **Harder for LLMs to produce** — an LLM has to emit *correct event ordering* (calls before returns, assigns at the right moment). A flat "here's what the state looks like at step 3" is easier for an LLM to generate
- **Call stack is implicit** — must be derived by tracking call/return nesting; off-by-one errors in event generation break the whole stack
- **More storage for equivalent data** — events are fine-grained; a single "step" in the current model might become 3-5 events

---

## Idea 3: Annotated Call Tree with Execution Order

**Core insight:** The natural shape of a code walk is a **tree** (call graph), not a list. Model the walk as a tree of function invocations where each node contains the actions that happened inside that function. Attach a global execution index to each action for linear stepping, giving you both the hierarchical and sequential views.

### Data Structure

```ts
/** The walk is a tree of function invocations */
interface CodeWalk {
  id: string;
  name: string;
  description: string;
  /** The root invocation */
  root: InvocationNode;
  /** Total number of actions across all nodes (for progress/navigation) */
  totalActions: number;
  /** Global metadata */
  meta: WalkMeta;
}

interface WalkMeta {
  contributors: { tool: string; timestamp: string }[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

/** A single function invocation in the call tree */
interface InvocationNode {
  id: string;
  functionName: string;              // qualified name
  location: CodeLocation;            // where the function is defined
  calledFrom?: CodeLocation;         // call site in the parent

  /** Ordered actions within this invocation */
  actions: InvocationAction[];

  /** Child invocations (calls made from within this function) */
  children: InvocationNode[];

  /** Summary of variables at entry and exit */
  entryState?: Record<string, AnnotatedValue>;
  exitState?: Record<string, AnnotatedValue>;

  /** Overall explanation of what this function does in context */
  summary?: Annotation;

  /** Provenance */
  source: DataSource;

  /** Corrections to this node */
  corrections?: NodeCorrection[];
}

/** An action within a function invocation */
type InvocationAction =
  | { type: 'line'; globalIndex: number; location: CodeLocation; sourceText: string; source: DataSource }
  | { type: 'branch'; globalIndex: number; location: CodeLocation; condition: string; taken: boolean; justification?: string; confidence?: number; source: DataSource }
  | { type: 'assign'; globalIndex: number; location: CodeLocation; variable: string; value: AnnotatedValue; source: DataSource }
  | { type: 'call_site'; globalIndex: number; location: CodeLocation; childId: string; source: DataSource }  // pointer to child InvocationNode
  | { type: 'return'; globalIndex: number; location: CodeLocation; value?: string; source: DataSource }
  | { type: 'dispatch'; globalIndex: number; location: CodeLocation; interface: string; resolvedTo: string; confidence?: number; source: DataSource };

interface AnnotatedValue {
  value: string;
  type?: string;
  source: DataSource;
  confidence?: number;
  rationale?: string;
  alternatives?: string[];
}

interface Annotation {
  text: string;
  source: DataSource;
}

interface NodeCorrection {
  field: string;
  path?: string;                   // JSON path within the node (e.g., "actions[2].value")
  oldValue: unknown;
  newValue: unknown;
  author: string;
  timestamp: string;
  reason?: string;
}
```

### Example

```json
{
  "id": "walk-user-login",
  "name": "User Login Flow",
  "totalActions": 8,
  "root": {
    "id": "inv-1",
    "functionName": "AuthService.authenticateUser",
    "location": { "filePath": "src/auth/login.ts", "line": 15 },
    "actions": [
      { "type": "line", "globalIndex": 0, "location": { "filePath": "src/auth/login.ts", "line": 18 }, "sourceText": "const user = await this.userRepo.findByEmail(email);", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } },
      { "type": "call_site", "globalIndex": 1, "location": { "filePath": "src/auth/login.ts", "line": 18 }, "childId": "inv-2", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } },
      { "type": "call_site", "globalIndex": 4, "location": { "filePath": "src/auth/login.ts", "line": 22 }, "childId": "inv-3", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } },
      { "type": "assign", "globalIndex": 7, "location": { "filePath": "src/auth/login.ts", "line": 30 }, "variable": "token", "value": { "value": "\"eyJhbG...\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.93, "timestamp": "..." } }, "source": { "tool": "ai:gpt-4", "confidence": 0.93, "timestamp": "..." } },
      { "type": "return", "globalIndex": 8, "location": { "filePath": "src/auth/login.ts", "line": 35 }, "value": "{ success: true, token }", "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "..." } }
    ],
    "children": [
      {
        "id": "inv-2",
        "functionName": "UserRepository.findByEmail",
        "location": { "filePath": "src/db/repository.ts", "line": 10 },
        "calledFrom": { "filePath": "src/auth/login.ts", "line": 18 },
        "actions": [
          { "type": "line", "globalIndex": 2, "location": { "filePath": "src/db/repository.ts", "line": 12 }, "sourceText": "return db.query('SELECT * FROM users WHERE email = $1', [email]);", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } },
          { "type": "return", "globalIndex": 3, "location": { "filePath": "src/db/repository.ts", "line": 12 }, "value": "{ id: 'usr_123', email: 'user@example.com' }", "source": { "tool": "ai:gpt-4", "confidence": 0.85, "timestamp": "..." } }
        ],
        "children": [],
        "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." }
      },
      {
        "id": "inv-3",
        "functionName": "AuthService.validateCredentials",
        "location": { "filePath": "src/auth/login.ts", "line": 50 },
        "calledFrom": { "filePath": "src/auth/login.ts", "line": 22 },
        "actions": [
          { "type": "line", "globalIndex": 5, "location": { "filePath": "src/auth/login.ts", "line": 55 }, "sourceText": "const isValid = await bcrypt.compare(password, user.passwordHash);", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } },
          { "type": "branch", "globalIndex": 6, "location": { "filePath": "src/auth/login.ts", "line": 60 }, "condition": "isValid", "taken": true, "justification": "Password matches in happy path", "confidence": 0.88, "source": { "tool": "ai:gpt-4", "confidence": 0.88, "timestamp": "..." } }
        ],
        "children": [],
        "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." }
      }
    ],
    "entryState": {
      "email": { "value": "\"user@example.com\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.9, "timestamp": "..." } },
      "password": { "value": "\"***\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "..." } }
    },
    "summary": { "text": "Authenticates a user with email/password, validates credentials, generates JWT token", "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "..." } },
    "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." }
  }
}
```

### Pros
- **Mirrors the real execution structure** — a function calls a function calls a function; the tree IS the call hierarchy
- **Call stack is implicit** — the path from root to any node IS the call stack. No redundant storage
- **Natural "step into" / "step over" / "step out"** — step into = enter child node; step over = skip child, go to next action; step out = return to parent
- **Partial population is natural** — an agent can create `InvocationNode` shells (just `functionName` + `location`) and fill in `actions` later
- **Per-function summaries** — each invocation node can have its own summary, making high-level browsing possible (collapse deep subtrees)
- **Supports both views** — `globalIndex` gives you linear stepping; tree structure gives you hierarchical browsing

### Cons
- **Circular/recursive calls are tricky** — recursive functions create deep trees; need a max-depth cutoff and a "see invocation X" reference
- **Global index maintenance** — inserting an action in the middle of a subtree requires re-indexing all subsequent `globalIndex` values
- **Harder for LLMs to produce** — generating nested JSON is more error-prone than a flat list. LLMs may lose track of which invocation node they're populating
- **Serialization size** — deeply nested trees with many leaves can be large; pagination is less natural than with a flat list
- **Random access by globalIndex requires a lookup** — must traverse the tree to find globalIndex=47 (can be solved with an index map)

---

## Idea 4: Notebook-Style Cells with Execution Slices

**Core insight:** Borrow from Jupyter notebooks — model the walk as an ordered sequence of **cells**, where each cell represents a meaningful "chunk" of execution (entering a function, evaluating a branch, a block of assignments). Cells are the unit of authoring, correction, and display. Each cell contains a code slice, variable state, and optional commentary.

### Data Structure

```ts
interface CodeWalk {
  id: string;
  name: string;
  description: string;
  cells: WalkCell[];
  meta: WalkMeta;
}

/** A cell is a chunk of execution — the atomic unit of the walk */
interface WalkCell {
  id: string;
  index: number;
  type: CellType;

  /** The code being discussed in this cell */
  code: CodeSlice;

  /** What happens in this cell */
  narrative?: string;               // human-readable explanation (AI or human)

  /** Variable state at the END of this cell */
  state?: CellState;

  /** Relationship to the call hierarchy */
  stackDepth: number;               // how deep in the call stack
  parentCellId?: string;            // which call cell spawned this

  /** Provenance and quality */
  source: DataSource;
  confidence?: number;
  status: 'skeleton' | 'partial' | 'complete' | 'corrected';

  /** Corrections */
  corrections?: CellCorrection[];
}

type CellType =
  | 'entry'          // entering a function
  | 'call'           // calling another function (child cells follow)
  | 'branch'         // evaluating a condition
  | 'assignment'     // variable assignment(s)
  | 'return'         // returning from a function
  | 'dispatch'       // virtual dispatch resolution
  | 'block'          // a block of sequential statements (grouped)
  | 'note';          // pure commentary cell (no code)

interface CodeSlice {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;                    // the actual source code
  highlights?: LineHighlight[];    // specific lines to emphasize
}

interface LineHighlight {
  line: number;
  type: 'executed' | 'skipped' | 'branched' | 'assigned';
  annotation?: string;
}

interface CellState {
  /** Variables visible at this point, organized by scope */
  scopes: Array<{
    name: string;                  // 'local', 'parameters', 'this', 'closure', etc.
    variables: Record<string, CellVariable>;
  }>;

  /** Quick-reference: what changed in this cell */
  changes?: string[];              // ["x: 5 -> 10", "user: null -> {id: 123}"]
}

interface CellVariable {
  value: string;
  type?: string;
  changed: boolean;                // did this variable change in this cell?
  source: DataSource;
}

interface CellCorrection {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  author: string;
  timestamp: string;
  reason?: string;
}
```

### Example

```json
{
  "id": "walk-user-login",
  "cells": [
    {
      "id": "cell-1",
      "index": 0,
      "type": "entry",
      "code": {
        "filePath": "src/auth/login.ts",
        "startLine": 15,
        "endLine": 20,
        "text": "async authenticateUser(email: string, password: string) {\n  const user = await this.userRepo.findByEmail(email);",
        "highlights": [{ "line": 18, "type": "executed", "annotation": "DB lookup" }]
      },
      "narrative": "The login flow begins when authenticateUser is called with an email and password.",
      "state": {
        "scopes": [{ "name": "parameters", "variables": {
          "email": { "value": "\"user@example.com\"", "type": "string", "changed": false, "source": { "tool": "ai:gpt-4", "confidence": 0.9, "timestamp": "..." } },
          "password": { "value": "\"***\"", "type": "string", "changed": false, "source": { "tool": "ai:gpt-4", "confidence": 0.95, "timestamp": "..." } }
        }}]
      },
      "stackDepth": 0,
      "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." },
      "status": "complete"
    },
    {
      "id": "cell-2",
      "index": 1,
      "type": "call",
      "code": {
        "filePath": "src/db/repository.ts",
        "startLine": 10,
        "endLine": 15,
        "text": "async findByEmail(email: string): Promise<User | null> {\n  return db.query('SELECT * ...', [email]);\n}"
      },
      "narrative": "The repository queries the database for the user record by email.",
      "stackDepth": 1,
      "parentCellId": "cell-1",
      "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." },
      "status": "partial"
    },
    {
      "id": "cell-3",
      "index": 2,
      "type": "branch",
      "code": {
        "filePath": "src/auth/login.ts",
        "startLine": 58,
        "endLine": 62,
        "text": "const isValid = await bcrypt.compare(password, user.passwordHash);\nif (isValid) {\n  // generate token",
        "highlights": [
          { "line": 60, "type": "branched", "annotation": "Condition: isValid === true" }
        ]
      },
      "narrative": "The password hash is compared. In this scenario, credentials are valid so we take the 'if' branch.",
      "state": {
        "scopes": [{ "name": "local", "variables": {
          "isValid": { "value": "true", "type": "boolean", "changed": true, "source": { "tool": "ai:gpt-4", "confidence": 0.88, "timestamp": "..." } }
        }}],
        "changes": ["isValid: undefined -> true"]
      },
      "stackDepth": 1,
      "parentCellId": "cell-1",
      "source": { "tool": "ai:gpt-4", "confidence": 0.88, "timestamp": "..." },
      "status": "complete"
    }
  ]
}
```

### Pros
- **Most natural for LLM generation** — an LLM can produce one cell at a time as a self-contained "here's what happens next" chunk. Very close to how LLMs already explain code
- **Explicit status per cell** — `skeleton` / `partial` / `complete` / `corrected` makes partial population a first-class concept
- **Code slices > line numbers** — showing a 3-5 line slice of code in context is much more useful than a single line reference
- **Narrative-first** — the `narrative` field makes every cell readable by a human without understanding the data model
- **Groupable** — `block` cells can batch multiple sequential statements into one cell, keeping the walk concise
- **`parentCellId` gives hierarchy without nesting** — the flat array is easy to serialize and paginate, but you can reconstruct the tree via parent references
- **`changed` flag on variables** — UI can highlight changed variables without diffing against the previous cell

### Cons
- **Granularity tension** — how big is a cell? One line? One statement? One "logical block"? Different agents may disagree, making walks inconsistent
- **Call stack must be derived** — `stackDepth` + `parentCellId` give you the hierarchy, but you have to walk up the parent chain to build the full stack
- **Code slices may overlap** — two cells might reference overlapping line ranges in the same file, which is confusing
- **`parentCellId` is a weak reference** — if the parent cell is corrected or removed, orphaned children need cleanup
- **Less precise than frame-based models** — a cell covering lines 15-20 is fuzzier than "execution is at line 18"

---

## Idea 5: Graph-of-Snapshots with Edges (Navigable State Graph)

**Core insight:** Model the walk as a **directed graph** where each node is a complete execution snapshot (location + call stack + variables), and edges represent transitions (step-into, step-over, step-out, jump). This makes navigation a graph traversal problem. Multiple walks can share snapshot nodes (if the same function is called with the same state in different scenarios).

### Data Structure

```ts
interface CodeWalkGraph {
  id: string;
  name: string;
  description: string;

  /** All snapshots in this walk */
  snapshots: Map<string, ExecutionSnapshot>;

  /** Edges between snapshots (navigation paths) */
  edges: NavigationEdge[];

  /** The starting snapshot */
  entrySnapshotId: string;

  /** Snapshot ordering for linear traversal */
  linearOrder: string[];           // snapshot IDs in execution order

  meta: WalkMeta;
}

/** A complete snapshot of execution state at one point */
interface ExecutionSnapshot {
  id: string;
  location: CodeLocation;
  sourceText?: string;

  /** Full call stack */
  callStack: StackEntry[];

  /** All visible variables, organized by scope */
  variables: ScopedVariables;

  /** What action produced this snapshot */
  action: SnapshotAction;

  /** Explanation */
  explanation?: string;

  /** Quality metadata */
  source: DataSource;
  confidence?: number;
  completeness: 'location-only' | 'with-stack' | 'with-variables' | 'fully-annotated';

  /** Corrections */
  corrections?: SnapshotCorrection[];
}

interface StackEntry {
  functionName: string;
  location: CodeLocation;
  locals?: Record<string, AnnotatedValue>;
}

interface ScopedVariables {
  parameters?: Record<string, AnnotatedValue>;
  locals?: Record<string, AnnotatedValue>;
  members?: Record<string, AnnotatedValue>;    // this.xxx
  globals?: Record<string, AnnotatedValue>;
  closures?: Record<string, AnnotatedValue>;
}

type SnapshotAction =
  | { type: 'call'; target: string }
  | { type: 'return'; value?: string }
  | { type: 'branch'; condition: string; taken: boolean }
  | { type: 'assign'; variable: string; value: string }
  | { type: 'dispatch'; resolvedTo: string }
  | { type: 'entry' };

/** An edge represents a navigation path between snapshots */
interface NavigationEdge {
  from: string;                    // snapshot ID
  to: string;                     // snapshot ID
  type: 'step-into' | 'step-over' | 'step-out' | 'next' | 'jump' | 'branch-alt';
  label?: string;
}

interface AnnotatedValue {
  value: string;
  type?: string;
  source: DataSource;
  confidence?: number;
  changed?: boolean;               // changed from previous snapshot
}

interface SnapshotCorrection {
  path: string;                    // JSON path: "variables.locals.x.value"
  oldValue: unknown;
  newValue: unknown;
  author: string;
  timestamp: string;
  reason?: string;
}
```

### Example

```json
{
  "id": "walk-user-login",
  "entrySnapshotId": "snap-1",
  "linearOrder": ["snap-1", "snap-2", "snap-3", "snap-4"],
  "snapshots": {
    "snap-1": {
      "id": "snap-1",
      "location": { "filePath": "src/auth/login.ts", "line": 18 },
      "sourceText": "const user = await this.userRepo.findByEmail(email);",
      "callStack": [{ "functionName": "AuthService.authenticateUser", "location": { "filePath": "src/auth/login.ts", "line": 18 } }],
      "variables": {
        "parameters": {
          "email": { "value": "\"user@example.com\"", "type": "string", "source": { "tool": "ai:gpt-4", "confidence": 0.9, "timestamp": "..." } }
        }
      },
      "action": { "type": "call", "target": "UserRepository.findByEmail" },
      "completeness": "fully-annotated",
      "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." }
    },
    "snap-2": {
      "id": "snap-2",
      "location": { "filePath": "src/db/repository.ts", "line": 12 },
      "sourceText": "return db.query('SELECT * FROM users WHERE email = $1', [email]);",
      "callStack": [
        { "functionName": "AuthService.authenticateUser", "location": { "filePath": "src/auth/login.ts", "line": 18 } },
        { "functionName": "UserRepository.findByEmail", "location": { "filePath": "src/db/repository.ts", "line": 12 } }
      ],
      "variables": {
        "parameters": { "email": { "value": "\"user@example.com\"", "type": "string", "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." } } }
      },
      "action": { "type": "entry" },
      "completeness": "with-variables",
      "source": { "tool": "clangd", "confidence": 1.0, "timestamp": "..." }
    }
  },
  "edges": [
    { "from": "snap-1", "to": "snap-2", "type": "step-into", "label": "Enter findByEmail" },
    { "from": "snap-1", "to": "snap-3", "type": "step-over", "label": "Skip to validateCredentials" },
    { "from": "snap-2", "to": "snap-3", "type": "next", "label": "Return to caller, continue" },
    { "from": "snap-3", "to": "snap-4", "type": "next" }
  ]
}
```

### Pros
- **Debugger UX is native** — step-into, step-over, step-out are just edge types. The UI traverses edges instead of incrementing an index
- **Alternative paths** — `branch-alt` edges let you explore "what if the branch went the other way?" without duplicating the whole walk
- **Snapshot sharing** — if two scenarios both call `validateCredentials` with the same state, they can share the snapshot node (space-efficient, enables cross-scenario analysis)
- **Self-contained snapshots** — each snapshot has the FULL state. Random access is O(1). No need to replay events or compute deltas
- **Explicit `completeness` level** — agents can create `location-only` snapshots and enrich them to `fully-annotated` over time
- **Graph structure enables queries** — "find all snapshots where variable X > 100", "find all branch points", etc.

### Cons
- **Full state on every snapshot is expensive** — a 1000-step walk with 50 variables means 50,000 variable values stored (most unchanged between snapshots)
- **Edge maintenance** — adding or removing a snapshot requires updating all edges pointing to/from it
- **Snapshot sharing adds complexity** — shared snapshots must be immutable, or corrections in one scenario affect another
- **Hard for LLMs to produce** — LLMs need to generate both nodes AND edges with consistent IDs. The graph structure adds cognitive overhead for the producing agent
- **Serialization** — JSON doesn't naturally represent graphs with shared references. Need either adjacency lists or repeated data
- **Not inherently ordered** — `linearOrder` is bolted on; the graph itself doesn't enforce execution order

---

## Comparison Matrix

| Criterion | 1. Layered Frames | 2. Event Log | 3. Call Tree | 4. Notebook Cells | 5. Snapshot Graph |
|-----------|-------------------|--------------|-------------|-------------------|-------------------|
| **Partial fillability** | Excellent (optional fields) | Excellent (append events) | Good (shell nodes) | Excellent (status field) | Good (completeness levels) |
| **Correctability** | Good (per-field) | Excellent (append correction events) | Good (per-node) | Good (per-cell) | Good (per-snapshot) |
| **Scalability** | Good (paginate array) | Excellent (append-only, stream) | Medium (deep trees) | Good (paginate cells) | Medium (full state per node) |
| **Browsability** | Good (delta-based) | Medium (needs materialization) | Excellent (tree nav) | Excellent (read top-to-bottom) | Excellent (graph traversal) |
| **LLM-friendliness** | Good (flat, clear fields) | Medium (ordering matters) | Medium (nested JSON) | **Best** (one chunk at a time) | Poor (graph + edge IDs) |
| **Variable tracking** | Good (scoped per frame) | Excellent (timeline free) | Medium (entry/exit only) | Good (per-cell state) | Good (full snapshot) |
| **Call stack** | Explicit (repeated) | Derived (from events) | Implicit (tree path) | Derived (parent chain) | Explicit (per snapshot) |
| **Storage efficiency** | Medium | Medium-High | **Best** (no redundancy) | Medium | Worst (full state per node) |
| **Random access** | O(1) by index | O(N) without snapshots | O(log N) tree walk | O(1) by index | O(1) by ID |
| **Debugger UX fit** | High | Low (needs views) | High | Medium | **Highest** |
| **Implementation complexity** | Medium | Medium-High | Medium | **Low** | High |

---

## Recommendation: Idea 4 (Notebook Cells) as primary, with Idea 1 (Layered Frames) as the internal runtime model

### Why Notebook Cells for storage and agent interaction

1. **LLMs produce cells naturally.** When you ask an LLM "walk me through this code," it already thinks in chunks: "first, the function is entered with these parameters... then it calls findByEmail... then the branch is evaluated..." Each of those chunks is a cell. No training needed — the format matches how LLMs already explain code.

2. **Partial population is a first-class status field.** A static analysis tool (clangd) can produce `skeleton` cells with just `code` + `type`. An AI enrichment pass upgrades them to `partial` (adds `narrative`) or `complete` (adds `state`). A human corrects one cell to `corrected`. Each cell's status is independent. This is the only model where "how done is this walk?" has an obvious answer: count cells by status.

3. **Code slices are more useful than line numbers.** When an agent is looking at code, it naturally works with multi-line chunks. A cell's `CodeSlice` (start line to end line with the actual text) is what the agent already has in its context window. Other models force the agent to decompose its understanding into single-line references.

4. **Flat array with parent references is the best of both worlds.** The array is trivially serializable, pageable, and streamable. The `parentCellId` field reconstructs the call hierarchy for tree-based views without nested JSON. And `stackDepth` gives you the indentation level for rendering without walking the parent chain.

5. **The granularity tension (the main con) is actually a feature.** Different scenarios warrant different granularity. A high-level architecture walkthrough uses coarse `block` cells. A debugging session uses fine-grained `branch`/`assignment` cells. The `type` field + `block` cell type makes this explicit. An LLM can choose the right granularity for the audience.

### Why Layered Frames as the runtime model

When the walk is loaded into the VS Code extension or web UI for interactive stepping, the UI needs:
- O(1) access to the current frame
- Efficient delta computation for step forward/backward
- Full call stack at every point

The Notebook Cell model doesn't give you these directly — you'd need to derive them. So at **display time**, convert cells into Layered Frames:

```
[Storage / Agent API]           [Runtime / UI]
  WalkCell[]          ─────>    ExecutionFrame[]
  (Idea 4)            build()   (Idea 1)
                      <─────
                      serialize()
```

This is exactly how Jupyter notebooks work: the `.ipynb` file stores cells, but the kernel maintains a runtime state (variables, execution count) that's derived from the cells.

### Suggested implementation path

1. **Phase 1 — Define `WalkCell` types and a `CodeWalkFile` format.** Store walks as `.codewalk.json` files alongside scenarios. Agents produce cells.

2. **Phase 2 — Build a `WalkRuntime` class** that converts `WalkCell[]` into an `ExecutionFrame[]` with computed call stacks, variable deltas, and a `globalIndex` for stepping. The VS Code step walker and CLI walk command consume this.

3. **Phase 3 — Multi-pass population.** Implement a `WalkBuilder` that lets different tools append cells at different completeness levels. clangd pass -> AI enrichment pass -> human review pass.

4. **Phase 4 — Borrow from Event Log (Idea 2) for corrections.** Instead of mutating cells in place, append `CorrectionEvent` entries that override specific fields. This gives you an audit trail while keeping the cell array stable.
