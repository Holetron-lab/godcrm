import { useEffect, useId, useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import type { useConversationSpace } from '../hooks/useConversationSpace';

type Binding = ReturnType<typeof useConversationSpace>;
const hint = 'Новые файлы будут сохраняться в выбранном Space. Ранее загруженные останутся в прежнем.';

export function ConversationSpaceSetting({ binding }: { binding: Binding }) {
  const spaces = useSpacesQuery();
  const id = binding.conversation?.space_id;
  return <section className="space-y-2 border-t border-[var(--border-secondary)] pt-2 text-xs">
    <h4 className="font-medium">Space чата</h4>
    <p>{binding.loading ? 'Загрузка…' : binding.loadError ? 'Не удалось загрузить Space чата.' : id ? `${spaces.data?.find(space => space.id === id)?.name || 'Space'} #${id}` : 'Не выбран'}</p>
    <p className="text-[var(--text-tertiary)]">{hint}</p>
    {binding.restriction && <p>{binding.restriction}</p>}
    {binding.loadError ? <Button size="sm" onClick={() => void binding.retryMetadata()}>Повторить</Button>
      : <Button size="sm" disabled={binding.loading || !!binding.restriction} onClick={() => void binding.openSettings()}>Выбрать Space</Button>}
    {!binding.dialogOpen && binding.error && <p role="alert">{binding.error}</p>}
  </section>;
}

export function ConversationSpaceDialog({ binding, userId }: { binding: Binding; userId?: number }) {
  const spaces = useSpacesQuery();
  const [selected, setSelected] = useState('');
  const selectId = useId();
  useEffect(() => {
    if (binding.dialogOpen) setSelected(String(binding.conversation?.space_id ?? ''));
  }, [binding.dialogOpen, binding.conversation?.id, binding.conversation?.space_id]);
  const eligible = (spaces.data || []).filter(space => space.owner_id === userId || space.user_access_level === 'owner' || space.user_access_level === 'admin');
  return <Modal open={binding.dialogOpen} onOpenChange={open => { if (!open) binding.cancel(); }} title="Space чата" description={hint} size="sm" restoreFocus
    secondaryAction={{ label: 'Отмена', onClick: binding.cancel }}
    primaryAction={{ label: binding.saving ? 'Сохранение…' : 'Сохранить', disabled: binding.saving || !eligible.some(space => space.id === Number(selected)), onClick: () => void binding.save(Number(selected)) }}>
    {spaces.isPending ? <p role="status">Загрузка Spaces…</p> : spaces.isError ? <div role="alert">Не удалось загрузить Spaces. <Button onClick={() => void spaces.refetch()}>Повторить</Button></div>
      : eligible.length === 0 ? <p>Нет доступных Spaces. Нужны права владельца или администратора Space.</p>
      : <><label htmlFor={selectId} className="block mb-2 text-sm">Выберите Space</label><select id={selectId} value={selected} disabled={binding.saving} onChange={event => setSelected(event.target.value)} className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 text-sm">
        <option value="">Не выбран</option>
        {eligible.map(space => <option key={space.id} value={space.id}>{space.icon} {space.name} #{space.id}</option>)}
      </select></>}
    {binding.error && <p role="alert" className="mt-3 text-sm text-red-500">{binding.error}</p>}
  </Modal>;
}
