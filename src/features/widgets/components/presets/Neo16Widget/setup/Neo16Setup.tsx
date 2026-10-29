import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { Button } from '@/shared/components/ui/Button';
import { apiClient } from '@/shared/utils/apiClient';
import type { Widget } from '../../../../types/widget.types';
import { Neo16ApiError } from '../learning/types';
import { installNeo16, loadSetupContext, type SetupPlan } from './setup';

interface Props { widget: Widget; onInstalled: (widget: Widget) => void }

export function Neo16Setup(props: Props) {
  const user = useAuthStore((state) => state.user);
  const readOnly = useIsPublicReadOnly();
  if (readOnly || !user) return <p className="p-4" role="status">Для установки Neo16 войдите как владелец пространства.</p>;
  return <OwnerSetup key={props.widget.id} {...props} userId={user.id} />;
}

function OwnerSetup({ widget, onInstalled, userId }: Props & { userId: number | string }) {
  const client = useQueryClient();
  const context = useQuery({ queryKey: ['neo16-setup', widget.dashboard_id, userId],
    queryFn: () => loadSetupContext(widget.dashboard_id), retry: false });
  const projectLabel = useId();
  const [project, setProject] = useState('');
  const [plan, setPlan] = useState<SetupPlan>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [applied, setApplied] = useState(false);
  const lock = useRef(false);
  const projectId = context.data?.projectId ?? Number(project);

  async function refreshWidget() {
    const response = await apiClient.get<{ data: Widget }>(`/widgets/${widget.id}`);
    if (response.data.id !== widget.id || !response.data.config?.__module) {
      throw new Error('Установка завершена, но данные виджета ещё не обновились. Повторите загрузку.');
    }
    // Both full-page and dashboard consumers must receive the adopted config.
    client.setQueryData(['widget', widget.id], response.data);
    await client.invalidateQueries({ queryKey: ['widgets'] });
    await client.invalidateQueries({ queryKey: ['project-dashboard'] });
    onInstalled(response.data);
  }

  async function run(dryRun: boolean) {
    if (lock.current || !context.data?.isOwner || !projectId) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      if (applied) { await refreshWidget(); return; }
      const result = await installNeo16(widget.id, projectId, dryRun);
      if (dryRun) {
        if (!result.dry_run || result.plan.conflicts.length || result.plan.widgets.length !== 1 || !result.plan.widgets.some((item) =>
          item.widget_id === widget.id && item.dashboard_id === widget.dashboard_id && ['adopt', 'existing'].includes(item.action))) {
          throw new Error('План не соответствует этому виджету или содержит конфликты. Установка остановлена.');
        }
        setPlan(result);
      } else {
        setApplied(true);
        await refreshWidget();
      }
    } catch (error) {
      setPlan(undefined);
      setNotice(error instanceof Neo16ApiError && error.code === 'NPC_SETUP_INCOMPLETE'
        ? 'Город установлен, но создание NPC не завершено. Повторите просмотр и установку: данные и прогресс сохранятся.'
        : error instanceof Error ? error.message : 'Не удалось установить Neo16. Повторите попытку.');
    } finally { lock.current = false; setBusy(false); }
  }

  return <section aria-label="Установка Neo16" aria-busy={busy} className="flex h-full min-h-64 flex-col gap-4 overflow-auto p-4 text-[var(--text-primary)] bg-[var(--bg-primary)]">
    <h2 className="text-lg font-semibold">Установка Neo16</h2>
    <p>Подготовьте город и его жителей: Nora, Reed и Casey. Адрес виджета, настройки и существующие данные сохранятся.</p>
    {context.isPending && <p role="status">Проверяем доступ…</p>}
    {context.isError && <div role="alert"><p>Не удалось загрузить настройки установки.</p><Button variant="secondary" onClick={() => void context.refetch()}>Повторить загрузку</Button></div>}
    {context.data && !context.data.isOwner && <p role="status">Установить Neo16 может владелец пространства. Обратитесь к нему для подготовки города.</p>}
    {context.data?.isOwner && <>
      {!context.data.projectId && <div className="flex flex-col gap-2">
        <label htmlFor={projectLabel}>Проект для данных города</label>
        <select id={projectLabel} value={project} disabled={busy || applied} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2"
          onChange={(event) => { setProject(event.target.value); setPlan(undefined); setNotice(''); }}>
          <option value="">Выберите проект</option>
          {context.data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {!context.data.projects.length && <div><p>В пространстве нет доступных проектов. Создайте проект и повторите загрузку.</p>
          <Button variant="secondary" onClick={() => void context.refetch()}>Повторить загрузку</Button></div>}
      </div>}
      {notice && <p role="alert">{notice}</p>}
      {plan && <div role="status" className="space-y-2">
        <h3 className="font-semibold">Изменения перед установкой</h3>
        <p>Проект: {context.data.projects.find((item) => item.id === projectId)?.name}. Виджет №{widget.id} сохранится.</p>
        <ul className="list-disc pl-5">
          {[...plan.plan.tables, ...plan.npc_agents.tables].map((table) => <li key={table.name}>
            {table.name}: {table.action === 'create' ? 'создать таблицу' : 'использовать существующую'}; новых полей: {table.columns_added.length}.
          </li>)}
        </ul>
        <p>Жители: {plan.npc_agents.agents.map((agent) => `${agent.npc_key} (${agent.action === 'create' ? 'добавить' : 'уже есть'})`).join(', ')}.</p>
        <p>Оператор Codex: {plan.npc_agents.operator.action === 'create' ? 'добавить' : 'использовать существующий'}. Вызов ИИ начнётся только в диалоге.</p>
      </div>}
      <div><Button disabled={busy || !projectId} loading={busy} onClick={() => void run(!plan)}>
        {busy ? 'Подождите…' : applied ? 'Загрузить город' : plan ? 'Подтвердить установку' : 'Посмотреть изменения'}
      </Button></div>
    </>}
  </section>;
}
