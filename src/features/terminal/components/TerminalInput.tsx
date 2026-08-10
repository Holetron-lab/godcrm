/**
 * TerminalInput - ADR-076
 * Command input with prompt, history navigation (up/down arrows).
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';

interface TerminalInputProps {
  onSubmit: (command: string) => void;
  isExecuting: boolean;
  cwd?: string;
  history?: string[];
}

export function TerminalInput({ onSubmit, isExecuting, cwd, history = [] }: TerminalInputProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect mobile — don't autoFocus on mobile to prevent keyboard popping up
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // On desktop, focus input when component mounts (replaces autoFocus attribute)
  useEffect(() => {
    if (!isMobile && inputRef.current) {
      inputRef.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const cmd = value.trim();
      if (cmd) {
        onSubmit(cmd);
        setValue('');
        setHistoryIndex(-1);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex + 1;
        if (newIndex < history.length) {
          setHistoryIndex(newIndex);
          setValue(history[history.length - 1 - newIndex]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex]);
      } else {
        setHistoryIndex(-1);
        setValue('');
      }
    }
  }, [value, history, historyIndex, onSubmit]);

  const shortCwd = cwd
    ? cwd.replace('/root/workspace/business-crm', '~/crm')
    : '~';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-t border-slate-700 bg-slate-900/50"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="text-blue-400 text-sm font-mono shrink-0">{shortCwd}</span>
      <span className="text-green-400 font-mono shrink-0">$</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isExecuting}
        placeholder={isExecuting ? 'Executing...' : 'Type a command...'}
        className="flex-1 bg-transparent text-slate-200 font-mono text-sm outline-none placeholder:text-slate-600"
        spellCheck={false}
        autoComplete="off"
      />
      {isExecuting && (
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
      )}
    </div>
  );
}
