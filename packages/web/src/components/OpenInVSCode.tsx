import React, { useEffect } from 'react';
import { useConfigStore } from '../stores/config';

interface OpenInVSCodeProps {
  filePath: string;
  line?: number;
}

/**
 * Builds a vscode:// URI for VS Code Remote SSH.
 * Format: vscode://vscode-remote/ssh-remote+HOST/filepath
 * With line: opens at that line via the goto query param.
 */
function buildVSCodeURI(sshHost: string, filePath: string, line?: number): string {
  // Ensure absolute path
  const absPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const base = `vscode://vscode-remote/ssh-remote+${sshHost}${absPath}`;
  if (line && line > 0) {
    return `${base}:${line}`;
  }
  return base;
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  fontSize: 11,
  color: '#4fc3f7',
  background: 'rgba(79, 195, 247, 0.1)',
  border: '1px solid rgba(79, 195, 247, 0.3)',
  borderRadius: 4,
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

export function OpenInVSCode({ filePath, line }: OpenInVSCodeProps): React.JSX.Element | null {
  const { sshHost, loaded, fetchConfig } = useConfigStore();

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  if (!loaded || !sshHost || !filePath) return null;

  const uri = buildVSCodeURI(sshHost, filePath, line);

  return (
    <a href={uri} style={btnStyle} title={`Open in VS Code (${sshHost})`}>
      <span style={{ fontSize: 13 }}>⟨⟩</span> Open in VS Code
    </a>
  );
}
