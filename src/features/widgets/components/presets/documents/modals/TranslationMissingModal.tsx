/**
 * TranslationMissingModal — opens when the user switches the document
 * language to a code that has no translated content on the selected
 * document. Offers to dispatch the widget's configured translation
 * agent in a row-bound chat with a "translate this document to X" prompt.
 *
 * Wired by DocumentsProvider via useEffect on `currentLanguage`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Languages, Loader2, X } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { useDocumentsContext } from '../DocumentsContext';

interface AgentRow {
  id: number;
  data: {
    name?: string;
    agent_name?: string;
    agent_slug?: string;
    slug?: string;
    icon?: string;
    [k: string]: unknown;
  };
}

export function TranslationMissingModal() {
  const ctx = useDocumentsContext();
  const config = ctx.config as
    | { ai_agents_config?: { translation_agent_id?: number; agents_table_id?: number }; translation_agent_id?: number; agents_table_id?: number }
    | undefined;

  const translationAgentId = useMemo(() => {
    const id = config?.ai_agents_config?.translation_agent_id ?? config?.translation_agent_id;
    return id ? Number(id) : null;
  }, [config]);

  const agentsTableId = useMemo(() => {
    const id = config?.ai_agents_config?.agents_table_id ?? config?.agents_table_id;
    return id ? Number(id) : null;
  }, [config]);

  const [agent, setAgent] = useState<{ name: string; slug: string; icon?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetLang = ctx.translationMissingLang || ctx.currentLanguage;
  const targetLangName =
    ctx.availableLanguages.find((l) => l.code === targetLang)?.name || targetLang.toUpperCase();

  useEffect(() => {
    if (!ctx.showTranslationMissingModal) return;
    if (!translationAgentId || !agentsTableId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ data: AgentRow }>(`/tables/${agentsTableId}/rows/${translationAgentId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data?.data || {};
        const slug = String(d.agent_slug || d.slug || '').trim();
        const name = String(d.name || d.agent_name || 'Translation Agent').trim();
        setAgent({ name, slug, icon: d.icon ? String(d.icon) : undefined });
      })
      .catch((e) => {
        if (cancelled) return;
        logger.warn('[TranslationMissingModal] failed to fetch agent row', e);
        setError('Не удалось загрузить агента переводов');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.showTranslationMissingModal, translationAgentId, agentsTableId]);

  const close = () => {
    ctx.setShowTranslationMissingModal(false);
    setSubmitting(false);
    setError(null);
  };

  const buildPrompt = (): string => {
    const doc = ctx.selectedDocument;
    const docTitle = doc?.name || doc?.slug || `doc#${ctx.selectedDocumentId}`;
    const docHint = ctx.registryTableId && ctx.selectedDocumentId
      ? `[[row:${ctx.registryTableId}/${ctx.selectedDocumentId}]]`
      : '';
    const slugTag = agent?.slug ? `<<@${agent.slug}>>` : '';
    return [
      slugTag,
      `Переведи документ «${docTitle}» ${docHint} на язык «${targetLangName}» (код: ${targetLang}).`,
      '',
      `Прочитай содержимое документа через MCP (registry table_id=${ctx.registryTableId}, document_id=${ctx.selectedDocumentId}), переведи каждый item, и запиши перевод в поле content_${targetLang} соответствующих строк таблицы содержимого через update_table_row. Сохраняй markdown-разметку и структуру.`,
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleDispatch = async () => {
    if (!ctx.registryTableId || !ctx.selectedDocumentId) {
      setError('Документ не выбран');
      return;
    }
    if (!agent?.slug) {
      setError('У агента нет slug — нечем инвокать');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const convResp = await apiClient.post<{
        success: boolean;
        data: { id: number };
      }>('/chat/conversations/ensure-row-chat', {
        table_id: ctx.registryTableId,
        row_id: ctx.selectedDocumentId,
        title: ctx.selectedDocument?.name || `Doc #${ctx.selectedDocumentId}`,
      });
      const convId = convResp.data?.id;
      if (!convId) throw new Error('ensure-row-chat did not return conversation id');

      await apiClient.post(`/chat/conversations/${convId}/messages`, {
        content: buildPrompt(),
        content_type: 'text',
      });

      close();
    } catch (e) {
      logger.error('[TranslationMissingModal] dispatch failed', e);
      setError(e instanceof Error ? e.message : 'Не удалось отправить запрос агенту');
    } finally {
      setSubmitting(false);
    }
  };

  const openAgentsSettings = () => {
    ctx.setShowTranslationMissingModal(false);
    ctx.setShowAgentsModal(true);
  };

  return (
    <Modal
      open={ctx.showTranslationMissingModal}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={`🌐 Перевода на «${targetLangName}» нет`}
      size="md"
      footer={
        <div className="flex items-center gap-3 w-full">
          <Button onClick={close} variant="secondary">
            Отмена
          </Button>
          <Button
            onClick={handleDispatch}
            disabled={submitting || loading || !translationAgentId || !agent?.slug}
            variant="primary"
            className="flex-1"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Отправляю агенту...
              </>
            ) : (
              <>
                <Languages className="w-4 h-4 mr-2" />
                Запросить перевод
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          В документе нет содержимого на языке «{targetLangName}». Можно отправить документ
          агенту переводов — он прочитает текущую версию и сохранит перевод в поле{' '}
          <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-xs">
            content_{targetLang}
          </code>{' '}
          каждого блока.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка агента...
          </div>
        ) : translationAgentId && agent ? (
          <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mb-1">
              <Languages className="w-3 h-3" />
              Агент переводов
            </div>
            <div className="text-sm text-[var(--text-primary)]">
              {agent.icon || '🤖'} {agent.name}{' '}
              <span className="text-[var(--text-tertiary)]">[ID: {translationAgentId}]</span>
            </div>
            {!agent.slug && (
              <div className="text-xs text-red-400 mt-2">
                У агента не задан <code>agent_slug</code> — заполните его в таблице агентов.
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <p className="text-sm text-yellow-300 mb-2">
              Агент переводов не настроен для этого виджета.
            </p>
            <button
              onClick={openAgentsSettings}
              className="text-xs text-yellow-300 underline hover:text-yellow-200"
            >
              Открыть настройки агентов →
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-start gap-2">
            <X className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
