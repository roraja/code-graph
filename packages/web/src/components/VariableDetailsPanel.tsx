import React from 'react';
import type { CallStackFrame, FrameVariable } from '../types';

/** Props for the VariableDetailsPanel component. */
interface VariableDetailsPanelProps {
  /** The selected call stack frame to show variables for. */
  frame: CallStackFrame;
}

/** Returns a color based on confidence level. */
function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#4caf50';
  if (confidence >= 0.5) return '#ff9800';
  return '#f44336';
}

/** Returns a label for the confidence level. */
function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'Very High';
  if (confidence >= 0.7) return 'High';
  if (confidence >= 0.5) return 'Medium';
  if (confidence >= 0.3) return 'Low';
  return 'Very Low';
}

const styles = {
  panel: {
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
  } as React.CSSProperties,
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as React.CSSProperties,
  frameBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: '#16162a',
    borderRadius: 6,
    marginBottom: 12,
    border: '1px solid #2d2d44',
  } as React.CSSProperties,
  frameName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: '#81d4fa',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  } as React.CSSProperties,
  frameLocation: {
    fontSize: 10,
    color: '#666',
    fontFamily: "'JetBrains Mono', monospace",
    flexShrink: 0,
  } as React.CSSProperties,
  varCard: {
    padding: '10px 12px',
    background: '#0d0d1a',
    borderRadius: 6,
    border: '1px solid #1e1e36',
    marginBottom: 8,
  } as React.CSSProperties,
  varHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  } as React.CSSProperties,
  varName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#81d4fa',
    fontWeight: 600,
  } as React.CSSProperties,
  varType: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: '#ce93d8',
    padding: '1px 6px',
    background: '#1a0a2e',
    borderRadius: 3,
  } as React.CSSProperties,
  varValue: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#a5d6a7',
    padding: '6px 10px',
    background: '#0a1a0a',
    borderRadius: 4,
    border: '1px solid #1e3a1e',
    marginBottom: 6,
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,
  confidenceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  } as React.CSSProperties,
  confidenceBar: {
    flex: 1,
    height: 4,
    background: '#2d2d44',
    borderRadius: 2,
    overflow: 'hidden',
  } as React.CSSProperties,
  confidenceLabel: {
    fontSize: 10,
    fontWeight: 600,
    minWidth: 50,
  } as React.CSSProperties,
  confidenceValue: {
    fontSize: 10,
    color: '#888',
    minWidth: 30,
    textAlign: 'right' as const,
  } as React.CSSProperties,
  rationale: {
    fontSize: 11,
    lineHeight: 1.5,
    color: '#999',
    fontStyle: 'italic' as const,
    padding: '6px 10px',
    background: '#16162a',
    borderRadius: 4,
    borderLeft: '2px solid #7c4dff',
    marginBottom: 6,
  } as React.CSSProperties,
  alternatives: {
    marginTop: 4,
  } as React.CSSProperties,
  alternativesTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  } as React.CSSProperties,
  altPill: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#1e1e36',
    borderRadius: 10,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    color: '#888',
    marginRight: 4,
    marginBottom: 4,
  } as React.CSSProperties,
  emptyState: {
    padding: '16px 0',
    color: '#555',
    fontSize: 12,
    textAlign: 'center' as const,
  } as React.CSSProperties,
};

/**
 * VariableDetailsPanel shows detailed AI-imagined variable values for a
 * selected stack frame. Each variable shows its value, type, confidence,
 * the AI's rationale for choosing the value, and alternative possibilities.
 */
export function VariableDetailsPanel({ frame }: VariableDetailsPanelProps): React.JSX.Element {
  const varEntries = Object.entries(frame.variables ?? {});

  // Extract just the file name from full path
  const fileName = frame.filePath.includes('/')
    ? frame.filePath.split('/').pop()!
    : frame.filePath;

  return (
    <div style={styles.panel}>
      <div style={styles.title}>Frame Variables</div>

      <div style={styles.frameBanner}>
        <span style={styles.frameName}>{frame.functionName}</span>
        <span style={styles.frameLocation}>{fileName}:{frame.line}</span>
      </div>

      {varEntries.length === 0 ? (
        <div style={styles.emptyState}>No variables in this stack frame.</div>
      ) : (
        varEntries.map(([name, variable]) => {
          const v = variable as FrameVariable;
          const color = confidenceColor(v.confidence);
          return (
            <div key={name} style={styles.varCard}>
              <div style={styles.varHeader}>
                <span style={styles.varName}>{name}</span>
                <span style={styles.varType}>{v.type}</span>
              </div>

              <div style={styles.varValue}>{v.value}</div>

              <div style={styles.confidenceRow}>
                <span style={{ ...styles.confidenceLabel, color }}>
                  {confidenceLabel(v.confidence)}
                </span>
                <div style={styles.confidenceBar}>
                  <div
                    style={{
                      width: `${Math.round(v.confidence * 100)}%`,
                      height: '100%',
                      background: color,
                      borderRadius: 2,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <span style={styles.confidenceValue}>
                  {Math.round(v.confidence * 100)}%
                </span>
              </div>

              {v.rationale && (
                <div style={styles.rationale}>{v.rationale}</div>
              )}

              {v.alternatives.length > 0 && (
                <div style={styles.alternatives}>
                  <div style={styles.alternativesTitle}>Alternatives</div>
                  {v.alternatives.map((alt, i) => (
                    <span key={i} style={styles.altPill}>{alt}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
