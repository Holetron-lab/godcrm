import { useRef, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import type { PresetWidgetProps } from '../../../../types/widget.types';
import { Neo16Setup } from '../setup/Neo16Setup';
import { LearningPanel } from '../learning/LearningPanel';
import { readQuestConfig } from '../learning/questConfig';
import { PALETTE } from '../types';
import { TownMap } from './TownMap';
import { useWorld } from './useWorld';

/** Installed worlds never mount the legacy game loop or its public Socket.IO room. */
export function Neo16ModuleWidget(props: PresetWidgetProps) {
  const [refreshed, setRefreshed] = useState<PresetWidgetProps['widget']>();
  const [setup, setSetup] = useState(false);
  const widget = refreshed?.id === props.widget.id ? refreshed : props.widget;
  const config = (widget.config ?? {}) as Record<string, unknown>;
  if (setup || typeof config.__module !== 'object' || config.__module === null) {
    return <div className="flex h-full flex-col">
      {setup && <Button variant="ghost" onClick={() => setSetup(false)}>Вернуться в город</Button>}
      <Neo16Setup widget={widget} onInstalled={(updated) => { setRefreshed(updated); setSetup(false); }} />
    </div>;
  }
  return <div className="flex h-full flex-col">
    <div><Button size="sm" variant="ghost" onClick={() => setSetup(true)}>Настройка Neo16</Button></div>
    <TownWidget key={widget.id} {...props} widget={widget} />
  </div>;
}

export function TownWidget({ widget }: PresetWidgetProps) {
  const world = useWorld(widget.id);
  const [selectedNpcKey, setSelectedNpcKey] = useState<string>();
  const questButton = useRef<HTMLButtonElement>(null);
  const questPanel = useRef<HTMLDialogElement>(null);
  const quest = readQuestConfig(widget.config);
  const learner = world.world?.snapshot.world.players.find((p) => p.id === world.world?.learner_player_id);
  const openQuest = (npcKey?: string) => {
    setSelectedNpcKey(npcKey);
    questPanel.current?.showModal();
  };
  return (
    <section aria-label="Neo16 town" className="relative flex h-full min-h-96 w-full flex-col overflow-auto font-mono"
      style={{ backgroundColor: PALETTE.deepNight, color: PALETTE.pale }}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3" style={{ borderColor: PALETTE.darkWall }}>
        <h2 className="text-sm font-bold" style={{ color: PALETTE.cyan }}>Neo16 · Town</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs" aria-label="Your position">{learner ? `You · ${learner.position.x.toFixed(1)}, ${learner.position.y.toFixed(1)}` : 'Entering town…'}</span>
          <Button ref={questButton} size="sm" variant="secondary" disabled={!world.world} onClick={() => openQuest()}>Quest</Button>
        </div>
      </header>
      {world.notice && <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-sm">
        <span>{world.notice}</span><Button size="sm" variant="secondary" disabled={world.busy} onClick={() => void world.retry()}>Retry</Button>
      </div>}
      {!world.world && !world.notice && <p role="status" className="p-4 text-sm">Loading your town…</p>}
      {world.world && <div className="flex-1 space-y-3 p-3">
        <p className="text-xs">Choose a tile to walk. Arrow keys select a tile; Enter moves. Select a resident to approach, then talk.</p>
        <TownMap world={world.world} disabled={world.busy || world.pending} onMove={(destination) => void world.move(destination)} onTalk={openQuest} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>You ● · {world.world.npcs.map((npc) => `${npc.name[0]} ${npc.name}`).join(' · ') || 'No residents here yet.'}</span>
          <Button size="sm" variant="secondary" disabled={world.busy || world.pending} onClick={() => void world.move(null)}>Stop walking</Button>
        </div>
      </div>}
      {world.world && <dialog ref={questPanel} aria-label="Quest conversation"
        className="fixed m-auto h-[min(90dvh,720px)] w-[min(100vw,420px)] max-w-full border-0 p-0 backdrop:bg-black/60"
        style={{ backgroundColor: PALETTE.deepNight }} onClose={() => questButton.current?.focus()}>
        <LearningPanel widgetId={widget.id} {...quest} restoreSession selectedNpcKey={selectedNpcKey} width={420}
          onClose={() => questPanel.current?.close()} />
      </dialog>}
    </section>
  );
}
