import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from './components/Header';
import { ScenarioList } from './components/ScenarioList';
import { ScenarioDetail } from './components/ScenarioDetail';
import { Walkthrough } from './components/Walkthrough';

/** Global styles applied to the document body via inline style on the root. */
const appStyles = {
  root: {
    minHeight: '100vh',
    background: '#0d0d1a',
    color: '#e0e0e0',
    fontFamily: "'Inter', system-ui, sans-serif",
    margin: 0,
    padding: 0,
  } as React.CSSProperties,
};

/**
 * Main application component.
 * Provides routing for the scenario list, scenario detail (call graph + walkthrough),
 * and standalone walkthrough views. Renders the navigation header on all pages.
 */
export function App(): React.JSX.Element {
  return (
    <div style={appStyles.root}>
      <Header />
      <Routes>
        <Route path="/" element={<ScenarioList />} />
        <Route path="/scenario/:id" element={<ScenarioDetail />} />
        <Route path="/scenario/:id/walk" element={<Walkthrough />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
