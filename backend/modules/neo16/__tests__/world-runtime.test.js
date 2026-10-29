import { describe, it, expect } from 'vitest';
import { Game, runStep } from '../engine/game.js';
import { defaultTownState } from '../content/town.js';

const T0 = 1_700_000_000_000;
function town() {
  const state = defaultTownState();
  state.world.players.push({ id: 'p:4', human: 'learner', lastInput: 0,
    position: { x: 1, y: 1 }, facing: { dx: 1, dy: 0 }, speed: 0 });
  return new Game(state, { random: () => 0.35 });
}

describe('active learner world simulation', () => {
  it('NPC alternates an activity and walking, retaining behavior across restore', () => {
    const game = town();
    let engine = runStep(game, { generationNumber: 0 }, T0, []).engine;
    expect(game.world.players.get('p:1').activity?.until).toBeGreaterThan(T0);
    const restored = new Game(JSON.parse(JSON.stringify(game.serialize())), { random: () => 0.35 });
    for (let i = 1; i <= 15; i++) {
      engine = runStep(restored, engine, T0 + i * 1000, []).engine;
    }
    expect(restored.world.players.get('p:1').position).not.toEqual({ x: 3, y: 3 });
    expect(restored.world.players.get('p:1').position.x).toBeGreaterThanOrEqual(0);
  });

  it('NPC stops and faces a nearby learner instead of walking away during dialogue', () => {
    const game = town();
    const learner = game.world.players.get('p:4');
    learner.position = { x: 2, y: 3 };
    const npc = game.world.players.get('p:1');
    npc.pathfinding = { destination: { x: 6, y: 3 }, started: T0, state: { kind: 'needsPath' } };
    runStep(game, { generationNumber: 0 }, T0, []);
    expect(npc.pathfinding).toBeUndefined();
    expect(npc.facing).toEqual({ dx: -1, dy: 0 });
  });

  it('repeated ticks at the same wall time cannot accelerate the world into the future', () => {
    const game = town();
    const first = runStep(game, { generationNumber: 0 }, T0, []);
    const second = runStep(game, first.engine, T0, []);
    expect(second.engine.currentTime).toBe(T0);
    expect(runStep(game, second.engine, T0 - 100, []).engine.currentTime).toBe(T0);
  });
});
