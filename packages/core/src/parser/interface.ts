/**
 * Parser Interface — defines the contract all language parsers must implement.
 *
 * Each parser extracts structural information from source files:
 * functions, classes, call edges, branches, variables, and inheritance.
 *
 * @module parser/interface
 */

/** A parsed function/method in the source code */
export interface FunctionNode {
  /** Unique ID: typically `filePath:startLine` or mangled name */
  id: string;
  /** Simple name, e.g. "handleFileDrop" */
  name: string;
  /** Fully qualified name, e.g. "DropHandler.handleFileDrop" */
  qualifiedName: string;
  /** File where this function is defined */
  filePath: string;
  /** Start line (1-indexed) */
  startLine: number;
  /** End line (1-indexed) */
  endLine: number;
  /** Full signature, e.g. "handleFileDrop(data: DropData): void" */
  signature: string;
  /** Whether the function is declared abstract/virtual */
  isAbstract: boolean;
  /** Whether it overrides a parent class method */
  isOverride: boolean;
  /** "public" | "protected" | "private" | "default" */
  visibility: string;
  /** Source language */
  language: string;
  /** The raw source code of the function body */
  sourceCode: string;
  /** Parameters with types */
  parameters: ParameterInfo[];
  /** Return type */
  returnType: string;
  /** Whether this is an exported function */
  isExported: boolean;
  /** Whether this is async */
  isAsync: boolean;
  /** JSDoc/comment documentation */
  documentation?: string;
}

/** Parameter information for a function */
export interface ParameterInfo {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue?: string;
}

/** A class/interface in the source code */
export interface ClassNode {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isAbstract: boolean;
  isInterface: boolean;
  language: string;
  /** Methods defined on this class */
  methods: string[];
  /** Properties/fields */
  properties: PropertyInfo[];
  documentation?: string;
}

/** Property information for a class */
export interface PropertyInfo {
  name: string;
  type: string;
  visibility: string;
  isStatic: boolean;
  isReadonly: boolean;
}

/** A function call edge: caller → callee */
export interface CallEdge {
  /** ID of the calling function */
  callerId: string;
  /** ID or qualified name of the called function */
  calleeId: string;
  /** Name of the called function (for display) */
  calleeName: string;
  /** File where the call occurs */
  filePath: string;
  /** Line number of the call */
  line: number;
  /** Column of the call */
  column: number;
  /** Whether this is a virtual/dynamic dispatch */
  isVirtualDispatch: boolean;
  /** The expression used to call (e.g., "this.handler.process") */
  callExpression: string;
}

/** A branch (if/else/switch) in the source code */
export interface BranchNode {
  id: string;
  /** "if" | "else_if" | "switch_case" | "ternary" | "logical_and" | "logical_or" */
  type: string;
  /** The condition expression as source text */
  condition: string;
  /** Containing function ID */
  functionId: string;
  filePath: string;
  line: number;
  /** Line where the 'then' block starts */
  thenStartLine: number;
  /** Line where the 'then' block ends */
  thenEndLine: number;
  /** Line where the 'else' block starts (if any) */
  elseStartLine?: number;
  /** Line where the 'else' block ends (if any) */
  elseEndLine?: number;
}

/** A variable declaration/usage */
export interface VariableNode {
  id: string;
  name: string;
  type: string;
  /** "local" | "parameter" | "member" | "global" | "property" */
  scope: string;
  filePath: string;
  line: number;
  /** The function this variable belongs to (if local/parameter) */
  functionId?: string;
  /** The class this variable belongs to (if member) */
  classId?: string;
  /** Initial value if statically determinable */
  initialValue?: string;
}

/** An inheritance relationship (extends/implements) */
export interface InheritanceEdge {
  /** ID of the child class */
  childId: string;
  /** ID of the parent class/interface */
  parentId: string;
  /** "extends" | "implements" */
  type: 'extends' | 'implements';
}

/** Information about a call site for dispatch resolution */
export interface CallSite {
  filePath: string;
  line: number;
  column: number;
  callerFunctionId: string;
  callExpression: string;
  receiverType?: string;
}

/** Context for resolving virtual dispatch */
export interface DispatchContext {
  /** Known variable types at the call site */
  knownTypes: Record<string, string>;
  /** The scenario being traced (if any) */
  scenarioId?: string;
  /** User corrections that may affect dispatch */
  corrections?: Array<{ rule: string; scope: string }>;
}

/** Result of resolving a virtual dispatch */
export interface DispatchResolution {
  /** The concrete function that would be called */
  targetFunction: FunctionNode;
  /** Confidence in this resolution (0.0 - 1.0) */
  confidence: number;
  /** Explanation of why this target was chosen */
  evidence: string;
}

/** Complete parse result for a single file */
export interface ParseResult {
  filePath: string;
  language: string;
  functions: FunctionNode[];
  classes: ClassNode[];
  calls: CallEdge[];
  branches: BranchNode[];
  variables: VariableNode[];
  inheritances: InheritanceEdge[];
  /** Content hash for incremental parsing */
  contentHash: string;
  /** Parse duration in milliseconds */
  parseTimeMs: number;
}

/**
 * ICodeParser — the contract every language parser must implement.
 *
 * Parsers extract structural information (functions, classes, calls, branches)
 * from source files. They also support resolving virtual/dynamic dispatch
 * and finding implementations of abstract methods.
 */
export interface ICodeParser {
  /** Language identifiers this parser handles (e.g. ["ts", "tsx"]) */
  readonly languages: string[];

  /** Parse a single source file and extract all structural information */
  parseFile(filePath: string): Promise<ParseResult>;

  /**
   * Parse all files in a directory matching this parser's language.
   * Returns results for each file. Skips files that fail to parse.
   */
  parseDirectory(
    rootDir: string,
    options?: { exclude?: string[]; include?: string[] }
  ): Promise<ParseResult[]>;

  /**
   * Resolve which concrete function(s) a virtual/interface call
   * could dispatch to, given context.
   */
  resolveDispatch(
    callSite: CallSite,
    context: DispatchContext
  ): Promise<DispatchResolution[]>;

  /**
   * Find all concrete implementations of an abstract/interface method.
   */
  findImplementations(
    method: FunctionNode
  ): Promise<FunctionNode[]>;
}
