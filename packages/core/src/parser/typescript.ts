/**
 * TypeScript Parser — extracts structural code information from TypeScript/TSX files.
 *
 * Uses `ts-morph` (a TypeScript Compiler API wrapper) to perform full AST analysis
 * with type resolution. Extracts functions, classes, call edges, branches, variables,
 * and inheritance relationships conforming to the {@link ICodeParser} contract.
 *
 * @module parser/typescript
 */

import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  ClassDeclaration,
  InterfaceDeclaration,
  ConstructorDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
  CallExpression,
  IfStatement,
  SwitchStatement,
  ConditionalExpression,
  VariableDeclaration,
  ParameterDeclaration,
  PropertyDeclaration,
  PropertySignature,
  Scope,
  ts,
  Type,
} from 'ts-morph';
import { glob } from 'glob';
import type {
  ICodeParser,
  ParseResult,
  FunctionNode,
  ClassNode,
  CallEdge,
  BranchNode,
  VariableNode,
  InheritanceEdge,
  ParameterInfo,
  PropertyInfo,
  CallSite,
  DispatchContext,
  DispatchResolution,
} from './interface.js';

/** Simple string hash for content fingerprinting. */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Determines the visibility modifier for a class member node.
 *
 * @returns `"public"`, `"protected"`, `"private"`, or `"default"`
 */
