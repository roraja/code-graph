import React, { useState } from 'react';
import type { CallStackFrame, FrameVariable } from '../types';

/** Props for the CallStackPanel component. */
interface CallStackPanelProps {
  /** The call stack frames, from entry (depth 0) to current (deepest). */
  callStack: CallStackFrame[];
  /** The step number this call stack belongs to. */
  stepNumber: number;
  /** Callback when a stack frame is clicked (e.g. to navigate to that function). */
  onFrameClick?: (frame: CallStackFrame) => void;
}

/** Returns a color based on confidence level. */
function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#4caf50';
  if (confidence >= 0.5) return '#ff9800';
  return '#f44336';
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
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
  stackList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } as React.CSSProperties,
  frame: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '6px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
    border: '1px solid transparent',
  } as React.CSSProperties,
  frameActive: {
    background: 'rgba(124, 77, 255, 0.15)',
    borderColor: '#7c4dff',
  } as React.CSSProperties,
  frameInactive: {
    background: '#16162a',
    borderColor: '#2d2d44',
  } as React.CSSProperties,
  frameHover: {
    background: 'rgba(124, 77, 255, 0.08)',
  } as React.CSSProperties,
  frameHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
  } as React.CSSProperties,
  depthBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 4,
    background: '#2d2d44',
    color: '#7c4dff',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    flexShrink: 0,
  } as React.CSSProperties,
  frameName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: '#81d4fa',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  } as React.CSSProperties,
  frameLocation: {
    fontSize: 10,
    color: '#666',
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: 2,
    marginLeft: 28,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  expandIcon: {
    fontSize: 10,
    color: '#666',
    flexShrink: 0,
    transition: 'transform 0.15s',
  } as React.CSSProperties,
  variableSection: {
    marginTop: 6,
    marginLeft: 28,
    padding: '6px 10px',
    background: '#0d0d1a',
    borderRadius: 4,
    border: '1px solid #1e1e36',
  } as React.CSSProperties,
  variableTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 6,
  } as React.CSSProperties,
  varRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '3px 0',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    borderBottom: '1px solid #1e1e36',
  } as React.CSSProperties,
  varName: {
    color: '#81d4fa',
    minWidth: 70,
    flexShrink: 0,
  } as React.CSSProperties,
  varValue: {
    color: '#a5d6a7',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  varType: {
    color: '#ce93d8',
    fontSize: 10,
    flexShrink: 0,
  } as React.CSSProperties,
  varConfidence: {
    fontSize: 9,
    fontWeight: 600,
    flexShrink: 0,
    padding: '1px 4px',
    borderRadius: 3,
  } as React.CSSProperties,
  varRationale: {
    fontSize: 10,
    color: '#888',
    fontStyle: 'italic' as const,
    marginTop: 2,
    marginLeft: 70,
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,
  alternatives: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    marginLeft: 70,
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,
  noVariables: {
    fontSize: 11,
    color: '#555',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,
  emptyState: {
    padding: '12px 0',
    color: '#555',
    fontSize: 12,
    textAlign: 'center' as const,
  } as React.CSSProperties,
  arrowConnector: {
    width: 1,
    height: 6,
    background: '#2d2d44',
    marginLeft: 19,
  } as React.CSSProperties,
};

/**
 * VariableDetail renders the expanded view of a single variable in a stack frame.
 */
function VariableDetail({ name, variable }: { name: string; variable: FrameVariable }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div style={styles.varRow} onClick={() => setExpanded(!expanded)} role="button" tabIndex={0}>
        <span style={styles.varName}>{name}</span>
        <span style={styles.varValue} title={variable.value}>{variable.value}</span>
        <span style={styles.varType}>{variable.type}</span>
        <span
          style={{
            ...styles.varConfidence,
            color: confidenceColor(variable.confidence),
            background: `${confidenceColor(variable.confidence)}15`,
          }}
        >
          {Math.round(variable.confidence * 100)}%
        </span>
      </div>
      {expanded && (
        <>
          {variable.rationale && (
            <div style={styles.varRationale}>{variable.rationale}</div>
          )}
          {variable.alternatives.length > 0 && (
            <div style={styles.alternatives}>
              Also possible: {variable.alternatives.join(', ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * CallStackPanel displays the call stack at the current scenario step.
 *
 * Shows each frame from the entry function down to the current function,
 * with expandable variable details per frame. The deepest (current) frame
 * is visually highlighted. Clicking a frame can navigate to that function.
 */
export function CallStackPanel({
  callStack,
  stepNumber,
  onFrameClick,
}: CallStackPanelProps): React.JSX.Element {
  const [expandedFrame, setExpandedFrame] = useState<number | null>(null);
  const [hoveredFrame, setHoveredFrame] = useState<number | null>(null);

  if (!callStack || callStack.length === 0) {
    return (
      <div style={styles.panel}>
        <div style={styles.title}>
          <span>Call Stack</span>
        </div>
        <div style={styles.emptyState}>
          No call stack available for step {stepNumber}.
        </div>
      </div>
    );
  }

  // Display frames bottom-up: current (deepest) at top, entry at bottom
  const reversedStack = [...callStack].reverse();
  const deepestDepth = callStack[callStack.length - 1]?.depth ?? 0;

  const handleFrameClick = (frame: CallStackFrame) => {
    setExpandedFrame(expandedFrame === frame.depth ? null : frame.depth);
    onFrameClick?.(frame);
  };

  return (
    <div style={styles.panel}>
      <div style={styles.title}>
        <span>Call Stack</span>
        <span style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>
          ({callStack.length} frame{callStack.length !== 1 ? 's' : ''})
        </span>
      </div>

      <ul style={styles.stackList}>
        {reversedStack.map((frame, index) => {
          const isActive = frame.depth === deepestDepth;
          const isExpanded = expandedFrame === frame.depth;
          const isHovered = hoveredFrame === frame.depth;
          const varEntries = Object.entries(frame.variables ?? {});

          // Extract just the short function name from qualified name
          const shortName = frame.functionName.includes('.')
            ? frame.functionName.split('.').pop()!
            : frame.functionName;

          // Extract just the file name from full path
          const fileName = frame.filePath.includes('/')
            ? frame.filePath.split('/').pop()!
            : frame.filePath;

          return (
            <React.Fragment key={frame.depth}>
              {index > 0 && <div style={styles.arrowConnector} />}
              <li
                style={{
                  ...styles.frame,
                  ...(isActive ? styles.frameActive : styles.frameInactive),
                  ...(isHovered && !isActive ? styles.frameHover : {}),
                }}
                onClick={() => handleFrameClick(frame)}
                onMouseEnter={() => setHoveredFrame(frame.depth)}
                onMouseLeave={() => setHoveredFrame(null)}
              >
                <div style={styles.frameHeader}>
                  <span style={styles.depthBadge}>{frame.depth}</span>
                  <span style={{
                    ...styles.frameName,
                    color: isActive ? '#e0e0e0' : '#81d4fa',
                    fontWeight: isActive ? 600 : 400,
                  }}>
                    {isActive ? frame.functionName : shortName}
                  </span>
                  <span style={{
                    ...styles.expandIcon,
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}>
                    {varEntries.length > 0 ? '>' : ''}
                  </span>
                </div>

                <div style={styles.frameLocation}>
                  {fileName}:{frame.line}
                </div>

                {/* Variable details panel — shown when frame is expanded */}
                {isExpanded && (
                  <div style={styles.variableSection}>
                    <div style={styles.variableTitle}>
                      Variables ({varEntries.length})
                    </div>
                    {varEntries.length > 0 ? (
                      varEntries.map(([name, variable]) => (
                        <VariableDetail
                          key={name}
                          name={name}
                          variable={variable as FrameVariable}
                        />
                      ))
                    ) : (
                      <div style={styles.noVariables}>No variables in this frame</div>
                    )}
                  </div>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
}
