import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ScenarioEngine,
  type CreateScenarioInput,
  type ScenarioStep,
} from '../../packages/core/src/scenario/engine.js';
import type { GraphDriver } from '../../packages/core/src/graph/driver.js';
import type { QueryEngine } from '../../packages/core/src/graph/queries.js';

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

function createMockQueryEngine(): QueryEngine {
  return {} as unknown as QueryEngine;
}

const sampleInput: CreateScenarioInput = {
  name: 'User drops a file',
  description: 'User drags and drops a file onto the browser tab',
  entryFunction: 'handleUserFileDrop',
  triggerCondition: 'User drags a file onto the drop zone',
  discoveredBy: 'human',
  confidence: 0.95,
};

function makeSteps(scenarioId: string): Omit<ScenarioStep, 'scenarioId'>[] {
  return [
    {
      id: 'step-1',
      stepNumber: 1,
      functionId: 'src/index.ts:10',
      functionName: 'handleUserFileDrop',
      line: 10,
      action: 'call',
      justification: 'Entry point',
      variableState: { files: ['a.png'] },
      confidence: 0.9,
    },
    {
      id: 'step-2',
      stepNumber: 2,
      functionId: 'src/pipeline.ts:15',
      functionName: 'handleFileDrop',
      line: 15,
      action: 'branch_taken',
      justification: 'Files array is not empty',
      variableState: { files: ['a.png'], isValid: true },
      confidence: 0.85,
    },
  ];
}

