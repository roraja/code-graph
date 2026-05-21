import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Walkthrough } from './Walkthrough';
import { CorrectionChat } from './CorrectionChat';
import { useScenarioStore } from '../stores/scenario';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: 'calc(100vh - 56px)',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
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
 * Renders the codewalk walkthrough for the scenario along with the correction
 * chat at the bottom. The call graph pane has been removed to simplify the UI.
 */
export function ScenarioDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { steps, currentStep } = useScenarioStore();

  if (!id) {
    navigate('/');
    return <></>;
  }

  const currentStepData = steps[currentStep];

  return (
    <div style={styles.container}>
      <div style={styles.walkthroughWrapper}>
        <Walkthrough />
        <div style={styles.correctionWrapper}>
          <CorrectionChat
            scenarioId={id}
            stepId={currentStepData?.id}
          />
        </div>
      </div>
    </div>
  );
}
