import React, { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useScenarioStore } from '../stores/scenario';
import { JustificationPanel } from './JustificationPanel';
import type { StepAction } from '../types';

/** Icon mapping for step action types. */
const ACTION_ICONS: Record<StepAction, string> = {
  call: '📞',
  branch_taken: '✅',
  branch_skipped: '⏭',
  dispatch: '🔀',
  return: '↩️',
  assign: '📝',
};

/** Color mapping for step action types. */
const ACTION_COLORS: Record<StepAction, string> = {
  call: '#2196f3',
  branch_taken: '#4caf50',
  branch_skipped: '#ff9800',
  dispatch: '#9c27b0',
  return: '#607d8b',
  assign: '#00bcd4',
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: 'calc(100vh - 56px)',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
  } as React.CSSProperties,
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    background: '#1a1a2e',
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  stepInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  } as React.CSSProperties,
  stepCounter: {
    fontSize: 14,
    fontWeight: 600,
    color: '#7c4dff',
    fontFamily: "'JetBrains Mono', monospace",
  } as React.CSSProperties,
  stepAction: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  } as React.CSSProperties,
  navButtons: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  navBtn: {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#ccc',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  navBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  jumpInput: {
    width: 50,
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#e0e0e0',
    fontSize: 13,
    textAlign: 'center' as const,
    outline: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  } as React.CSSProperties,
  mainContent: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  } as React.CSSProperties,
  codePanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,
  fileHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    background: '#16162a',
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  fileName: {
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    color: '#81d4fa',
  } as React.CSSProperties,
  functionName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0e0',
  } as React.CSSProperties,
  codeContainer: {
    flex: 1,
    overflow: 'auto',
    padding: 0,
    background: '#0d0d1a',
  } as React.CSSProperties,
  codePre: {
    margin: 0,
    padding: '12px 0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    lineHeight: 1.7,
    whiteSpace: 'pre' as const,
  } as React.CSSProperties,
  codeLine: {
    display: 'flex',
    padding: '0 16px',
    minHeight: 22,
  } as React.CSSProperties,
  codeLineHighlighted: {
    background: 'rgba(124, 77, 255, 0.15)',
    borderLeft: '3px solid #7c4dff',
    paddingLeft: 13,
  } as React.CSSProperties,
  lineNumber: {
    color: '#444',
    minWidth: 45,
    textAlign: 'right' as const,
    paddingRight: 16,
    userSelect: 'none' as const,
  } as React.CSSProperties,
  lineContent: {
    flex: 1,
    color: '#d4d4d4',
  } as React.CSSProperties,
  sidePanel: {
    width: 360,
    display: 'flex',
    flexDirection: 'column' as const,
    borderLeft: '1px solid #2d2d44',
    overflow: 'auto',
    background: '#121224',
  } as React.CSSProperties,
  sidePanelSection: {
    padding: 16,
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  variablePanel: {
    padding: 16,
  } as React.CSSProperties,
  variableTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  } as React.CSSProperties,
  varList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  } as React.CSSProperties,
  varItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    borderBottom: '1px solid #1e1e36',
  } as React.CSSProperties,
  varName: {
    color: '#81d4fa',
  } as React.CSSProperties,
  varValue: {
    color: '#a5d6a7',
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#7c4dff',
    fontSize: 14,
  } as React.CSSProperties,
  error: {
    padding: 24,
    color: '#ef9a9a',
    fontSize: 13,
  } as React.CSSProperties,
  backLink: {
    fontSize: 13,
    color: '#7c4dff',
    textDecoration: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,
};

/**
 * Walkthrough provides a step-by-step code walkthrough for a scenario.
 * Displays the current step's function name, file path, source code with
 * highlighted current line, variable state, and the AI's justification.
 * Supports navigation via Prev/Next/Jump controls.
 */
