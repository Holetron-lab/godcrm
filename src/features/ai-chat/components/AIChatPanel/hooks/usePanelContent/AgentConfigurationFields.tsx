import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IdCard, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useAIChat } from '@/features/ai-chat/context/AIChatContext';
import { usePassportAuthority } from '@/features/ai-chat/hooks/usePassportAuthority';
import type { AIAgent } from '@/features/ai-chat/types';

type Fields = { name: string; slug: string; icon: string; color: string; operator_id: number | null; model: string; crm_instructions: string; main_instructions: string };
type AgentData = Partial<Omit<Fields, 'main_instructions' | 'model'>> & { agent_slug?: string; model?: string | number | null; main_instructions?: AIAgent['main_instructions'] };
type AgentUser = { id: number; managed_by_agent_row_id: number; handle?: string | null };
type PassportResponse<T> = { success: boolean; data?: T; error?: { message: string } };
const inputClass = 'w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] disabled:opacity-60';

export function AgentConfigurationFields({ agent, operators, disabled, onDirtyChange }: {
  agent: AIAgent; operators: Array<{ id: number; name: string }>; disabled: boolean; onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLanguage();
  const { loadAgents, spaceId: contextSpaceId } = useAIChat();
  const authority = usePassportAuthority('row_id', agent.id, !disabled);
  const spaceId = agent.space_id ?? contextSpaceId;
  const passportSpaceId = authority.data?.space?.id ?? spaceId;
  const client = useQueryClient();
  const canIssuePassport = authority.allowed;
  const passportUsers = useQuery({
    queryKey: ['agent-roster', 'agent-users', passportSpaceId],
    queryFn: async () => {
      const response = await apiClient.get<PassportResponse<AgentUser[]>>(`/users/agents?spaceId=${passportSpaceId}`);
      if (!response.success || !Array.isArray(response.data)) throw new Error(response.error?.message || t('aiChat.ui.passportLoadFailed'));
      return response.data;
    },
    enabled: canIssuePassport && !!passportSpaceId && !!agent.table_id,
  });
  const passportUser = passportUsers.data?.find(user => user.managed_by_agent_row_id === agent.id);
  const passportInFlight = useRef(false);
  const passport = useMutation({
    mutationFn: async () => {
      // Refresh before creating: another surface may already have created the account.
      const current = await passportUsers.refetch({ throwOnError: true });
      let user = current.data?.find(item => item.managed_by_agent_row_id === agent.id);
      if (!user) {
        const created = await apiClient.post<PassportResponse<AgentUser>>('/users/create-agent-user', { agentTableId: agent.table_id, agentRowId: agent.id });
        if (!created.success || !created.data?.id) throw new Error(created.error?.message || t('aiChat.ui.passportIssueFailed'));
        user = created.data;
      }
      if (user.handle) return user;
      const issued = await apiClient.post<PassportResponse<{ ok: boolean; handle: string }>>(`/users/${user.id}/passport`, {});
      if (!issued.success || !issued.data?.ok || !issued.data.handle) throw new Error(issued.error?.message || t('aiChat.ui.passportIssueFailed'));
      return { ...user, handle: issued.data.handle };
    },
    onSuccess: user => {
      client.setQueryData<AgentUser[]>(['agent-roster', 'agent-users', passportSpaceId], current => [
        ...(current ?? []).filter(item => item.managed_by_agent_row_id !== agent.id), user,
      ]);
      for (const key of ['users-for-mentions', 'chat-space-users', 'chat-all-users']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
      void loadAgents();
    },
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: ['agent-roster', 'agent-users'] }),
      client.invalidateQueries({ queryKey: ['passport-authority'] }),
    ]),
  });
  const [draft, setDraft] = useState<Partial<Fields>>({});
  const updateDraft = (changes: Partial<Fields>) => { setDraft(prev => ({ ...prev, ...changes })); onDirtyChange?.(true); };
  const row = useQuery({
    queryKey: ['agent-configuration', agent.table_id, agent.id],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: { row: { data: AgentData } }; error?: { message: string } }>(`/tables/${agent.table_id}/rows/${agent.id}`);
      if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.agentLoadFailed'));
      if (!response.data?.row?.data) throw new Error(t('aiChat.ui.agentLoadFailed'));
      return response.data.row.data;
    },
    enabled: !!agent.table_id,
  });
  const original: Fields = {
    name: row.data?.name ?? agent.name,
    slug: row.data?.slug ?? row.data?.agent_slug ?? passportUser?.handle ?? '',
    icon: row.data?.icon ?? agent.icon ?? '',
    color: row.data?.color ?? agent.color ?? '#3b82f6',
    operator_id: row.data?.operator_id ?? agent.operator_id ?? agent.provider_id ?? null,
    model: String(row.data?.model ?? agent.model ?? ''),
    crm_instructions: row.data?.crm_instructions ?? '',
    main_instructions: typeof row.data?.main_instructions === 'string' ? row.data.main_instructions : row.data?.main_instructions ? JSON.stringify(row.data.main_instructions, null, 2) : '',
  };
  const fields = { ...original, ...draft };
  const nameError = draft.name !== undefined && !fields.name.trim() ? t('aiChat.ui.agentNameRequired') : undefined;
  const slugError = draft.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.slug.trim()) ? t('aiChat.ui.agentSlugInvalid') : undefined;
  const models = useQuery({
    queryKey: ['ai-models', fields.operator_id, spaceId],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data?: { models: Array<{ id: number; name: string; model_id?: string }> } }>(`/ai/providers/${fields.operator_id}/models${spaceId ? `?spaceId=${spaceId}` : ''}`);
      if (!response.success) throw new Error(t('aiChat.ui.agentLoadFailed'));
      return response.data?.models ?? [];
    },
    enabled: !!fields.operator_id,
  });
  const selectedModel = models.data?.find(m => m.model_id === fields.model || String(m.id) === fields.model);
  const modelValue = selectedModel?.model_id || fields.model;
  const save = useMutation({ mutationFn: async () => {
    if (nameError || slugError) throw new Error(nameError || slugError);
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as Array<keyof Fields>) {
      const value = key === 'name' || key === 'slug' ? fields[key].trim() : draft[key];
      if (value !== original[key]) changes[key] = value;
    }
    if ('main_instructions' in changes && Array.isArray(row.data?.main_instructions)) {
      const parsed: unknown = JSON.parse(fields.main_instructions);
      if (!Array.isArray(parsed) || !parsed.every((item: unknown) => typeof item === 'string' || (item && typeof item === 'object' && 'content' in item && typeof item.content === 'string'))) throw new Error(t('aiChat.ui.instructionsArrayRequired'));
      changes.main_instructions = parsed;
    }
    // Identity requires one server transaction for the row and its passport.
    // Never fall back to the legacy endpoint: it silently ignores slug.
    const identityChanged = 'name' in changes || 'slug' in changes;
    const response = await apiClient.put<{ success: boolean; error?: { message: string } }>(
      `/ai/agents/${agent.id}${identityChanged ? '/configuration' : ''}`,
      identityChanged ? { data: changes } : changes,
    );
    if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.agentSaveFailed'));
  }, onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['agent-configuration', agent.table_id, agent.id] });
    for (const key of ['agent-roster', 'users-for-mentions', 'chat-space-users', 'chat-all-users', 'mention-agent-directory']) {
      void client.invalidateQueries({ queryKey: [key] });
    }
    setDraft({});
    onDirtyChange?.(false);
    void loadAgents();
  } });
  if (!agent.table_id || row.isError) return <div role="alert">{row.error?.message || t('aiChat.ui.agentLoadFailed')} <Button size="sm" variant="ghost" onClick={() => void row.refetch()}>{t('aiChat.ui.retry')}</Button></div>;
  if (row.isPending) return <p role="status">{t('aiChat.ui.loading')}</p>;
  const changed = (Object.keys(draft) as Array<keyof Fields>).some(key => draft[key] !== original[key]);
  return <fieldset disabled={disabled || save.isPending || passport.isPending} className="space-y-3 min-w-0 py-2">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="text-xs"><label htmlFor={`agent-operator-${agent.id}`}>{t('aiChat.ui.operator')}</label>
        <select id={`agent-operator-${agent.id}`} className={inputClass} value={fields.operator_id ?? ''} onChange={e => updateDraft({ operator_id: e.target.value ? Number(e.target.value) : null, model: '' })}>
          <option value="">{t('aiChat.ui.select')}</option>
          {fields.operator_id && !operators.some(op => op.id === fields.operator_id) && <option value={fields.operator_id}>{agent.provider_id === fields.operator_id ? agent.provider_name || fields.operator_id : fields.operator_id}</option>}
          {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
        </select>
      </div>
      <div className="text-xs"><label htmlFor={`agent-model-${agent.id}`}>{t('aiChat.ui.model')}</label>
        <select id={`agent-model-${agent.id}`} className={inputClass} value={modelValue} disabled={!fields.operator_id || models.isPending || models.isError} onChange={e => updateDraft({ model: e.target.value })}>
          <option value="">{t('aiChat.ui.select')}</option>
          {fields.model && !selectedModel && <option value={fields.model}>{String(agent.model_id) === fields.model || agent.model === fields.model ? agent.model_name || fields.model : fields.model}</option>}
          {models.data?.map(m => <option key={m.id} value={m.model_id || String(m.id)}>{m.name}</option>)}
        </select>
      </div>
    </div>
    {models.isError && <p role="alert">{models.error.message}</p>}
    {(['main_instructions', 'crm_instructions'] as const).map(key => <div key={key} className="text-xs">
      <label htmlFor={`agent-${agent.id}-${key}`} className="block">
      {t(key === 'crm_instructions' ? 'aiChat.ui.crmInstructions' : 'aiChat.ui.mainInstructions')}
      </label>
      <textarea id={`agent-${agent.id}-${key}`} className={inputClass} rows={5} value={fields[key]} onChange={e => updateDraft({ [key]: e.target.value })} />
    </div>)}
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 items-start">
      <div className="min-w-0 space-y-2">
        <div>
          <label htmlFor={`agent-icon-${agent.id}`} className="block text-xs mb-1">{t('aiChat.ui.avatarEmoji')}</label>
          <div className="flex items-center">
            <input id={`agent-icon-${agent.id}`} value={fields.icon} onChange={e => updateDraft({ icon: e.target.value })} className="w-12 h-10 text-center text-xl rounded-l-md border border-r-0 border-[var(--border-primary)] bg-[var(--bg-secondary)] focus-visible:ring-2" />
            {!disabled && !save.isPending && !passport.isPending && <div className="[&>div>button]:h-10 [&>div>button]:w-8 [&>div>button]:rounded-l-none [&>div>button]:rounded-r-md [&>div>button]:border-t [&>div>button]:opacity-100 [&>div>button]:focus-visible:ring-2"><EmojiPicker value={fields.icon} onChange={icon => updateDraft({ icon })} buttonOnly portal /></div>}
          </div>
        </div>
        <div>
          <label htmlFor={`agent-color-${agent.id}`} className="block text-xs mb-1">{t('aiChat.ui.avatarColor')}</label>
          <input id={`agent-color-${agent.id}`} type="color" value={fields.color} onChange={e => updateDraft({ color: e.target.value })} className="block h-10 w-20 cursor-pointer rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-1 focus-visible:ring-2 disabled:cursor-not-allowed" />
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <Input id={`agent-name-${agent.id}`} label={t('aiChat.ui.agentName')} value={fields.name} error={nameError}
          onChange={e => updateDraft({ name: e.target.value })} autoComplete="off" className="min-w-0 text-xs" />
        <Input id={`agent-slug-${agent.id}`} label={t('aiChat.ui.agentSlug')} value={fields.slug} error={slugError}
          aria-describedby={`agent-slug-${agent.id}-${slugError ? 'error' : 'hint'}`} onChange={e => updateDraft({ slug: e.target.value })}
          autoComplete="off" autoCapitalize="none" spellCheck={false} className="min-w-0 text-xs" />
        {!slugError && <p id={`agent-slug-${agent.id}-hint`} className="text-xs text-[var(--text-secondary)]">{t('aiChat.ui.agentSlugHint')}</p>}
      </div>
    </div>
    {!disabled && authority.hint && <div role={authority.isError ? 'alert' : 'status'} className="text-xs text-[var(--text-secondary)]">
      {authority.hint} {authority.isError && <Button type="button" size="sm" variant="ghost" onClick={() => void authority.refetch()}>{t('aiChat.ui.retry')}</Button>}
    </div>}
    {save.isError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{save.error.message}</p>}
    {canIssuePassport && passportUsers.isError && <div role="alert" className="text-xs text-red-700 dark:text-red-400">
      {passportUsers.error.message} <Button type="button" size="sm" variant="ghost" onClick={() => void passportUsers.refetch()}>{t('aiChat.ui.retry')}</Button>
    </div>}
    {canIssuePassport && !passportUser?.handle && passport.isError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{passport.error.message}</p>}
    {!disabled && <div className="flex items-center justify-between gap-3">
      {canIssuePassport && <Button type="button" variant="ghost" size="sm" className="h-10 w-10 shrink-0 p-0"
        aria-label={t(passportUser?.handle ? 'aiChat.ui.passportIssued' : 'aiChat.ui.issuePassport')}
        title={t(passportUser?.handle ? 'aiChat.ui.passportIssued' : 'aiChat.ui.issuePassport')}
        aria-busy={passport.isPending || passportUsers.isFetching}
        loading={passport.isPending || passportUsers.isFetching}
        disabled={!passportSpaceId || passportUsers.isPending || passportUsers.isError || !!passportUser?.handle || draft.name !== undefined || draft.slug !== undefined}
        onClick={() => {
          if (passportInFlight.current) return;
          passportInFlight.current = true;
          passport.mutate(undefined, { onSettled: () => { passportInFlight.current = false; } });
        }}>
        {passportUser?.handle ? <ShieldCheck size={18} aria-hidden="true" /> : <IdCard size={18} aria-hidden="true" />}
      </Button>}
      {canIssuePassport && passportUser?.handle && <span role="status" className="min-w-0 truncate text-xs text-[var(--text-secondary)]" title={`@${passportUser.handle}`}>@{passportUser.handle}</span>}
      <Button type="button" size="sm" className="ml-auto shrink-0 bg-[var(--color-primary-800)] hover:bg-[var(--color-primary-900)]" loading={save.isPending} disabled={!changed || !!nameError || !!slugError} onClick={() => save.mutate()}>{t('aiChat.ui.save')}</Button>
    </div>}
  </fieldset>;
}
