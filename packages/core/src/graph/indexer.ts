/**
 * Code Indexer — writes parsed source code structures into Neo4j as
 * nodes and relationships, forming the CodeGraph.
 *
 * Uses MERGE (upsert) for idempotent writes so that re-indexing a file
 * updates existing nodes rather than creating duplicates.
 *
 * @module graph/indexer
 */

import type { ManagedTransaction } from 'neo4j-driver';
import type { GraphDriver } from './driver.js';
import type {
  ParseResult,
  FunctionNode,
  ClassNode,
  CallEdge,
  BranchNode,
  VariableNode,
  InheritanceEdge,
} from '../parser/interface.js';

/**
 * CodeIndexer transforms {@link ParseResult} objects into Neo4j graph
 * nodes and relationships.
 *
 * @example
 * ```ts
 * const indexer = new CodeIndexer(driver);
 * const result = await parser.parseFile('src/app.ts');
 * await indexer.indexParseResult(result);
 * ```
 */
export class CodeIndexer {
  private readonly driver: GraphDriver;

  constructor(driver: GraphDriver) {
    this.driver = driver;
  }

  /**
   * Indexes a single {@link ParseResult} into Neo4j.
   *
   * Creates or updates:
   * - `:File` node for the source file
   * - `:Function` nodes with `:CONTAINS` edges from the file
   * - `:Class` nodes with `:CONTAINS` edges from the file
   * - `:Branch` nodes with `:HAS_BRANCH` edges from owning functions
   * - `:Variable` nodes with `:READS`/`:WRITES` edges
   * - `:CALLS` edges between functions
   * - `:EXTENDS` / `:IMPLEMENTS` edges for inheritance
   * - `:MEMBER_OF` edges from methods to classes
   * - `:OVERRIDES` edges for overriding methods
   *
   * @param result - The parse result to index
   */
  async indexParseResult(result: ParseResult): Promise<void> {
    await this.driver.runInTransaction(async (tx) => {
      // 1. File node
      await this.mergeFileNode(tx, result);

      // 2. Functions
      await this.mergeFunctionNodes(tx, result.functions, result.filePath);

      // 3. Classes
      await this.mergeClassNodes(tx, result.classes, result.filePath);

      // 4. Call edges
      await this.mergeCallEdges(tx, result.calls);

      // 5. Branches
      await this.mergeBranchNodes(tx, result.branches);

      // 6. Variables
      await this.mergeVariableNodes(tx, result.variables);

      // 7. Inheritance edges
      await this.mergeInheritanceEdges(tx, result.inheritances);
    });
  }

  /**
   * Batch-indexes multiple parse results, one transaction per file.
   *
   * @param results - Array of parse results (typically from a directory parse)
   */
  async indexDirectory(results: ParseResult[]): Promise<void> {
    for (const result of results) {
      await this.indexParseResult(result);
    }
  }

