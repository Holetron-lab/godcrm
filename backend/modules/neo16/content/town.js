// Neo16 W2-S3 — the default learner town (doc 239900 §Module Integration, §Data Ownership).
//
// DATA ONLY. The first time a learner starts a quest through the HTTP router, the server
// creates their own `worlds` row from this snapshot, so a session never depends on a
// world made by hand. Shape is the serialized GameState the ported engine loads
// (engine/game.js → World/WorldMap/PlayerDescription/AgentDescription).
//
// Synthetic 16×16 map: a short wall in the middle so pathfinding has something to route
// around; no upstream art (README §Asset inventory — nothing from AI Town `public/assets`).
// NPC keys mirror content/quests.js so a later frontend can place `nora`, `reed`, `casey`.

const WIDTH = 16;
const HEIGHT = 16;

function makeMap() {
  const objects = [];
  const bg = [];
  for (let x = 0; x < WIDTH; x++) {
    const col = [];
    for (let y = 0; y < HEIGHT; y++) col.push(x === 8 && y >= 4 && y <= 11 ? 1 : -1);
    objects.push(col);
    bg.push(new Array(HEIGHT).fill(0));
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSetUrl: 'synthetic',
    tileSetDimX: 32,
    tileSetDimY: 32,
    tileDim: 32,
    bgTiles: [bg],
    objectTiles: [objects],
    animatedSprites: [],
  };
}

export const TOWN_NPCS = Object.freeze([
  { key: 'nora', playerId: 'p:1', agentId: 'a:0', name: 'Nora Blake', description: 'Front desk, knows everyone', character: 'f1',
    identity: 'Nora is the receptionist of the lab.', plan: 'Keep the visitor log tidy.', position: { x: 3, y: 3 } },
  { key: 'reed', playerId: 'p:2', agentId: 'a:1', name: 'Dr. Evelyn Reed', description: 'Scientist, precise and busy', character: 'f2',
    identity: 'Dr. Reed runs Lab B.', plan: 'Finish the experiment before Thursday.', position: { x: 12, y: 6 } },
  { key: 'casey', playerId: 'p:3', agentId: 'a:2', name: 'Casey Brooks', description: 'Chatty colleague', character: 'm1',
    identity: 'Casey is your partner on the floor.', plan: 'Find someone to talk to.', position: { x: 5, y: 12 } },
]);

/** A fresh serialized GameState for one learner's town. */
export function defaultTownState() {
  return {
    world: {
      nextId: TOWN_NPCS.length + 1,
      conversations: [],
      players: TOWN_NPCS.map((n) => ({ id: n.playerId, lastInput: 0, position: n.position, facing: { dx: 1, dy: 0 }, speed: 0 })),
      agents: TOWN_NPCS.map((n) => ({ id: n.agentId, playerId: n.playerId })),
    },
    playerDescriptions: TOWN_NPCS.map((n) => ({ playerId: n.playerId, name: n.name, description: n.description, character: n.character })),
    agentDescriptions: TOWN_NPCS.map((n) => ({ agentId: n.agentId, identity: n.identity, plan: n.plan })),
    worldMap: makeMap(),
  };
}

/** Add the authenticated learner once; preserve old worlds and NPC positions. */
export function addLearner(state, userId) {
  if (state.world.players.some((p) => p.human === String(userId))) return false;
  const { width, height, objectTiles } = state.worldMap;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (objectTiles.some((layer) => layer[x][y] !== -1) ||
          state.world.players.some((p) => Math.hypot(p.position.x - x, p.position.y - y) < 0.75)) continue;
      let id;
      do { id = `p:${state.world.nextId++}`; } while (state.world.players.some((p) => p.id === id));
      state.world.players.push({ id, human: String(userId), lastInput: 0, position: { x, y }, facing: { dx: 1, dy: 0 }, speed: 0 });
      state.playerDescriptions.push({ playerId: id, name: 'Learner', description: '', character: 'm2' });
      return true;
    }
  }
  throw new Error('No free learner spawn in world');
}
