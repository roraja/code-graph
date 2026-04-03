/**
 * End-to-end test: Parse the sample-project with TypeScriptParser
 * and verify all structural elements are extracted correctly.
 *
 * This test does NOT require Neo4j — it only tests the parser.
 *
 * NOTE: The TypeScriptParser must be implemented at
 *   packages/core/src/parser/typescript.ts
 * before these tests will pass. Until then, tests are skipped.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  ICodeParser,
  ParseResult,
  FunctionNode,
  ClassNode,
  CallEdge,
  BranchNode,
  InheritanceEdge,
} from '../../packages/core/src/parser/interface.js';

const SAMPLE_PROJECT = resolve(__dirname, '../fixtures/sample-project');
const SAMPLE_SRC = resolve(SAMPLE_PROJECT, 'src');

// Try to import the TypeScript parser. If it doesn't exist yet, skip all tests.
let TypeScriptParser: (new (...args: unknown[]) => ICodeParser) | null = null;
let parserAvailable = false;

try {
  const mod = await import('../../packages/core/src/parser/typescript.js');
  TypeScriptParser = mod.TypeScriptParser ?? mod.default;
  parserAvailable = TypeScriptParser != null;
} catch {
  parserAvailable = false;
}

const describeParser = parserAvailable ? describe : describe.skip;

describeParser('Full Workflow — TypeScript Parser against sample-project', () => {
  let parser: ICodeParser;
  let allResults: ParseResult[];

  beforeAll(async () => {
    parser = new TypeScriptParser!();
    allResults = await parser.parseDirectory(SAMPLE_SRC, {
      exclude: ['node_modules', 'dist'],
    });
  });

  it('sample project fixture exists', () => {
    expect(existsSync(SAMPLE_PROJECT)).toBe(true);
    expect(existsSync(resolve(SAMPLE_SRC, 'types.ts'))).toBe(true);
    expect(existsSync(resolve(SAMPLE_SRC, 'pipeline.ts'))).toBe(true);
  });

  it('parses all source files', () => {
    const files = allResults.map((r) => r.filePath);
    expect(files.length).toBeGreaterThanOrEqual(6);

    const basenames = files.map((f) => f.split('/').pop());
    expect(basenames).toContain('types.ts');
    expect(basenames).toContain('validators.ts');
    expect(basenames).toContain('processors.ts');
    expect(basenames).toContain('pipeline.ts');
    expect(basenames).toContain('events.ts');
    expect(basenames).toContain('index.ts');
  });

  describe('function extraction', () => {
    it('extracts all functions and methods', () => {
      const allFunctions = allResults.flatMap((r) => r.functions);
      const names = allFunctions.map((f) => f.name);

      // Validators
      expect(names).toContain('validate');
      expect(names).toContain('getMaxSize');

      // Processors
      expect(names).toContain('process');
      expect(names).toContain('supports');

      // Pipeline
      expect(names).toContain('handleFileDrop');
      expect(names).toContain('validateFile');
      expect(names).toContain('findProcessor');

      // Top-level
      expect(names).toContain('handleUserFileDrop');
      expect(names).toContain('inferMimeType');
      expect(names).toContain('createFileData');
    });

    it('identifies async functions', () => {
      const allFunctions = allResults.flatMap((r) => r.functions);
      const asyncFns = allFunctions.filter((f) => f.isAsync);
      const asyncNames = asyncFns.map((f) => f.name);

      expect(asyncNames).toContain('process');
      expect(asyncNames).toContain('handleFileDrop');
      expect(asyncNames).toContain('handleUserFileDrop');
    });

    it('extracts function parameters', () => {
      const allFunctions = allResults.flatMap((r) => r.functions);
      const handleFileDrop = allFunctions.find(
        (f) => f.qualifiedName === 'FileProcessingPipeline.handleFileDrop'
      );

      expect(handleFileDrop).toBeDefined();
      expect(handleFileDrop!.parameters.length).toBeGreaterThan(0);
      expect(handleFileDrop!.parameters[0].name).toBe('files');
    });

    it('identifies exported functions', () => {
      const allFunctions = allResults.flatMap((r) => r.functions);
      const exported = allFunctions.filter((f) => f.isExported);
      const exportedNames = exported.map((f) => f.name);

      expect(exportedNames).toContain('handleUserFileDrop');
    });
  });

  describe('class extraction', () => {
    it('extracts all classes', () => {
      const allClasses = allResults.flatMap((r) => r.classes);
      const names = allClasses.map((c) => c.name);

      expect(names).toContain('SizeValidator');
      expect(names).toContain('TypeValidator');
      expect(names).toContain('ImageProcessor');
      expect(names).toContain('DocumentProcessor');
      expect(names).toContain('DefaultProcessor');
      expect(names).toContain('FileProcessingPipeline');
      expect(names).toContain('FileDropEventHandler');
      expect(names).toContain('LoggingEventHandler');
    });

    it('extracts interfaces', () => {
      const allClasses = allResults.flatMap((r) => r.classes);
      const interfaces = allClasses.filter((c) => c.isInterface);
      const names = interfaces.map((c) => c.name);

      expect(names).toContain('FileData');
      expect(names).toContain('ProcessResult');
      expect(names).toContain('IFileValidator');
      expect(names).toContain('IFileProcessor');
      expect(names).toContain('IEventHandler');
    });

    it('lists methods on classes', () => {
      const allClasses = allResults.flatMap((r) => r.classes);
      const pipeline = allClasses.find(
        (c) => c.name === 'FileProcessingPipeline'
      );

      expect(pipeline).toBeDefined();
      expect(pipeline!.methods.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('inheritance and implementation extraction', () => {
    it('extracts implements relationships', () => {
      const allInheritances = allResults.flatMap((r) => r.inheritances);
      const impls = allInheritances.filter((i) => i.type === 'implements');

      // Validators implement IFileValidator
      const validatorImpls = impls.filter(
        (i) =>
          i.parentId.includes('IFileValidator') ||
          i.childId.includes('SizeValidator') ||
          i.childId.includes('TypeValidator')
      );
      expect(validatorImpls.length).toBeGreaterThanOrEqual(2);

      // Processors implement IFileProcessor
      const processorImpls = impls.filter(
        (i) =>
          i.parentId.includes('IFileProcessor') ||
          i.childId.includes('ImageProcessor') ||
          i.childId.includes('DocumentProcessor') ||
          i.childId.includes('DefaultProcessor')
      );
      expect(processorImpls.length).toBeGreaterThanOrEqual(3);

      // Event handlers implement IEventHandler
      const handlerImpls = impls.filter(
        (i) =>
          i.parentId.includes('IEventHandler') ||
          i.childId.includes('FileDropEventHandler') ||
          i.childId.includes('LoggingEventHandler')
      );
      expect(handlerImpls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('call edge extraction', () => {
    it('extracts function calls', () => {
      const allCalls = allResults.flatMap((r) => r.calls);

      expect(allCalls.length).toBeGreaterThan(0);

      const calleeNames = allCalls.map((c) => c.calleeName);

      // Pipeline calls validators and processors
      expect(calleeNames).toContain('validateFile');
      expect(calleeNames).toContain('findProcessor');
    });

    it('identifies virtual dispatch calls', () => {
      const allCalls = allResults.flatMap((r) => r.calls);
      const virtualCalls = allCalls.filter((c) => c.isVirtualDispatch);

      // Calls through IFileValidator.validate, IFileProcessor.process, etc.
      expect(virtualCalls.length).toBeGreaterThan(0);
    });
  });

  describe('branch extraction', () => {
    it('extracts if/else branches from pipeline', () => {
      const allBranches = allResults.flatMap((r) => r.branches);

      expect(allBranches.length).toBeGreaterThan(0);

      const pipelineBranches = allBranches.filter((b) =>
        b.filePath.includes('pipeline.ts')
      );
      expect(pipelineBranches.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts switch cases from inferMimeType', () => {
      const allBranches = allResults.flatMap((r) => r.branches);

      const switchCases = allBranches.filter(
        (b) => b.type === 'switch_case' && b.filePath.includes('index.ts')
      );
      expect(switchCases.length).toBeGreaterThanOrEqual(1);
    });

    it('captures branch conditions', () => {
      const allBranches = allResults.flatMap((r) => r.branches);

      const emptyCheck = allBranches.find(
        (b) =>
          b.condition.includes('files.length === 0') ||
          b.condition.includes('files.length')
      );
      expect(emptyCheck).toBeDefined();
    });
  });

  describe('variable extraction', () => {
    it('extracts variables from functions', () => {
      const allVariables = allResults.flatMap((r) => r.variables);

      expect(allVariables.length).toBeGreaterThan(0);

      const names = allVariables.map((v) => v.name);
      expect(names).toContain('results');
    });
  });

  describe('parse result metadata', () => {
    it('each result has language set to typescript', () => {
      for (const result of allResults) {
        expect(result.language).toBe('typescript');
      }
    });

    it('each result has a content hash', () => {
      for (const result of allResults) {
        expect(result.contentHash).toBeTruthy();
      }
    });

    it('each result reports parse time', () => {
      for (const result of allResults) {
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// Fixture validation tests that always run (no parser needed)
describe('Sample Project Fixtures', () => {
  it('all fixture files exist', () => {
    const files = [
      'tsconfig.json',
      'src/types.ts',
      'src/validators.ts',
      'src/processors.ts',
      'src/pipeline.ts',
      'src/events.ts',
      'src/index.ts',
    ];

    for (const file of files) {
      const fullPath = resolve(SAMPLE_PROJECT, file);
      expect(existsSync(fullPath), `Missing: ${file}`).toBe(true);
    }
  });
});
