/**
 * 16Neo — Type Definitions
 * 16-bit pixel art virtual office + messenger + tamagotchi
 *
 * Core concept: user IS their animal avatar, moves through office as their pet
 */

// ── Geometry ──────────────────────────────────────────
export interface Vec2 {
  x: number;
  y: number;
}

export type Direction = 'down' | 'up' | 'left' | 'right';

// ── Tiles & Room ─────────────────────────────────────
export type TileType =
  | 'floor_wood'
  | 'floor_carpet'
  | 'floor_tile'
  | 'wall'
  | 'wall_top'
  | 'door'
  | 'window'
  | 'empty';

export interface RoomTile {
  type: TileType;
  walkable: boolean;
  interactive?: boolean;
  objectId?: string;
}

export interface FurnitureItem {
  id: string;
  type: 'desk' | 'chair' | 'monitor' | 'plant' | 'bookshelf' | 'couch' | 'coffee_machine' | 'whiteboard' | 'lamp' | 'rug';
  pos: Vec2;
  size: Vec2; // in tiles
  walkable: boolean;
  interactive: boolean;
}

export interface Room {
  id: string;
  name: string;
  width: number;  // tiles
  height: number; // tiles
  tiles: TileType[][];
  furniture: FurnitureItem[];
  spawnPoint: Vec2;
}

// ── Animal Avatars ──────────────────────────────────
export type AnimalSpecies = 'corgi' | 'cat' | 'bunny' | 'hamster' | 'fox';
export type AnimalState = 'idle' | 'walking';
export type AnimalMood = 'happy' | 'idle' | 'sad' | 'hungry' | 'sleeping';

export interface AnimalAvatar {
  id: string;
  name: string;
  ownerName: string;    // player display name
  species: AnimalSpecies;
  pos: Vec2;            // pixel position
  tilePos: Vec2;        // tile position
  direction: Direction;
  state: AnimalState;
  mood: AnimalMood;
  frame: number;
  color: string;        // accent color for this animal
  isLocal: boolean;
}

// ── Chat ─────────────────────────────────────────────
export interface ChatBubble {
  id: string;
  animalId: string;
  text: string;
  timestamp: number;
  duration: number; // ms to show
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: number;
}

// ── Game State ───────────────────────────────────────
export interface Neo16State {
  room: Room;
  localAnimal: AnimalAvatar;
  remoteAnimals: AnimalAvatar[];
  chatBubbles: ChatBubble[];
  chatHistory: ChatMessage[];
  camera: Vec2;
  showChatPanel: boolean;
}

// ── Constants ────────────────────────────────────────
export const TILE_SIZE = 16;
export const SCALE = 3;        // render scale
export const RENDER_TILE = TILE_SIZE * SCALE; // 48px on screen
export const PET_SIZE = 16;
export const MOVE_SPEED = 2;   // pixels per frame (at base resolution)
export const CHAT_BUBBLE_DURATION = 4000; // ms
export const CANVAS_BG = '#1a1a2e';

// ── Palette (Neo Office 32-color) ────────────────────
export const PALETTE = {
  deepNight: '#1a1a2e',
  darkWall: '#2d2d44',
  shadow: '#4a4a68',
  midGrey: '#6b6b8d',
  lightGrey: '#9898b5',
  pale: '#c8c8d8',
  nearWhite: '#e8e8f0',
  white: '#f5f5fa',
  darkWood: '#3d2b1f',
  wood: '#5c3d2e',
  lightWood: '#8b5e3c',
  paleWood: '#c49a6c',
  darkEarth: '#6b4423',
  sand: '#a0724a',
  darkForest: '#1b4332',
  forest: '#2d6a4f',
  freshGreen: '#52b788',
  lightGreen: '#95d5b2',
  deepBlue: '#1d3557',
  ocean: '#457b9d',
  sky: '#72b4d4',
  lightSky: '#a8dadc',
  red: '#c0392b',
  lightRed: '#e74c3c',
  gold: '#d4a017',
  amber: '#f39c12',
  orange: '#e67e22',
  pink: '#ff6b9d',
  purple: '#c084fc',
  cyan: '#67e8f9',
  yellow: '#fbbf24',
  peach: '#fb923c',
} as const;

// ── Species visual config ────────────────────────────
export const SPECIES_CONFIG: Record<AnimalSpecies, { bodyColor: number; bellyColor: number; label: string }> = {
  corgi:   { bodyColor: 0xe67e22, bellyColor: 0xf5f5fa, label: '🐕' },
  cat:     { bodyColor: 0x6b6b8d, bellyColor: 0xe8e8f0, label: '🐱' },
  bunny:   { bodyColor: 0xf5f5fa, bellyColor: 0xff6b9d, label: '🐰' },
  hamster: { bodyColor: 0xfbbf24, bellyColor: 0xf5f5fa, label: '🐹' },
  fox:     { bodyColor: 0xc0392b, bellyColor: 0xf5f5fa, label: '🦊' },
};
