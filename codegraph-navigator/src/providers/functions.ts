/**
 * Functions Tree Provider — populates the "Functions" sidebar view.
 *
 * Shows all functions in the graph, grouped by file.
 * Right-click context menu allows:
 *   - "Show Scenarios for Function"
 *   - "Discover Scenarios from Function"
 *
 * @module providers/functions
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as coreBridge from '../core-bridge.js';
import { log } from '../logger.js';
import type { FunctionNode } from '@codegraph/core';

/** A node in the functions tree — either a file group or a function */
type FunctionTreeNode = FileGroupNode | FunctionNodeItem;

/** A file grouping node */
class FileGroupNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly functions: FunctionNode[]
  ) {
    super(path.basename(filePath), vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${functions.length} function(s)`;
    this.tooltip = filePath;
    this.iconPath = vscode.ThemeIcon.File;
    this.resourceUri = vscode.Uri.file(filePath);
  }
}

/** A function node */
class FunctionNodeItem extends vscode.TreeItem {
  constructor(public readonly func: FunctionNode) {
    super(func.qualifiedName, vscode.TreeItemCollapsibleState.None);

    const paramStr = func.parameters
      .map((p) => `${p.name}: ${p.type}`)
      .join(', ');
    this.description = `(${paramStr}): ${func.returnType}`;

    this.tooltip = new vscode.MarkdownString(
      `**${func.qualifiedName}**\n\n` +
      `\`\`\`typescript\n${func.signature}\n\`\`\`\n\n` +
      `- **File:** ${func.filePath}:${func.startLine}\n` +
      `- **Visibility:** ${func.visibility}\n` +
      `- **Async:** ${func.isAsync ? 'Yes' : 'No'}\n` +
      `- **Exported:** ${func.isExported ? 'Yes' : 'No'}\n` +
      (func.documentation ? `\n${func.documentation}` : '')
    );

    this.contextValue = 'function';
    this.iconPath = new vscode.ThemeIcon(
      func.isAsync ? 'symbol-event' : 'symbol-function'
    );

    // Click to open file at function start line
    this.command = {
      command: 'vscode.open',
      title: 'Open Function',
      arguments: [
        vscode.Uri.file(func.filePath),
        {
          selection: new vscode.Range(
            func.startLine - 1, 0,
            func.startLine - 1, 0
          ),
        } as vscode.TextDocumentShowOptions,
      ],
    };
  }
}

/**
 * Tree data provider for the Functions view.
 */
export class FunctionsProvider implements vscode.TreeDataProvider<FunctionTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FunctionTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private searchQuery: string | undefined;
  private cachedFunctions: FunctionNode[] = [];

  refresh(): void {
    this.cachedFunctions = [];
    this._onDidChangeTreeData.fire();
    log('info', 'Functions tree refreshed');
  }

  setSearch(query: string | undefined): void {
    this.searchQuery = query;
    this.cachedFunctions = [];
    this._onDidChangeTreeData.fire();
    log('info', 'Functions search updated', { query });
  }

  /**
   * Get all cached functions (for lookup by name).
   */
  getCachedFunctions(): FunctionNode[] {
    return this.cachedFunctions;
  }

  getTreeItem(element: FunctionTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FunctionTreeNode): Promise<FunctionTreeNode[]> {
    if (element instanceof FileGroupNode) {
      return element.functions.map((f) => new FunctionNodeItem(f));
    }

    if (element) {
      return [];
    }

    // Root — load functions and group by file
    try {
      if (this.cachedFunctions.length === 0) {
        this.cachedFunctions = await coreBridge.listFunctions(this.searchQuery);
      }

      const byFile = new Map<string, FunctionNode[]>();
      for (const fn of this.cachedFunctions) {
        const existing = byFile.get(fn.filePath) ?? [];
        existing.push(fn);
        byFile.set(fn.filePath, existing);
      }

      // Sort by file path
      const sortedFiles = [...byFile.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
      );

      return sortedFiles.map(
        ([filePath, funcs]) => new FileGroupNode(filePath, funcs)
      );
    } catch (err) {
      log('error', 'Failed to load functions for tree', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
