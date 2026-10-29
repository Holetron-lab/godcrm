// Neo16 W0 — port of AI Town `convex/aiTown/game.ts` (Game) and
// `convex/engine/abstractGame.ts` (runStep), with the Convex boundary removed.
// Upstream: a16z-infra/ai-town @ 8e05997f2409275669c8344b84a51692e83f3f33 (MIT).
//
// Patch inventory:
//   - Game no longer extends AbstractGame nor holds a Convex `engine` doc. The
//     engine record ({ currentTime, lastStepTs, processedInputNumber,
//     generationNumber }) is a plain object owned by the store (crmWorldStore.js)
//     and threaded through `runStep` as data.
//   - `runStep` is a pure function: (game, engine, now, inputs) → { engine,
//     completedInputs }. Loading inputs and persisting the result are the
//     store's job, so the simulation can be unit-tested without a database.
//   - Only the `moveTo` input is ported (the W0 "one NPC command"). The input
//     table is a plain object so W2 can add conversation/agent inputs.
//   - Tuning constants live on the Game instance so tests can pin them, and
//     `random` is injectable (upstream used Math.random for collision backoff).
//   - historicalLocations / HistoricalObject packing dropped (see world.js).

import { World, WorldMap, PlayerDescription, AgentDescription, parseMap, serializeMap, parseGameId, allocGameId } from './world.js';
import { movePlayer, stopPlayer } from './movement.js';

export const INPUTS = {
  heartbeat: (game, now, args) => {
    const player = game.world.players.get(parseGameId('players', args.playerId));
    if (!player) throw new Error(`Invalid player ID ${args.playerId}`);
    player.lastInput = now;
    return null;
  },
  moveTo: (game, now, args) => {
    const playerId = parseGameId('players', args.playerId);
    const player = game.world.players.get(playerId);
    if (!player) {
      throw new Error(`Invalid player ID ${playerId}`);
    }
    if (args.destination) {
      movePlayer(game, now, player, args.destination);
    } else {
      stopPlayer(player);
    }
    return null;
  },
};

export class Game {
  tickDuration = 16;
  stepDuration = 1000;
  maxTicksPerStep = 600;
  maxInputsPerStep = 32;

  // Upstream constants (convex/constants.ts, data/characters.ts).
  pathfindingTimeout = 60 * 1000;
  pathfindingBackoff = 1000;
  collisionThreshold = 0.75;
  maxPathfindsPerStep = 16;
  movementSpeed = 0.75;

  /**
   * @param {{world, playerDescriptions, agentDescriptions, worldMap}} state serialized GameState
   * @param {{random?: () => number}} [opts]
   */
  constructor(state, { random = Math.random } = {}) {
    this.world = new World(state.world);
    this.worldMap = new WorldMap(state.worldMap);
    this.playerDescriptions = parseMap(state.playerDescriptions ?? [], PlayerDescription, (p) => p.playerId);
    this.agentDescriptions = parseMap(state.agentDescriptions ?? [], AgentDescription, (a) => a.agentId);
    this.random = random;
    this.numPathfinds = 0;
  }

  allocId(idType) {
    const id = allocGameId(idType, this.world.nextId);
    this.world.nextId += 1;
    return id;
  }

  handleInput(now, name, args) {
    const handler = INPUTS[name];
    if (!handler) {
      throw new Error(`Invalid input: ${name}`);
    }
    return handler(this, now, args);
  }

  beginStep(_now) {
    this.numPathfinds = 0;
  }

  tick(now) {
    for (const player of this.world.players.values()) player.tick(this, now);
    for (const player of this.world.players.values()) player.tickPathfinding(this, now);
    for (const player of this.world.players.values()) player.tickPosition(this, now);
    for (const agent of this.world.agents.values()) agent.tick(this, now);
  }

  serialize() {
    return {
      world: this.world.serialize(),
      playerDescriptions: serializeMap(this.playerDescriptions),
      agentDescriptions: serializeMap(this.agentDescriptions),
      worldMap: this.worldMap.serialize(),
    };
  }
}

/**
 * Advance `game` from the engine's `currentTime` towards `now`, feeding queued
 * inputs to the ticks whose simulated time has reached their `received` stamp.
 * Mirrors AbstractGame.runStep; the caller persists what comes back.
 *
 * @param {Game} game
 * @param {{currentTime?: number, lastStepTs?: number, processedInputNumber?: number, generationNumber: number}} engine
 * @param {number} now  wall-clock ms the step is allowed to simulate up to
 * @param {Array<{id: any, number: number, name: string, args: object, received: number}>} inputs
 *        pending inputs ordered by `number`, at most game.maxInputsPerStep
 * @returns {{engine: object, completedInputs: Array<{inputId: any, returnValue: object}>, simulated: {from: number, to: number}}}
 */
export function runStep(game, engine, now, inputs) {
  const lastStepTs = engine.currentTime;
  const startTs = lastStepTs == null ? now : Math.max(lastStepTs, Math.min(lastStepTs + game.tickDuration, now));
  let currentTs = startTs;
  let inputIndex = 0;
  let numTicks = 0;
  let processedInputNumber = engine.processedInputNumber;
  const completedInputs = [];

  game.beginStep(currentTs);

  while (numTicks < game.maxTicksPerStep) {
    numTicks += 1;

    const tickInputs = [];
    while (inputIndex < inputs.length) {
      const input = inputs[inputIndex];
      if (input.received > currentTs) {
        break;
      }
      inputIndex += 1;
      processedInputNumber = input.number;
      tickInputs.push(input);
    }

    for (const input of tickInputs) {
      let returnValue;
      try {
        const value = game.handleInput(currentTs, input.name, input.args);
        returnValue = { kind: 'ok', value };
      } catch (e) {
        returnValue = { kind: 'error', message: e.message };
      }
      completedInputs.push({ inputId: input.id, returnValue });
    }

    game.tick(currentTs);

    const candidateTs = currentTs + game.tickDuration;
    if (now < candidateTs) {
      break;
    }
    currentTs = candidateTs;
  }

  return {
    engine: {
      ...engine,
      currentTime: currentTs,
      lastStepTs,
      processedInputNumber,
      generationNumber: engine.generationNumber + 1,
    },
    completedInputs,
    simulated: { from: startTs, to: currentTs },
  };
}
