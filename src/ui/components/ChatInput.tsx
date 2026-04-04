import { useState, useCallback, useRef } from 'react';
import type { Theme } from '../hooks/useDayNightCycle';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  disabled?: boolean;
  theme: Theme;
}

export function ChatInput({ onSend, disabled, theme }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{
      padding: '16px 24px 24px',
      display: 'flex',
      justifyContent: 'center',
      pointerEvents: 'auto',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        maxWidth: 680,
        padding: '12px 16px',
        borderRadius: 16,
        background: `${theme.cardBg}bb`,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${theme.border}`,
        transition: 'border-color 0.2s',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="a forest at dawn with birds circling overhead..."
          disabled={disabled}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontSize: '15px',
            fontFamily: "'Inter', system-ui, sans-serif",
            color: theme.text,
            letterSpacing: '0.01em',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: value.trim() && !disabled ? theme.invertedBg : 'transparent',
            border: 'none',
            cursor: value.trim() && !disabled ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: value.trim() && !disabled ? 1 : 0.2,
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={value.trim() && !disabled ? theme.invertedText : theme.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
