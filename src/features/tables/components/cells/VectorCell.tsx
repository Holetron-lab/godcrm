import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Sparkles, Loader2, RefreshCw } from 'lucide-react';
import type { VectorColumnConfig } from '../../types/table.types';
import { tablesApi } from '../../api/tablesApi';

interface VectorCellProps {
  value: unknown;
  rawMode?: boolean;
  rowData?: Record<string, unknown>;
  columnId?: string;
  tableId?: string | number;
  rowId?: string | number;
  config?: { vector?: VectorColumnConfig };
  onUpdate?: (newValue: unknown) => void;
}

export const VectorCell = ({ 
  value, 
  rawMode = false,
  rowData = {}, 
  columnId, 
  tableId, 
  rowId,
  config,
  onUpdate
}: VectorCellProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Parse vector value
  let displayText = '';
  let hasEmbedding = false;
  const currentValue = localValue || value;

  if (currentValue && typeof currentValue === 'object' && 'text' in currentValue) {
    const vectorData = currentValue as { text?: string; embedding?: number[] };
    displayText = vectorData.text || '';
    hasEmbedding = Array.isArray(vectorData.embedding) && vectorData.embedding.length > 0;
  } else if (typeof currentValue === 'string') {
    try {
      const parsed = JSON.parse(currentValue);
      if (parsed && typeof parsed === 'object' && 'text' in parsed) {
        displayText = parsed.text || '';
        hasEmbedding = Array.isArray(parsed.embedding) && parsed.embedding.length > 0;
      } else {
        displayText = currentValue;
      }
    } catch {
      displayText = currentValue;
    }
  }

  // Preview text from formula (only for display, not saved yet)
  const previewText = useMemo(() => {
    if (config?.vector?.formula && rowData) {
      let text = config.vector.formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const val = rowData[key];
        return val != null ? String(val) : match;
      });
      // Apply prefix/suffix for preview
      const prefix = config?.vector?.prefix || '';
      const suffix = config?.vector?.suffix || '';
      if (prefix || suffix) {
        text = prefix + text + suffix;
      }
      return text;
    }
    return null;
  }, [config?.vector?.formula, config?.vector?.prefix, config?.vector?.suffix, rowData]);

  // Apply prefix and suffix to saved displayText
  if (displayText && (config?.vector?.prefix || config?.vector?.suffix)) {
    const prefix = config?.vector?.prefix || '';
    const suffix = config?.vector?.suffix || '';
    displayText = prefix + displayText + suffix;
  }

  // Can generate if we have tableId, rowId, columnId
  const canGenerate = !!(tableId && rowId && columnId);

  const handleGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canGenerate || isGenerating) return;
    
    setIsGenerating(true);
    try {
      // Call backend API to generate vector embedding
      const result = await tablesApi.generateVectorCell(
        String(tableId),
        String(rowId),
        columnId!
      );
      
      if (result.success && result.result) {
        // Update local state with result
        const vectorData = {
          text: result.result.text,
          embedding: [] // Embedding stored on backend
        };
        setLocalValue(vectorData);
        
        // Notify parent if callback provided
        if (onUpdate) {
          onUpdate(vectorData);
        }
      }
    } catch (error) {
      logger.error('Vector generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Empty state - show preview text or subtle placeholder, click to generate
  if (!displayText && !hasEmbedding) {
    return (
      <button
        type="button"
        aria-label="Generate vector"
        disabled={!canGenerate || isGenerating}
        className="group relative block w-full h-full px-2 py-1 text-left hover:bg-muted/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 disabled:cursor-default"
        onClick={handleGenerate}
        title={previewText ? 'Click to generate' : 'Click to generate vector'}
      >
        <Sparkles className="absolute top-0.5 left-0.5 h-3 w-3 text-orange-400/50" />
        {isGenerating ? (
          <span className="flex items-center gap-2 pl-4 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 text-orange-500 animate-spin" />
            <span>Generating...</span>
          </span>
        ) : (
          <span className="block pl-4 text-sm whitespace-pre-wrap break-words overflow-hidden text-muted-foreground">
            {previewText || <span className="italic text-muted-foreground/50">Click to generate</span>}
          </span>
        )}
      </button>
    );
  }

  // Filled state - show text content with subtle sparkles indicator
  return (
    <div
      className="group relative h-full px-2 py-1 hover:bg-muted/30 transition-colors"
    >
      <Sparkles className={`absolute top-0.5 left-0.5 h-3 w-3 ${hasEmbedding ? 'text-orange-500/60' : 'text-orange-400/50'}`} />
      {isGenerating ? (
        <div className="flex items-center gap-2 pl-4 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 text-orange-500 animate-spin" />
          <span>Regenerating...</span>
        </div>
      ) : (
        <div className="pl-4 text-sm whitespace-pre-wrap break-words overflow-hidden">
          {displayText}
        </div>
      )}

      {/* Regenerate button on hover */}
      {canGenerate && (
        <button
          type="button"
          disabled={isGenerating}
          className="absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
          onClick={handleGenerate}
          title="Regenerate vector"
        >
          <RefreshCw className="h-3 w-3 text-muted-foreground hover:text-orange-500" />
        </button>
      )}
    </div>
  );
};
