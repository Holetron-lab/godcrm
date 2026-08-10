/**
 * 16Neo — PixiJS Renderer
 * Draws room, animal avatars, chat bubbles on a PixiJS canvas
 * All players are animals — no human characters
 */

import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type {
  Room, AnimalAvatar, ChatBubble, FurnitureItem, Vec2, TileType, AnimalSpecies,
} from './types';
import { TILE_SIZE, SCALE, PALETTE, SPECIES_CONFIG } from './types';

const S = TILE_SIZE * SCALE; // rendered tile size (48px)

// ── Tile Colors ──────────────────────────────────────
const TILE_COLORS: Record<TileType, number> = {
  floor_wood: 0x8b5e3c,
  floor_carpet: 0x457b9d,
  floor_tile: 0xc8c8d8,
  wall: 0x2d2d44,
  wall_top: 0x1a1a2e,
  door: 0x5c3d2e,
  window: 0x72b4d4,
  empty: 0x000000,
};

const FURNITURE_COLORS: Record<FurnitureItem['type'], number> = {
  desk: 0xc49a6c,
  chair: 0x4a4a68,
  monitor: 0x1d3557,
  plant: 0x52b788,
  bookshelf: 0x5c3d2e,
  couch: 0xc0392b,
  coffee_machine: 0x6b6b8d,
  whiteboard: 0xe8e8f0,
  lamp: 0xfbbf24,
  rug: 0x457b9d,
};

// ── Animal sprite drawing ────────────────────────────
function drawAnimalSprite(g: Graphics, animal: AnimalAvatar) {
  const cs = SCALE;
  const isWalking = animal.state === 'walking';
  const bob = isWalking ? Math.sin(Date.now() / 150) * cs : Math.sin(Date.now() / 600 + animal.pos.x) * cs * 0.3;
  const species = animal.species;
  const cfg = SPECIES_CONFIG[species];

  switch (species) {
    case 'corgi':
      drawCorgi(g, cs, bob, isWalking, cfg, animal);
      break;
    case 'cat':
      drawCat(g, cs, bob, isWalking, cfg, animal);
      break;
    case 'bunny':
      drawBunny(g, cs, bob, isWalking, cfg, animal);
      break;
    case 'hamster':
      drawHamster(g, cs, bob, isWalking, cfg, animal);
      break;
    case 'fox':
      drawFox(g, cs, bob, isWalking, cfg, animal);
      break;
  }

  // Mood indicator above head
  drawMoodIndicator(g, cs, bob, animal);
}

function drawCorgi(g: Graphics, cs: number, bob: number, isWalking: boolean, cfg: typeof SPECIES_CONFIG['corgi'], animal: AnimalAvatar) {
  // Body
  g.rect(2 * cs, 6 * cs + bob, 12 * cs, 7 * cs).fill(cfg.bodyColor);
  // Head
  g.rect(3 * cs, 2 * cs + bob, 10 * cs, 6 * cs).fill(cfg.bodyColor);
  // Ears (pointy)
  g.rect(3 * cs, 0 * cs + bob, 3 * cs, 3 * cs).fill(cfg.bodyColor);
  g.rect(10 * cs, 0 * cs + bob, 3 * cs, 3 * cs).fill(cfg.bodyColor);
  // White belly
  g.rect(4 * cs, 9 * cs + bob, 8 * cs, 3 * cs).fill(cfg.bellyColor);
  // Eyes (direction-based)
  const eyeOff = animal.direction === 'left' ? -cs : animal.direction === 'right' ? cs : 0;
  g.rect(5 * cs + eyeOff, 4 * cs + bob, 2 * cs, 2 * cs).fill(0x1a1a2e);
  g.rect(9 * cs + eyeOff, 4 * cs + bob, 2 * cs, 2 * cs).fill(0x1a1a2e);
  // Nose
  g.rect(7 * cs, 6 * cs + bob, 2 * cs, cs).fill(0x1a1a2e);
  // Legs
  const legSpread = isWalking ? Math.sin(Date.now() / 120) * cs : 0;
  g.rect(3 * cs - legSpread, 13 * cs, 3 * cs, 3 * cs).fill(0xfbbf24);
  g.rect(10 * cs + legSpread, 13 * cs, 3 * cs, 3 * cs).fill(0xfbbf24);
  // Tail
  const tailWag = Math.sin(Date.now() / 200) * 2 * cs;
  g.rect(14 * cs + tailWag, 6 * cs + bob, 2 * cs, 3 * cs).fill(cfg.bodyColor);

  // Local player glow
  if (animal.isLocal) {
    g.rect(0, 15 * cs + 2, 16 * cs, cs).fill(0x67e8f9);
  }
}

