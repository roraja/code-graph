import type {
  Scenario,
  ScenarioStep,
  CorrectionResult,
  FunctionNode,
  CallEdge,
  GraphData,
  DatabaseStats,
  CallStackFrame,
} from './types';

const API_BASE = '/api';

/**
 * Generic fetch wrapper that handles JSON parsing and error responses.
 * Throws an Error with the response status text on non-OK responses.
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch all scenarios, optionally filtered by status.
 * GET /api/scenarios
 */
export async function fetchScenarios(
  status?: Scenario['status']
): Promise<Scenario[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<Scenario[]>(`/scenarios${query}`);
}

/**
 * Fetch a single scenario by ID.
 * GET /api/scenarios/:id
 */
export async function fetchScenario(id: string): Promise<Scenario> {
  return request<Scenario>(`/scenarios/${encodeURIComponent(id)}`);
}

/**
 * Fetch the steps for a scenario, with optional range.
 * GET /api/scenarios/:id/steps
 */
export async function fetchSteps(
  scenarioId: string,
  from?: number,
  to?: number
): Promise<{ steps: ScenarioStep[]; totalSteps: number }> {
  const params = new URLSearchParams();
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  const query = params.toString() ? `?${params}` : '';
  return request<{ steps: ScenarioStep[]; totalSteps: number }>(
    `/scenarios/${encodeURIComponent(scenarioId)}/steps${query}`
  );
}

/**
 * Trigger AI-powered scenario discovery.
 * POST /api/scenarios/discover
 */
export async function discoverScenarios(
  hint?: string,
  count?: number
): Promise<Scenario[]> {
  return request<Scenario[]>('/scenarios/discover', {
    method: 'POST',
    body: JSON.stringify({ hint, count }),
  });
}

/**
 * Trace (execute) a scenario to generate steps.
 * POST /api/scenarios/:id/trace
 */
export async function traceScenario(
  scenarioId: string
): Promise<{ steps: ScenarioStep[]; totalSteps: number }> {
  return request<{ steps: ScenarioStep[]; totalSteps: number }>(
    `/scenarios/${encodeURIComponent(scenarioId)}/trace`,
    { method: 'POST' }
  );
}

/**
 * Submit a human correction for a scenario.
 * POST /api/corrections
 */
export async function submitCorrection(
  scenarioId: string,
  message: string,
  stepId?: string
): Promise<CorrectionResult> {
  return request<CorrectionResult>('/corrections', {
    method: 'POST',
    body: JSON.stringify({ scenarioId, message, stepId }),
  });
}

/**
 * Search functions by name or qualified name.
 * GET /api/functions/search?q=
 */
export async function searchFunctions(
  query: string,
  limit?: number
): Promise<FunctionNode[]> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) params.set('limit', String(limit));
  return request<FunctionNode[]>(`/functions/search?${params}`);
}

/**
 * Get all functions that call the given function.
 * GET /api/functions/:id/callers
 */
export async function getCallers(functionId: string): Promise<CallEdge[]> {
  return request<CallEdge[]>(
    `/functions/${encodeURIComponent(functionId)}/callers`
  );
}

/**
 * Get all functions called by the given function.
 * GET /api/functions/:id/callees
 */
export async function getCallees(functionId: string): Promise<CallEdge[]> {
  return request<CallEdge[]>(
    `/functions/${encodeURIComponent(functionId)}/callees`
  );
}

/**
 * Get the graph visualization data for a scenario.
 * GET /api/graph/:scenarioId
 */
export async function fetchGraphData(scenarioId: string): Promise<GraphData> {
  return request<GraphData>(
    `/graph/${encodeURIComponent(scenarioId)}`
  );
}

/**
 * Get database statistics (node and relationship counts).
 * GET /api/stats
 */
export async function getStats(): Promise<DatabaseStats> {
  return request<DatabaseStats>('/stats');
}

/**
 * Get public config (editor settings, project name).
 * GET /api/config
 */
export async function fetchConfig(): Promise<{ projectName: string; editor: { sshHost?: string } }> {
  return request<{ projectName: string; editor: { sshHost?: string } }>('/config');
}

/**
 * Get the call stack and per-frame variable values for a specific scenario step.
 * GET /api/scenarios/:id/steps/:stepNumber/callstack
 */
export async function fetchCallStack(
  scenarioId: string,
  stepNumber: number
): Promise<{ stepNumber: number; functionName: string; callStack: CallStackFrame[] }> {
  return request<{ stepNumber: number; functionName: string; callStack: CallStackFrame[] }>(
    `/scenarios/${encodeURIComponent(scenarioId)}/steps/${stepNumber}/callstack`
  );
}
