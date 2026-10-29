import { useEffect, useRef, useState } from 'react';
import { PALETTE } from '../types';
import type { Position, WorldPlayer, WorldView } from './types';

/** Bounded visual prediction only; interaction/proximity always uses server positions. */
export function positionAt(player: WorldPlayer, simulatedAt: number | null, elapsed: number): Position {
  const state = player.pathfinding?.state;
  if (simulatedAt === null || state?.kind !== 'moving' || !state.path?.length) return player.position;
  const time = simulatedAt + Math.min(1000, Math.max(0, elapsed));
  const path = state.path;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]; const b = path[i];
    if (time <= b[4]) {
      const fraction = b[4] > a[4] ? Math.max(0, (time - a[4]) / (b[4] - a[4])) : 1;
      return { x: a[0] + (b[0] - a[0]) * fraction, y: a[1] + (b[1] - a[1]) * fraction };
    }
  }
  return { x: path[path.length - 1][0], y: path[path.length - 1][1] };
}

export function TownMap({ world, disabled, onMove, onTalk }: {
  world: WorldView; disabled: boolean; onMove: (position: Position) => void; onTalk: (npcKey: string) => void;
}) {
  const map = world.snapshot.worldMap;
  const players = world.snapshot.world.players;
  const learner = players.find((p) => p.id === world.learner_player_id);
  const [cursor, setCursor] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const origin = performance.now();
    let frame: number;
    const animate = () => {
      const next = performance.now() - origin;
      setElapsed(Math.min(next, 1000));
      if (next < 1000) frame = requestAnimationFrame(animate);
    };
    setElapsed(0);
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [world]);
  const blocked = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height ||
    map.objectTiles.some((layer) => layer[x]?.[y] !== -1);

  return (
    <div className="relative mx-auto w-full max-w-xl border-4" style={{ aspectRatio: `${map.width}/${map.height}`, borderColor: PALETTE.darkWall }}>
      <div role="group" aria-label="Town map" className="grid h-full w-full"
        style={{ gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))` }}>
        {Array.from({ length: map.width * map.height }, (_, index) => {
          const x = index % map.width; const y = Math.floor(index / map.width); const wall = blocked(x, y);
          return <button key={index} type="button" ref={(el) => { tiles.current[index] = el; }}
            tabIndex={cursor === index ? 0 : -1} onFocus={() => setCursor(index)}
            aria-label={`${wall ? 'Blocked tile' : 'Move to'} ${x}, ${y}`} aria-disabled={wall || disabled}
            className="min-h-0 min-w-0 border border-black/10 hover:brightness-125 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={{ backgroundColor: wall ? PALETTE.midGrey : (x + y) % 2 ? PALETTE.forest : PALETTE.darkForest }}
            onClick={() => { if (!wall && !disabled) onMove({ x, y }); }}
            onKeyDown={(event) => {
              const shifts: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
              const shift = shifts[event.key];
              if (!shift) return;
              event.preventDefault(); event.stopPropagation();
              const nx = Math.max(0, Math.min(map.width - 1, x + shift.x));
              const ny = Math.max(0, Math.min(map.height - 1, y + shift.y));
              tiles.current[ny * map.width + nx]?.focus();
            }} />;
        })}
      </div>
      {players.map((player) => {
        const npc = world.npcs.find((n) => n.player_id === player.id);
        const isLearner = player.id === world.learner_player_id;
        const pos = positionAt(player, world.simulated_at, elapsed);
        const near = learner && Math.hypot(learner.position.x - player.position.x, learner.position.y - player.position.y) <= 1.5;
        const name = isLearner ? 'You' : npc?.name ?? world.snapshot.playerDescriptions.find((p) => p.playerId === player.id)?.name ?? 'Resident';
        return <div key={player.id} className="pointer-events-none absolute flex items-center justify-center"
          style={{ left: `${pos.x / map.width * 100}%`, top: `${pos.y / map.height * 100}%`, width: `${100 / map.width}%`, height: `${100 / map.height}%` }}>
          {npc ? <button type="button" aria-label={`${near ? 'Talk to' : 'Approach'} ${name}`} disabled={disabled}
            className="pointer-events-auto flex h-full w-full items-center justify-center border-2 text-xs font-bold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={{ backgroundColor: PALETTE.peach, color: PALETTE.deepNight, borderColor: PALETTE.deepNight }}
            title={`${name}${player.activity ? ` · ${player.activity.description}` : ''}`}
            onClick={() => {
              if (near) { onTalk(npc.npc_key); return; }
              const x = Math.round(player.position.x); const y = Math.round(player.position.y);
              const candidates = [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }]
                .filter((p) => !blocked(p.x, p.y) && !players.some((other) => other.id !== learner?.id && Math.hypot(other.position.x - p.x, other.position.y - p.y) < 0.75))
                .sort((a, b) => Math.hypot(a.x - (learner?.position.x ?? 0), a.y - (learner?.position.y ?? 0)) - Math.hypot(b.x - (learner?.position.x ?? 0), b.y - (learner?.position.y ?? 0)));
              if (candidates[0]) onMove(candidates[0]);
            }}>{name[0]}</button> : <span aria-label={name} className="flex h-3/4 w-3/4 items-center justify-center border-2 text-xs font-bold"
              style={{ backgroundColor: PALETTE.cyan, color: PALETTE.deepNight, borderColor: PALETTE.deepNight }}>●</span>}
        </div>;
      })}
    </div>
  );
}
