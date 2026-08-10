/**
 * 16Neo — Default Room Generator
 * Creates a furnished office room
 */

import type { Room, TileType, FurnitureItem } from './types';

/** Generate the default 16Neo office room (14×12 tiles) */
export function createDefaultRoom(): Room {
  const W = 14;
  const H = 12;

  // Build tile grid
  const tiles: TileType[][] = [];
  for (let y = 0; y < H; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < W; x++) {
      if (y === 0) {
        row.push('wall_top');
      } else if (y === 1) {
        row.push('wall');
      } else if (x === 0 || x === W - 1) {
        row.push('wall');
      } else if (y === H - 1) {
        row.push(x === Math.floor(W / 2) ? 'door' : 'wall');
      } else {
        // interior floor pattern
        if ((x + y) % 5 === 0) {
          row.push('floor_carpet');
        } else {
          row.push('floor_wood');
        }
      }
    }
    tiles.push(row);
  }

  // Windows on top wall
  tiles[1][3] = 'window';
  tiles[1][7] = 'window';
  tiles[1][10] = 'window';

  const furniture: FurnitureItem[] = [
    // Work desks
    { id: 'desk1', type: 'desk', pos: { x: 2, y: 3 }, size: { x: 2, y: 1 }, walkable: false, interactive: true },
    { id: 'desk2', type: 'desk', pos: { x: 6, y: 3 }, size: { x: 2, y: 1 }, walkable: false, interactive: true },
    { id: 'desk3', type: 'desk', pos: { x: 10, y: 3 }, size: { x: 2, y: 1 }, walkable: false, interactive: true },
    // Chairs
    { id: 'chair1', type: 'chair', pos: { x: 2, y: 4 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    { id: 'chair2', type: 'chair', pos: { x: 7, y: 4 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    { id: 'chair3', type: 'chair', pos: { x: 11, y: 4 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    // Monitors on desks
    { id: 'mon1', type: 'monitor', pos: { x: 3, y: 3 }, size: { x: 1, y: 1 }, walkable: false, interactive: true },
    { id: 'mon2', type: 'monitor', pos: { x: 7, y: 3 }, size: { x: 1, y: 1 }, walkable: false, interactive: true },
    { id: 'mon3', type: 'monitor', pos: { x: 11, y: 3 }, size: { x: 1, y: 1 }, walkable: false, interactive: true },
    // Couch area
    { id: 'couch1', type: 'couch', pos: { x: 2, y: 8 }, size: { x: 3, y: 1 }, walkable: false, interactive: true },
    // Plants
    { id: 'plant1', type: 'plant', pos: { x: 1, y: 2 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    { id: 'plant2', type: 'plant', pos: { x: 12, y: 2 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    // Coffee machine
    { id: 'coffee', type: 'coffee_machine', pos: { x: 10, y: 8 }, size: { x: 1, y: 1 }, walkable: false, interactive: true },
    // Whiteboard
    { id: 'board', type: 'whiteboard', pos: { x: 6, y: 7 }, size: { x: 2, y: 1 }, walkable: false, interactive: true },
    // Bookshelf
    { id: 'shelf', type: 'bookshelf', pos: { x: 12, y: 6 }, size: { x: 1, y: 2 }, walkable: false, interactive: true },
    // Lamp
    { id: 'lamp1', type: 'lamp', pos: { x: 5, y: 8 }, size: { x: 1, y: 1 }, walkable: false, interactive: false },
    // Rug
    { id: 'rug1', type: 'rug', pos: { x: 3, y: 9 }, size: { x: 2, y: 1 }, walkable: true, interactive: false },
  ];

  return {
    id: 'default-office',
    name: 'Neo Office',
    width: W,
    height: H,
    tiles,
    furniture,
    spawnPoint: { x: 7, y: 6 },
  };
}

/** Check if a tile position is walkable */
export function isWalkable(room: Room, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return false;

  const tile = room.tiles[ty][tx];
  if (tile === 'wall' || tile === 'wall_top' || tile === 'window' || tile === 'empty') return false;

  // Check furniture
  for (const f of room.furniture) {
    if (!f.walkable) {
      if (
        tx >= f.pos.x &&
        tx < f.pos.x + f.size.x &&
        ty >= f.pos.y &&
        ty < f.pos.y + f.size.y
      ) {
        return false;
      }
    }
  }

  return true;
}