function drawCat(g: Graphics, cs: number, bob: number, isWalking: boolean, cfg: typeof SPECIES_CONFIG['cat'], animal: AnimalAvatar) {
  // Body (sleek)
  g.rect(3 * cs, 6 * cs + bob, 10 * cs, 7 * cs).fill(cfg.bodyColor);
  // Head (round)
  g.rect(3 * cs, 2 * cs + bob, 10 * cs, 6 * cs).fill(cfg.bodyColor);
  // Ears (triangular)
  g.rect(3 * cs, 0 * cs + bob, 2 * cs, 3 * cs).fill(cfg.bodyColor);
  g.rect(11 * cs, 0 * cs + bob, 2 * cs, 3 * cs).fill(cfg.bodyColor);
  // Inner ears (pink)
  g.rect(4 * cs, 1 * cs + bob, cs, cs).fill(0xff6b9d);
  g.rect(12 * cs, 1 * cs + bob, cs, cs).fill(0xff6b9d);
  // Belly
  g.rect(5 * cs, 9 * cs + bob, 6 * cs, 3 * cs).fill(cfg.bellyColor);
  // Eyes (cat-like slits)
  const eyeOff = animal.direction === 'left' ? -cs : animal.direction === 'right' ? cs : 0;
  g.rect(5 * cs + eyeOff, 4 * cs + bob, 2 * cs, 2 * cs).fill(0x52b788);
  g.rect(9 * cs + eyeOff, 4 * cs + bob, 2 * cs, 2 * cs).fill(0x52b788);
  g.rect(6 * cs + eyeOff, 4 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  g.rect(10 * cs + eyeOff, 4 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  // Nose
  g.rect(7 * cs, 6 * cs + bob, 2 * cs, cs).fill(0xff6b9d);
  // Whiskers
  g.rect(1 * cs, 5 * cs + bob, 3 * cs, cs).fill(0x9898b5);
  g.rect(12 * cs, 5 * cs + bob, 3 * cs, cs).fill(0x9898b5);
  // Legs
  const legSpread = isWalking ? Math.sin(Date.now() / 100) * cs : 0;
  g.rect(4 * cs - legSpread, 13 * cs, 2 * cs, 3 * cs).fill(cfg.bodyColor);
  g.rect(10 * cs + legSpread, 13 * cs, 2 * cs, 3 * cs).fill(cfg.bodyColor);
  // Tail (curved up)
  const tailSway = Math.sin(Date.now() / 300) * cs;
  g.rect(13 * cs + tailSway, 4 * cs + bob, 2 * cs, 3 * cs).fill(cfg.bodyColor);
  g.rect(14 * cs + tailSway, 7 * cs + bob, 2 * cs, 2 * cs).fill(cfg.bodyColor);

  if (animal.isLocal) {
    g.rect(0, 15 * cs + 2, 16 * cs, cs).fill(0x67e8f9);
  }
}

function drawBunny(g: Graphics, cs: number, bob: number, isWalking: boolean, cfg: typeof SPECIES_CONFIG['bunny'], animal: AnimalAvatar) {
  // Body (round)
  g.rect(3 * cs, 7 * cs + bob, 10 * cs, 6 * cs).fill(cfg.bodyColor);
  // Head
  g.rect(4 * cs, 3 * cs + bob, 8 * cs, 5 * cs).fill(cfg.bodyColor);
  // Long ears
  g.rect(4 * cs, -3 * cs + bob, 3 * cs, 6 * cs).fill(cfg.bodyColor);
  g.rect(9 * cs, -3 * cs + bob, 3 * cs, 6 * cs).fill(cfg.bodyColor);
  // Inner ears
  g.rect(5 * cs, -2 * cs + bob, cs, 4 * cs).fill(cfg.bellyColor);
  g.rect(10 * cs, -2 * cs + bob, cs, 4 * cs).fill(cfg.bellyColor);
  // Belly
  g.rect(5 * cs, 9 * cs + bob, 6 * cs, 3 * cs).fill(cfg.bellyColor);
  // Eyes
  const eyeOff = animal.direction === 'left' ? -cs : animal.direction === 'right' ? cs : 0;
  g.rect(5 * cs + eyeOff, 5 * cs + bob, 2 * cs, 2 * cs).fill(0xc0392b);
  g.rect(9 * cs + eyeOff, 5 * cs + bob, 2 * cs, 2 * cs).fill(0xc0392b);
  // Nose
  g.rect(7 * cs, 7 * cs + bob, 2 * cs, cs).fill(0xff6b9d);
  // Legs
  const hop = isWalking ? Math.abs(Math.sin(Date.now() / 100)) * 2 * cs : 0;
  g.rect(4 * cs, 13 * cs - hop, 3 * cs, 3 * cs).fill(cfg.bodyColor);
  g.rect(9 * cs, 13 * cs - hop, 3 * cs, 3 * cs).fill(cfg.bodyColor);
  // Fluffy tail
  g.circle(13 * cs, 10 * cs + bob, 2 * cs).fill(cfg.bodyColor);

  if (animal.isLocal) {
    g.rect(0, 15 * cs + 2, 16 * cs, cs).fill(0x67e8f9);
  }
}

function drawHamster(g: Graphics, cs: number, bob: number, isWalking: boolean, cfg: typeof SPECIES_CONFIG['hamster'], animal: AnimalAvatar) {
  // Body (chubby round)
  g.rect(2 * cs, 5 * cs + bob, 12 * cs, 8 * cs).fill(cfg.bodyColor);
  // Head (big round)
  g.rect(3 * cs, 2 * cs + bob, 10 * cs, 5 * cs).fill(cfg.bodyColor);
  // Cheeks (puffy!)
  g.circle(3 * cs, 5 * cs + bob, 2 * cs).fill(0xfb923c);
  g.circle(13 * cs, 5 * cs + bob, 2 * cs).fill(0xfb923c);
  // Ears (small round)
  g.rect(3 * cs, 1 * cs + bob, 2 * cs, 2 * cs).fill(cfg.bodyColor);
  g.rect(11 * cs, 1 * cs + bob, 2 * cs, 2 * cs).fill(cfg.bodyColor);
  // Belly
  g.rect(4 * cs, 8 * cs + bob, 8 * cs, 4 * cs).fill(cfg.bellyColor);
  // Eyes (beady)
  const eyeOff = animal.direction === 'left' ? -cs : animal.direction === 'right' ? cs : 0;
  g.rect(5 * cs + eyeOff, 3 * cs + bob, 2 * cs, 2 * cs).fill(0x1a1a2e);
  g.rect(9 * cs + eyeOff, 3 * cs + bob, 2 * cs, 2 * cs).fill(0x1a1a2e);
  // Nose
  g.rect(7 * cs, 5 * cs + bob, 2 * cs, cs).fill(0xff6b9d);
  // Tiny legs
  const legWiggle = isWalking ? Math.sin(Date.now() / 80) * cs : 0;
  g.rect(4 * cs - legWiggle, 13 * cs, 2 * cs, 2 * cs).fill(cfg.bodyColor);
  g.rect(10 * cs + legWiggle, 13 * cs, 2 * cs, 2 * cs).fill(cfg.bodyColor);

  if (animal.isLocal) {
    g.rect(0, 14 * cs + 2, 16 * cs, cs).fill(0x67e8f9);
  }
}

function drawFox(g: Graphics, cs: number, bob: number, isWalking: boolean, cfg: typeof SPECIES_CONFIG['fox'], animal: AnimalAvatar) {
  // Body
  g.rect(2 * cs, 6 * cs + bob, 12 * cs, 7 * cs).fill(cfg.bodyColor);
  // Head (pointy)
  g.rect(3 * cs, 2 * cs + bob, 10 * cs, 6 * cs).fill(cfg.bodyColor);
  // Ears (big triangle)
  g.rect(3 * cs, -1 * cs + bob, 3 * cs, 4 * cs).fill(cfg.bodyColor);
  g.rect(10 * cs, -1 * cs + bob, 3 * cs, 4 * cs).fill(cfg.bodyColor);
  // Inner ears
  g.rect(4 * cs, 0 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  g.rect(11 * cs, 0 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  // White muzzle
  g.rect(5 * cs, 5 * cs + bob, 6 * cs, 3 * cs).fill(cfg.bellyColor);
  // Belly
  g.rect(4 * cs, 9 * cs + bob, 8 * cs, 3 * cs).fill(cfg.bellyColor);
  // Eyes (sly)
  const eyeOff = animal.direction === 'left' ? -cs : animal.direction === 'right' ? cs : 0;
  g.rect(5 * cs + eyeOff, 3 * cs + bob, 2 * cs, 2 * cs).fill(0xd4a017);
  g.rect(9 * cs + eyeOff, 3 * cs + bob, 2 * cs, 2 * cs).fill(0xd4a017);
  g.rect(6 * cs + eyeOff, 3 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  g.rect(10 * cs + eyeOff, 3 * cs + bob, cs, 2 * cs).fill(0x1a1a2e);
  // Nose
  g.rect(7 * cs, 6 * cs + bob, 2 * cs, cs).fill(0x1a1a2e);
  // Legs
  const legSpread = isWalking ? Math.sin(Date.now() / 110) * cs : 0;
  g.rect(3 * cs - legSpread, 13 * cs, 3 * cs, 3 * cs).fill(0x1a1a2e);
  g.rect(10 * cs + legSpread, 13 * cs, 3 * cs, 3 * cs).fill(0x1a1a2e);
  // Bushy tail
  const tailSway = Math.sin(Date.now() / 250) * 2 * cs;
  g.rect(14 * cs + tailSway, 4 * cs + bob, 3 * cs, 4 * cs).fill(cfg.bodyColor);
  g.rect(15 * cs + tailSway, 8 * cs + bob, 2 * cs, 2 * cs).fill(cfg.bellyColor); // white tip

  if (animal.isLocal) {
    g.rect(0, 15 * cs + 2, 16 * cs, cs).fill(0x67e8f9);
  }
}

function drawMoodIndicator(g: Graphics, cs: number, bob: number, animal: AnimalAvatar) {
  if (animal.mood === 'happy') {
    g.circle(8 * cs, -4 * cs + bob, 2 * cs).fill(0xff6b9d); // heart
  } else if (animal.mood === 'hungry') {
    g.rect(6 * cs, -6 * cs + bob, 4 * cs, 3 * cs).fill(0xfbbf24);
  } else if (animal.mood === 'sleeping') {
    const textG = new Text({
      text: 'z',
      style: new TextStyle({ fontSize: 10 * cs / 3, fill: PALETTE.lightSky, fontFamily: 'monospace' }),
    });
    textG.x = 12 * cs;
    textG.y = -4 * cs + bob;
    g.addChild(textG);
  }
}

// ── Chat Bubble ──────────────────────────────────────
function drawChatBubble(g: Graphics, text: string, width: number) {
  const padding = 6;
  const h = 20;
  g.roundRect(0, 0, width + padding * 2, h, 4).fill(0xf5f5fa);
  g.roundRect(0, 0, width + padding * 2, h, 4).stroke({ color: 0x2d2d44, width: 1 });
  g.moveTo(width / 2 + padding - 4, h).lineTo(width / 2 + padding, h + 6).lineTo(width / 2 + padding + 4, h).fill(0xf5f5fa);

  const t = new Text({
    text,
    style: new TextStyle({ fontSize: 11, fill: PALETTE.deepNight, fontFamily: 'monospace', wordWrap: true, wordWrapWidth: 180 }),
  });
  t.x = padding;
  t.y = 3;
  g.addChild(t);
}

// ── Main Renderer Class ──────────────────────────────
export class Neo16Renderer {
  app: Application;
  private worldContainer: Container;
  private uiContainer: Container;
  private initialized = false;

  constructor() {
    this.app = new Application();
    this.worldContainer = new Container();
    this.uiContainer = new Container();
  }

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      backgroundColor: parseInt(PALETTE.deepNight.replace('#', ''), 16),
      antialias: false,
      roundPixels: true,
      resolution: 1,
    });

    this.app.stage.addChild(this.worldContainer);
    this.app.stage.addChild(this.uiContainer);
    this.initialized = true;
  }

  resize(w: number, h: number) {
    if (!this.initialized) return;
    this.app.renderer.resize(w, h);
  }

  render(
    room: Room,
    animals: AnimalAvatar[],
    bubbles: ChatBubble[],
    camera: Vec2,
  ) {
    if (!this.initialized) return;

    this.worldContainer.removeChildren();
    this.worldContainer.x = -camera.x;
    this.worldContainer.y = -camera.y;

    // 1. Draw tiles
    this.drawRoom(room);

    // 2. Draw furniture
    this.drawFurniture(room.furniture);

    // 3. Collect and sort all animals by Y for depth
    type Entity = { y: number; draw: (c: Container) => void };
    const entities: Entity[] = [];

    for (const animal of animals) {
      entities.push({
        y: animal.pos.y,
        draw: (parent) => {
          const g = new Graphics();
          g.x = animal.pos.x * SCALE;
          g.y = animal.pos.y * SCALE;
          drawAnimalSprite(g, animal);

          // Name tag: animal name + owner
          const label = animal.isLocal
            ? `${animal.name}`
            : `${animal.name} (${animal.ownerName})`;
          const nameTag = new Text({
            text: label,
            style: new TextStyle({
              fontSize: 10,
              fill: animal.isLocal ? PALETTE.cyan : PALETTE.pale,
              fontFamily: 'monospace',
              stroke: { color: PALETTE.deepNight, width: 2 },
            }),
          });
          nameTag.anchor.set(0.5, 1);
          nameTag.x = 8 * SCALE;
          nameTag.y = -6 * SCALE;
          g.addChild(nameTag);

          parent.addChild(g);
        },
      });
    }

    // Sort by Y (depth sorting)
    entities.sort((a, b) => a.y - b.y);
    for (const e of entities) {
      e.draw(this.worldContainer);
    }

    // 4. Draw chat bubbles (in UI layer, screen-space)
    this.uiContainer.removeChildren();
    const now = Date.now();
    for (const bubble of bubbles) {
      if (now - bubble.timestamp > bubble.duration) continue;

      const animal = animals.find(a => a.id === bubble.animalId);
      if (!animal) continue;

      const g = new Graphics();
      const screenX = animal.pos.x * SCALE - camera.x + 8 * SCALE;
      const screenY = animal.pos.y * SCALE - camera.y - 10;
      const textWidth = Math.min(bubble.text.length * 7, 200);

      g.x = screenX - textWidth / 2 - 6;
      g.y = screenY - 30;
      drawChatBubble(g, bubble.text, textWidth);

      const timeLeft = bubble.duration - (now - bubble.timestamp);
      if (timeLeft < 500) {
        g.alpha = timeLeft / 500;
      }

      this.uiContainer.addChild(g);
    }
  }

  private drawRoom(room: Room) {
    const g = new Graphics();

    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const tile = room.tiles[y][x];
        const color = TILE_COLORS[tile];
        const px = x * S;
        const py = y * S;

        g.rect(px, py, S, S).fill(color);

        if (tile === 'floor_wood') {
          g.rect(px, py + S - 1, S, 1).fill(0x6b4423);
          if (x % 2 === 0) {
            g.rect(px + S / 3, py + 2, 1, S - 4).fill(0xa0724a);
          }
        } else if (tile === 'floor_carpet') {
          g.rect(px + 1, py + 1, S - 2, S - 2).fill(0x1d3557);
        } else if (tile === 'wall') {
          g.rect(px, py + S / 2, S, 1).fill(0x4a4a68);
          g.rect(px + S / 2, py, 1, S / 2).fill(0x4a4a68);
          g.rect(px + S / 4, py + S / 2, 1, S / 2).fill(0x4a4a68);
        } else if (tile === 'window') {
          g.rect(px + 4, py + 4, S - 8, S - 8).fill(0xa8dadc);
          g.rect(px + S / 2 - 1, py + 4, 2, S - 8).fill(0x2d2d44);
          g.rect(px + 4, py + S / 2 - 1, S - 8, 2).fill(0x2d2d44);
        } else if (tile === 'door') {
          g.rect(px + 6, py, S - 12, S).fill(0x3d2b1f);
          g.circle(px + S - 12, py + S / 2, 3).fill(0xd4a017);
        }
      }
    }

    this.worldContainer.addChild(g);
  }

  private drawFurniture(furniture: FurnitureItem[]) {
    for (const f of furniture) {
      const g = new Graphics();
      const px = f.pos.x * S;
      const py = f.pos.y * S;
      const w = f.size.x * S;
      const h = f.size.y * S;
      const color = FURNITURE_COLORS[f.type];

      g.rect(px + 2, py + 2, w - 4, h - 4).fill(color);

      switch (f.type) {
        case 'desk':
          g.rect(px + 4, py + h - 6, w - 8, 4).fill(0x3d2b1f);
          break;
        case 'monitor':
          g.rect(px + 6, py + 4, w - 12, h - 12).fill(0x72b4d4);
          g.rect(px + w / 2 - 3, py + h - 8, 6, 6).fill(0x4a4a68);
          break;
        case 'plant':
          g.rect(px + 8, py + h - 10, w - 16, 8).fill(0x5c3d2e);
          g.circle(px + w / 2, py + h / 3, w / 4).fill(0x2d6a4f);
          g.circle(px + w / 2 - 6, py + h / 3 + 4, w / 5).fill(0x52b788);
          break;
        case 'coffee_machine':
          g.rect(px + 8, py + 4, w - 16, h - 8).fill(0x4a4a68);
          g.circle(px + w / 2, py + h / 2, 6).fill(0xc0392b);
          break;
        case 'couch':
          g.rect(px + 2, py + 4, 6, h - 8).fill(0x8b2020);
          g.rect(px + w - 8, py + 4, 6, h - 8).fill(0x8b2020);
          break;
        case 'whiteboard':
          g.rect(px + 4, py + 2, w - 8, h - 6).fill(0xf5f5fa);
          g.rect(px + 4, py + 2, w - 8, h - 6).stroke({ color: 0x6b6b8d, width: 2 });
          break;
        case 'bookshelf':
          for (let i = 0; i < 3; i++) {
            const shelfY = py + 4 + i * (h / 3);
            g.rect(px + 4, shelfY, w - 8, 3).fill(0x3d2b1f);
            g.rect(px + 6, shelfY - 8, 4, 8).fill(0xc0392b);
            g.rect(px + 12, shelfY - 10, 4, 10).fill(0x1d3557);
            g.rect(px + 18, shelfY - 7, 4, 7).fill(0x52b788);
          }
          break;
        case 'lamp':
          g.rect(px + w / 2 - 2, py + h / 2, 4, h / 2).fill(0x6b6b8d);
          g.rect(px + 4, py + 2, w - 8, h / 3).fill(0xfbbf24);
          break;
        case 'rug':
          g.roundRect(px + 2, py + 2, w - 4, h - 4, 4).fill(0x457b9d);
          g.roundRect(px + 6, py + 6, w - 12, h - 12, 2).fill(0x1d3557);
          break;
      }

      this.worldContainer.addChild(g);
    }
  }

  destroy() {
    if (this.initialized) {
      this.app.destroy(true);
      this.initialized = false;
    }
  }
}