  /**
   * Removes all nodes and relationships associated with a given file path.
   *
   * This detaches and deletes Functions, Classes, Branches, and Variables
   * that belong to the file, then removes the File node itself.
   *
   * @param filePath - Absolute or project-relative path of the file to remove
   */
  async removeFile(filePath: string): Promise<void> {
    await this.driver.runInTransaction(async (tx) => {
      // Remove functions and their relationships
      await tx.run(
        `MATCH (f:Function {filePath: $filePath})
         DETACH DELETE f`,
        { filePath }
      );

      // Remove classes and their relationships
      await tx.run(
        `MATCH (c:Class {filePath: $filePath})
         DETACH DELETE c`,
        { filePath }
      );

      // Remove branches belonging to this file
      await tx.run(
        `MATCH (b:Branch {filePath: $filePath})
         DETACH DELETE b`,
        { filePath }
      );

      // Remove variables belonging to this file
      await tx.run(
        `MATCH (v:Variable {filePath: $filePath})
         DETACH DELETE v`,
        { filePath }
      );

      // Remove the file node itself
      await tx.run(
        `MATCH (file:File {path: $filePath})
         DETACH DELETE file`,
        { filePath }
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Private merge helpers
  // ---------------------------------------------------------------------------

  /**
   * Merges the :File node for the source file and stores content hash metadata.
   */
  private async mergeFileNode(
    tx: ManagedTransaction,
    result: ParseResult
  ): Promise<void> {
    await tx.run(
      `MERGE (file:File {path: $path})
       SET file.language = $language,
           file.contentHash = $contentHash,
           file.indexedAt = datetime()`,
      {
        path: result.filePath,
        language: result.language,
        contentHash: result.contentHash,
      }
    );
  }

  /**
   * Merges :Function nodes and creates :CONTAINS edges from the :File node.
   * Also creates :MEMBER_OF edges for methods and :OVERRIDES edges where applicable.
   */
  private async mergeFunctionNodes(
    tx: ManagedTransaction,
    functions: FunctionNode[],
    filePath: string
  ): Promise<void> {
    if (functions.length === 0) return;

    // Batch merge functions
    await tx.run(
      `UNWIND $functions AS fn
       MERGE (f:Function {id: fn.id})
       SET f.name = fn.name,
           f.qualifiedName = fn.qualifiedName,
           f.filePath = fn.filePath,
           f.startLine = fn.startLine,
           f.endLine = fn.endLine,
           f.signature = fn.signature,
           f.isAbstract = fn.isAbstract,
           f.isOverride = fn.isOverride,
           f.visibility = fn.visibility,
           f.language = fn.language,
           f.sourceCode = fn.sourceCode,
           f.parameters = fn.parameters,
           f.returnType = fn.returnType,
           f.isExported = fn.isExported,
           f.isAsync = fn.isAsync,
           f.documentation = fn.documentation
       WITH f, fn
       MATCH (file:File {path: fn.filePath})
       MERGE (file)-[:CONTAINS]->(f)`,
      {
        functions: functions.map((fn) => ({
          ...fn,
          parameters: JSON.stringify(fn.parameters),
          documentation: fn.documentation ?? null,
        })),
      }
    );

    // Create :MEMBER_OF edges for methods that belong to a class
    const methodsWithClass = functions.filter((fn) =>
      fn.qualifiedName.includes('.')
    );
    if (methodsWithClass.length > 0) {
      await tx.run(
        `UNWIND $methods AS m
         MATCH (f:Function {id: m.id})
         MATCH (c:Class {qualifiedName: m.className})
         MERGE (f)-[:MEMBER_OF]->(c)`,
        {
          methods: methodsWithClass.map((fn) => ({
            id: fn.id,
            className: fn.qualifiedName.substring(
              0,
              fn.qualifiedName.lastIndexOf('.')
            ),
          })),
        }
      );
    }

    // Create :OVERRIDES edges for override methods
    const overrides = functions.filter((fn) => fn.isOverride);
    if (overrides.length > 0) {
      await tx.run(
        `UNWIND $overrides AS o
         MATCH (child:Function {id: o.id})
         MATCH (parent:Function {name: o.name, isAbstract: true})
         WHERE parent.id <> child.id
         MERGE (child)-[:OVERRIDES]->(parent)`,
        {
          overrides: overrides.map((fn) => ({
            id: fn.id,
            name: fn.name,
          })),
        }
      );
    }
  }

  /**
   * Merges :Class nodes and creates :CONTAINS edges from the :File node.
   */
  private async mergeClassNodes(
    tx: ManagedTransaction,
    classes: ClassNode[],
    filePath: string
  ): Promise<void> {
    if (classes.length === 0) return;

    await tx.run(
      `UNWIND $classes AS cls
       MERGE (c:Class {id: cls.id})
       SET c.name = cls.name,
           c.qualifiedName = cls.qualifiedName,
           c.filePath = cls.filePath,
           c.startLine = cls.startLine,
           c.endLine = cls.endLine,
           c.isAbstract = cls.isAbstract,
           c.isInterface = cls.isInterface,
           c.language = cls.language,
           c.methods = cls.methods,
           c.properties = cls.properties,
           c.documentation = cls.documentation
       WITH c, cls
       MATCH (file:File {path: cls.filePath})
       MERGE (file)-[:CONTAINS]->(c)`,
      {
        classes: classes.map((cls) => ({
          ...cls,
          methods: JSON.stringify(cls.methods),
          properties: JSON.stringify(cls.properties),
          documentation: cls.documentation ?? null,
        })),
      }
    );
  }

  /**
   * Merges :CALLS relationship edges between :Function nodes.
   * Matches callees by exact ID first, then by qualifiedName or name.
   */
  private async mergeCallEdges(
    tx: ManagedTransaction,
    calls: CallEdge[]
  ): Promise<void> {
    if (calls.length === 0) return;

    // Match by exact ID
    await tx.run(
      `UNWIND $calls AS call
       MATCH (caller:Function {id: call.callerId})
       MATCH (callee:Function {id: call.calleeId})
       MERGE (caller)-[r:CALLS]->(callee)
       SET r.filePath = call.filePath,
           r.line = call.line,
           r.column = call.column,
           r.isVirtualDispatch = call.isVirtualDispatch,
           r.callExpression = call.callExpression,
           r.calleeName = call.calleeName`,
      { calls }
    );

    // Match by qualifiedName (for cross-file calls where calleeId is a name)
    await tx.run(
      `UNWIND $calls AS call
       MATCH (caller:Function {id: call.callerId})
       MATCH (callee:Function)
       WHERE callee.qualifiedName = call.calleeId OR callee.qualifiedName = call.calleeName
       AND NOT EXISTS { (caller)-[:CALLS]->(callee) }
       MERGE (caller)-[r:CALLS]->(callee)
       SET r.filePath = call.filePath,
           r.line = call.line,
           r.column = call.column,
           r.isVirtualDispatch = call.isVirtualDispatch,
           r.callExpression = call.callExpression,
           r.calleeName = call.calleeName`,
      { calls }
    );

    // Match by simple name (fallback for unqualified calls)
    await tx.run(
      `UNWIND $calls AS call
       MATCH (caller:Function {id: call.callerId})
       MATCH (callee:Function)
       WHERE callee.name = call.calleeName
       AND NOT EXISTS { (caller)-[:CALLS]->(callee) }
       MERGE (caller)-[r:CALLS]->(callee)
       SET r.filePath = call.filePath,
           r.line = call.line,
           r.column = call.column,
           r.isVirtualDispatch = call.isVirtualDispatch,
           r.callExpression = call.callExpression,
           r.calleeName = call.calleeName`,
      { calls }
    );
  }

  /**
   * Merges :Branch nodes and creates :HAS_BRANCH edges from owning :Function nodes.
   */
  private async mergeBranchNodes(
    tx: ManagedTransaction,
    branches: BranchNode[]
  ): Promise<void> {
    if (branches.length === 0) return;

    await tx.run(
      `UNWIND $branches AS br
       MERGE (b:Branch {id: br.id})
       SET b.type = br.type,
           b.condition = br.condition,
           b.functionId = br.functionId,
           b.filePath = br.filePath,
           b.line = br.line,
           b.thenStartLine = br.thenStartLine,
           b.thenEndLine = br.thenEndLine,
           b.elseStartLine = br.elseStartLine,
           b.elseEndLine = br.elseEndLine
       WITH b, br
       MATCH (f:Function {id: br.functionId})
       MERGE (f)-[:HAS_BRANCH]->(b)`,
      {
        branches: branches.map((br) => ({
          ...br,
          elseStartLine: br.elseStartLine ?? null,
          elseEndLine: br.elseEndLine ?? null,
        })),
      }
    );
  }

  /**
   * Merges :Variable nodes and creates :READS/:WRITES edges
   * from owning :Function or :Class nodes.
   */
  private async mergeVariableNodes(
    tx: ManagedTransaction,
    variables: VariableNode[]
  ): Promise<void> {
    if (variables.length === 0) return;

    await tx.run(
      `UNWIND $variables AS v
       MERGE (var:Variable {id: v.id})
       SET var.name = v.name,
           var.type = v.type,
           var.scope = v.scope,
           var.filePath = v.filePath,
           var.line = v.line,
           var.functionId = v.functionId,
           var.classId = v.classId,
           var.initialValue = v.initialValue`,
      {
        variables: variables.map((v) => ({
          ...v,
          functionId: v.functionId ?? null,
          classId: v.classId ?? null,
          initialValue: v.initialValue ?? null,
        })),
      }
    );

    // :READS/:WRITES edges from functions to their variables
    const funcVars = variables.filter((v) => v.functionId);
    if (funcVars.length > 0) {
      await tx.run(
        `UNWIND $funcVars AS fv
         MATCH (f:Function {id: fv.functionId})
         MATCH (v:Variable {id: fv.id})
         MERGE (f)-[:READS]->(v)
         MERGE (f)-[:WRITES]->(v)`,
        { funcVars }
      );
    }

    // :READS/:WRITES edges from classes to their member variables
    const classVars = variables.filter((v) => v.classId);
    if (classVars.length > 0) {
      await tx.run(
        `UNWIND $classVars AS cv
         MATCH (c:Class {id: cv.classId})
         MATCH (v:Variable {id: cv.id})
         MERGE (c)-[:READS]->(v)
         MERGE (c)-[:WRITES]->(v)`,
        { classVars }
      );
    }
  }

  /**
   * Merges :EXTENDS and :IMPLEMENTS edges between :Class nodes.
   */
  private async mergeInheritanceEdges(
    tx: ManagedTransaction,
    inheritances: InheritanceEdge[]
  ): Promise<void> {
    if (inheritances.length === 0) return;

    const extendsEdges = inheritances.filter((e) => e.type === 'extends');
    const implementsEdges = inheritances.filter(
      (e) => e.type === 'implements'
    );

    if (extendsEdges.length > 0) {
      await tx.run(
        `UNWIND $edges AS e
         MATCH (child:Class {id: e.childId})
         MATCH (parent:Class {id: e.parentId})
         MERGE (child)-[:EXTENDS]->(parent)`,
        { edges: extendsEdges }
      );
    }

    if (implementsEdges.length > 0) {
      await tx.run(
        `UNWIND $edges AS e
         MATCH (child:Class {id: e.childId})
         MATCH (parent:Class {id: e.parentId})
         MERGE (child)-[:IMPLEMENTS]->(parent)`,
        { edges: implementsEdges }
      );
    }
  }
}
