/**
 * Code Walk File Reader — reads `.codewalk.json` files from disk.
 *
 * Supports two on-disk formats:
 *
 * **V1 (single file):**
 * ```
 * .vscode/code-graph/codewalks/<walk-id>.codewalk.json
 * ```
 * One file containing the full walk with all cells inlined.
 *
 * **V2 (multi-file directory):**
 * ```
 * .vscode/code-graph/codewalks/<walk-id>/
 *   manifest.codewalk.json   ← walk metadata + ordered cellIds
 *   cell-0.json              ← individual cell
 *   cell-1.json              ← individual cell
 * ```
 * The manifest references cell files by ID; each cell is a separate JSON file.
 * This format is better for AI agents (smaller files, incremental writes).
 *
 * Both formats are read transparently — consumers always get a `CodeWalk`.
 *
 * @module codewalk/file-reader
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createModuleLogger } from '../config/logger.js';
import type {
  CodeWalk,
  CodeWalkFileData,
  CodeWalkManifest,
  CodeWalkCellFileData,
  WalkCell,
  WalkMeta,
} from './types.js';

const log = createModuleLogger('codewalk-file-reader');

/** The subdirectory under the CodeGraph dir where codewalk JSONs live */
const CODEWALKS_SUBDIR = 'codewalks';

/** The CodeGraph directory inside the target project */
const CODEGRAPH_DIR = '.vscode/code-graph';

/** Manifest filename inside a v2 walk directory */
const MANIFEST_FILENAME = 'manifest.codewalk.json';

// ---------------------------------------------------------------------------
// Internal: a resolved walk source — either a v1 file path or a v2 directory
// ---------------------------------------------------------------------------

interface V1Source {
  format: 'v1';
  filePath: string;
}

interface V2Source {
  format: 'v2';
  dirPath: string;
  manifestPath: string;
}

type WalkSource = V1Source | V2Source;

