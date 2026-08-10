import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, ExternalLink, Table } from 'lucide-react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';

export const TablesListPanel = () => {
  const { nodes } = useSchemaEditorStore();
  const [isExternalExpanded, setIsExternalExpanded] = useState(false);
  const [isLocalExpanded, setIsLocalExpanded] = useState(true);

  const localTables = nodes.filter((n) => !n.data.isExternal);
  const externalTables = nodes.filter((n) => n.data.isExternal);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-[var(--text-secondary)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Tables
          </h3>
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">
          {nodes.length}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2">
        {/* Local Tables Section */}
        <div className="mb-2">
          <button
            onClick={() => setIsLocalExpanded(!isLocalExpanded)}
            className="flex items-center gap-1 w-full px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {isLocalExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span className="font-medium">Space Tables</span>
            <span className="text-xs text-[var(--text-tertiary)] ml-auto">
              {localTables.length}
            </span>
          </button>

          {isLocalExpanded && (
            <div className="space-y-0.5 mt-1">
              {localTables.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                >
                  <span className="text-base">{node.data.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">
                      {node.data.displayName || node.data.name}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] font-mono truncate">
                      {node.data.columns.length} columns
                    </p>
                  </div>
                </div>
              ))}

              {localTables.length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)] text-center py-2">
                  No tables in this space
                </p>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[var(--border-primary)] my-2" />

        {/* External Tables Section */}
        <div>
          <button
            onClick={() => setIsExternalExpanded(!isExternalExpanded)}
            className="flex items-center gap-1 w-full px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {isExternalExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-medium">External Tables</span>
            <span className="text-xs text-[var(--text-tertiary)] ml-auto">
              {externalTables.length}
            </span>
          </button>

          {isExternalExpanded && (
            <div className="space-y-0.5 mt-1">
              {externalTables.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                >
                  <span className="text-base">{node.data.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">
                      {node.data.displayName || node.data.name}
                    </p>
                    <p className="text-xs text-amber-400 truncate">
                      From: {node.data.sourceSpaceName}
                    </p>
                  </div>
                </div>
              ))}

              {externalTables.length === 0 && (
                <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-md transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add from other Space</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
