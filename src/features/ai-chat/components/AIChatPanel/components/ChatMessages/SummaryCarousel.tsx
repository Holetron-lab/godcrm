/**
 * SummaryCarousel.tsx
 * Chat Summary — renders as an agent message with carousel navigation.
 *
 * Looks like a ChatTurn from the Summary Agent with:
 * - Agent avatar + header (like TurnHeader)
 * - Summary content inside a bubble
 * - Left/right carousel navigation for history
 * - Regenerate + close controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationSummary {
  id: number;
  conversation_id: number;
  chunk_number: number;
  messages_start_id: number | null;
  messages_end_id: number | null;
  messages_count: number;
  summary: string;
  summary_model: string;
  created_at: string;
  agent_id?: number;
  agent_name?: string;
  agent_icon?: string | null;
  agent_color?: string | null;
}

interface SummaryCarouselProps {
  conversationId: number | null;
  isVisible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_COLOR = '#3b82f6';
const DEFAULT_AGENT_ICON = '📋';
const DEFAULT_AGENT_NAME = 'Summary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSummaryDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SummaryCarousel: React.FC<SummaryCarouselProps> = ({
  conversationId,
  isVisible,
  onClose,
}) => {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing summaries and generate a new one
  const fetchAndGenerate = useCallback(async () => {
    if (!conversationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const listResponse = await apiClient.get<{
        success: boolean;
        data: { summaries: ConversationSummary[] };
      }>(`/chat/conversations/${conversationId}/summaries`);

      const existing = listResponse?.data?.summaries ?? [];
      setSummaries(existing);

      if (existing.length > 0) {
        setCurrentIndex(existing.length - 1);
      }
    } catch (err) {
      setError('Failed to load summaries');
    } finally {
      setIsLoading(false);
    }

    // Generate new summary in background
    setIsGenerating(true);
    try {
      const genResponse = await apiClient.post<{
        success: boolean;
        data: { summary: ConversationSummary };
      }>(`/chat/conversations/${conversationId}/summaries`);

      const newSummary = genResponse?.data?.summary;
      if (newSummary) {
        setSummaries(prev => {
          const updated = [...prev, newSummary];
          setCurrentIndex(updated.length - 1);
          return updated;
        });
      }
    } catch (err) {
      if (summaries.length === 0) {
        setError('Failed to generate summary');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [conversationId]);

  // Regenerate summary on demand
  const handleRegenerate = useCallback(async () => {
    if (!conversationId || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    try {
      const genResponse = await apiClient.post<{
        success: boolean;
        data: { summary: ConversationSummary };
      }>(`/chat/conversations/${conversationId}/summaries`);

      const newSummary = genResponse?.data?.summary;
      if (newSummary) {
        setSummaries(prev => {
          const updated = [...prev, newSummary];
          setCurrentIndex(updated.length - 1);
          return updated;
        });
      }
    } catch {
      setError('Failed to generate summary');
    } finally {
      setIsGenerating(false);
    }
  }, [conversationId, isGenerating]);

  // Fetch on visibility change
  useEffect(() => {
    if (isVisible && conversationId) {
      fetchAndGenerate();
    }
  }, [isVisible, conversationId, fetchAndGenerate]);

  // Navigation handlers
  const goLeft = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, []);

  const goRight = useCallback(() => {
    setCurrentIndex(prev => Math.min(summaries.length - 1, prev + 1));
  }, [summaries.length]);

  if (!isVisible) return null;

  const currentSummary = summaries[currentIndex] ?? null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < summaries.length - 1;

  // Resolve agent display info from current summary or defaults
  const agentColor = currentSummary?.agent_color || DEFAULT_AGENT_COLOR;
  const agentIcon = currentSummary?.agent_icon || DEFAULT_AGENT_ICON;
  const agentName = currentSummary?.agent_name || DEFAULT_AGENT_NAME;

  return (
    <div
      className={cn(
        'group relative w-full bg-[var(--bg-secondary)] rounded-xl border-b border-[var(--border-secondary)] border-l-[3px]',
        'animate-in fade-in slide-in-from-top-2 duration-200',
        'mb-2',
      )}
      style={{ borderLeftColor: agentColor }}
    >
      <div className="px-4 pt-3 pb-3">
        {/* ── Header: Agent avatar + name + badge + controls ── */}
        <div className="flex items-center gap-2 mb-2">
          {/* Avatar */}
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
          >
            <span className="text-sm leading-none">{agentIcon}</span>
          </div>

          {/* Agent color dot */}
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: agentColor }}
          />

          {/* Agent name */}
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {agentName}
          </span>

          {/* Badge */}
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: `${agentColor}15`, color: agentColor }}
          >
            <Bot className="w-3 h-3" />
            Agent
          </span>

          {/* Generating spinner */}
          {isGenerating && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)]" />
          )}

          {/* Spacer */}
          <span className="flex-1" />

          {/* Carousel navigation */}
          {summaries.length > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={goLeft}
                disabled={!hasPrev}
                className={cn(
                  'p-0.5 rounded transition-colors',
                  hasPrev
                    ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed',
                )}
                title="Previous summary"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums min-w-[24px] text-center">
                {currentIndex + 1}/{summaries.length}
              </span>
              <button
                onClick={goRight}
                disabled={!hasNext}
                className={cn(
                  'p-0.5 rounded transition-colors',
                  hasNext
                    ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                    : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed',
                )}
                title="Next summary"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Regenerate */}
          <button
            onClick={handleRegenerate}
            disabled={isGenerating}
            className={cn(
              'p-1 rounded transition-colors',
              isGenerating
                ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
            )}
            title="Generate new summary"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isGenerating && 'animate-spin')} />
          </button>

          {/* Timestamp */}
          {currentSummary && (
            <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
              {formatSummaryDate(currentSummary.created_at)}
            </span>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Separator (like ChatTurn) ── */}
        <div className="border-b border-[var(--border-secondary)] mb-3" />

        {/* ── Body: Summary content (no bordered card, just content) ── */}
        <div className="min-h-[60px] max-h-[300px] overflow-y-auto">
          {isLoading && summaries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading summaries...</span>
            </div>
          ) : error && summaries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-red-400">
              <span className="text-xs">{error}</span>
            </div>
          ) : currentSummary ? (
            <div className="text-sm text-[var(--text-primary)] leading-relaxed">
              <MarkdownPreview content={currentSummary.summary} />
            </div>
          ) : isGenerating ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Generating summary...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
              <FileText className="w-4 h-4" />
              <span className="text-xs">No summaries yet. Click refresh to generate one.</span>
            </div>
          )}
        </div>

        {/* Footer: model + messages count (inline, no border) */}
        {currentSummary && (
          <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-tertiary)]">
            <Bot className="w-3 h-3" />
            <span>{currentSummary.summary_model} | {currentSummary.messages_count} messages</span>
            {isGenerating && (
              <>
                <span className="flex-1" />
                <span className="flex items-center gap-1" style={{ color: agentColor }}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating...
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
