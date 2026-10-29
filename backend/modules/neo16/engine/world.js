// Neo16 W0 — port of AI Town `convex/aiTown/{ids,player,agent,world,worldMap,
// playerDescription,agentDescription}.ts` + `convex/util/object.ts`.
// Upstream: a16z-infra/ai-town @ 8e05997f2409275669c8344b84a51692e83f3f33 (MIT).
//
// Patch inventory (W0 scope = "one NPC command + durable save/restore"):
//   - `convex/values` validators and TS types removed; shapes are documented inline.
//   - Player.tick: the human-idle auto-leave is dropped (no human session here yet).
//   - Agent.tick: upstream schedules LLM operations (agentDoSomething,
//     agentRememberConversation). W0 carries the Agent record through
//     save/restore. Active learner worlds now run the synchronous activity/wander
//     subset; learning dialogue uses the CRM evaluator outside simulation locks.
//   - Conversations are carried as opaque serialized records (no Conversation
//     class); nothing in W0 ticks or mutates them.
//   - historicalLocations (per-tick movement history buffers) are dropped —
//     the client interpolates from the saved path instead.

import { pathPosition, pointsEqual, distance } from './geometry.js';
import { findRoute, blocked, stopPlayer, movePlayer } from './movement.js';

// ── ids ───────────────────────────────────────────────────────────────────
const ID_SHORT_CODES = { agents: 'a', conversations: 'c', players: 'p', operations: 'o' };

