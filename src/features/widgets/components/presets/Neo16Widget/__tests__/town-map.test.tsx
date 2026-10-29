import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TownMap, positionAt } from '../town/TownMap';
import type { WorldPlayer, WorldView } from '../town/types';

const world: WorldView = {
  world_id: 1, state_version: 10, learner_player_id: 'learner-from-api', simulated_at: 1000,
  npcs: [{ npc_key: 'reed', player_id: 'npc-id', name: 'Reed' }],
  snapshot: {
    worldMap: { width: 4, height: 4, tileDim: 32, bgTiles: [], objectTiles: [[[-1, -1, -1, -1], [-1, 1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]] },
    playerDescriptions: [], world: { agents: [], players: [
      { id: 'learner-from-api', position: { x: 0, y: 0 }, facing: { dx: 1, dy: 0 }, speed: 0 },
      { id: 'npc-id', position: { x: 3, y: 3 }, facing: { dx: 1, dy: 0 }, speed: 0 },
    ] },
  },
};
it('blocks walls, supports keyboard destinations and maps the nearby player to npc_key', () => {
  const move = vi.fn(); const talk = vi.fn();
  const page = render(<TownMap world={world} disabled={false} onMove={move} onTalk={talk} />);
  fireEvent.click(screen.getByLabelText('Blocked tile 1, 1'));
  expect(move).not.toHaveBeenCalled();
  const tile = screen.getByLabelText('Move to 0, 0');
  tile.focus();
  fireEvent.keyDown(tile, { key: 'ArrowRight' });
  expect(screen.getByLabelText('Move to 1, 0')).toHaveFocus();
  fireEvent.click(screen.getByLabelText('Move to 1, 0'));
  expect(move).toHaveBeenLastCalledWith({ x: 1, y: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Approach Reed' }));
  expect(talk).not.toHaveBeenCalled();
  const nearby = structuredClone(world);
  nearby.snapshot.world.players[0].position = { x: 2, y: 3 };
  page.rerender(<TownMap world={nearby} disabled={false} onMove={move} onTalk={talk} />);
  fireEvent.click(screen.getByRole('button', { name: 'Talk to Reed' }));
  expect(talk).toHaveBeenCalledWith('reed');
});
it('interpolates on logical time and caps prediction at one heartbeat after a long idle', () => {
  const player: WorldPlayer = { id: 'p', position: { x: 0, y: 0 }, facing: { dx: 1, dy: 0 }, speed: 1,
    pathfinding: { state: { kind: 'moving', path: [[0, 0, 1, 0, 1000], [4, 0, 1, 0, 3000]] } } };
  expect(positionAt(player, 1000, 500)).toEqual({ x: 1, y: 0 });
  expect(positionAt(player, 1000, 86_400_000)).toEqual({ x: 2, y: 0 });
  expect(positionAt(player, null, 500)).toEqual(player.position);
});