/**
 * CodeWalkFileReader — reads and writes code walks from JSON files on disk.
 *
 * Transparently handles both v1 (single-file) and v2 (multi-file) formats.
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
   * Reads both v1 single-file walks and v2 multi-file walk directories.
   */
  listCodeWalks(): CodeWalk[] {
    const sources = this.discoverWalkSources();
    const walks: CodeWalk[] = [];

    for (const source of sources) {
      try {
        const walk = this.loadFromSource(source);
        if (walk) {
          walks.push(walk);
        }
      } catch (err) {
        const label = source.format === 'v1' ? source.filePath : source.dirPath;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Skipping invalid codewalk ${label}: ${msg}`);
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
    const sources = this.discoverWalkSources();

    for (const source of sources) {
      try {
        const walk = this.loadFromSource(source);
        if (walk && walk.id === id) {
          return walk;
        }
      } catch {
        // Skip invalid sources
      }
    }

    return null;
  }

  /**
   * Get a code walk by scenario ID (finds the walk associated with a scenario).
   */
  getCodeWalkForScenario(scenarioId: string): CodeWalk | null {
    const sources = this.discoverWalkSources();

    for (const source of sources) {
      try {
        const walk = this.loadFromSource(source);
        if (walk && walk.scenarioId === scenarioId) {
          return walk;
        }
      } catch {
        // Skip invalid sources
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
   * Save a code walk to disk in v1 (single-file) format.
   *
   * Use {@link saveCodeWalkMultiFile} for the v2 multi-file format.
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
    log.info(`Saved codewalk (v1) to ${filePath}`);
  }

  /**
   * Save a code walk to disk in v2 (multi-file) format.
   *
   * Creates a directory per walk with a manifest and individual cell files:
   * ```
   * <walk-id>/
   *   manifest.codewalk.json
   *   cell-0.json
   *   cell-1.json
   *   ...
   * ```
   */
  saveCodeWalkMultiFile(walk: CodeWalk): void {
    const walkDir = join(this.codewalksDir, walk.id);

    // Ensure directory exists
    if (!existsSync(walkDir)) {
      mkdirSync(walkDir, { recursive: true });
    }

    // Build the manifest (walk metadata without cells)
    const cellIds = walk.cells.map(c => c.id);
    const manifest: CodeWalkManifest = {
      _format: 'codegraph-codewalk-v2',
      walk: {
        id: walk.id,
        name: walk.name,
        description: walk.description,
        scenarioId: walk.scenarioId,
        cellIds,
        meta: walk.meta,
      },
    };

    const manifestPath = join(walkDir, MANIFEST_FILENAME);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // Write each cell as an individual file
    for (const cell of walk.cells) {
      const cellData: CodeWalkCellFileData = {
        _format: 'codegraph-cell-v1',
        walkId: walk.id,
        cell,
      };
      const cellPath = join(walkDir, `${cell.id}.json`);
      writeFileSync(cellPath, JSON.stringify(cellData, null, 2), 'utf-8');
    }

    log.info(`Saved codewalk (v2 multi-file) to ${walkDir} with ${walk.cells.length} cell files`);
  }

  /**
   * Save a single cell to disk in v2 (multi-file) format.
   *
   * This writes/overwrites only the specified cell file without touching
   * other cells or the manifest. Useful for incremental AI population.
   *
   * **Note:** The manifest's `cellIds` is NOT updated automatically.
   * If this is a new cell, call {@link saveCodeWalkMultiFile} or update
   * the manifest separately.
   */
  saveCellFile(walkId: string, cell: WalkCell): void {
    const walkDir = join(this.codewalksDir, walkId);

    if (!existsSync(walkDir)) {
      mkdirSync(walkDir, { recursive: true });
    }

    const cellData: CodeWalkCellFileData = {
      _format: 'codegraph-cell-v1',
      walkId,
      cell,
    };

    const cellPath = join(walkDir, `${cell.id}.json`);
    writeFileSync(cellPath, JSON.stringify(cellData, null, 2), 'utf-8');
    log.info(`Saved cell ${cell.id} to ${cellPath}`);
  }

  // ---------------------------------------------------------------------------
  // Private: discover walk sources (v1 files + v2 directories)
  // ---------------------------------------------------------------------------

  private discoverWalkSources(): WalkSource[] {
    if (!existsSync(this.codewalksDir)) {
      log.debug(`Codewalks directory not found: ${this.codewalksDir}`);
      return [];
    }

    const sources: WalkSource[] = [];

    try {
      const entries = readdirSync(this.codewalksDir);

      for (const entry of entries) {
        const fullPath = join(this.codewalksDir, entry);

        // V1: *.codewalk.json files
        if (entry.endsWith('.codewalk.json')) {
          try {
            const stat = statSync(fullPath);
            if (stat.isFile()) {
              sources.push({ format: 'v1', filePath: fullPath });
            }
          } catch {
            // Skip if stat fails
          }
          continue;
        }

        // V2: directories containing manifest.codewalk.json
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            const manifestPath = join(fullPath, MANIFEST_FILENAME);
            if (existsSync(manifestPath)) {
              sources.push({ format: 'v2', dirPath: fullPath, manifestPath });
            }
          }
        } catch {
          // Skip if stat fails
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to read codewalks directory: ${msg}`);
    }

    return sources;
  }

  // ---------------------------------------------------------------------------
  // Private: load a CodeWalk from a source (v1 or v2)
  // ---------------------------------------------------------------------------

  private loadFromSource(source: WalkSource): CodeWalk | null {
    if (source.format === 'v1') {
      return this.loadV1(source.filePath);
    } else {
      return this.loadV2(source.dirPath, source.manifestPath);
    }
  }

  /**
   * Load a v1 single-file codewalk.
   */
  private loadV1(filePath: string): CodeWalk | null {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as CodeWalkFileData;

      // Validate minimal structure
      if (!data.walk || !data.walk.id || !data.walk.cells) {
        log.warn(`Invalid codewalk file (missing walk.id or walk.cells): ${filePath}`);
        return null;
      }

      return data.walk;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to parse codewalk file ${filePath}: ${msg}`);
      return null;
    }
  }

  /**
   * Load a v2 multi-file codewalk from a directory.
   *
   * Reads the manifest, then loads each cell file in the order specified
   * by `cellIds`. Missing cell files are skipped with a warning.
   */
  private loadV2(dirPath: string, manifestPath: string): CodeWalk | null {
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as CodeWalkManifest;

      // Validate manifest structure
      if (!manifest.walk || !manifest.walk.id || !manifest.walk.cellIds) {
        log.warn(`Invalid codewalk manifest (missing walk.id or walk.cellIds): ${manifestPath}`);
        return null;
      }

      const walkMeta = manifest.walk;

      // Load cells in order
      const cells: WalkCell[] = [];
      for (const cellId of walkMeta.cellIds) {
        const cellPath = join(dirPath, `${cellId}.json`);
        try {
          if (!existsSync(cellPath)) {
            log.warn(`Cell file not found: ${cellPath} (referenced by ${manifestPath})`);
            continue;
          }
          const cellRaw = readFileSync(cellPath, 'utf-8');
          const cellData = JSON.parse(cellRaw) as CodeWalkCellFileData;

          if (!cellData.cell || !cellData.cell.id) {
            log.warn(`Invalid cell file (missing cell.id): ${cellPath}`);
            continue;
          }

          cells.push(cellData.cell);
        } catch (cellErr) {
          const cellMsg = cellErr instanceof Error ? cellErr.message : String(cellErr);
          log.warn(`Failed to read cell ${cellId}: ${cellMsg}`);
        }
      }

      // Also pick up any cell files NOT in cellIds (e.g. newly added by an agent)
      try {
        const dirEntries = readdirSync(dirPath);
        const knownCellIds = new Set(walkMeta.cellIds);
        const loadedCellIds = new Set(cells.map(c => c.id));

        for (const entry of dirEntries) {
          // Skip manifest and non-json
          if (entry === MANIFEST_FILENAME || !entry.endsWith('.json')) continue;

          const cellId = basename(entry, '.json');
          if (knownCellIds.has(cellId) || loadedCellIds.has(cellId)) continue;

          const cellPath = join(dirPath, entry);
          try {
            const cellRaw = readFileSync(cellPath, 'utf-8');
            const cellData = JSON.parse(cellRaw) as CodeWalkCellFileData;
            if (cellData.cell && cellData.cell.id) {
              log.debug(`Found extra cell file not in manifest: ${cellPath}`);
              cells.push(cellData.cell);
            }
          } catch {
            // Skip unparseable files
          }
        }
      } catch {
        // Non-critical — just means we won't find extra cells
      }

      // Sort cells by index to ensure correct order
      cells.sort((a, b) => a.index - b.index);

      // Assemble the full CodeWalk
      const walk: CodeWalk = {
        id: walkMeta.id,
        name: walkMeta.name,
        description: walkMeta.description,
        scenarioId: walkMeta.scenarioId,
        cells,
        meta: walkMeta.meta,
      };

      return walk;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to load codewalk directory ${dirPath}: ${msg}`);
      return null;
    }
  }
}