export function parseGameId(idType, gameId) {
  const type = gameId[0];
  const match = Object.entries(ID_SHORT_CODES).find(([, value]) => value === type);
  if (!match || match[0] !== idType) {
    throw new Error(`Invalid game ID type: ${type}`);
  }
  const number = parseInt(gameId.slice(2), 10);
  if (isNaN(number) || !Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid game ID number: ${gameId}`);
  }
  return gameId;
}

export function allocGameId(idType, idNumber) {
  const type = ID_SHORT_CODES[idType];
  if (!type) {
    throw new Error(`Invalid game ID type: ${idType}`);
  }
  return `${type}:${idNumber}`;
}

// ── util/object ───────────────────────────────────────────────────────────
export function parseMap(records, Ctor, getId) {
  const out = new Map();
  for (const record of records) {
    const parsed = new Ctor(record);
    const id = getId(parsed);
    if (out.has(id)) {
      throw new Error(`Duplicate ID ${id}`);
    }
    out.set(id, parsed);
  }
  return out;
}

export function serializeMap(map) {
  return [...map.values()].map((v) => v.serialize());
}

// ── Player ────────────────────────────────────────────────────────────────
// serialized: { id, human?, pathfinding?, activity?, lastInput, position{x,y},
//               facing{dx,dy}, speed }
export class Player {
  constructor(serialized) {
    const { id, human, pathfinding, activity, lastInput, position, facing, speed } = serialized;
    this.id = parseGameId('players', id);
    this.human = human;
    this.pathfinding = pathfinding;
    this.activity = activity;
    this.lastInput = lastInput;
    this.position = position;
    this.facing = facing;
    this.speed = speed;
  }

  tick(_game, _now) {
    // ponytail: human idle auto-leave (HUMAN_IDLE_TOO_LONG) deferred to W2.
  }

  tickPathfinding(game, now) {
    const { pathfinding, position } = this;
    if (!pathfinding) {
      return;
    }
    if (pathfinding.state.kind === 'moving' && pointsEqual(pathfinding.destination, position)) {
      stopPlayer(this);
    }
    if (pathfinding.started + game.pathfindingTimeout < now) {
      stopPlayer(this);
    }
    if (pathfinding.state.kind === 'waiting' && pathfinding.state.until < now) {
      pathfinding.state = { kind: 'needsPath' };
    }
    if (pathfinding.state.kind === 'needsPath' && game.numPathfinds < game.maxPathfindsPerStep) {
      game.numPathfinds++;
      const route = findRoute(game, now, this, pathfinding.destination);
      if (route === null) {
        stopPlayer(this);
      } else {
        if (route.newDestination) {
          pathfinding.destination = route.newDestination;
        }
        pathfinding.state = { kind: 'moving', path: route.path };
      }
    }
  }

  tickPosition(game, now) {
    if (!this.pathfinding || this.pathfinding.state.kind !== 'moving') {
      this.speed = 0;
      return;
    }
    const candidate = pathPosition(this.pathfinding.state.path, now);
    if (!candidate) {
      return;
    }
    const { position, facing, velocity } = candidate;
    const collisionReason = blocked(game, now, position, this.id);
    if (collisionReason !== null) {
      const backoff = game.random() * game.pathfindingBackoff;
      this.pathfinding.state = { kind: 'waiting', until: now + backoff };
      return;
    }
    this.position = position;
    this.facing = facing;
    this.speed = velocity;
  }

  serialize() {
    const { id, human, pathfinding, activity, lastInput, position, facing, speed } = this;
    return { id, human, pathfinding, activity, lastInput, position, facing, speed };
  }
}

// ── Agent (NPC) ───────────────────────────────────────────────────────────
// serialized: { id, playerId, toRemember?, lastConversation?, lastInviteAttempt?,
//               inProgressOperation?{name, operationId, started} }
export class Agent {
  constructor(serialized) {
    const { id, lastConversation, lastInviteAttempt, inProgressOperation } = serialized;
    this.id = parseGameId('agents', id);
    this.playerId = parseGameId('players', serialized.playerId);
    this.toRemember =
      serialized.toRemember !== undefined
        ? parseGameId('conversations', serialized.toRemember)
        : undefined;
    this.lastConversation = lastConversation;
    this.lastInviteAttempt = lastInviteAttempt;
    this.inProgressOperation = inProgressOperation;
  }

  tick(game, now) {
    const player = game.world.players.get(this.playerId);
    if (!player) throw new Error(`Invalid player ID ${this.playerId}`);
    const learner = [...game.world.players.values()].find((p) => p.human);
    if (!learner) return;
    // Port the activity/wander branch of upstream agentDoSomething into the
    // bounded synchronous step. Dialogue still uses the CRM agent evaluator.
    const separation = distance(player.position, learner.position);
    if (separation <= 1.5) {
      stopPlayer(player);
      if (separation > 0) player.facing = {
        dx: (learner.position.x - player.position.x) / separation,
        dy: (learner.position.y - player.position.y) / separation,
      };
      return;
    }
    if (player.pathfinding || (player.activity && player.activity.until > now)) return;
    if (!player.activity) {
      player.activity = { description: game.agentDescriptions.get(this.id)?.plan ?? 'Taking a break', until: now + 5000 };
      return;
    }
    delete player.activity;
    // Bounded sampling; pathfinding and collision handling are the ported engine.
    for (let attempt = 0; attempt < 8; attempt++) {
      const destination = {
        x: 1 + Math.floor(game.random() * (game.worldMap.width - 2)),
        y: 1 + Math.floor(game.random() * (game.worldMap.height - 2)),
      };
      if (!pointsEqual(player.position, destination) && !blocked(game, now, destination, player.id)) {
        movePlayer(game, now, player, destination);
        return;
      }
    }
  }

  serialize() {
    const { id, playerId, toRemember, lastConversation, lastInviteAttempt, inProgressOperation } =
      this;
    return { id, playerId, toRemember, lastConversation, lastInviteAttempt, inProgressOperation };
  }
}

// ── Descriptions ──────────────────────────────────────────────────────────
export class PlayerDescription {
  constructor({ playerId, name, description, character }) {
    this.playerId = parseGameId('players', playerId);
    this.name = name;
    this.description = description;
    this.character = character;
  }
  serialize() {
    const { playerId, name, description, character } = this;
    return { playerId, name, description, character };
  }
}

export class AgentDescription {
  constructor({ agentId, identity, plan }) {
    this.agentId = parseGameId('agents', agentId);
    this.identity = identity;
    this.plan = plan;
  }
  serialize() {
    const { agentId, identity, plan } = this;
    return { agentId, identity, plan };
  }
}

// ── WorldMap ──────────────────────────────────────────────────────────────
// serialized: { width, height, tileSetUrl, tileSetDimX, tileSetDimY, tileDim,
//               bgTiles: number[][][], objectTiles: number[][][], animatedSprites[] }
// `objectTiles[layer][x][y]` is a tile index or -1 if empty (upstream convention).
export class WorldMap {
  constructor(serialized) {
    Object.assign(this, serialized);
  }
  serialize() {
    const {
      width, height, tileSetUrl, tileSetDimX, tileSetDimY, tileDim, bgTiles, objectTiles,
      animatedSprites,
    } = this;
    return {
      width, height, tileSetUrl, tileSetDimX, tileSetDimY, tileDim, bgTiles, objectTiles,
      animatedSprites,
    };
  }
}

// ── World ─────────────────────────────────────────────────────────────────
// serialized: { nextId, conversations[], players[], agents[] }
export class World {
  constructor(serialized) {
    this.nextId = serialized.nextId;
    this.conversations = serialized.conversations ?? [];
    this.players = parseMap(serialized.players, Player, (p) => p.id);
    this.agents = parseMap(serialized.agents, Agent, (a) => a.id);
  }

  serialize() {
    return {
      nextId: this.nextId,
      conversations: this.conversations,
      players: serializeMap(this.players),
      agents: serializeMap(this.agents),
    };
  }
}
