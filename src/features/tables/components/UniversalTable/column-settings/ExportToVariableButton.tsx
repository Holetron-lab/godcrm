import React, { useState } from 'react';
import { Upload, X, Loader2, AlertCircle, Variable } from 'lucide-react';
import type { LinkedVariableRef } from '../../../types/table.types';

export interface ExportToVariableButtonProps {
  /** Whether the aggregation is enabled (shown in summary bar) */
  enabled: boolean;
  /** Linked variable reference (if already exported) */
  linked?: LinkedVariableRef | null;
  /** Callback when user clicks export button */
  onExport?: () => Promise<{ id: number; name: string } | void>;
  /** Callback when user clicks unlink button */
  onUnlink?: () => void;
}

/**
 * ExportToVariableButton - ADR-026 Sprint 2.5
 * 
 * Button component that allows exporting a summary aggregation to a Variable.
 * Shows different states:
 * - Hidden when aggregation is not enabled
 * - "📤 В переменные" when enabled but not linked
 * - Variable chip with remove button when linked
 * - Loading state during export
 * - Error state on failure
 */
export const ExportToVariableButton: React.FC<ExportToVariableButtonProps> = ({
  enabled,
  linked,
  onExport,
  onUnlink,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't render if aggregation is not enabled
  if (!enabled) {
    return null;
  }

  // If linked to a variable, show chip with unlink button
  if (linked) {
    return (
      <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30">
        <Variable className="w-3 h-3 text-[var(--accent-primary)]" />
        <span className="text-xs font-mono text-[var(--accent-primary)]">
          {linked.variableName}
        </span>
        <button
          type="button"
          onClick={onUnlink}
          aria-label="Удалить связь с переменной"
          className="ml-1 p-0.5 rounded hover:bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/30">
        <AlertCircle className="w-3 h-3 text-red-400" />
        <span className="text-xs text-red-400">Ошибка</span>
        <button
          type="button"
          onClick={() => setError(null)}
          className="ml-1 p-0.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Handle export click
  const handleExport = async () => {
    if (!onExport || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await onExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  // Show export button
  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isLoading}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)]/10 border border-[var(--border-color)] hover:border-[var(--accent-primary)]/30 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isLoading ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Экспорт...</span>
        </>
      ) : (
        <>
          <span>📤</span>
          <span>В переменные</span>
        </>
      )}
    </button>
  );
};

export default ExportToVariableButton;
