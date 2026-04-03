import { create } from 'zustand';
import type { Scenario, ScenarioStep, CorrectionResult } from '../types';
import * as api from '../api';

/** State shape for scenario management. */
interface ScenarioState {
  /** All loaded scenarios. */
  scenarios: Scenario[];
  /** The currently selected scenario. */
  currentScenario: Scenario | null;
  /** Steps of the current scenario. */
  steps: ScenarioStep[];
  /** Total steps for the current scenario (may differ from loaded steps). */
  totalSteps: number;
  /** Index of the currently viewed step. */
  currentStep: number;
  /** Merged variable state up to the current step. */
  variableState: Record<string, unknown>;
  /** Whether data is being fetched. */
  loading: boolean;
  /** Last error message if any. */
  error: string | null;

  /** Load all scenarios from the API. */
  fetchScenarios: () => Promise<void>;
  /** Load a single scenario by ID. */
  fetchScenario: (id: string) => Promise<void>;
  /** Load steps for the current scenario. */
  fetchSteps: (scenarioId: string) => Promise<void>;
  /** Navigate to a specific step index. */
  setCurrentStep: (index: number) => void;
  /** Submit a correction and reload affected data. */
  submitCorrection: (
    scenarioId: string,
    message: string,
    stepId?: string
  ) => Promise<CorrectionResult>;
}

/**
 * Compute the merged variable state from step 0 up to `index`.
 * Each step's variableState is layered on top of previous steps.
 */
function computeVariableState(
  steps: ScenarioStep[],
  index: number
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
    Object.assign(merged, steps[i].variableState);
  }
  return merged;
}

/**
 * Zustand store for scenario state management.
 * Handles fetching scenarios, steps, and submitting corrections.
 */
export const useScenarioStore = create<ScenarioState>((set, get) => ({
  scenarios: [],
  currentScenario: null,
  steps: [],
  totalSteps: 0,
  currentStep: 0,
  variableState: {},
  loading: false,
  error: null,

  fetchScenarios: async () => {
    set({ loading: true, error: null });
    try {
      const scenarios = await api.fetchScenarios();
      set({ scenarios, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchScenario: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const scenario = await api.fetchScenario(id);
      set({ currentScenario: scenario, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchSteps: async (scenarioId: string) => {
    set({ loading: true, error: null });
    try {
      const { steps, totalSteps } = await api.fetchSteps(scenarioId);
      const variableState = steps.length > 0 ? computeVariableState(steps, 0) : {};
      set({ steps, totalSteps, currentStep: 0, variableState, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  setCurrentStep: (index: number) => {
    const { steps } = get();
    const clamped = Math.max(0, Math.min(index, steps.length - 1));
    set({
      currentStep: clamped,
      variableState: computeVariableState(steps, clamped),
    });
  },

  submitCorrection: async (
    scenarioId: string,
    message: string,
    stepId?: string
  ) => {
    set({ loading: true, error: null });
    try {
      const result = await api.submitCorrection(scenarioId, message, stepId);
      if (result.retraceTriggered) {
        const { steps, totalSteps } = await api.fetchSteps(scenarioId);
        const { currentStep } = get();
        const clamped = Math.min(currentStep, steps.length - 1);
        set({
          steps,
          totalSteps,
          currentStep: clamped,
          variableState: computeVariableState(steps, clamped),
        });
      }
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },
}));
