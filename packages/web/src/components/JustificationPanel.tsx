import React from 'react';

/** Props for the JustificationPanel component. */
interface JustificationPanelProps {
  /** The justification text from the AI. */
  justification: string;
  /** Confidence score from 0.0 to 1.0. */
  confidence: number;
  /** Variable state that influenced the decision. */
  variableState: Record<string, unknown>;
  /** Whether this step was human-corrected. */
  correctedBy?: string;
  /** Note attached to the correction. */
  correctionNote?: string;
}

/** Returns a color based on the confidence level. */
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
    background: '#1a1a2e',
    border: '1px solid #2d2d44',
    borderRadius: 8,
    padding: 16,
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
  } as React.CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#7c4dff',
    marginBottom: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  } as React.CSSProperties,
  justification: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#ccc',
    marginBottom: 16,
    padding: '10px 12px',
    background: '#16162a',
    borderRadius: 6,
    borderLeft: '3px solid #7c4dff',
  } as React.CSSProperties,
  confidenceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  } as React.CSSProperties,
  confidenceBar: {
    flex: 1,
    height: 8,
    background: '#2d2d44',
    borderRadius: 4,
    overflow: 'hidden',
  } as React.CSSProperties,
  confidenceLabel: {
    fontSize: 12,
    fontWeight: 500,
    minWidth: 80,
  } as React.CSSProperties,
  confidenceValue: {
    fontSize: 12,
    color: '#888',
    minWidth: 40,
    textAlign: 'right' as const,
  } as React.CSSProperties,
  section: {
    marginTop: 14,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#999',
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  variableList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  } as React.CSSProperties,
  variableItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 8px',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  varName: {
    color: '#81d4fa',
  } as React.CSSProperties,
  varValue: {
    color: '#a5d6a7',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  correctionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    background: '#1b3a4b',
    border: '1px solid #2196f3',
    borderRadius: 6,
    fontSize: 12,
    color: '#64b5f6',
    marginBottom: 12,
  } as React.CSSProperties,
  correctionNote: {
    fontSize: 12,
    color: '#90caf9',
    fontStyle: 'italic',
    marginTop: 6,
    padding: '6px 10px',
    background: '#16162a',
    borderRadius: 4,
  } as React.CSSProperties,
};

/**
 * JustificationPanel displays the AI's reasoning for a walkthrough step.
 * Shows the justification text, a confidence meter, and the variable state
 * that influenced the AI's decision.
 */
export function JustificationPanel({
  justification,
  confidence,
  variableState,
  correctedBy,
  correctionNote,
}: JustificationPanelProps): React.JSX.Element {
  const entries = Object.entries(variableState);
  const color = confidenceColor(confidence);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>AI Justification</div>

      {correctedBy && (
        <div style={styles.correctionBadge}>
          ✏️ Corrected by {correctedBy}
        </div>
      )}

      {correctionNote && (
        <div style={styles.correctionNote}>{correctionNote}</div>
      )}

      <div style={styles.justification}>{justification}</div>

      <div style={styles.confidenceRow}>
        <span style={{ ...styles.confidenceLabel, color }}>
          {confidenceLabel(confidence)}
        </span>
        <div style={styles.confidenceBar}>
          <div
            style={{
              width: `${Math.round(confidence * 100)}%`,
              height: '100%',
              background: color,
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <span style={styles.confidenceValue}>
          {Math.round(confidence * 100)}%
        </span>
      </div>

      {entries.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Variable State</div>
          <ul style={styles.variableList}>
            {entries.map(([name, value]) => (
              <li key={name} style={styles.variableItem}>
                <span style={styles.varName}>{name}</span>
                <span style={styles.varValue} title={JSON.stringify(value)}>
                  {typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
