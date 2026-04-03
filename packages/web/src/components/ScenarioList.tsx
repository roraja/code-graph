import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScenarioStore } from '../stores/scenario';
import * as api from '../api';
import type { Scenario, ScenarioStatus } from '../types';

/** Color mapping for scenario statuses. */
const STATUS_COLORS: Record<ScenarioStatus, string> = {
  draft: '#ff9800',
  traced: '#2196f3',
  validated: '#4caf50',
  corrected: '#9c27b0',
};

/** Inline styles for the ScenarioList component. */
const styles = {
  container: {
    padding: '24px 32px',
    maxWidth: 1200,
    margin: '0 auto',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#e0e0e0',
  } as React.CSSProperties,
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  } as React.CSSProperties,
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#e0e0e0',
    margin: 0,
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    gap: 10,
  } as React.CSSProperties,
  button: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    transition: 'background 0.15s',
  } as React.CSSProperties,
  primaryBtn: {
    background: '#7c4dff',
    color: '#fff',
  } as React.CSSProperties,
  secondaryBtn: {
    background: '#2d2d44',
    color: '#ccc',
  } as React.CSSProperties,
  searchRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  searchInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 6,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#e0e0e0',
    fontSize: 14,
    outline: 'none',
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,
  filterSelect: {
    padding: '10px 14px',
    borderRadius: 6,
    border: '1px solid #2d2d44',
    background: '#16162a',
    color: '#e0e0e0',
    fontSize: 14,
    cursor: 'pointer',
    outline: 'none',
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    borderSpacing: 0,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    borderBottom: '1px solid #2d2d44',
  } as React.CSSProperties,
  tr: {
    cursor: 'pointer',
    transition: 'background 0.1s',
  } as React.CSSProperties,
  td: {
    padding: '12px 14px',
    fontSize: 14,
    borderBottom: '1px solid #1e1e36',
  } as React.CSSProperties,
  statusBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  confidenceBar: {
    width: 60,
    height: 6,
    background: '#2d2d44',
    borderRadius: 3,
    overflow: 'hidden',
    display: 'inline-block',
    verticalAlign: 'middle',
    marginRight: 8,
  } as React.CSSProperties,
  empty: {
    textAlign: 'center' as const,
    padding: 40,
    color: '#666',
    fontSize: 14,
  } as React.CSSProperties,
  error: {
    padding: '12px 16px',
    background: '#3e1f1f',
    border: '1px solid #f44336',
    borderRadius: 6,
    color: '#ef9a9a',
    fontSize: 13,
    marginBottom: 16,
  } as React.CSSProperties,
  loading: {
    textAlign: 'center' as const,
    padding: 40,
    color: '#7c4dff',
    fontSize: 14,
  } as React.CSSProperties,
  mono: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: '#81d4fa',
  } as React.CSSProperties,
};

/**
 * ScenarioList is the main landing page.
 * Displays a searchable, filterable table of all scenarios with status badges,
 * step count, and confidence indicators. Provides buttons to discover more
 * scenarios or create custom ones.
 */
export function ScenarioList(): React.JSX.Element {
  const { scenarios, loading, error, fetchScenarios } = useScenarioStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ScenarioStatus | ''>('');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  /** Filtered scenarios based on search text and status filter. */
  const filtered = useMemo(() => {
    let result = scenarios;
    if (statusFilter) {
      result = result.filter((s) => s.status === statusFilter);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(lower) ||
          s.description.toLowerCase().includes(lower) ||
          s.entryFunction.toLowerCase().includes(lower)
      );
    }
    return result;
  }, [scenarios, search, statusFilter]);

  const handleDiscover = async () => {
    try {
      await api.discoverScenarios();
      await fetchScenarios();
    } catch {
      // Error is handled by the store
    }
  };

  const confidenceColor = (c: number): string => {
    if (c >= 0.8) return '#4caf50';
    if (c >= 0.5) return '#ff9800';
    return '#f44336';
  };

  const renderRow = (scenario: Scenario) => {
    const isHovered = hoveredRow === scenario.id;
    return (
      <tr
        key={scenario.id}
        style={{
          ...styles.tr,
          background: isHovered ? '#1e1e36' : 'transparent',
        }}
        onClick={() => navigate(`/scenario/${scenario.id}`)}
        onMouseEnter={() => setHoveredRow(scenario.id)}
        onMouseLeave={() => setHoveredRow(null)}
      >
        <td style={styles.td}>
          <div style={{ fontWeight: 500 }}>{scenario.name}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {scenario.description.length > 80
              ? `${scenario.description.slice(0, 80)}…`
              : scenario.description}
          </div>
        </td>
        <td style={styles.td}>
          <span
            style={{
              ...styles.statusBadge,
              color: STATUS_COLORS[scenario.status],
              background: `${STATUS_COLORS[scenario.status]}20`,
            }}
          >
            {scenario.status}
          </span>
        </td>
        <td style={styles.td}>
          <span style={styles.mono}>{scenario.entryFunction}</span>
        </td>
        <td style={styles.td}>
          {scenario.stepCount ?? '—'}
        </td>
        <td style={styles.td}>
          <div style={styles.confidenceBar}>
            <div
              style={{
                width: `${Math.round(scenario.confidence * 100)}%`,
                height: '100%',
                background: confidenceColor(scenario.confidence),
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#888' }}>
            {Math.round(scenario.confidence * 100)}%
          </span>
        </td>
        <td style={styles.td}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {scenario.discoveredBy === 'ai' ? '🤖 AI' : '👤 Human'}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.titleRow}>
        <h1 style={styles.title}>Scenarios</h1>
        <div style={styles.actions}>
          <button
            style={{ ...styles.button, ...styles.primaryBtn }}
            onClick={handleDiscover}
            disabled={loading}
          >
            ✨ Discover More
          </button>
          <button
            style={{ ...styles.button, ...styles.secondaryBtn }}
            onClick={() => navigate('/scenario/new')}
          >
            + Create Custom
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>⚠ {error}</div>}

      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          placeholder="Search scenarios by name, description, or entry function…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ScenarioStatus | '')}
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="traced">Traced</option>
          <option value="validated">Validated</option>
          <option value="corrected">Corrected</option>
        </select>
      </div>

      {loading && <div style={styles.loading}>Loading scenarios…</div>}

      {!loading && filtered.length === 0 && (
        <div style={styles.empty}>
          {scenarios.length === 0
            ? 'No scenarios yet. Click "Discover More" to find scenarios in your codebase.'
            : 'No scenarios match your filters.'}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Scenario</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Entry Function</th>
              <th style={styles.th}>Steps</th>
              <th style={styles.th}>Confidence</th>
              <th style={styles.th}>Source</th>
            </tr>
          </thead>
          <tbody>{filtered.map(renderRow)}</tbody>
        </table>
      )}
    </div>
  );
}
