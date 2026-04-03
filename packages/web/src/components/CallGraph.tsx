import React, { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core as CyCore, EventObject } from 'cytoscape';
import { useGraphStore, type LayoutName } from '../stores/graph';
import type { GraphNode } from '../types';

/** Color palette for files/modules. */
const FILE_COLORS = [
  '#7c4dff', '#00bcd4', '#ff9800', '#4caf50', '#e91e63',
  '#03a9f4', '#ffeb3b', '#9c27b0', '#8bc34a', '#ff5722',
];

/** Map file paths to consistent colors. */
function getFileColor(filePath: string, colorMap: Map<string, string>): string {
  if (colorMap.has(filePath)) return colorMap.get(filePath)!;
  const color = FILE_COLORS[colorMap.size % FILE_COLORS.length];
  colorMap.set(filePath, color);
  return color;
}

/** Props for the CallGraph component. */
interface CallGraphProps {
  /** The scenario ID to load graph data for. */
  scenarioId: string;
  /** Callback when a node is clicked. */
  onNodeClick?: (node: GraphNode) => void;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: '#0d0d1a',
    borderRadius: 8,
    overflow: 'hidden',
  } as React.CSSProperties,
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: '#1a1a2e',
    borderBottom: '1px solid #2d2d44',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  toolbarLabel: {
    fontSize: 12,
    color: '#888',
    marginRight: 4,
  } as React.CSSProperties,
  select: {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#e0e0e0',
    fontSize: 12,
    cursor: 'pointer',
    outline: 'none',
  } as React.CSSProperties,
  iconBtn: {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#ccc',
    fontSize: 14,
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  filterInput: {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#e0e0e0',
    fontSize: 12,
    outline: 'none',
    width: 180,
  } as React.CSSProperties,
  graphArea: {
    flex: 1,
    minHeight: 400,
  } as React.CSSProperties,
  legend: {
    display: 'flex',
    gap: 16,
    padding: '8px 12px',
    background: '#1a1a2e',
    borderTop: '1px solid #2d2d44',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: '#888',
  } as React.CSSProperties,
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
  } as React.CSSProperties,
  legendDiamond: {
    width: 10,
    height: 10,
    background: '#ff9800',
    transform: 'rotate(45deg)',
    display: 'inline-block',
  } as React.CSSProperties,
  tooltip: {
    position: 'absolute' as const,
    padding: '8px 12px',
    background: '#1a1a2e',
    border: '1px solid #2d2d44',
    borderRadius: 6,
    fontSize: 12,
    color: '#e0e0e0',
    maxWidth: 300,
    pointerEvents: 'none' as const,
    zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  } as React.CSSProperties,
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 400,
    color: '#7c4dff',
    fontSize: 14,
  } as React.CSSProperties,
  error: {
    padding: 16,
    color: '#ef9a9a',
    fontSize: 13,
  } as React.CSSProperties,
};

const LAYOUT_OPTIONS: { value: LayoutName; label: string }[] = [
  { value: 'breadthfirst', label: 'Hierarchical' },
  { value: 'cose', label: 'Force-Directed' },
  { value: 'circle', label: 'Circle' },
  { value: 'grid', label: 'Grid' },
];

/**
 * CallGraph renders an interactive call graph visualization for a scenario
 * using Cytoscape.js. Nodes represent functions (colored by file/module),
 * edges represent call relationships (directed arrows). Branch nodes are
 * shown as diamonds. Supports click to select, hover tooltips, zoom/fit
 * controls, and layout toggling.
 */