describe('ScenarioEngine', () => {
  let engine: ScenarioEngine;
  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(() => {
    driver = createMockDriver();
    engine = new ScenarioEngine(driver, createMockQueryEngine());
    vi.restoreAllMocks();
  });

  describe('createScenario', () => {
    it('creates a scenario in draft status', async () => {
      const scenario = await engine.createScenario(sampleInput);

      expect(scenario.name).toBe('User drops a file');
      expect(scenario.status).toBe('draft');
      expect(scenario.discoveredBy).toBe('human');
      expect(scenario.confidence).toBe(0.95);
      expect(scenario.version).toBe(1);
      expect(scenario.entryFunction).toBe('handleUserFileDrop');
      expect(driver.run).toHaveBeenCalledTimes(1);
    });

    it('generates a kebab-case ID from the name', async () => {
      const scenario = await engine.createScenario(sampleInput);
      expect(scenario.id).toBe('user-drops-a-file');
    });

    it('defaults discoveredBy to human and confidence to 1.0', async () => {
      const input: CreateScenarioInput = {
        name: 'Minimal scenario',
        description: 'Test',
        entryFunction: 'main',
        triggerCondition: 'Startup',
      };
      const scenario = await engine.createScenario(input);

      expect(scenario.discoveredBy).toBe('human');
      expect(scenario.confidence).toBe(1.0);
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const scenario = await engine.createScenario(sampleInput);
      expect(scenario.createdAt).toBeTruthy();
      expect(scenario.updatedAt).toBeTruthy();
      expect(scenario.createdAt).toBe(scenario.updatedAt);
    });
  });

  describe('getScenario', () => {
    it('returns null when scenario does not exist', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());
      const result = await engine.getScenario('nonexistent');
      expect(result).toBeNull();
    });

    it('returns scenario when found', async () => {
      const mockRecord = {
        s: {
          properties: {
            id: 'test-id',
            name: 'Test',
            description: 'A test scenario',
            discoveredBy: 'ai',
            confidence: 0.8,
            status: 'draft',
            entryFunction: 'main',
            triggerCondition: 'startup',
            version: 1,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      };
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult([mockRecord]));

      const result = await engine.getScenario('test-id');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-id');
      expect(result!.name).toBe('Test');
      expect(result!.discoveredBy).toBe('ai');
    });
  });

  describe('listScenarios', () => {
    it('lists all scenarios without status filter', async () => {
      const records = [
        { s: { properties: { id: 's1', name: 'S1', description: '', discoveredBy: 'human', confidence: 1, status: 'draft', entryFunction: 'fn1', triggerCondition: '', version: 1, createdAt: '', updatedAt: '' } } },
        { s: { properties: { id: 's2', name: 'S2', description: '', discoveredBy: 'ai', confidence: 0.5, status: 'traced', entryFunction: 'fn2', triggerCondition: '', version: 2, createdAt: '', updatedAt: '' } } },
      ];
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult(records));

      const scenarios = await engine.listScenarios();
      expect(scenarios).toHaveLength(2);
      expect(scenarios[0].id).toBe('s1');
      expect(scenarios[1].id).toBe('s2');
    });

    it('filters by status when provided', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());

      await engine.listScenarios('traced');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('status: $status');
      expect(call[1]).toEqual({ status: 'traced' });
    });
  });

  describe('updateStatus', () => {
    it('updates scenario status in the graph', async () => {
      await engine.updateStatus('test-id', 'validated');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('SET s.status = $status');
      expect(call[1].id).toBe('test-id');
      expect(call[1].status).toBe('validated');
    });
  });

  describe('saveSteps', () => {
    it('deletes existing steps and creates new ones', async () => {
      const steps = makeSteps('scenario-1');

      await engine.saveSteps('scenario-1', steps);

      const calls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
      // 1 delete + 2 creates + 1 NEXT relationship + 1 updateStatus
      expect(calls.length).toBe(5);
      // First call should be the delete
      expect(calls[0][0]).toContain('DETACH DELETE step');
    });

    it('creates NEXT relationships between consecutive steps', async () => {
      const steps = makeSteps('scenario-1');

      await engine.saveSteps('scenario-1', steps);

      const calls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
      const nextCall = calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('NEXT')
      );
      expect(nextCall).toBeDefined();
      expect(nextCall![1]).toEqual({ fromId: 'step-1', toId: 'step-2' });
    });

    it('updates scenario status to traced', async () => {
      const steps = makeSteps('scenario-1');

      await engine.saveSteps('scenario-1', steps);

      const calls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
      const statusCall = calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('SET s.status')
      );
      expect(statusCall).toBeDefined();
      expect(statusCall![1].status).toBe('traced');
    });
  });

  describe('getSteps', () => {
    it('gets all steps when no range specified', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());

      await engine.getSteps('scenario-1');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('HAS_STEP');
      expect(call[0]).not.toContain('WHERE');
    });

    it('filters by from and to range', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());

      await engine.getSteps('scenario-1', 2, 5);

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('step.stepNumber >= $from');
      expect(call[0]).toContain('step.stepNumber <= $to');
    });

    it('filters by from only', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());

      await engine.getSteps('scenario-1', 3);

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('step.stepNumber >= $from');
      expect(call[0]).not.toContain('step.stepNumber <= $to');
    });
  });

  describe('updateStep', () => {
    it('updates step fields dynamically', async () => {
      await engine.updateStep('scenario-1', 1, {
        action: 'branch_skipped',
        justification: 'Corrected by user',
        confidence: 0.5,
      });

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('step.action');
      expect(call[0]).toContain('step.justification');
      expect(call[0]).toContain('step.confidence');
    });

    it('skips update when no fields provided', async () => {
      await engine.updateStep('scenario-1', 1, {});

      expect(driver.run).not.toHaveBeenCalled();
    });
  });

  describe('deleteScenario', () => {
    it('deletes scenario and all steps', async () => {
      await engine.deleteScenario('test-id');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('DETACH DELETE step, s');
      expect(call[1].id).toBe('test-id');
    });
  });

  describe('getScenariosForFunction', () => {
    it('queries scenarios containing the given function', async () => {
      (driver.run as ReturnType<typeof vi.fn>).mockResolvedValue(mockQueryResult());

      await engine.getScenariosForFunction('src/pipeline.ts:15');

      const call = (driver.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('functionId: $functionId');
      expect(call[1].functionId).toBe('src/pipeline.ts:15');
    });
  });
});
