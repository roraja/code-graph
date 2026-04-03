import React from 'react';
import { Link, useLocation } from 'react-router-dom';

/** Inline styles for the header component. */
const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    height: 56,
    background: '#1a1a2e',
    borderBottom: '1px solid #2d2d44',
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textDecoration: 'none',
    color: '#e0e0e0',
  } as React.CSSProperties,
  logo: {
    fontSize: 22,
    fontWeight: 700,
    color: '#7c4dff',
    fontFamily: "'JetBrains Mono', monospace",
  } as React.CSSProperties,
  subtitle: {
    fontSize: 12,
    color: '#888',
    marginLeft: 4,
  } as React.CSSProperties,
  nav: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
  } as React.CSSProperties,
  navLink: {
    color: '#aaa',
    textDecoration: 'none',
    fontSize: 14,
    padding: '6px 12px',
    borderRadius: 6,
    transition: 'background 0.15s, color 0.15s',
  } as React.CSSProperties,
  navLinkActive: {
    color: '#e0e0e0',
    background: '#2d2d44',
  } as React.CSSProperties,
};

/**
 * Navigation header component.
 * Displays the project name and navigation links.
 */
export function Header(): React.JSX.Element {
  const location = useLocation();

  const isActive = (path: string): boolean => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navLinkStyle = (path: string): React.CSSProperties => ({
    ...styles.navLink,
    ...(isActive(path) ? styles.navLinkActive : {}),
  });

  return (
    <header style={styles.header}>
      <Link to="/" style={styles.brand}>
        <span style={styles.logo}>⟨⟩ CodeGraph</span>
        <span style={styles.subtitle}>AI-Powered Code Analysis</span>
      </Link>
      <nav style={styles.nav}>
        <Link to="/" style={navLinkStyle('/')}>
          Scenarios
        </Link>
      </nav>
    </header>
  );
}
