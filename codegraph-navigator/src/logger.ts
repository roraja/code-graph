/**
 * Logger — writes datewise log files to .vscode/code-graph/logs/
 * AND writes to a VS Code OutputChannel ("CodeGraph Navigator")
 * so you can see live diagnostics in the Output panel.
 *
 * @module logger
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

let logDir: string | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the logger with the workspace root.
 * Creates .vscode/codegraph/logs/ if it doesn't exist.
 * Creates (or reuses) a VS Code OutputChannel.
 */
export function initLogger(workspaceRoot: string): void {
  logDir = path.join(workspaceRoot, '.vscode', 'code-graph', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('CodeGraph Navigator');
  }

  log('info', 'Logger initialized', { workspaceRoot });
}

/**
 * Get the output channel (creates one if needed, even before initLogger).
 */
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('CodeGraph Navigator');
  }
  return outputChannel;
}

/**
 * Show the output channel in the VS Code panel.
 */
export function showOutputChannel(): void {
  getOutputChannel().show(true);
}

/**
 * Get today's date string for the log filename.
 */
function getDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get a timestamp for log entries.
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Write a log entry to both the datewise log file and the OutputChannel.
 */
export function log(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = getTimestamp();
  const tag = level.toUpperCase().padEnd(5);

  let line = `[${timestamp}] [${tag}] ${message}`;
  if (data) {
    line += ` | ${JSON.stringify(data)}`;
  }

  // Write to OutputChannel (always, even before initLogger)
  const channel = getOutputChannel();
  channel.appendLine(line);

  // Write to datewise log file (only if logger is initialized)
  if (logDir) {
    const dateStr = getDateString();
    const logFile = path.join(logDir, `${dateStr}.log`);
    try {
      fs.appendFileSync(logFile, line + '\n', 'utf8');
    } catch {
      // Best effort — don't crash the extension for file logging failures
    }
  }
}

/**
 * Log a function entry with its arguments.
 * Usage: logEntry('functionName', { arg1, arg2 });
 */
export function logEntry(functionName: string, args?: Record<string, unknown>): void {
  log('debug', `→ ${functionName}`, args);
}

/**
 * Log a function exit with its return value.
 * Usage: logExit('functionName', returnValue);
 */
export function logExit(functionName: string, result?: unknown): void {
  const data = result !== undefined ? { result: summarize(result) } : undefined;
  log('debug', `← ${functionName}`, data);
}

/**
 * Log a function error.
 */
export function logError(functionName: string, error: unknown): void {
  log('error', `✖ ${functionName}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
  });
}

/**
 * Summarize a value for logging (truncate long strings, summarize arrays/objects).
 */
function summarize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 200 ? value.substring(0, 200) + '...' : value;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}}`;
  }
  return value;
}

/**
 * Dispose the output channel (call on deactivate).
 */
export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
