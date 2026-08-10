import { Bot } from 'lucide-react';
import { useDocumentsContext } from '../DocumentsContext';

export function ToolbarAtomsModeActions() {
  const ctx = useDocumentsContext();

  return (
    <>
      {/* Agents button — hidden in read-only (ADR-0060 P6/P) */}
      {!ctx.isReadOnly && (
        <button
          onClick={() => ctx.setShowAgentsModal(true)}
          className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]"
          title="AI Агенты"
        >
          <Bot className="w-4 h-4" />
        </button>
      )}

      {/* Exit atoms mode */}
      <button
        onClick={() => ctx.setAtomsViewMode(false)}
        className="px-3 py-1.5 rounded-lg text-xs bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
      >
        Документы
      </button>
    </>
  );
}
