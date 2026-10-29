// Neo16 W0 — port of AI Town `convex/aiTown/movement.ts`.
// Upstream: a16z-infra/ai-town @ 8e05997f2409275669c8344b84a51692e83f3f33 (MIT).
// Patch inventory:
//   - `movementSpeed` (data/characters.ts) and COLLISION_THRESHOLD (constants.ts)
//     are read from `game` so a world carries its own tuning instead of a global.
//   - movePlayer: the "can't move while in a conversation" guard is dropped —
//     conversations are carried as opaque state in W0 (see world.js).
//   - console.* diagnostics removed; the callers surface outcomes as input results.

import { compressPath, distance, manhattanDistance, pointsEqual } from './geometry.js';
import { MinHeap } from './minheap.js';

export function stopPlayer(player) {
  delete player.pathfinding;
  player.speed = 0;
}

export function movePlayer(game, now, player, destination) {
  if (Math.floor(destination.x) !== destination.x || Math.floor(destination.y) !== destination.y) {
    throw new Error(`Non-integral destination: ${JSON.stringify(destination)}`);
  }
  if (pointsEqual(player.position, destination)) {
    return;
  }
  player.pathfinding = { destination, started: now, state: { kind: 'needsPath' } };
}

export function findRoute(game, now, player, destination) {
  const minDistances = [];
  const explore = (current) => {
    const { x, y } = current.position;
    const neighbors = [];
    // Off-grid: first step horizontally/vertically back onto a grid point.
    if (x !== Math.floor(x)) {
      neighbors.push(
        { position: { x: Math.floor(x), y }, facing: { dx: -1, dy: 0 } },
        { position: { x: Math.floor(x) + 1, y }, facing: { dx: 1, dy: 0 } },
      );
    }
    if (y !== Math.floor(y)) {
      neighbors.push(
        { position: { x, y: Math.floor(y) }, facing: { dx: 0, dy: -1 } },
        { position: { x, y: Math.floor(y) + 1 }, facing: { dx: 0, dy: 1 } },
      );
    }
    if (x == Math.floor(x) && y == Math.floor(y)) {
      neighbors.push(
        { position: { x: x + 1, y }, facing: { dx: 1, dy: 0 } },
        { position: { x: x - 1, y }, facing: { dx: -1, dy: 0 } },
        { position: { x, y: y + 1 }, facing: { dx: 0, dy: 1 } },
        { position: { x, y: y - 1 }, facing: { dx: 0, dy: -1 } },
      );
    }
    const next = [];
    for (const { position, facing } of neighbors) {
      const segmentLength = distance(current.position, position);
      const length = current.length + segmentLength;
      if (blocked(game, now, position, player.id)) {
        continue;
      }
      const remaining = manhattanDistance(position, destination);
      const path = {
        position,
        facing,
        // Movement speed is in tiles per second.
        t: current.t + (segmentLength / game.movementSpeed) * 1000,
        length,
        cost: length + remaining,
        prev: current,
      };
      const existingMin = minDistances[position.y]?.[position.x];
      if (existingMin && existingMin.cost <= path.cost) {
        continue;
      }
      minDistances[position.y] ??= [];
      minDistances[position.y][position.x] = path;
      next.push(path);
    }
    return next;
  };

  const startingPosition = { x: player.position.x, y: player.position.y };
  let current = {
    position: startingPosition,
    facing: player.facing,
    t: now,
    length: 0,
    cost: manhattanDistance(startingPosition, destination),
    prev: undefined,
  };
  let bestCandidate = current;
  const minheap = MinHeap((p0, p1) => p0.cost > p1.cost);
  while (current) {
    if (pointsEqual(current.position, destination)) {
      break;
    }
    if (
      manhattanDistance(current.position, destination) <
      manhattanDistance(bestCandidate.position, destination)
    ) {
      bestCandidate = current;
    }
    for (const candidate of explore(current)) {
      minheap.push(candidate);
    }
    current = minheap.pop();
  }
  let newDestination = null;
  if (!current) {
    if (bestCandidate.length === 0) {
      return null;
    }
    current = bestCandidate;
    newDestination = current.position;
  }
  const densePath = [];
  let facing = current.facing;
  while (current) {
    densePath.push({ position: current.position, t: current.t, facing });
    facing = current.facing;
    current = current.prev;
  }
  densePath.reverse();
  return { path: compressPath(densePath), newDestination };
}

export function blocked(game, now, pos, playerId) {
  const otherPositions = [...game.world.players.values()]
    .filter((p) => p.id !== playerId)
    .map((p) => p.position);
  return blockedWithPositions(pos, otherPositions, game.worldMap, game.collisionThreshold);
}

export function blockedWithPositions(position, otherPositions, map, collisionThreshold) {
  if (isNaN(position.x) || isNaN(position.y)) {
    throw new Error(`NaN position in ${JSON.stringify(position)}`);
  }
  if (position.x < 0 || position.y < 0 || position.x >= map.width || position.y >= map.height) {
    return 'out of bounds';
  }
  for (const layer of map.objectTiles) {
    if (layer[Math.floor(position.x)][Math.floor(position.y)] !== -1) {
      return 'world blocked';
    }
  }
  for (const otherPosition of otherPositions) {
    if (distance(otherPosition, position) < collisionThreshold) {
      return 'player';
    }
  }
  return null;
}
