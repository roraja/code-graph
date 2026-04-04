import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CallGraph } from './CallGraph';
import { Walkthrough } from './Walkthrough';
import { CorrectionChat } from './CorrectionChat';
import { OpenInVSCode } from './OpenInVSCode';
import { useScenarioStore } from '../stores/scenario';
import type { GraphNode } from '../types';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: 'calc(100vh - 56px)',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
  } as React.CSSProperties,
  tabs: {
    display: 'flex',
    background: '#1a1a2e',
    borderBottom: '1px solid #2d2d44',
    padding: '0 24px',
  } as React.CSSProperties,
  tab: {
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 500,
    color: '#888',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
  } as React.CSSProperties,
  tabActive: {
    color: '#e0e0e0',
    borderBottomColor: '#7c4dff',
  } as React.CSSProperties,
  graphPanel: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  } as React.CSSProperties,
  graphMain: {
    flex: 1,
    overflow: 'hidden',
  } as React.CSSProperties,
  sidePanel: {
    width: 350,
    borderLeft: '1px solid #2d2d44',
    background: '#121224',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
  } as React.CSSProperties,
  sidePanelTitle: {
    padding: '12px 16px',
    fontSize: 12,
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  sourceCode: {
    padding: 16,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    lineHeight: 1.6,
    color: '#d4d4d4',
    whiteSpace: 'pre-wrap' as const,
    flex: 1,
    overflow: 'auto',
  } as React.CSSProperties,
  nodeInfo: {
    padding: '12px 16px',
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  nodeLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0e0',
    marginBottom: 4,
  } as React.CSSProperties,
  nodeMeta: {
    fontSize: 12,
    color: '#888',
  } as React.CSSProperties,
  placeholder: {
    padding: 24,
    color: '#666',
    fontSize: 13,
    textAlign: 'center' as const,
  } as React.CSSProperties,
  walkthroughWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,
  correctionWrapper: {
    borderTop: '1px solid #2d2d44',
  } as React.CSSProperties,
};

/**
 * ScenarioDetail is the detail page for a single scenario.
 * Shows the call graph and walkthrough in a tabbed layout.
 * The graph tab includes a side panel showing source code for clicked nodes.
 * The walkthrough tab includes the correction chat at the bottom.
 */
export function ScenarioDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'graph' | 'walkthrough'>('graph');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const { steps, currentStep } = useScenarioStore();

  if (!id) {
    navigate('/');
    return <></>;
  }

  const currentStepData = steps[currentStep];

  return (
    <div style={styles.container}>
      {/* Tab bar */}
      <div style={styles.tabs}>
        <div
          style={{
            ...styles.tab,
            ...(activeTab === 'graph' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('graph')}
        >
          📊 Call Graph
        </div>
        <div
          style={{
            ...styles.tab,
            ...(activeTab === 'walkthrough' ? styles.tabActive : {}),
          }}
          onClick={() => setActiveTab('walkthrough')}
        >
          🚶 Walkthrough
        </div>
      </div>

      {/* Graph view */}
      {activeTab === 'graph' && (
        <div style={styles.graphPanel}>
          <div style={styles.graphMain}>
            <CallGraph scenarioId={id} onNodeClick={setSelectedNode} />
          </div>
          <div style={styles.sidePanel}>
            {selectedNode ? (
              <>
                <div style={styles.nodeInfo}>
                  <div style={styles.nodeLabel}>{selectedNode.label}</div>
                  <div style={styles.nodeMeta}>
                    {selectedNode.qualifiedName && (
                      <div>{selectedNode.qualifiedName}</div>
                    )}
                    <div>{selectedNode.filePath}
                      {selectedNode.line ? `:${selectedNode.line}` : ''}
                    </div>
                    <OpenInVSCode filePath={selectedNode.filePath} line={selectedNode.line} />
                    {selectedNode.signature && (
                      <div style={{ marginTop: 4, color: '#81d4fa', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        {selectedNode.signature}
                      </div>
                    )}
                  </div>
                </div>
                <div style={styles.sidePanelTitle}>Source Code</div>
                <div style={styles.sourceCode}>
                  {selectedNode.sourceCode || 'Source code not available.'}
                </div>
              </>
            ) : (
              <div style={styles.placeholder}>
                Click a node in the graph to view its source code.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Walkthrough view */}
      {activeTab === 'walkthrough' && (
        <div style={styles.walkthroughWrapper}>
          <Walkthrough />
          <div style={styles.correctionWrapper}>
            <CorrectionChat
              scenarioId={id}
              stepId={currentStepData?.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}
