import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CorrectionEngine,
  type CorrectionContext,
} from '../../packages/core/src/correction/engine.js';
import type { ScenarioEngine, Scenario, ScenarioStep } from '../../packages/core/src/scenario/engine.js';
import type { GraphDriver } from '../../packages/core/src/graph/driver.js';
import type { CorrectionInterpreterAgent } from '../../packages/core/src/ai/correction-interpreter.js';

function mockQueryResult(records: Record<string, unknown>[] = []) {
  return {
    records: records.map(obj => ({
      get: (key: string) => obj[key],
      toObject: () => obj,
    })),
  };
}

function createMockDriver(): GraphDriver {
  return {
    run: vi.fn().mockResolvedValue(mockQueryResult()),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    runInTransaction: vi.fn(),
  } as unknown as GraphDriver;
}

function createMockScenarioEngine(): ScenarioEngine {
  return {
    createScenario: vi.fn(),
    getScenario: vi.fn(),
    listScenarios: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    saveSteps: vi.fn(),
    getSteps: vi.fn(),
    getStep: vi.fn(),
    updateStep: vi.fn().mockResolvedValue(undefined),
    deleteScenario: vi.fn(),
    getScenariosForFunction: vi.fn(),
  } as unknown as ScenarioEngine;
}

function createMockInterpreter(
  overrides: Record<string, unknown> = {}
): CorrectionInterpreterAgent {
  return {
    interpret: vi.fn().mockResolvedValue({
      ...defaultInterpretation(),
      ...overrides,
    }),
  } as unknown as CorrectionInterpreterAgent;
}

function defaultInterpretation() {
  return {
    correctionType: 'variable_constraint' as const,
    target: 'fileCount',
    rule: 'fileCount != 0',
    scope: 'scenario' as const,
    confidence: 0.9,
    clarificationNeeded: false,
  };
}

