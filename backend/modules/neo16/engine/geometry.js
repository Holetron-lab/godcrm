// Neo16 W0 — port of AI Town `convex/util/geometry.ts` + `convex/util/types.ts`.
// Upstream: a16z-infra/ai-town @ 8e05997f2409275669c8344b84a51692e83f3f33 (MIT).
// Patch inventory: TypeScript types dropped, `convex/values` validators removed;
// logic is otherwise verbatim. Paths are arrays of [x, y, dx, dy, t] tuples.

export const EPSILON = 0.0001;

export function distance(p0, p1) {
  const dx = p0.x - p1.x;
  const dy = p0.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointsEqual(p0, p1) {
  return p0.x == p1.x && p0.y == p1.y;
}

export function manhattanDistance(p0, p1) {
  return Math.abs(p0.x - p1.x) + Math.abs(p0.y - p1.y);
}

export function vectorLength(vector) {
  return Math.sqrt(vector.dx * vector.dx + vector.dy * vector.dy);
}

export function packPathComponent(p) {
  return [p.position.x, p.position.y, p.facing.dx, p.facing.dy, p.t];
}

export function unpackPathComponent(p) {
  return { position: { x: p[0], y: p[1] }, facing: { dx: p[2], dy: p[3] }, t: p[4] };
}

export function queryPath(path, at) {
  return unpackPathComponent(path[at]);
}

export function pathPosition(path, time) {
  if (path.length < 2) {
    throw new Error(`Invalid path: ${JSON.stringify(path)}`);
  }
  const first = queryPath(path, 0);
  if (time < first.t) {
    return { position: first.position, facing: first.facing, velocity: 0 };
  }
  const last = queryPath(path, path.length - 1);
  if (last.t < time) {
    return { position: last.position, facing: last.facing, velocity: 0 };
  }
  for (let i = 0; i < path.length - 1; i++) {
    const segmentStart = queryPath(path, i);
    const segmentEnd = queryPath(path, i + 1);
    if (segmentStart.t <= time && time <= segmentEnd.t) {
      const interp = (time - segmentStart.t) / (segmentEnd.t - segmentStart.t);
      return {
        position: {
          x: segmentStart.position.x + interp * (segmentEnd.position.x - segmentStart.position.x),
          y: segmentStart.position.y + interp * (segmentEnd.position.y - segmentStart.position.y),
        },
        facing: segmentStart.facing,
        velocity:
          distance(segmentStart.position, segmentEnd.position) / (segmentEnd.t - segmentStart.t),
      };
    }
  }
  throw new Error('Timestamp checks not exhaustive?');
}

export function compressPath(densePath) {
  if (densePath.length <= 2) {
    return densePath.map(packPathComponent);
  }
  const out = [packPathComponent(densePath[0])];
  let last = densePath[0];
  let candidate;
  for (const point of densePath.slice(1)) {
    if (!candidate) {
      candidate = point;
      continue;
    }
    // We can skip `candidate` if it interpolates cleanly between `last` and `point`.
    const { position, facing } = pathPosition(
      [packPathComponent(last), packPathComponent(point)],
      candidate.t,
    );
    const positionCloseEnough = distance(position, candidate.position) < EPSILON;
    const facingDifference = {
      dx: facing.dx - candidate.facing.dx,
      dy: facing.dy - candidate.facing.dy,
    };
    const facingCloseEnough = vectorLength(facingDifference) < EPSILON;
    if (positionCloseEnough && facingCloseEnough) {
      candidate = point;
      continue;
    }
    out.push(packPathComponent(candidate));
    last = candidate;
    candidate = point;
  }
  if (candidate) {
    out.push(packPathComponent(candidate));
  }
  return out;
}
