/**
 * CopilotCLIProvider — AI provider that uses GitHub Copilot CLI
 * in single-shot prompt mode (`copilot -p "..." --yolo`).
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
}

export class CopilotCLIProvider implements AIProvider {
  private readonly binaryPath: string;
  private readonly extraFlags: string[];
  private readonly timeout: number;

  constructor(config?: CopilotCLIConfig) {
    this.binaryPath = config?.binaryPath ?? 'copilot';
    this.extraFlags = config?.extraFlags ?? [];
    this.timeout = config?.timeout ?? 120_000;
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
        env: { ...process.env },
      });

      const output = stdout.trim();
      if (!output && stderr) {
        throw new Error(`Copilot CLI returned no output. stderr: ${stderr.slice(0, 500)}`);
      }
      return output || 'No response from Copilot CLI.';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Copilot CLI invocation failed: ${message}`);
    }
  }
}