function getVisibility(
  node:
    | MethodDeclaration
    | PropertyDeclaration
    | ConstructorDeclaration
    | GetAccessorDeclaration
    | SetAccessorDeclaration,
): string {
  if (node.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
  if (node.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
  if (node.hasModifier(SyntaxKind.PublicKeyword)) return 'public';
  return 'default';
}

/**
 * Extracts JSDoc documentation text from a node, if present.
 */
function getDocumentation(
  node: Node & { getJsDocs?: () => Array<{ getDescription(): string }> },
): string | undefined {
  if (typeof node.getJsDocs === 'function') {
    const docs = node.getJsDocs();
    if (docs.length > 0) {
      return docs
        .map((d) => d.getDescription())
        .join('\n')
        .trim();
    }
  }
  return undefined;
}

/**
 * Builds a unique ID for a node: `filePath:startLine`.
 */
function makeId(filePath: string, startLine: number): string {
  return `${filePath}:${startLine}`;
}

/**
 * TypeScriptParser — full-featured TypeScript/TSX code parser.
 *
 * Implements {@link ICodeParser} to extract structural information
 * from `.ts` and `.tsx` source files using the TypeScript compiler API
 * via `ts-morph`.
 *
 * @example
 * ```ts
 * const parser = new TypeScriptParser();
 * const result = await parser.parseFile('src/index.ts');
 * console.log(result.functions, result.classes);
 * ```
 */
export class TypeScriptParser implements ICodeParser {
  /** Language identifiers handled by this parser. */
  readonly languages: string[] = ['ts', 'tsx'];

  /** The ts-morph project used for analysis. Lazily initialized per parse call. */
  private project: Project | null = null;

  /**
   * Creates a new TypeScriptParser instance.
   *
   * @param existingProject - An optional pre-configured ts-morph Project.
   *   When provided the parser re-uses it instead of creating a new one.
   *   This is useful for testing with in-memory source files.
   */
  constructor(existingProject?: Project) {
    this.project = existingProject ?? null;
  }

  // ---------------------------------------------------------------------------
  // Public API — ICodeParser
  // ---------------------------------------------------------------------------

  /**
   * Parse a single TypeScript file and extract all structural information.
   *
   * @param filePath - Absolute or relative path to the `.ts`/`.tsx` file.
   * @returns A {@link ParseResult} with functions, classes, calls, branches,
   *          variables, and inheritance edges.
   */
  async parseFile(filePath: string): Promise<ParseResult> {
    const start = performance.now();

    const project = this.getOrCreateProject();
    let sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(filePath);
    }

    const content = sourceFile.getFullText();
    const contentHash = hashContent(content);
    const normalizedPath = sourceFile.getFilePath();

    const functions = this.extractFunctions(sourceFile, normalizedPath);
    const classes = this.extractClasses(sourceFile, normalizedPath);
    const calls = this.extractCalls(sourceFile, normalizedPath, functions);
    const branches = this.extractBranches(sourceFile, normalizedPath, functions);
    const variables = this.extractVariables(sourceFile, normalizedPath, functions, classes);
    const inheritances = this.extractInheritance(sourceFile, normalizedPath);

    const parseTimeMs = performance.now() - start;

    return {
      filePath: normalizedPath,
      language: 'typescript',
      functions,
      classes,
      calls,
      branches,
      variables,
      inheritances,
      contentHash,
      parseTimeMs,
    };
  }

  /**
   * Parse all TypeScript files in a directory.
   *
   * @param rootDir - The root directory to search.
   * @param options - Optional include/exclude glob patterns.
   * @returns An array of {@link ParseResult} — one per successfully parsed file.
   */
  async parseDirectory(
    rootDir: string,
    options?: { exclude?: string[]; include?: string[] },
  ): Promise<ParseResult[]> {
    const includePatterns = options?.include ?? ['**/*.ts', '**/*.tsx'];
    const excludePatterns = options?.exclude ?? ['**/node_modules/**', '**/dist/**'];

    const files: string[] = [];
    for (const pattern of includePatterns) {
      const matched = await glob(pattern, {
        cwd: rootDir,
        absolute: true,
        ignore: excludePatterns,
      });
      files.push(...matched);
    }

    // Deduplicate
    const uniqueFiles = Array.from(new Set(files));

    const results: ParseResult[] = [];
    for (const file of uniqueFiles) {
      try {
        const result = await this.parseFile(file);
        results.push(result);
      } catch {
        // Skip files that fail to parse
      }
    }
    return results;
  }

  /**
   * Resolve which concrete function(s) a virtual/interface call could
   * dispatch to, given context about known types.
   *
   * @param callSite - Information about where the call occurs.
   * @param context - Contextual type information for dispatch resolution.
   * @returns An array of {@link DispatchResolution} with possible targets.
   */
  async resolveDispatch(
    callSite: CallSite,
    context: DispatchContext,
  ): Promise<DispatchResolution[]> {
    const project = this.getOrCreateProject();
    const sourceFile = project.getSourceFile(callSite.filePath);
    if (!sourceFile) return [];

    const resolutions: DispatchResolution[] = [];

    // Extract the method name from the call expression (e.g., "obj.method" → "method")
    const methodName = callSite.callExpression.includes('.')
      ? callSite.callExpression.split('.').pop()!
      : callSite.callExpression;

    // Determine the receiver type from context or from the call expression
    let receiverTypeName = callSite.receiverType;
    if (!receiverTypeName) {
      const receiverExpr = callSite.callExpression.includes('.')
        ? callSite.callExpression.split('.').slice(0, -1).join('.')
        : undefined;
      if (receiverExpr && context.knownTypes[receiverExpr]) {
        receiverTypeName = context.knownTypes[receiverExpr];
      }
    }

    if (!receiverTypeName) return [];

    // Find all classes/interfaces with this name in the project
    const allSourceFiles = project.getSourceFiles();
    for (const sf of allSourceFiles) {
      const classes = sf.getClasses();
      for (const cls of classes) {
        if (this.isSubtypeOf(cls, receiverTypeName, project)) {
          const method = cls.getMethod(methodName);
          if (method && !method.isAbstract()) {
            const fnNode = this.methodToFunctionNode(method, sf.getFilePath());
            resolutions.push({
              targetFunction: fnNode,
              confidence: cls.getName() === receiverTypeName ? 1.0 : 0.7,
              evidence:
                cls.getName() === receiverTypeName
                  ? `Direct type match: ${receiverTypeName}.${methodName}`
                  : `${cls.getName()} implements/extends ${receiverTypeName}`,
            });
          }
        }
      }
    }

    return resolutions;
  }

  /**
   * Find all concrete implementations of an abstract or interface method
   * across the project.
   *
   * @param method - The abstract/interface method to find implementations for.
   * @returns An array of concrete {@link FunctionNode} implementations.
   */
  async findImplementations(method: FunctionNode): Promise<FunctionNode[]> {
    const project = this.getOrCreateProject();
    const implementations: FunctionNode[] = [];

    // Determine the class/interface that owns this method
    const parts = method.qualifiedName.split('.');
    if (parts.length < 2) return implementations;

    const className = parts[parts.length - 2];
    const methodName = parts[parts.length - 1];

    const allSourceFiles = project.getSourceFiles();
    for (const sf of allSourceFiles) {
      for (const cls of sf.getClasses()) {
        if (cls.getName() === className) continue;
        if (!this.isSubtypeOf(cls, className, project)) continue;

        const impl = cls.getMethod(methodName);
        if (impl && !impl.isAbstract()) {
          implementations.push(this.methodToFunctionNode(impl, sf.getFilePath()));
        }
      }
    }

    return implementations;
  }

  // ---------------------------------------------------------------------------
  // Extraction helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns or creates the ts-morph Project instance.
   */
  private getOrCreateProject(): Project {
    if (!this.project) {
      this.project = new Project({
        skipFileDependencyResolution: false,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.Node16,
          moduleResolution: ts.ModuleResolutionKind.Node16,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      });
    }
    return this.project;
  }

  /**
   * Extracts all function and method declarations from a source file.
   *
   * Handles:
   * - Top-level function declarations
   * - Class methods (including constructors, getters, setters)
   * - Arrow functions and function expressions assigned to variables
   */
  private extractFunctions(sourceFile: SourceFile, filePath: string): FunctionNode[] {
    const functions: FunctionNode[] = [];

    // Top-level function declarations
    for (const fn of sourceFile.getFunctions()) {
      functions.push(this.functionDeclToNode(fn, filePath));
    }

    // Class methods, constructors, accessors
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? '<anonymous>';

      for (const method of cls.getMethods()) {
        functions.push(this.methodToFunctionNode(method, filePath, className));
      }

      // Constructors
      for (const ctor of cls.getConstructors()) {
        functions.push(this.constructorToFunctionNode(ctor, filePath, className));
      }

      // Getters
      for (const getter of cls.getGetAccessors()) {
        functions.push(this.accessorToFunctionNode(getter, filePath, className, 'get'));
      }

      // Setters
      for (const setter of cls.getSetAccessors()) {
        functions.push(this.accessorToFunctionNode(setter, filePath, className, 'set'));
      }
    }

    // Arrow functions & function expressions assigned to `const`/`let`/`var`
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;

        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          functions.push(
            this.arrowOrExprToFunctionNode(
              init,
              decl.getName(),
              filePath,
              varStmt.isExported(),
            ),
          );
        }
      }
    }

    // Interface method signatures
    for (const iface of sourceFile.getInterfaces()) {
      const ifaceName = iface.getName();
      for (const sig of iface.getMethods()) {
        const startLine = sig.getStartLineNumber();
        const endLine = sig.getEndLineNumber();
        const params = sig.getParameters().map((p) => this.extractParameter(p));
        const returnType = sig.getReturnType().getText(sig) ?? 'void';

        functions.push({
          id: makeId(filePath, startLine),
          name: sig.getName(),
          qualifiedName: `${ifaceName}.${sig.getName()}`,
          filePath,
          startLine,
          endLine,
          signature: `${sig.getName()}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${returnType}`,
          isAbstract: true,
          isOverride: false,
          visibility: 'public',
          language: 'typescript',
          sourceCode: sig.getText(),
          parameters: params,
          returnType,
          isExported: false,
          isAsync: false,
          documentation: getDocumentation(sig),
        });
      }
    }

    return functions;
  }

  /**
   * Converts a top-level FunctionDeclaration into a {@link FunctionNode}.
   */
  private functionDeclToNode(fn: FunctionDeclaration, filePath: string): FunctionNode {
    const name = fn.getName() ?? '<anonymous>';
    const startLine = fn.getStartLineNumber();
    const endLine = fn.getEndLineNumber();
    const params = fn.getParameters().map((p) => this.extractParameter(p));
    const returnType = fn.getReturnType().getText(fn) ?? 'void';
    const isExported = fn.isExported();
    const isAsync = fn.isAsync();

    return {
      id: makeId(filePath, startLine),
      name,
      qualifiedName: name,
      filePath,
      startLine,
      endLine,
      signature: `${name}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${returnType}`,
      isAbstract: false,
      isOverride: false,
      visibility: isExported ? 'public' : 'default',
      language: 'typescript',
      sourceCode: fn.getText(),
      parameters: params,
      returnType,
      isExported,
      isAsync,
      documentation: getDocumentation(fn),
    };
  }

  /**
   * Converts a class MethodDeclaration into a {@link FunctionNode}.
   */
  private methodToFunctionNode(
    method: MethodDeclaration,
    filePath: string,
    className?: string,
  ): FunctionNode {
    const resolvedClassName =
      className ?? method.getParent()?.asKind(SyntaxKind.ClassDeclaration)?.getName() ?? '<class>';
    const name = method.getName();
    const startLine = method.getStartLineNumber();
    const endLine = method.getEndLineNumber();
    const params = method.getParameters().map((p) => this.extractParameter(p));
    const returnType = method.getReturnType().getText(method) ?? 'void';
    const isAbstract = method.isAbstract();
    const isOverride = method.hasModifier(SyntaxKind.OverrideKeyword);
    const isAsync = method.isAsync();
    const isStatic = method.isStatic();
    const vis = getVisibility(method);

    return {
      id: makeId(filePath, startLine),
      name,
      qualifiedName: `${resolvedClassName}.${name}`,
      filePath,
      startLine,
      endLine,
      signature: `${isStatic ? 'static ' : ''}${name}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${returnType}`,
      isAbstract,
      isOverride,
      visibility: vis,
      language: 'typescript',
      sourceCode: method.getText(),
      parameters: params,
      returnType,
      isExported: false,
      isAsync,
      documentation: getDocumentation(method),
    };
  }

  /**
   * Converts a ConstructorDeclaration into a {@link FunctionNode}.
   */
  private constructorToFunctionNode(
    ctor: ConstructorDeclaration,
    filePath: string,
    className: string,
  ): FunctionNode {
    const startLine = ctor.getStartLineNumber();
    const endLine = ctor.getEndLineNumber();
    const params = ctor.getParameters().map((p) => this.extractParameter(p));
    const vis = getVisibility(ctor);

    return {
      id: makeId(filePath, startLine),
      name: 'constructor',
      qualifiedName: `${className}.constructor`,
      filePath,
      startLine,
      endLine,
      signature: `constructor(${params.map((p) => `${p.name}: ${p.type}`).join(', ')})`,
      isAbstract: false,
      isOverride: false,
      visibility: vis,
      language: 'typescript',
      sourceCode: ctor.getText(),
      parameters: params,
      returnType: className,
      isExported: false,
      isAsync: false,
      documentation: getDocumentation(ctor),
    };
  }

  /**
   * Converts a GetAccessor or SetAccessor into a {@link FunctionNode}.
   */
  private accessorToFunctionNode(
    accessor: GetAccessorDeclaration | SetAccessorDeclaration,
    filePath: string,
    className: string,
    kind: 'get' | 'set',
  ): FunctionNode {
    const name = accessor.getName();
    const startLine = accessor.getStartLineNumber();
    const endLine = accessor.getEndLineNumber();
    const params = accessor.getParameters().map((p) => this.extractParameter(p));
    const returnType =
      kind === 'get' ? (accessor.getReturnType().getText(accessor) ?? 'void') : 'void';
    const vis = getVisibility(accessor);

    return {
      id: makeId(filePath, startLine),
      name: `${kind} ${name}`,
      qualifiedName: `${className}.${kind} ${name}`,
      filePath,
      startLine,
      endLine,
      signature: `${kind} ${name}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${returnType}`,
      isAbstract: false,
      isOverride: false,
      visibility: vis,
      language: 'typescript',
      sourceCode: accessor.getText(),
      parameters: params,
      returnType,
      isExported: false,
      isAsync: false,
      documentation: getDocumentation(accessor),
    };
  }

  /**
   * Converts an ArrowFunction or FunctionExpression assigned to a variable
   * into a {@link FunctionNode}.
   */
  private arrowOrExprToFunctionNode(
    node: ArrowFunction | FunctionExpression,
    name: string,
    filePath: string,
    isExported: boolean,
  ): FunctionNode {
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    const params = node.getParameters().map((p) => this.extractParameter(p));
    const returnType = node.getReturnType().getText(node) ?? 'void';
    const isAsync = node.isAsync();

    return {
      id: makeId(filePath, startLine),
      name,
      qualifiedName: name,
      filePath,
      startLine,
      endLine,
      signature: `${name}(${params.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${returnType}`,
      isAbstract: false,
      isOverride: false,
      visibility: isExported ? 'public' : 'default',
      language: 'typescript',
      sourceCode: node.getText(),
      parameters: params,
      returnType,
      isExported,
      isAsync,
      documentation: undefined,
    };
  }

  /**
   * Extracts parameter metadata from a ParameterDeclaration.
   */
  private extractParameter(param: ParameterDeclaration): ParameterInfo {
    return {
      name: param.getName(),
      type: param.getType().getText(param) ?? 'any',
      isOptional: param.isOptional(),
      defaultValue: param.getInitializer()?.getText(),
    };
  }

  /**
   * Extracts all class and interface declarations from a source file.
   */
  private extractClasses(sourceFile: SourceFile, filePath: string): ClassNode[] {
    const classes: ClassNode[] = [];

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() ?? '<anonymous>';
      const startLine = cls.getStartLineNumber();
      const endLine = cls.getEndLineNumber();

      const methods = cls
        .getMethods()
        .map((m) => `${name}.${m.getName()}`);

      // Include constructor and accessors in the methods list
      if (cls.getConstructors().length > 0) {
        methods.push(`${name}.constructor`);
      }
      for (const g of cls.getGetAccessors()) {
        methods.push(`${name}.get ${g.getName()}`);
      }
      for (const s of cls.getSetAccessors()) {
        methods.push(`${name}.set ${s.getName()}`);
      }

      const properties: PropertyInfo[] = cls.getProperties().map((p) => ({
        name: p.getName(),
        type: p.getType().getText(p) ?? 'any',
        visibility: getVisibility(p),
        isStatic: p.isStatic(),
        isReadonly: p.isReadonly(),
      }));

      classes.push({
        id: makeId(filePath, startLine),
        name,
        qualifiedName: name,
        filePath,
        startLine,
        endLine,
        isAbstract: cls.isAbstract(),
        isInterface: false,
        language: 'typescript',
        methods,
        properties,
        documentation: getDocumentation(cls),
      });
    }

    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      const startLine = iface.getStartLineNumber();
      const endLine = iface.getEndLineNumber();

      const methods = iface.getMethods().map((m) => `${name}.${m.getName()}`);

      const properties: PropertyInfo[] = iface.getProperties().map((p) => ({
        name: p.getName(),
        type: p.getType().getText(p) ?? 'any',
        visibility: 'public',
        isStatic: false,
        isReadonly: p.isReadonly(),
      }));

      classes.push({
        id: makeId(filePath, startLine),
        name,
        qualifiedName: name,
        filePath,
        startLine,
        endLine,
        isAbstract: false,
        isInterface: true,
        language: 'typescript',
        methods,
        properties,
        documentation: getDocumentation(iface),
      });
    }

    return classes;
  }

  /**
   * Extracts all call edges from a source file.
   *
   * Walks through every {@link CallExpression} in the file, determines
   * the enclosing function, and records the caller→callee edge.
   * Detects virtual dispatch when the receiver's type is an interface
   * or an abstract class.
   */
  private extractCalls(
    sourceFile: SourceFile,
    filePath: string,
    functions: FunctionNode[],
  ): CallEdge[] {
    const calls: CallEdge[] = [];

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const callExpr = node as CallExpression;
      const expression = callExpr.getExpression();
      const callText = expression.getText();
      const line = callExpr.getStartLineNumber();
      const column = callExpr.getStart() - callExpr.getStartLinePos();

      // Determine callee name
      let calleeName: string;
      if (Node.isPropertyAccessExpression(expression)) {
        calleeName = expression.getName();
      } else if (Node.isIdentifier(expression)) {
        calleeName = expression.getText();
      } else {
        calleeName = callText;
      }

      // Determine caller function
      const callerId = this.findEnclosingFunctionId(node, filePath, functions);

      // Detect virtual dispatch: receiver type is interface or abstract class
      let isVirtualDispatch = false;
      if (Node.isPropertyAccessExpression(expression)) {
        try {
          const receiverType = expression.getExpression().getType();
          if (receiverType) {
            isVirtualDispatch = this.isInterfaceOrAbstract(receiverType);
          }
        } catch {
          // Type resolution may fail for some expressions
        }
      }

      // Attempt to resolve the callee ID
      let calleeId = calleeName;
      try {
        const symbol = expression.getSymbol();
        if (symbol) {
          const decls = symbol.getDeclarations();
          if (decls.length > 0) {
            const declFile = decls[0].getSourceFile().getFilePath();
            const declLine = decls[0].getStartLineNumber();
            calleeId = makeId(declFile, declLine);
          }
        }
      } catch {
        // Symbol resolution may fail
      }

      calls.push({
        callerId,
        calleeId,
        calleeName,
        filePath,
        line,
        column,
        isVirtualDispatch,
        callExpression: callText,
      });
    });

    return calls;
  }

  /**
   * Extracts branch nodes (if/else, switch/case, ternary) from a source file.
   */
  private extractBranches(
    sourceFile: SourceFile,
    filePath: string,
    functions: FunctionNode[],
  ): BranchNode[] {
    const branches: BranchNode[] = [];

    sourceFile.forEachDescendant((node) => {
      if (Node.isIfStatement(node)) {
        this.extractIfBranch(node, filePath, functions, branches);
      } else if (Node.isSwitchStatement(node)) {
        this.extractSwitchBranch(node, filePath, functions, branches);
      } else if (Node.isConditionalExpression(node)) {
        this.extractTernaryBranch(node, filePath, functions, branches);
      }
    });

    return branches;
  }

  /**
   * Extracts an if/else-if chain into {@link BranchNode} entries.
   */
  private extractIfBranch(
    node: IfStatement,
    filePath: string,
    functions: FunctionNode[],
    branches: BranchNode[],
  ): void {
    const condition = node.getExpression().getText();
    const line = node.getStartLineNumber();
    const functionId = this.findEnclosingFunctionId(node, filePath, functions);

    const thenStmt = node.getThenStatement();
    const thenStartLine = thenStmt.getStartLineNumber();
    const thenEndLine = thenStmt.getEndLineNumber();

    const elseStmt = node.getElseStatement();
    let elseStartLine: number | undefined;
    let elseEndLine: number | undefined;

    if (elseStmt) {
      elseStartLine = elseStmt.getStartLineNumber();
      elseEndLine = elseStmt.getEndLineNumber();
    }

    branches.push({
      id: makeId(filePath, line),
      type: 'if',
      condition,
      functionId,
      filePath,
      line,
      thenStartLine,
      thenEndLine,
      elseStartLine,
      elseEndLine,
    });

    // If the else clause is itself an if-statement, extract it as "else_if"
    if (elseStmt && Node.isIfStatement(elseStmt)) {
      const elseIfCondition = elseStmt.getExpression().getText();
      const elseIfLine = elseStmt.getStartLineNumber();
      const elseIfThen = elseStmt.getThenStatement();

      const elseIfElse = elseStmt.getElseStatement();

      branches.push({
        id: makeId(filePath, elseIfLine),
        type: 'else_if',
        condition: elseIfCondition,
        functionId,
        filePath,
        line: elseIfLine,
        thenStartLine: elseIfThen.getStartLineNumber(),
        thenEndLine: elseIfThen.getEndLineNumber(),
        elseStartLine: elseIfElse?.getStartLineNumber(),
        elseEndLine: elseIfElse?.getEndLineNumber(),
      });
    }
  }

  /**
   * Extracts switch/case into {@link BranchNode} entries (one per case clause).
   */
  private extractSwitchBranch(
    node: SwitchStatement,
    filePath: string,
    functions: FunctionNode[],
    branches: BranchNode[],
  ): void {
    const switchExpr = node.getExpression().getText();
    const functionId = this.findEnclosingFunctionId(node, filePath, functions);

    for (const clause of node.getCaseBlock().getClauses()) {
      const clauseLine = clause.getStartLineNumber();
      const clauseEndLine = clause.getEndLineNumber();

      let condition: string;
      if (Node.isCaseClause(clause)) {
        condition = `${switchExpr} === ${clause.getExpression().getText()}`;
      } else {
        condition = `default`;
      }

      branches.push({
        id: makeId(filePath, clauseLine),
        type: 'switch_case',
        condition,
        functionId,
        filePath,
        line: clauseLine,
        thenStartLine: clauseLine,
        thenEndLine: clauseEndLine,
      });
    }
  }

  /**
   * Extracts a ternary (conditional) expression into a {@link BranchNode}.
   */
  private extractTernaryBranch(
    node: ConditionalExpression,
    filePath: string,
    functions: FunctionNode[],
    branches: BranchNode[],
  ): void {
    const condition = node.getCondition().getText();
    const line = node.getStartLineNumber();
    const functionId = this.findEnclosingFunctionId(node, filePath, functions);

    const whenTrue = node.getWhenTrue();
    const whenFalse = node.getWhenFalse();

    branches.push({
      id: makeId(filePath, line),
      type: 'ternary',
      condition,
      functionId,
      filePath,
      line,
      thenStartLine: whenTrue.getStartLineNumber(),
      thenEndLine: whenTrue.getEndLineNumber(),
      elseStartLine: whenFalse.getStartLineNumber(),
      elseEndLine: whenFalse.getEndLineNumber(),
    });
  }

  /**
   * Extracts variable declarations, function parameters, and class member
   * properties from a source file.
   */
  private extractVariables(
    sourceFile: SourceFile,
    filePath: string,
    functions: FunctionNode[],
    classes: ClassNode[],
  ): VariableNode[] {
    const variables: VariableNode[] = [];

    // Local and global variable declarations (search all depths to find locals inside functions)
    for (const varStmt of sourceFile.getDescendantsOfKind(SyntaxKind.VariableStatement)) {
      for (const decl of varStmt.getDeclarations()) {
        const init = decl.getInitializer();
        // Skip arrow functions / function expressions (already captured as functions)
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          continue;
        }

        const line = decl.getStartLineNumber();
        const functionId = this.findEnclosingFunctionId(decl, filePath, functions);
        const scope = functionId ? 'local' : 'global';

        variables.push({
          id: makeId(filePath, line),
          name: decl.getName(),
          type: decl.getType().getText(decl) ?? 'any',
          scope,
          filePath,
          line,
          functionId: functionId || undefined,
          initialValue: init?.getText(),
        });
      }
    }

    // Function parameters
    for (const fn of functions) {
      for (const param of fn.parameters) {
        // Find the parameter declaration node to get the correct line
        // Use the function start line as a fallback
        variables.push({
          id: `${filePath}:${fn.startLine}:param:${param.name}`,
          name: param.name,
          type: param.type,
          scope: 'parameter',
          filePath,
          line: fn.startLine,
          functionId: fn.id,
          initialValue: param.defaultValue,
        });
      }
    }

    // Class member properties
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() ?? '<anonymous>';
      const classId = classes.find((c) => c.name === className)?.id;

      for (const prop of cls.getProperties()) {
        const line = prop.getStartLineNumber();
        variables.push({
          id: makeId(filePath, line),
          name: prop.getName(),
          type: prop.getType().getText(prop) ?? 'any',
          scope: 'member',
          filePath,
          line,
          classId,
          initialValue: prop.getInitializer()?.getText(),
        });
      }
    }

    return variables;
  }

  /**
   * Extracts inheritance relationships (extends/implements) from a source file.
   */
  private extractInheritance(sourceFile: SourceFile, filePath: string): InheritanceEdge[] {
    const edges: InheritanceEdge[] = [];

    for (const cls of sourceFile.getClasses()) {
      const childId = makeId(filePath, cls.getStartLineNumber());

      // extends
      const baseClass = cls.getExtends();
      if (baseClass) {
        const baseName = baseClass.getText();
        const parentId = this.resolveTypeId(baseName, sourceFile, filePath);
        edges.push({ childId, parentId, type: 'extends' });
      }

      // implements
      for (const impl of cls.getImplements()) {
        const ifaceName = impl.getText();
        const parentId = this.resolveTypeId(ifaceName, sourceFile, filePath);
        edges.push({ childId, parentId, type: 'implements' });
      }
    }

    // Interface extends
    for (const iface of sourceFile.getInterfaces()) {
      const childId = makeId(filePath, iface.getStartLineNumber());
      for (const base of iface.getBaseDeclarations()) {
        const parentId = makeId(base.getSourceFile().getFilePath(), base.getStartLineNumber());
        edges.push({ childId, parentId, type: 'extends' });
      }
    }

    return edges;
  }

  // ---------------------------------------------------------------------------
  // Internal utilities
  // ---------------------------------------------------------------------------

  /**
   * Finds the enclosing function ID for a given AST node.
   *
   * Walks up the AST tree until it finds a function, method, constructor,
   * or accessor declaration, then returns its ID. Returns an empty string
   * if the node is at module scope.
   */
  private findEnclosingFunctionId(
    node: Node,
    filePath: string,
    functions: FunctionNode[],
  ): string {
    let current: Node | undefined = node.getParent();

    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isConstructorDeclaration(current) ||
        Node.isGetAccessorDeclaration(current) ||
        Node.isSetAccessorDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current)
      ) {
        const startLine = current.getStartLineNumber();
        const id = makeId(filePath, startLine);
        // Verify this ID exists in our functions list
        const match = functions.find((f) => f.id === id);
        if (match) return match.id;

        // For arrow functions assigned to variables, the function node starts
        // at the arrow function, but our recorded id starts at the arrow line.
        // Try finding by start line.
        const byLine = functions.find((f) => f.startLine === startLine);
        if (byLine) return byLine.id;
      }
      current = current.getParent();
    }

    return '';
  }

  /**
   * Checks whether a ts-morph Type represents an interface or an abstract class.
   */
  private isInterfaceOrAbstract(type: Type): boolean {
    const symbol = type.getSymbol();
    if (!symbol) return false;

    const declarations = symbol.getDeclarations();
    for (const decl of declarations) {
      if (Node.isInterfaceDeclaration(decl)) return true;
      if (Node.isClassDeclaration(decl) && decl.isAbstract()) return true;
    }
    return false;
  }

  /**
   * Resolves a type name to a node ID by searching the current file
   * and the project's source files.
   *
   * @returns The ID of the resolved type, or a placeholder `unresolved:<name>`.
   */
  private resolveTypeId(
    typeName: string,
    sourceFile: SourceFile,
    currentFilePath: string,
  ): string {
    // Strip generic parameters for lookup
    const baseName = typeName.replace(/<.*>/, '');

    // Search current file first
    for (const cls of sourceFile.getClasses()) {
      if (cls.getName() === baseName) {
        return makeId(currentFilePath, cls.getStartLineNumber());
      }
    }
    for (const iface of sourceFile.getInterfaces()) {
      if (iface.getName() === baseName) {
        return makeId(currentFilePath, iface.getStartLineNumber());
      }
    }

    // Search across the project
    const project = this.getOrCreateProject();
    for (const sf of project.getSourceFiles()) {
      for (const cls of sf.getClasses()) {
        if (cls.getName() === baseName) {
          return makeId(sf.getFilePath(), cls.getStartLineNumber());
        }
      }
      for (const iface of sf.getInterfaces()) {
        if (iface.getName() === baseName) {
          return makeId(sf.getFilePath(), iface.getStartLineNumber());
        }
      }
    }

    return `unresolved:${baseName}`;
  }

  /**
   * Checks whether a class is a subtype of a named type (via extends or implements).
   */
  private isSubtypeOf(
    cls: ClassDeclaration,
    targetName: string,
    project: Project,
  ): boolean {
    // Direct match
    if (cls.getName() === targetName) return true;

    // Check implements
    for (const impl of cls.getImplements()) {
      const implName = impl.getText().replace(/<.*>/, '');
      if (implName === targetName) return true;
    }

    // Check extends chain
    const baseExpr = cls.getExtends();
    if (baseExpr) {
      const baseName = baseExpr.getText().replace(/<.*>/, '');
      if (baseName === targetName) return true;

      // Recursively check the base class
      for (const sf of project.getSourceFiles()) {
        for (const baseCls of sf.getClasses()) {
          if (baseCls.getName() === baseName) {
            return this.isSubtypeOf(baseCls, targetName, project);
          }
        }
      }
    }

    return false;
  }
}
