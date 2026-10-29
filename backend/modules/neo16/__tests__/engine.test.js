// Neo16 W0 — engine port, no database. Proves the ported AI Town kernel runs
// one NPC command (moveTo) and that a serialize → JSON → restore round trip is
// lossless and resumes identically to an uninterrupted run.

import { describe, it, expect } from 'vitest';
import { Game, runStep } from '../engine/game.js';
import { makeState, NPC_PLAYER_ID, EAST_SIDE } from './fixtures.js';

const T0 = 1_000_000;
const STEP = 2_000; // ms of wall clock per step
const noRandom = () => 0.5;

function freshEngine() {
  return { generationNumber: 0 };
}

function moveInput(received = T0) {
  return { id: 'turn-1', number: 0, name: 'moveTo', args: { playerId: NPC_PLAYER_ID, destination: EAST_SIDE }, received };
}

function drive(game, engine, steps, inputsForStep) {
  let eng = engine;
  const completed = [];
  for (let i = 0; i < steps; i++) {
    const now = T0 + i * STEP;
    const res = runStep(game, eng, now, inputsForStep(i));
    eng = res.engine;
    completed.push(...res.completedInputs);
  }
  return { engine: eng, completed };
}

describe('Neo16 engine port (AI Town @ 8e05997f, no Convex)', () => {
  it('serialize() round-trips the initial state exactly', () => {
    const state = makeState();
    const game = new Game(state);
    expect(game.serialize()).toEqual(state);
    // and through a JSON string, which is what lands in table_rows.data
    const again = new Game(JSON.parse(JSON.stringify(game.serialize())));
    expect(again.serialize()).toEqual(state);
  });

  it('moveTo makes the NPC path around the wall and arrive on the east side', () => {
    const game = new Game(makeState(), { random: noRandom });
    const { engine, completed } = drive(game, freshEngine(), 20, (i) => (i === 0 ? [moveInput()] : []));

    expect(completed).toEqual([{ inputId: 'turn-1', returnValue: { kind: 'ok', value: null } }]);
    expect(engine.generationNumber).toBe(20);
    expect(engine.processedInputNumber).toBe(0);

    const npc = game.world.players.get(NPC_PLAYER_ID);
    expect(npc.position).toEqual(EAST_SIDE);
    expect(npc.pathfinding).toBeUndefined(); // arrived → pathfinding cleared
    expect(npc.speed).toBe(0);
  });

  it('the NPC never occupies a blocked tile while travelling', () => {
    const game = new Game(makeState(), { random: noRandom });
    let eng = freshEngine();
    for (let i = 0; i < 20; i++) {
      eng = runStep(game, eng, T0 + i * STEP, i === 0 ? [moveInput()] : []).engine;
      const { x, y } = game.world.players.get(NPC_PLAYER_ID).position;
      const blocked = Math.floor(x) === 5 && Math.floor(y) <= 7;
      expect(blocked, `blocked tile at step ${i}: ${x},${y}`).toBe(false);
    }
  });

  it('an input for an unknown player fails as a result, not a crash, and the step still commits', () => {
    const game = new Game(makeState(), { random: noRandom });
    const bad = { id: 'turn-x', number: 0, name: 'moveTo', args: { playerId: 'p:99', destination: EAST_SIDE }, received: T0 };
    const res = runStep(game, freshEngine(), T0, [bad]);
    expect(res.completedInputs).toEqual([
      { inputId: 'turn-x', returnValue: { kind: 'error', message: 'Invalid player ID p:99' } },
    ]);
    expect(res.engine.generationNumber).toBe(1);
    expect(game.serialize()).toEqual(makeState());
  });

  it('an unknown input name is rejected the same way', () => {
    const game = new Game(makeState(), { random: noRandom });
    const res = runStep(game, freshEngine(), T0, [{ id: 't', number: 0, name: 'teleport', args: {}, received: T0 }]);
    expect(res.completedInputs[0].returnValue).toEqual({ kind: 'error', message: 'Invalid input: teleport' });
  });

  it('an input received after the step window is left for a later step', () => {
    const game = new Game(makeState(), { random: noRandom });
    const late = moveInput(T0 + 5 * STEP);
    const res = runStep(game, freshEngine(), T0, [late]);
    expect(res.completedInputs).toEqual([]);
    expect(res.engine.processedInputNumber).toBeUndefined();
  });

  it('save mid-journey, restore from JSON, resume → identical to an uninterrupted run', () => {
    // Reference: one game, 20 steps, never serialized.
    const reference = new Game(makeState(), { random: noRandom });
    const ref = drive(reference, freshEngine(), 20, (i) => (i === 0 ? [moveInput()] : []));

    // Interrupted: run 7 steps, snapshot, throw the instance away, restore, run 13 more.
    const first = new Game(makeState(), { random: noRandom });
    const a = drive(first, freshEngine(), 7, (i) => (i === 0 ? [moveInput()] : []));
    const snapshot = JSON.parse(JSON.stringify({ state: first.serialize(), engine: a.engine }));
    const npcMid = snapshot.state.world.players[0];
    expect(npcMid.pathfinding?.state.kind).toBe('moving'); // we really did stop mid-walk
    expect(npcMid.position).not.toEqual({ x: 2, y: 2 });

    const restored = new Game(snapshot.state, { random: noRandom });
    let eng = snapshot.engine;
    for (let i = 7; i < 20; i++) {
      eng = runStep(restored, eng, T0 + i * STEP, []).engine;
    }

    expect(restored.serialize()).toEqual(reference.serialize());
    expect(eng).toEqual(ref.engine);
  });
});
