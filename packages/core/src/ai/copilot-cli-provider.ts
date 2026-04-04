/**
 * CopilotCLIProvider — AI provider that uses GitHub Copilot CLI
 * in single-shot prompt mode (`copilot -p "..." --yolo`).
 *
 * The Copilot CLI emits progress/status lines (tool-use indicators like
 * `○ Search (...)`, `● Continuing autonomously`, usage summaries, etc.)
 * mixed into stdout alongside the actual model response. This provider
 * strips all of that and returns only the model's answer.
 *
 * @module ai/copilot-cli-provider
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIProvider, ChatMessage, ChatOptions } from './agent.js';

const execFileAsync = promisify(execFile);

export interface CopilotCLIConfig {
  /** Path to the copilot binary. Defaults to 'copilot'. */
  binaryPath?: string;
  /** Extra flags to pass (e.g. ['--autopilot']). */
  extraFlags?: string[];
  /** Timeout in ms for each invocation. Defaults to 120000 (2 min). */
  timeout?: number;
  /** Working directory for the copilot process. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * Patterns that match Copilot CLI progress / status / summary lines.
 * These appear in stdout but are NOT part of the model's response.
 */
const COPILOT_NOISE_PATTERNS = [
  // Tool-use progress indicators: ○ Search (...), ● Read (...), etc.
  /^[○●◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/,
  // "Continuing autonomously" banner
  /Continuing autonomously/,
  // Usage summary lines
  /^Total usage est:/,
  /^API time spent:/,
  /^Total session time:/,
  /^Total code changes:/,
  /^Breakdown by AI model:/,
  // Model usage detail lines (e.g. "  claude-opus-4.6-1m  64.5k in, ...")
  /^\s+\S+\s+[\d.]+k?\s+in,/,
  // Empty lines (will be handled separately)
];

export class CopilotCLIProvider implements AIProvider {
  private readonly binaryPath: string;
  private readonly extraFlags: string[];
  private readonly timeout: number;
  private readonly cwd: string | undefined;

  constructor(config?: CopilotCLIConfig) {
    this.binaryPath = config?.binaryPath ?? 'copilot';
    this.extraFlags = config?.extraFlags ?? [];
    this.timeout = config?.timeout ?? 120_000;
    this.cwd = config?.cwd;
  }

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<string> {
    // Combine all messages into a single prompt for non-interactive mode
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`[System instructions: ${msg.content}]`);
      } else if (msg.role === 'user') {
        parts.push(msg.content);
      } else if (msg.role === 'assistant') {
        parts.push(`[Previous response: ${msg.content}]`);
      }
    }
    const prompt = parts.join('\n\n');

    const args = [
      '-p', prompt,
      '--yolo',
      '--autopilot',
      ...this.extraFlags,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        cwd: this.cwd,
        env: { ...process.env },
      });

      const cleaned = CopilotCLIProvider.extractResponse(stdout);
      if (!cleaned && stderr) {
        throw new Error(`Copilot CLI returned no output. stderr: ${stderr.slice(0, 500)}`);
      }
      return cleaned || 'No response from Copilot CLI.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Copilot CLI invocation failed: ${message}`);
    }
  }

  /**
   * Extract the model's actual response from raw Copilot CLI stdout.
   *
   * Strategy:
   * 1. Try to find a JSON block (```json ... ``` or raw JSON array/object).
   * 2. If no JSON block, strip known noise lines and return the rest.
   */
  static extractResponse(raw: string): string {
    // 1. Try to extract a fenced JSON code block
    const fencedMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (fencedMatch) {
      return fencedMatch[1].trim();
    }

    // 2. Try to extract a raw JSON array or object from the output.
    //    Find the first [ or { and match to the last ] or }.
    const jsonStart = raw.search(/[\[{]/);
    if (jsonStart !== -1) {
      const opener = raw[jsonStart];
      const closer = opener === '[' ? ']' : '}';
      const lastClose = raw.lastIndexOf(closer);
      if (lastClose > jsonStart) {
        const candidate = raw.slice(jsonStart, lastClose + 1);
        // Validate it's actually parseable JSON
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // Not valid JSON, fall through to line-by-line stripping
        }
      }
    }

    // 3. Fallback: strip known noise lines
    const lines = raw.split('\n');
    const cleaned = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return !COPILOT_NOISE_PATTERNS.some((pat) => pat.test(trimmed));
    });
    return cleaned.join('\n').trim();
  }
}