export function Walkthrough(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentScenario, steps, totalSteps, currentStep,
    variableState, loading, error,
    fetchScenario, fetchSteps, setCurrentStep,
  } = useScenarioStore();

  useEffect(() => {
    if (id) {
      fetchScenario(id);
      fetchSteps(id);
    }
  }, [id, fetchScenario, fetchSteps]);

  const step = steps[currentStep] ?? null;

  /** Parse source code into numbered lines. */
  const codeLines = useMemo(() => {
    if (!step?.sourceCode) return [];
    return step.sourceCode.split('\n');
  }, [step?.sourceCode]);

  const handleJump = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      if (!isNaN(value) && value >= 1 && value <= steps.length) {
        setCurrentStep(value - 1);
      }
    }
  };

  /** Handle keyboard navigation. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'k') {
        setCurrentStep(currentStep - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'j') {
        setCurrentStep(currentStep + 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStep, setCurrentStep]);

  if (loading) return <div style={styles.loading}>Loading walkthrough…</div>;
  if (error) return <div style={styles.error}>⚠ {error}</div>;
  if (!step) {
    return (
      <div style={styles.loading}>
        No steps available.{' '}
        <span style={styles.backLink} onClick={() => navigate('/')}>
          ← Back to scenarios
        </span>
      </div>
    );
  }

  const varEntries = Object.entries(variableState);
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  return (
    <div style={styles.container}>
      {/* Top navigation bar */}
      <div style={styles.topBar}>
        <div style={styles.stepInfo}>
          <span style={styles.backLink} onClick={() => navigate(`/scenario/${id}`)}>
            ← Graph
          </span>
          <span style={styles.stepCounter}>
            Step {currentStep + 1} / {totalSteps || steps.length}
          </span>
          <span
            style={{
              ...styles.stepAction,
              color: ACTION_COLORS[step.action],
              background: `${ACTION_COLORS[step.action]}20`,
            }}
          >
            {ACTION_ICONS[step.action]} {step.action.replace('_', ' ')}
          </span>
          {currentScenario && (
            <span style={{ fontSize: 13, color: '#888' }}>
              {currentScenario.name}
            </span>
          )}
        </div>
        <div style={styles.navButtons}>
          <button
            style={{ ...styles.navBtn, ...(isFirst ? styles.navBtnDisabled : {}) }}
            onClick={() => !isFirst && setCurrentStep(currentStep - 1)}
            disabled={isFirst}
          >
            ← Prev
          </button>
          <input
            style={styles.jumpInput}
            type="number"
            min={1}
            max={steps.length}
            placeholder={(currentStep + 1).toString()}
            onKeyDown={handleJump}
            title="Jump to step"
          />
          <button
            style={{ ...styles.navBtn, ...(isLast ? styles.navBtnDisabled : {}) }}
            onClick={() => !isLast && setCurrentStep(currentStep + 1)}
            disabled={isLast}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div style={styles.mainContent}>
        {/* Code panel */}
        <div style={styles.codePanel}>
          <div style={styles.fileHeader}>
            <span style={styles.functionName}>{step.functionName}</span>
            <span style={styles.fileName}>
              {step.functionId.split(':')[0] || 'unknown'}
            </span>
            {step.line > 0 && (
              <span style={{ fontSize: 12, color: '#666' }}>
                Line {step.line}
              </span>
            )}
          </div>
          <div style={styles.codeContainer}>
            {codeLines.length > 0 ? (
              <pre style={styles.codePre}>
                {codeLines.map((line, i) => {
                  const lineNum = i + 1;
                  const isHighlighted = lineNum === step.line;
                  return (
                    <div
                      key={i}
                      style={{
                        ...styles.codeLine,
                        ...(isHighlighted ? styles.codeLineHighlighted : {}),
                      }}
                    >
                      <span style={styles.lineNumber}>{lineNum}</span>
                      <span style={styles.lineContent}>{line}</span>
                    </div>
                  );
                })}
              </pre>
            ) : (
              <div style={{ padding: 24, color: '#666', fontSize: 13 }}>
                Source code not available for this step.
              </div>
            )}
          </div>
        </div>

        {/* Side panel: justification + variables */}
        <div style={styles.sidePanel}>
          <div style={styles.sidePanelSection}>
            <JustificationPanel
              justification={step.justification}
              confidence={step.confidence}
              variableState={step.variableState}
              correctedBy={step.correctedBy}
              correctionNote={step.correctionNote}
            />
          </div>

          {varEntries.length > 0 && (
            <div style={styles.variablePanel}>
              <div style={styles.variableTitle}>Cumulative Variable State</div>
              <ul style={styles.varList}>
                {varEntries.map(([name, value]) => (
                  <li key={name} style={styles.varItem}>
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
      </div>
    </div>
  );
}
