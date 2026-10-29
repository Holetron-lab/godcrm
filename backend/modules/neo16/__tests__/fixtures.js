// Synthetic 10×10 town for Neo16 W0 tests. A wall runs down x=5 from y=0..7,
// so the only route from the west half to the east half goes under it
// (y = 8 or 9). `objectTiles[layer][x][y]` follows the upstream convention
// (-1 = empty, anything else blocks).

export function makeMap() {
  const W = 10;
  const H = 10;
  const layer = [];
  for (let x = 0; x < W; x++) {
    const col = [];
    for (let y = 0; y < H; y++) col.push(x === 5 && y <= 7 ? 1 : -1);
    layer.push(col);
  }
  const bg = [];
  for (let x = 0; x < W; x++) bg.push(new Array(H).fill(0));
  return {
    width: W,
    height: H,
    tileSetUrl: 'synthetic',
    tileSetDimX: 32,
    tileSetDimY: 32,
    tileDim: 32,
    bgTiles: [bg],
    objectTiles: [layer],
    animatedSprites: [],
  };
}

/** One NPC (agent a:0 driving player p:1) standing at (2,2) facing east. */
export function makeState() {
  return {
    world: {
      nextId: 2,
      conversations: [],
      players: [
        { id: 'p:1', lastInput: 0, position: { x: 2, y: 2 }, facing: { dx: 1, dy: 0 }, speed: 0 },
      ],
      agents: [{ id: 'a:0', playerId: 'p:1' }],
    },
    playerDescriptions: [
      { playerId: 'p:1', name: 'Nora Blake', description: 'Front desk, knows everyone', character: 'f1' },
    ],
    agentDescriptions: [
      { agentId: 'a:0', identity: 'Nora is the receptionist of the lab.', plan: 'Keep the visitor log tidy.' },
    ],
    worldMap: makeMap(),
  };
}

export const NPC_PLAYER_ID = 'p:1';
export const EAST_SIDE = { x: 8, y: 2 };