export function CallGraph({ scenarioId, onNodeClick }: CallGraphProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<CyCore | null>(null);
  const {
    nodes, edges, layout, filterText, loading, error,
    fetchGraphData, setLayout, filterNodes,
    getFilteredNodes, getFilteredEdges,
  } = useGraphStore();

  const [tooltipData, setTooltipData] = useState<{
    x: number; y: number; text: string;
  } | null>(null);

  useEffect(() => {
    fetchGraphData(scenarioId);
  }, [scenarioId, fetchGraphData]);

  /** Build and render the Cytoscape instance. */
  const renderGraph = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;

    const colorMap = new Map<string, string>();
    const visibleNodes = getFilteredNodes();
    const visibleEdges = getFilteredEdges();

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...visibleNodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            filePath: n.filePath,
            type: n.type,
            sourceCode: n.sourceCode ?? '',
            qualifiedName: n.qualifiedName ?? n.label,
            signature: n.signature ?? '',
          },
        })),
        ...visibleEdges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label ?? '',
            isVirtualDispatch: e.isVirtualDispatch ?? false,
          },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '11px',
            'font-family': "'JetBrains Mono', monospace",
            color: '#e0e0e0',
            'text-outline-color': '#0d0d1a',
            'text-outline-width': 2,
            width: 40,
            height: 40,
            'border-width': 2,
            'border-color': '#2d2d44',
          },
        },
        {
          selector: 'node[type = "function"]',
          style: {
            shape: 'ellipse',
            'background-color': (ele: cytoscape.NodeSingular) =>
              getFileColor(ele.data('filePath'), colorMap),
          },
        },
        {
          selector: 'node[type = "branch"]',
          style: {
            shape: 'diamond',
            'background-color': '#ff9800',
            width: 35,
            height: 35,
          },
        },
        {
          selector: 'node[type = "class"]',
          style: {
            shape: 'rectangle',
            'background-color': '#9c27b0',
            width: 50,
            height: 35,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#555',
            'target-arrow-color': '#555',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
          },
        },
        {
          selector: 'edge[?isVirtualDispatch]',
          style: {
            'line-style': 'dashed',
            'line-color': '#ff9800',
            'target-arrow-color': '#ff9800',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#7c4dff',
            'border-width': 3,
            'background-opacity': 1,
          },
        },
      ],
      layout: {
        name: layout,
        directed: true,
        padding: 30,
        spacingFactor: 1.5,
        animate: false,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (evt: EventObject) => {
      const nodeData = evt.target.data();
      const graphNode = visibleNodes.find((n) => n.id === nodeData.id);
      if (graphNode && onNodeClick) {
        onNodeClick(graphNode);
      }
    });

    cy.on('mouseover', 'node', (evt: EventObject) => {
      const pos = evt.renderedPosition;
      const data = evt.target.data();
      const text = data.qualifiedName || data.label;
      setTooltipData({ x: pos.x + 15, y: pos.y + 15, text });
    });

    cy.on('mouseout', 'node', () => {
      setTooltipData(null);
    });

    cyRef.current = cy;
  }, [nodes, edges, layout, filterText, getFilteredNodes, getFilteredEdges, onNodeClick]);

  useEffect(() => {
    renderGraph();
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [renderGraph]);

  const handleFit = () => {
    cyRef.current?.fit(undefined, 30);
  };

  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  if (loading) return <div style={styles.loading}>Loading graph…</div>;
  if (error) return <div style={styles.error}>⚠ {error}</div>;

  const colorMap = new Map<string, string>();
  const uniqueFiles = [...new Set(nodes.map((n) => n.filePath))];
  uniqueFiles.forEach((f) => getFileColor(f, colorMap));

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Layout:</span>
        <select
          style={styles.select}
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutName)}
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <input
          style={styles.filterInput}
          placeholder="Filter nodes…"
          value={filterText}
          onChange={(e) => filterNodes(e.target.value)}
        />

        <button style={styles.iconBtn} onClick={handleZoomIn} title="Zoom In">+</button>
        <button style={styles.iconBtn} onClick={handleZoomOut} title="Zoom Out">−</button>
        <button style={styles.iconBtn} onClick={handleFit} title="Fit to View">⊡</button>

        <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      <div ref={containerRef} style={styles.graphArea} />

      {tooltipData && (
        <div style={{ ...styles.tooltip, left: tooltipData.x, top: tooltipData.y + 56 }}>
          {tooltipData.text}
        </div>
      )}

      <div style={styles.legend}>
        {uniqueFiles.map((file) => (
          <div key={file} style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: colorMap.get(file) }} />
            {file.split('/').pop()}
          </div>
        ))}
        <div style={styles.legendItem}>
          <span style={styles.legendDiamond} />
          Branch
        </div>
      </div>
    </div>
  );
}
