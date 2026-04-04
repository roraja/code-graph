/**
 * CopilotCLIProvider — AI provider that uses GitHub Copilot CLI
 * in single-shot prompt mode (`copilot -p "..." --yolo`).
 *
 * The provider writes prompts to a temp file (using `-p @filepath` syntax)
 * to avoid OS ARG_MAX limits. Responses are read from an output file that
 * the prompt instructs copilot to write, which avoids issues with stdout
 * noise (progress indicators, tool-use lines, usage summaries).
 *
 * When the response is not written to a file (e.g. for simple prompts),
 * the provider falls back to extracting JSON from stdout using pattern
 * matching.
 *
 * @module ai/copilot-cli-provider
 */

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AIProvider, ChatMessage, ChatOptions } from './agent.js';

export interface CopilotCLIConfig {
  /** Path to the copilot binary. Defaults to 'copilot'. */
  binaryPath?: string;
  /** Extra flags to pass (e.g. ['--autopilot']). */
  extraFlags?: string[];
  /** Timeout in ms for each invocation. Defaults to 300000 (5 min). */
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
    this.timeout = config?.timeout ?? 300_000;
    this.cwd = config?.cwd;
  }

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<string> {
    // Combine all messages into a single prompt for non-interactive mode.
    //
    // The Copilot CLI has its own system prompt and will reject text that
    // looks like a system-prompt override (e.g. "[System instructions: ...]").
    // Instead, we present system messages as task context / guidelines and
    // user messages as the actual task. This framing is natural enough that
    // the CLI treats it as a regular coding-analysis request.
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        parts.push(`# Task Guidelines\n\n${msg.content}`);
      } else if (msg.role === 'user') {
        parts.push(msg.content);
      } else if (msg.role === 'assistant') {
        parts.push(`Previous analysis:\n${msg.content}`);
      }
    }

    // Create a temp directory for prompt and output files
    const tempDir = mkdtempSync(join(tmpdir(), 'codegraph-'));
    const outputFile = join(tempDir, 'output.json');

    // Append an output-file instruction to the prompt so copilot writes
    // its JSON result to a file we can read back reliably.
    const outputInstruction = [
      '',
      `IMPORTANT: Write your complete JSON response to this file: ${outputFile}`,
      'The file must contain ONLY valid JSON — no markdown fences, no commentary.',
    ].join('\n');
    const prompt = parts.join('\n\n') + outputInstruction;

    try {
      const result = await this.spawnCopilot(prompt, tempDir);

      // 1. Try reading the output file first (most reliable method).
      if (existsSync(outputFile)) {
        const content = readFileSync(outputFile, 'utf-8').trim();
        if (content) {
          // Strip markdown fences if copilot added them despite instructions
          const cleaned = content
            .replace(/^```(?:json)?\s*\n?/m, '')
            .replace(/\n?```\s*$/m, '')
            .trim();
          return cleaned;
        }
      }

      // 2. Fallback: extract JSON from stdout.
      const cleaned = CopilotCLIProvider.extractResponse(result.stdout);
      if (!cleaned && result.stderr) {
        throw new Error(`Copilot CLI returned no output. stderr: ${result.stderr.slice(0, 500)}`);
      }
      return cleaned || 'No response from Copilot CLI.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Copilot CLI invocation failed: ${message}`);
    } finally {
      // Clean up temp files
      try {
        if (existsSync(outputFile)) unlinkSync(outputFile);
        const promptFile = join(tempDir, 'prompt.txt');
        if (existsSync(promptFile)) unlinkSync(promptFile);
        rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Spawn the copilot binary by writing the prompt to a temp file
   * and passing it via the `-p @filepath` syntax.
   *
   * The Copilot CLI's `-p` flag supports reading from a file when
   * the argument is prefixed with `@` (e.g. `-p @/tmp/prompt.txt`).
   * This avoids OS ARG_MAX limits for large prompts.
   *
   * Note: `-p -` does NOT read from stdin — it's interpreted as a
   * literal dash character.
   */
  private spawnCopilot(
    prompt: string,
    tempDir: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const tempFile = join(tempDir, 'prompt.txt');
    writeFileSync(tempFile, prompt, 'utf-8');

    const args = [
      '-p', `@${tempFile}`,
      '--yolo',
      '--autopilot',
      '--silent',
      ...this.extraFlags,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, {
        cwd: this.cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const maxBuffer = 10 * 1024 * 1024; // 10 MB

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > maxBuffer) {
          child.kill();
          reject(new Error('stdout exceeded 10 MB limit'));
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Process exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
            ),
          );
        } else {
          resolve({ stdout, stderr });
        }
      });

      // Timeout
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Copilot CLI timed out after ${this.timeout}ms`));
      }, this.timeout);

      child.on('close', () => clearTimeout(timer));
    });
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
