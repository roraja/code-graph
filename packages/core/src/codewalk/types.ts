/**
 * Code Walk in Cells — Data structures (Idea 4 from design doc).
 *
 * A code walk is a Jupyter-notebook-style ordered sequence of **cells**,
 * where each cell represents a meaningful chunk of execution. Cells are
 * the unit of authoring, correction, display, and navigation.
 *
 * Key properties:
 * - Flat array with parent references (easy to serialize, paginate)
 * - Each cell carries its own status (skeleton / partial / complete / corrected)
 * - Code slices with line highlights make the walk visually browsable
 * - Variables track `changed` flag per cell for instant diff rendering
 * - `stackDepth` + `parentCellId` reconstruct call hierarchy without nesting
 * - AI doesn't *require* static analyzers but can leverage them for speed
 *
 * @module codewalk/types
 */

// ---------------------------------------------------------------------------
// Core walk structure
// ---------------------------------------------------------------------------

/** A complete code walk — the top-level container. */
export interface CodeWalk {
  id: string;
  name: string;
  description: string;
  /** The scenario this walk was generated from (if any) */
  scenarioId?: string;
  cells: WalkCell[];
  meta: WalkMeta;
}

/** Metadata about the walk itself. */
export interface WalkMeta {
  /** Tools/agents that contributed to this walk */
  contributors: WalkContributor[];
  createdAt: string;
  updatedAt: string;
  /** User-defined tags for filtering/categorization */
  tags: string[];
  /** Entry point of the walk (first cell's location) */
  entryPoint?: CodeLocation;
}

/** A contributor that helped populate this walk. */
export interface WalkContributor {
  /** Tool or agent name: 'clangd', 'ai:claude', 'human:roraja', etc. */
  tool: string;
  /** Which fields this tool populated */
  fieldsPopulated: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Walk Cell — the fundamental unit
// ---------------------------------------------------------------------------

/** A cell is a chunk of execution — the atomic unit of the walk. */
export interface WalkCell {
  id: string;
  /** Sequential position in the walk (0-based) */
  index: number;
  /** What kind of execution chunk this cell represents */
  type: CellType;

  /** The code being discussed in this cell */
  code: CodeSlice;

  /** Human-readable explanation (AI or human authored) */
  narrative?: string;

  /** Variable state at the END of this cell */
  state?: CellState;

  /** How deep in the call stack this cell is */
  stackDepth: number;
  /** Which 'call' or 'entry' cell spawned this context */
  parentCellId?: string;

  /** The full call stack at this cell (derived from parentCellId chain or explicitly set) */
  callStack?: CellCallStackFrame[];

  /** Provenance: who/what produced this cell */
  source: DataSource;
  /** AI confidence in this cell's accuracy (0.0 - 1.0) */
  confidence?: number;
  /** How complete this cell is */
  status: CellStatus;

  /** Corrections applied to this cell */
  corrections?: CellCorrection[];
}

/** Cell types — what kind of execution chunk */
export type CellType =
  | 'entry'          // entering a function (function signature + initial state)
  | 'call'           // calling another function (the call site)
  | 'branch'         // evaluating a condition (if/switch/ternary)
  | 'assignment'     // variable assignment(s)
  | 'return'         // returning from a function
  | 'dispatch'       // virtual dispatch / interface resolution
  | 'block'          // a block of sequential statements (grouped for brevity)
  | 'note';          // pure commentary cell (no code)

/** How complete this cell is — supports incremental population. */
export type CellStatus = 'skeleton' | 'partial' | 'complete' | 'corrected';

// ---------------------------------------------------------------------------
// Code Slice — the code a cell refers to
// ---------------------------------------------------------------------------

/** A slice of source code that a cell discusses. */
export interface CodeSlice {
  /** Absolute or workspace-relative file path */
  filePath: string;
  /** First line of the slice (1-based) */
  startLine: number;
  /** Last line of the slice (1-based, inclusive) */
  endLine: number;
  /** The actual source code text */
  text: string;
  /** Specific lines to visually emphasize within the slice */
  highlights?: LineHighlight[];
}

/** A highlighted line within a code slice. */
export interface LineHighlight {
  /** Line number (1-based, absolute in the file) */
  line: number;
  /** Why this line is highlighted */
  type: 'executed' | 'skipped' | 'branched' | 'assigned' | 'called' | 'returned';
  /** Optional short annotation shown next to the line */
  annotation?: string;
}

// ---------------------------------------------------------------------------
// Cell State — variables at the end of a cell
// ---------------------------------------------------------------------------

/** Variable state at the end of a cell, organized by scope. */
export interface CellState {
  /** Variables organized by scope (local, parameters, this, closure, etc.) */
  scopes: CellScope[];

  /** Quick summary of what changed in this cell */
  changes?: string[];    // e.g. ["x: 5 → 10", "user: null → {id: 123}"]
}

/** A group of variables in a specific scope. */
export interface CellScope {
  /** Scope name: 'local', 'parameters', 'this', 'closure', 'global', etc. */
  name: string;
  /** Variables in this scope */
  variables: Record<string, CellVariable>;
}

/** A single variable's value within a cell. */
export interface CellVariable {
  /** Display value (string representation) */
  value: string;
  /** Declared or inferred type */
  type?: string;
  /** Did this variable change in this cell? (for highlight rendering) */
  changed: boolean;
  /** How was this value determined */
  action?: 'created' | 'modified' | 'read' | 'unchanged';
  /** Who provided this value */
  source: DataSource;
  /** AI explanation of why this value was chosen */
  rationale?: string;
}

// ---------------------------------------------------------------------------
// Call Stack
// ---------------------------------------------------------------------------

/** A frame in the call stack at a given cell. */
export interface CellCallStackFrame {
  /** Function name (qualified) */
  functionName: string;
  /** File location */
  filePath: string;
  /** Line number in the file */
  line: number;
  /** Depth in the stack (0 = root) */
  depth: number;
  /** The cell ID that represents this function's entry */
  cellId?: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Who/what produced a piece of data. */
export interface DataSource {
  /** Tool identifier: 'clangd', 'intellisense', 'ai:claude', 'ai:gpt-4', 'human', etc. */
  tool: string;
  /** Specific agent/person name */
  agent?: string;
  /** When this data was produced */
  timestamp: string;
  /** Confidence in this data (0.0 - 1.0) */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Code Location (reusable)
// ---------------------------------------------------------------------------

/** A specific location in source code. */
export interface CodeLocation {
  filePath: string;
  line: number;
  column?: number;
  functionName?: string;
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/** A correction applied to a cell. */
export interface CellCorrection {
  /** Which field was corrected (e.g., 'narrative', 'state.scopes[0].variables.x') */
  field: string;
  oldValue: unknown;
  newValue: unknown;
  /** Who made the correction */
  author: string;
  timestamp: string;
  /** Why the correction was made */
  reason?: string;
}

// ---------------------------------------------------------------------------
// File format — on-disk representation
// ---------------------------------------------------------------------------

/** The shape of a `.codewalk.json` file on disk. */
export interface CodeWalkFileData {
  _format: 'codegraph-codewalk-v1';
  walk: CodeWalk;
}
