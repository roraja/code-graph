/**
 * Code Walk File Reader — reads `.codewalk.json` files from disk.
 *
 * Code walks are stored alongside scenarios in `.vscode/code-graph/codewalks/`.
 * This reader provides read access without requiring a database.
 *
 * @module codewalk/file-reader
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createModuleLogger } from '../config/logger.js';
import type { CodeWalk, CodeWalkFileData, WalkCell } from './types.js';

const log = createModuleLogger('codewalk-file-reader');

/** The subdirectory under the CodeGraph dir where codewalk JSONs live */
const CODEWALKS_SUBDIR = 'codewalks';

/** The CodeGraph directory inside the target project */
const CODEGRAPH_DIR = '.vscode/code-graph';

/**
 * CodeWalkFileReader — reads and writes code walks from JSON files on disk.
 */
export class CodeWalkFileReader {
  private readonly codewalksDir: string;

  constructor(projectRoot: string) {
    this.codewalksDir = resolve(projectRoot, CODEGRAPH_DIR, CODEWALKS_SUBDIR);
  }

  /**
   * Get the codewalks directory path.
   */
  getCodewalksDir(): string {
    return this.codewalksDir;
  }

  /**
   * List all code walks from JSON files on disk.
   */
  listCodeWalks(): CodeWalk[] {
    const files = this.getCodeWalkFiles();
    const walks: CodeWalk[] = [];

    for (const filePath of files) {
      try {
        const data = this.readCodeWalkFile(filePath);
        if (data) {
          walks.push(data.walk);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Skipping invalid codewalk file ${filePath}: ${msg}`);
      }
    }

    // Sort by updatedAt descending
    walks.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
    return walks;
  }

  /**
   * Get a code walk by ID.
   */
  getCodeWalk(id: string): CodeWalk | null {
    const files = this.getCodeWalkFiles();

    for (const filePath of files) {
      try {
        const data = this.readCodeWalkFile(filePath);
        if (data && data.walk.id === id) {
          return data.walk;
        }
      } catch {
        // Skip invalid files
      }
    }

    return null;
  }

  /**
   * Get a code walk by scenario ID (finds the walk associated with a scenario).
   */
  getCodeWalkForScenario(scenarioId: string): CodeWalk | null {
    const files = this.getCodeWalkFiles();

    for (const filePath of files) {
      try {
        const data = this.readCodeWalkFile(filePath);
        if (data && data.walk.scenarioId === scenarioId) {
          return data.walk;
        }
      } catch {
        // Skip invalid files
      }
    }

    return null;
  }

  /**
   * Get a specific cell from a code walk.
   */
  getCell(walkId: string, cellIndex: number): WalkCell | null {
    const walk = this.getCodeWalk(walkId);
    if (!walk) return null;
    return walk.cells[cellIndex] ?? null;
  }

  /**
   * Save a code walk to disk.
   */
  saveCodeWalk(walk: CodeWalk): void {
    // Ensure directory exists
    if (!existsSync(this.codewalksDir)) {
      mkdirSync(this.codewalksDir, { recursive: true });
    }

    const fileData: CodeWalkFileData = {
      _format: 'codegraph-codewalk-v1',
      walk,
    };

    const filePath = join(this.codewalksDir, `${walk.id}.codewalk.json`);
    writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
    log.info(`Saved codewalk to ${filePath}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getCodeWalkFiles(): string[] {
    if (!existsSync(this.codewalksDir)) {
      log.debug(`Codewalks directory not found: ${this.codewalksDir}`);
      return [];
    }

    try {
      const entries = readdirSync(this.codewalksDir);
      return entries
        .filter(f => f.endsWith('.codewalk.json'))
        .map(f => join(this.codewalksDir, f));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to read codewalks directory: ${msg}`);
      return [];
    }
  }

  private readCodeWalkFile(filePath: string): CodeWalkFileData | null {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as CodeWalkFileData;

      // Validate minimal structure
      if (!data.walk || !data.walk.id || !data.walk.cells) {
        log.warn(`Invalid codewalk file (missing walk.id or walk.cells): ${filePath}`);
        return null;
      }

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to parse codewalk file ${filePath}: ${msg}`);
      return null;
    }
  }
}
