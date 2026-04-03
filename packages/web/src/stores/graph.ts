import { create } from 'zustand';
import type { GraphNode, GraphEdge } from '../types';
import * as api from '../api';

/** Layout algorithm options for the graph visualization. */
export type LayoutName = 'dagre' | 'breadthfirst' | 'cose' | 'circle' | 'grid';

/** State shape for graph visualization data. */
interface GraphState {
  /** Graph nodes. */
  nodes: GraphNode[];
  /** Graph edges. */
  edges: GraphEdge[];
  /** Current layout algorithm. */
  layout: LayoutName;
  /** Filter string for node labels. */
  filterText: string;
  /** Whether graph data is loading. */
  loading: boolean;
  /** Last error if any. */
  error: string | null;

  /** Fetch graph data for a scenario. */
  fetchGraphData: (scenarioId: string) => Promise<void>;
  /** Change the layout algorithm. */
  setLayout: (layout: LayoutName) => void;
  /** Set the node filter text. */
  filterNodes: (text: string) => void;
  /** Get filtered nodes based on current filterText. */
  getFilteredNodes: () => GraphNode[];
  /** Get filtered edges (only those connecting visible nodes). */
  getFilteredEdges: () => GraphEdge[];
}

/**
 * Zustand store for graph visualization state.
 * Manages nodes, edges, layout options, and filtering.
 */
export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  layout: 'breadthfirst',
  filterText: '',
  loading: false,
  error: null,

  fetchGraphData: async (scenarioId: string) => {
    set({ loading: true, error: null });
    try {
      const data = await api.fetchGraphData(scenarioId);
      set({ nodes: data.nodes, edges: data.edges, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  setLayout: (layout: LayoutName) => {
    set({ layout });
  },

  filterNodes: (text: string) => {
    set({ filterText: text });
  },

  getFilteredNodes: () => {
    const { nodes, filterText } = get();
    if (!filterText) return nodes;
    const lower = filterText.toLowerCase();
    return nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(lower) ||
        n.filePath.toLowerCase().includes(lower)
    );
  },

  getFilteredEdges: () => {
    const { edges } = get();
    const visibleNodes = get().getFilteredNodes();
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    return edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
    );
  },
}));
