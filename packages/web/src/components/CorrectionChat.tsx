import React, { useState, useRef, useEffect } from 'react';
import { useScenarioStore } from '../stores/scenario';
import type { CorrectionResult } from '../types';

/** A single message in the correction chat history. */
interface ChatMessage {
  id: string;
  role: 'user' | 'system';
  text: string;
  timestamp: Date;
  result?: CorrectionResult;
}

/** Props for the CorrectionChat component. */
interface CorrectionChatProps {
  /** The scenario ID to submit corrections for. */
  scenarioId: string;
  /** Optional step ID to scope the correction to. */
  stepId?: string;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#1a1a2e',
    border: '1px solid #2d2d44',
    borderRadius: 8,
    overflow: 'hidden',
    fontFamily: "'Inter', system-ui, sans-serif",
    maxHeight: 350,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: '#16162a',
    borderBottom: '1px solid #2d2d44',
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0e0',
  } as React.CSSProperties,
  headerBadge: {
    fontSize: 11,
    color: '#888',
    fontWeight: 400,
  } as React.CSSProperties,
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    minHeight: 120,
  } as React.CSSProperties,
  message: {
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.5,
    maxWidth: '85%',
  } as React.CSSProperties,
  userMessage: {
    alignSelf: 'flex-end' as const,
    background: '#7c4dff',
    color: '#fff',
  } as React.CSSProperties,
  systemMessage: {
    alignSelf: 'flex-start' as const,
    background: '#2d2d44',
    color: '#e0e0e0',
  } as React.CSSProperties,
  resultInfo: {
    marginTop: 6,
    padding: '6px 10px',
    background: '#16162a',
    borderRadius: 4,
    fontSize: 11,
    color: '#aaa',
  } as React.CSSProperties,
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderTop: '1px solid #2d2d44',
    background: '#16162a',
  } as React.CSSProperties,
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #2d2d44',
    background: '#0d0d1a',
    color: '#e0e0e0',
    fontSize: 13,
    outline: 'none',
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,
  sendBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#7c4dff',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,
  sendBtnDisabled: {
    background: '#3d3d5c',
    cursor: 'not-allowed',
    color: '#888',
  } as React.CSSProperties,
  empty: {
    textAlign: 'center' as const,
    color: '#666',
    fontSize: 12,
    padding: 20,
  } as React.CSSProperties,
  timestamp: {
    fontSize: 10,
    color: '#555',
    marginTop: 4,
  } as React.CSSProperties,
};

let messageCounter = 0;

/**
 * CorrectionChat provides a chat-like interface for submitting human corrections
 * to the AI's scenario trace. Users type correction messages, and the system
 * shows what changed and which steps were affected. The correction history
 * is maintained for the current session.
 */
export function CorrectionChat({ scenarioId, stepId }: CorrectionChatProps): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { submitCorrection } = useScenarioStore();

  /** Auto-scroll to bottom when new messages arrive. */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `msg-${++messageCounter}`,
      role: 'user',
      text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const result = await submitCorrection(scenarioId, text, stepId);

      const affectedCount = result.affectedSteps.length;
      let responseText: string;

      if (result.clarificationNeeded) {
        responseText = `❓ ${result.clarificationNeeded}`;
      } else if (result.retraceTriggered) {
        responseText = `✅ Correction applied. Re-traced the scenario. ${affectedCount} step(s) were updated.`;
      } else {
        responseText = `✅ Correction recorded: "${result.correction.rule}". ${affectedCount} step(s) affected.`;
      }

      const systemMsg: ChatMessage = {
        id: `msg-${++messageCounter}`,
        role: 'system',
        text: responseText,
        timestamp: new Date(),
        result,
      };

      setMessages((prev) => [...prev, systemMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${++messageCounter}`,
        role: 'system',
        text: `⚠ Error: ${(err as Error).message}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (d: Date): string =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>💬 Corrections</span>
        <span style={styles.headerBadge}>
          {messages.filter((m) => m.role === 'user').length} correction(s)
        </span>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            Type a correction below, e.g. &quot;The variable x is always positive here&quot;
            or &quot;Take the else branch at line 42&quot;
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            <div
              style={{
                ...styles.message,
                ...(msg.role === 'user' ? styles.userMessage : styles.systemMessage),
              }}
            >
              {msg.text}
            </div>
            {msg.result && msg.result.affectedSteps.length > 0 && (
              <div style={styles.resultInfo}>
                Affected steps:{' '}
                {msg.result.affectedSteps
                  .map((s) => `#${s.stepNumber} (${s.functionName})`)
                  .join(', ')}
              </div>
            )}
            <div
              style={{
                ...styles.timestamp,
                textAlign: msg.role === 'user' ? 'right' : 'left',
              }}
            >
              {formatTime(msg.timestamp)}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputRow}>
        <input
          style={styles.input}
          placeholder="Type a correction or constraint…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          style={{
            ...styles.sendBtn,
            ...(sending || !input.trim() ? styles.sendBtnDisabled : {}),
          }}
          onClick={handleSend}
          disabled={sending || !input.trim()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
