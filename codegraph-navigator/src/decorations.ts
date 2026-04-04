/**
 * Editor Decorations — highlights the current scenario step in the editor.
 *
 * When the user is walking through a scenario and opens a step in the
 * editor, this module highlights the relevant line with a gutter icon
 * and background color.
 *
 * @module decorations
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { log } from './logger.js';
import type { ScenarioStep } from './types.js';

/** Decoration type for the current step line */
const stepDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  isWholeLine: true,
  gutterIconPath: undefined, // will set per-range
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Center,
  after: {
    margin: '0 0 0 1em',
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
  },
});

/** Decoration type for other steps in the same file */
const otherStepDecorationType = vscode.window.createTextEditorDecorationType({
  gutterIconSize: '80%',
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  before: {
    contentText: '',
    width: '4px',
    backgroundColor: new vscode.ThemeColor('charts.blue'),
  },
});

/**
 * Open a file and highlight the step location.
 *
 * @param step - The scenario step to navigate to
 * @param workspaceRoot - The workspace root path
 * @param allSteps - All steps in the scenario (to highlight others in same file)
 */
export async function openStepInEditor(
  step: ScenarioStep,
  workspaceRoot: string | undefined,
  allSteps?: ScenarioStep[]
): Promise<void> {
  // The step's functionId is typically "filePath:startLine"
  const filePath = extractFilePath(step.functionId, workspaceRoot);

  if (!filePath) {
    log('warn', 'Could not determine file path for step', {
      functionId: step.functionId,
      functionName: step.functionName,
    });
    vscode.window.showWarningMessage(
      `CodeGraph: Could not determine file path for ${step.functionName}`
    );
    return;
  }

  try {
    const uri = vscode.Uri.file(filePath);
    const line = Math.max(0, step.line - 1);

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(line, 0, line, 0),
      preview: false,
    });

    // Apply current step decoration
    const stepAnnotation = ` // [Step ${step.stepNumber}] ${step.action} — ${truncate(step.justification, 60)}`;
    const currentDecorations: vscode.DecorationOptions[] = [
      {
        range: new vscode.Range(line, 0, line, 999),
        renderOptions: {
          after: {
            contentText: stepAnnotation,
          },
        },
      },
    ];
    editor.setDecorations(stepDecorationType, currentDecorations);

    // Highlight other steps in the same file
    if (allSteps) {
      const otherDecorations: vscode.DecorationOptions[] = allSteps
        .filter(
          (s) =>
            s.stepNumber !== step.stepNumber &&
            extractFilePath(s.functionId, workspaceRoot) === filePath
        )
        .map((s) => ({
          range: new vscode.Range(
            Math.max(0, s.line - 1),
            0,
            Math.max(0, s.line - 1),
            999
          ),
          hoverMessage: new vscode.MarkdownString(
            `**Step ${s.stepNumber}** — ${s.action}\n\n` +
            `\`${s.functionName}\`\n\n${s.justification}`
          ),
        }));
      editor.setDecorations(otherStepDecorationType, otherDecorations);
    }

    log('info', 'Opened step in editor', {
      file: filePath,
      line: step.line,
      step: step.stepNumber,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Failed to open step in editor', { error: message });
    vscode.window.showErrorMessage(`CodeGraph: Could not open file — ${message}`);
  }
}

/**
 * Clear all codegraph decorations from the active editor.
 */
export function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(stepDecorationType, []);
  editor.setDecorations(otherStepDecorationType, []);
}

/**
 * Extract a filesystem path from a function ID.
 * Function IDs are typically "filePath:startLine".
 */
function extractFilePath(
  functionId: string,
  workspaceRoot: string | undefined
): string | null {
  // Split on last colon to separate path from line number
  const lastColon = functionId.lastIndexOf(':');
  if (lastColon === -1) { return null; }

  const rawPath = functionId.substring(0, lastColon);
  if (!rawPath) { return null; }

  // If already absolute, use as-is
  if (rawPath.startsWith('/')) {
    return rawPath;
  }

  // Otherwise resolve relative to workspace
  if (workspaceRoot) {
    return path.join(workspaceRoot, rawPath);
  }

  return rawPath;
}

/**
 * Truncate a string to maxLen characters.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) { return str; }
  return str.substring(0, maxLen - 3) + '...';
}