function makeSampleScenario(): Scenario {
  return {
    id: 'scenario-1',
    name: 'File Drop',
    description: 'User drops a file',
    discoveredBy: 'human',
    confidence: 1.0,
    status: 'traced',
    entryFunction: 'handleUserFileDrop',
    triggerCondition: 'User drops a file',
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeSampleStep(): ScenarioStep {
  return {
    id: 'step-1',
    scenarioId: 'scenario-1',
    stepNumber: 1,
    functionId: 'src/pipeline.ts:15',
    functionName: 'handleFileDrop',
    line: 15,
    action: 'branch_taken',
    justification: 'Files array is not empty',
    variableState: { fileCount: 3 },
    confidence: 0.85,
  };
}

describe('CorrectionEngine', () => {
  let engine: CorrectionEngine;
  let driver: ReturnType<typeof createMockDriver>;
  let scenarioEngine: ReturnType<typeof createMockScenarioEngine>;

  beforeEach(() => {
    driver = createMockDriver();
    scenarioEngine = createMockScenarioEngine();
  });

  describe('submitCorrection — variable_constraint', () => {
    it('interprets and applies a variable constraint correction', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'variable_constraint' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: makeSampleStep(),
        variableState: { fileCount: 3 },
      };

      const result = await engine.submitCorrection(
        'fileCount should never be 0',
        context,
        'user-1'
      );

      expect(result.correction.type).toBe('variable_constraint');
      expect(result.correction.userId).toBe('user-1');
      expect(result.correction.prompt).toBe('fileCount should never be 0');
      expect(interpreter.interpret).toHaveBeenCalledTimes(1);
    });

    it('updates the step with correctedBy and correctionNote', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'variable_constraint' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: makeSampleStep(),
      };

      await engine.submitCorrection('fileCount > 0', context, 'user-1');

      expect(scenarioEngine.updateStep).toHaveBeenCalledWith(
        'scenario-1',
        1,
        expect.objectContaining({
          correctedBy: 'user-1',
          correctionNote: 'fileCount > 0',
        })
      );
    });
  });

  describe('submitCorrection — branch_override', () => {
    it('flips branch_taken to branch_skipped', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'branch_override' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const step = makeSampleStep();
      step.action = 'branch_taken';

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: step,
      };

      const result = await engine.submitCorrection(
        'always take the else branch here',
        context
      );

      expect(result.affectedSteps.length).toBeGreaterThan(0);
      expect(result.affectedSteps[0].action).toBe('branch_skipped');
    });

    it('flips branch_skipped to branch_taken', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'branch_override' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const step = makeSampleStep();
      step.action = 'branch_skipped';

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: step,
      };

      const result = await engine.submitCorrection(
        'take this branch',
        context
      );

      expect(result.affectedSteps[0].action).toBe('branch_taken');
    });
  });

  describe('submitCorrection — dispatch_override', () => {
    it('applies dispatch override correction', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'dispatch_override' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: makeSampleStep(),
      };

      const result = await engine.submitCorrection(
        'this dispatches to ImageProcessor',
        context
      );

      expect(result.correction.type).toBe('dispatch_override');
      expect(scenarioEngine.updateStep).toHaveBeenCalled();
    });
  });

  describe('submitCorrection — scenario_note', () => {
    it('appends a note to the scenario description', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'scenario_note' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
      };

      await engine.submitCorrection('This only happens on macOS', context);

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('[Note]')
      );
      expect(call).toBeDefined();
    });
  });

  describe('submitCorrection — function_skip', () => {
    it('stores a function_skip correction', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'function_skip' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const result = await engine.submitCorrection('skip logging functions', {});

      expect(result.correction.type).toBe('function_skip');
      expect(result.affectedSteps).toHaveLength(0);
    });
  });

  describe('submitCorrection — global_rule', () => {
    it('stores a global rule correction', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'global_rule' });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const result = await engine.submitCorrection(
        'never trace into node_modules',
        {}
      );

      expect(result.correction.type).toBe('global_rule');
      expect(result.affectedSteps).toHaveLength(0);
    });
  });

  describe('submitCorrection — clarification needed', () => {
    it('returns clarification without applying', async () => {
      const interpreter = createMockInterpreter({
        clarificationNeeded: true,
        clarificationQuestion: 'Which variable do you mean?',
      });
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      const result = await engine.submitCorrection('fix the value', {});

      expect(result.clarificationNeeded).toBe('Which variable do you mean?');
      expect(result.retraceTriggered).toBe(false);
      expect(result.affectedSteps).toHaveLength(0);
    });
  });

  describe('submitCorrection — retrace triggering', () => {
    it('triggers retrace for branch_override with tracer available', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'branch_override' });
      const mockTracer = {} as never;
      engine = new CorrectionEngine(driver, scenarioEngine, mockTracer, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
        currentStep: makeSampleStep(),
      };

      const result = await engine.submitCorrection(
        'take else branch',
        context
      );

      expect(result.retraceTriggered).toBe(true);
      expect(scenarioEngine.updateStatus).toHaveBeenCalledWith(
        'scenario-1',
        'corrected'
      );
    });

    it('does not trigger retrace for scenario_note', async () => {
      const interpreter = createMockInterpreter({ correctionType: 'scenario_note' });
      const mockTracer = {} as never;
      engine = new CorrectionEngine(driver, scenarioEngine, mockTracer, interpreter);

      const context: CorrectionContext = {
        scenario: makeSampleScenario(),
      };

      const result = await engine.submitCorrection(
        'add a note',
        context
      );

      expect(result.retraceTriggered).toBe(false);
    });
  });

  describe('getCorrections', () => {
    it('queries by scenarioId when provided', async () => {
      const interpreter = createMockInterpreter();
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      await engine.getCorrections('scenario-1');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('Scenario {id: $scenarioId}');
    });

    it('queries by scope when provided', async () => {
      const interpreter = createMockInterpreter();
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      await engine.getCorrections(undefined, 'global');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('scope: $scope');
    });

    it('queries all corrections when no filter', async () => {
      const interpreter = createMockInterpreter();
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      await engine.getCorrections();

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('MATCH (c:Correction)');
      expect(call[0]).not.toContain('APPLIES_TO');
    });
  });

  describe('undoCorrection', () => {
    it('deletes the correction from the graph', async () => {
      const interpreter = createMockInterpreter();
      engine = new CorrectionEngine(driver, scenarioEngine, null, interpreter);

      await engine.undoCorrection('corr-123');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('DETACH DELETE c');
      expect(call[1].correctionId).toBe('corr-123');
    });
  });
});
