/**
 * 16Neo — Game Loop Hook
 * User IS their animal avatar. WASD moves the animal directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Neo16State, AnimalAvatar, ChatBubble, ChatMessage, Direction,
} from './types';
import {
  TILE_SIZE, MOVE_SPEED, CHAT_BUBBLE_DURATION, PALETTE,
} from './types';
import { createDefaultRoom, isWalkable } from './room';

// ── Input State ──────────────────────────────────────
interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

// ── Hook ─────────────────────────────────────────────
interface MultiplayerEmitters {
  emitMove?: (pos: any, tilePos: any, direction: string, state: string, frame: number) => void;
}

export function useGameLoop(canvasWidth: number, canvasHeight: number, mp?: MultiplayerEmitters) {
  const room = useRef(createDefaultRoom()).current;

  const [state, setState] = useState<Neo16State>(() => {
    const spawn = room.spawnPoint;

    // Player IS their animal
    const localAnimal: AnimalAvatar = {
      id: 'local',
      name: 'Тор',
      ownerName: 'You',
      species: 'corgi',
      pos: { x: spawn.x * TILE_SIZE, y: spawn.y * TILE_SIZE },
      tilePos: { ...spawn },
      direction: 'down',
      state: 'idle',
      mood: 'happy',
      frame: 0,
      color: PALETTE.orange,
      isLocal: true,
    };

    // NPC animals in the office
    const npcAnimals: AnimalAvatar[] = [
      {
        id: 'npc1',
        name: 'Мурка',
        ownerName: 'Алекс',
        species: 'cat',
        pos: { x: 3 * TILE_SIZE, y: 5 * TILE_SIZE },
        tilePos: { x: 3, y: 5 },
        direction: 'down',
        state: 'idle',
        mood: 'idle',
        frame: 0,
        color: PALETTE.freshGreen,
        isLocal: false,
      },
      {
        id: 'npc2',
        name: 'Зайка',
        ownerName: 'Мия',
        species: 'bunny',
        pos: { x: 10 * TILE_SIZE, y: 6 * TILE_SIZE },
        tilePos: { x: 10, y: 6 },
        direction: 'left',
        state: 'idle',
        mood: 'happy',
        frame: 0,
        color: PALETTE.pink,
        isLocal: false,
      },
    ];

    return {
      room,
      localAnimal,
      remoteAnimals: npcAnimals,
      chatBubbles: [],
      chatHistory: [],
      camera: { x: 0, y: 0 },
      showChatPanel: false,
    };
  });

  const keysRef = useRef<KeyState>({ up: false, down: false, left: false, right: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Keyboard input ────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const k = keysRef.current;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp':    k.up = true; break;
      case 's': case 'S': case 'ArrowDown':   k.down = true; break;
      case 'a': case 'A': case 'ArrowLeft':   k.left = true; break;
      case 'd': case 'D': case 'ArrowRight':  k.right = true; break;
      case 'Enter':
        setState(prev => ({ ...prev, showChatPanel: !prev.showChatPanel }));
        break;
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const k = keysRef.current;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp':    k.up = false; break;
      case 's': case 'S': case 'ArrowDown':   k.down = false; break;
      case 'a': case 'A': case 'ArrowLeft':   k.left = false; break;
      case 'd': case 'D': case 'ArrowRight':  k.right = false; break;
    }
  }, []);

  // ── Send chat message ─────────────────────────────
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    const now = Date.now();
    const bubble: ChatBubble = {
      id: `b_${now}`,
      animalId: 'local',
      text: text.trim(),
      timestamp: now,
      duration: CHAT_BUBBLE_DURATION,
    };
    const msg: ChatMessage = {
      id: `m_${now}`,
      authorId: 'local',
      authorName: 'You',
      text: text.trim(),
      timestamp: now,
    };

    setState(prev => ({
      ...prev,
      chatBubbles: [...prev.chatBubbles, bubble],
      chatHistory: [...prev.chatHistory, msg],
    }));

    // NPC auto-reply after 1-2s
    const replies = [
      'Мяу! 🐱', 'Круто!', '*нюхает*', 'Гав!', '🎮', 'Офис бомба!',
      '*виляет хвостом*', 'Чай будешь?', '☕', '*прыг-прыг*', 'Смотри на доску',
    ];
    setTimeout(() => {
      const npcId = Math.random() > 0.5 ? 'npc1' : 'npc2';
      const npcName = npcId === 'npc1' ? 'Мурка' : 'Зайка';
      const reply = replies[Math.floor(Math.random() * replies.length)];
      const replyBubble: ChatBubble = {
        id: `b_${Date.now()}`,
        animalId: npcId,
        text: reply,
        timestamp: Date.now(),
        duration: CHAT_BUBBLE_DURATION,
      };
      const replyMsg: ChatMessage = {
        id: `m_${Date.now()}`,
        authorId: npcId,
        authorName: npcName,
        text: reply,
        timestamp: Date.now(),
      };
      setState(prev => ({
        ...prev,
        chatBubbles: [...prev.chatBubbles, replyBubble],
        chatHistory: [...prev.chatHistory, replyMsg],
      }));
    }, 1000 + Math.random() * 1500);
  }, []);

  // ── Game tick ─────────────────────────────────────
  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const k = keysRef.current;
      const prev = stateRef.current;

      let animal = prev.localAnimal;
      let moved = false;
      let dir: Direction = animal.direction;
      let dx = 0;
      let dy = 0;

      // Movement — WASD controls the animal directly
      if (k.up)    { dy = -MOVE_SPEED; dir = 'up'; }
      if (k.down)  { dy = MOVE_SPEED; dir = 'down'; }
      if (k.left)  { dx = -MOVE_SPEED; dir = 'left'; }
      if (k.right) { dx = MOVE_SPEED; dir = 'right'; }

      if (dx !== 0 || dy !== 0) {
        const newX = animal.pos.x + dx;
        const newY = animal.pos.y + dy;
        const newTX = Math.floor(newX / TILE_SIZE);
        const newTY = Math.floor(newY / TILE_SIZE);

        if (isWalkable(prev.room, newTX, newTY)) {
          animal = {
            ...animal,
            pos: { x: newX, y: newY },
            tilePos: { x: newTX, y: newTY },
            direction: dir,
            state: 'walking',
            frame: (animal.frame + 1) % 16,
          };
          moved = true;
        } else {
          animal = { ...animal, direction: dir, state: 'idle' };
        }
      } else {
        if (animal.state !== 'idle') {
          animal = { ...animal, state: 'idle' };
          moved = true;
        }
      }

      // Emit multiplayer updates
      if (moved && mp?.emitMove) {
        mp.emitMove(animal.pos, animal.tilePos, animal.direction, animal.state, animal.frame);
      }

      // Camera follows animal (centered)
      const SCALE = 3;
      const camX = animal.pos.x * SCALE - canvasWidth / 2 + 8 * SCALE;
      const camY = animal.pos.y * SCALE - canvasHeight / 2 + 8 * SCALE;

      // Clean expired bubbles
      const now = Date.now();
      const chatBubbles = prev.chatBubbles.filter(b => now - b.timestamp < b.duration);

      if (moved || chatBubbles.length !== prev.chatBubbles.length) {
        setState(prev2 => ({
          ...prev2,
          localAnimal: animal,
          chatBubbles,
          camera: { x: camX, y: camY },
        }));
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [canvasWidth, canvasHeight]);

  // ── Keyboard listeners ────────────────────────────
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return { state, sendMessage };
}
