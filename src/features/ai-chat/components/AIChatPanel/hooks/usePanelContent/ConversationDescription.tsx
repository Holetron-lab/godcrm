import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WandSparkles } from 'lucide-react';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import { Button } from '@/shared/components/ui/Button';
import { apiClient } from '@/shared/utils/apiClient';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function ConversationDescription({ conversationId, summaryAgentId, onSaved, onDirtyChange }: {
  conversationId: number; summaryAgentId?: number | null; onSaved: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Partial<{ description: string; icon: string; color: string }>>({});
  const queryKey = ['conversation-description', conversationId];
  const query = useQuery({ queryKey, queryFn: async () => {
    const response = await apiClient.get<{ success: boolean; data: { settings?: { description?: string; icon?: string; color?: string } | string }; error?: { message: string } }>(`/chat/conversations/${conversationId}?limit=1`);
    if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.descriptionLoadFailed'));
    const settings: unknown = typeof response.data.settings === 'string' ? JSON.parse(response.data.settings) : response.data.settings;
    return {
      description: settings && typeof settings === 'object' && 'description' in settings && typeof settings.description === 'string' ? settings.description : '',
      color: settings && typeof settings === 'object' && 'color' in settings && typeof settings.color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : '#3b82f6',
      icon: settings && typeof settings === 'object' && 'icon' in settings && typeof settings.icon === 'string' ? settings.icon : '',
    };
  } });
  const save = useMutation({ mutationFn: async () => {
    const response = await apiClient.patch<{ success: boolean; error?: { message: string } }>(`/chat/conversations/${conversationId}/settings`, draft);
    if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.descriptionSaveFailed'));
  }, onSuccess: () => { client.setQueryData(queryKey, { ...query.data, ...draft }); setDraft({}); onDirtyChange?.(false); onSaved(); } });
  const generate = useMutation({ mutationFn: async () => {
    const response = await apiClient.post<{ success: boolean; data: { summary: { summary: string } }; error?: { message: string } }>(`/chat/conversations/${conversationId}/summaries`, { summary_agent_id: summaryAgentId ?? null });
    if (!response.success || !response.data?.summary?.summary) throw new Error(response.error?.message || t('aiChat.ui.descriptionGenerateFailed'));
    return response.data.summary.summary;
  }, onSuccess: text => { setDraft(prev => ({ ...prev, description: text })); onDirtyChange?.(true); } });
  if (query.isPending) return <p role="status" className="p-3 text-xs">{t('aiChat.ui.loading')}</p>;
  if (query.isError) return <div role="alert">{query.error.message}<Button size="sm" onClick={() => void query.refetch()}>{t('aiChat.ui.retry')}</Button></div>;
  const busy = save.isPending || generate.isPending;
  return <fieldset disabled={busy} className="p-3 space-y-2 min-w-0">
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0">
        <label htmlFor={`chat-icon-${conversationId}`} className="block text-xs mb-1">{t('aiChat.ui.avatarEmoji')}</label>
        <div className="flex items-center">
          <input id={`chat-icon-${conversationId}`} value={draft.icon ?? query.data.icon} onChange={e => { setDraft(prev => ({ ...prev, icon: e.target.value })); onDirtyChange?.(true); }} className="w-12 h-10 text-center text-xl rounded-l-md border border-r-0 border-[var(--border-primary)] bg-[var(--bg-secondary)] focus-visible:ring-2" />
          {!busy && <div className="[&>div>button]:h-10 [&>div>button]:w-8 [&>div>button]:rounded-l-none [&>div>button]:rounded-r-md [&>div>button]:border-t [&>div>button]:opacity-100 [&>div>button]:focus-visible:ring-2"><EmojiPicker value={draft.icon ?? query.data.icon} onChange={icon => { setDraft(prev => ({ ...prev, icon })); onDirtyChange?.(true); }} buttonOnly portal /></div>}
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={`chat-color-${conversationId}`} className="block text-xs mb-1">{t('aiChat.ui.avatarColor')}</label>
        <input id={`chat-color-${conversationId}`} type="color" value={draft.color ?? query.data.color} onChange={e => { setDraft(prev => ({ ...prev, color: e.target.value })); onDirtyChange?.(true); }} className="block h-10 w-20 cursor-pointer rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-1 focus-visible:ring-2 disabled:cursor-not-allowed" />
      </div>
    </div>
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={`chat-description-${conversationId}`} className="text-xs">{t('aiChat.ui.chatDescription')}</label>
      <Button size="sm" variant="ghost" aria-label={t('aiChat.ui.autofillDescription')} title={t('aiChat.ui.autofillDescription')} loading={generate.isPending} onClick={() => generate.mutate()}><WandSparkles className="w-3.5 h-3.5" /></Button>
    </div>
    <textarea id={`chat-description-${conversationId}`} rows={3} value={draft.description ?? query.data.description} onChange={e => { setDraft(prev => ({ ...prev, description: e.target.value })); onDirtyChange?.(true); }} className="w-full text-xs p-2 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]" />
    <p className="text-[10px] text-[var(--text-secondary)]">{t('aiChat.ui.descriptionSummaryHint')}</p>
    {(save.isError || generate.isError) && <p role="alert" className="text-xs text-red-400">{save.error?.message || generate.error?.message}</p>}
    <Button size="sm" loading={save.isPending} disabled={!Object.keys(draft).some(key => draft[key as keyof typeof draft] !== query.data[key as keyof typeof draft])} onClick={() => save.mutate()}>{t('aiChat.ui.save')}</Button>
  </fieldset>;
}
