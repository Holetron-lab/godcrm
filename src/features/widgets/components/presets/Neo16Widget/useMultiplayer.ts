/**
 * 16Neo — Multiplayer Hook (Socket.IO)
 * All players are animal avatars — no human characters
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { AnimalAvatar, ChatMessage } from './types';
import { PALETTE } from './types';
import type { AnimalSpecies } from './types';

const RANDOM_SPECIES: AnimalSpecies[] = ['corgi', 'cat', 'bunny', 'hamster', 'fox'];
const RANDOM_COLORS = [
  PALETTE.freshGreen, PALETTE.pink, PALETTE.purple, PALETTE.amber,
  PALETTE.cyan, PALETTE.peach, PALETTE.gold, PALETTE.lightRed,
];

export function useMultiplayer(playerName: string, roomId = 'default-office') {
  const socketRef = useRef<Socket | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<AnimalAvatar[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(1);

  useEffect(() => {
    const wsPath = '/neo16-ws';
    const socket = io('/neo16', {
      path: wsPath,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);

      socket.emit('room:join', {
        roomId,
        player: {
          name: playerName,
          species: 'corgi',
          color: RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)],
        },
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('room:state', ({ players }: { players: Record<string, any> }) => {
      const rp: AnimalAvatar[] = [];
      for (const [id, p] of Object.entries(players)) {
        if (id === socket.id) continue;
        rp.push(toAnimal(id, p));
      }
      setRemotePlayers(rp);
      setPlayerCount(Object.keys(players).length);
    });

    socket.on('player:joined', ({ player }: { player: any }) => {
      setRemotePlayers(prev => [...prev.filter(p => p.id !== player.id), toAnimal(player.id, player)]);
      setPlayerCount(prev => prev + 1);
    });

    socket.on('player:moved', ({ id, pos, tilePos, direction, state, frame }: any) => {
      setRemotePlayers(prev =>
        prev.map(p => p.id === id ? { ...p, pos, tilePos, direction, state, frame } : p)
      );
    });

    socket.on('player:left', ({ id }: { id: string }) => {
      setRemotePlayers(prev => prev.filter(p => p.id !== id));
      setPlayerCount(prev => Math.max(1, prev - 1));
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev.slice(-100), msg]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [playerName, roomId]);

  const emitMove = useCallback((pos: any, tilePos: any, direction: string, state: string, frame: number) => {
    socketRef.current?.volatile.emit('player:move', { pos, tilePos, direction, state, frame });
  }, []);

  const emitChat = useCallback((text: string) => {
    socketRef.current?.emit('chat:message', { text });
  }, []);

  return {
    connected,
    playerCount,
    remotePlayers,
    chatMessages,
    emitMove,
    emitChat,
  };
}

function toAnimal(id: string, p: any): AnimalAvatar {
  return {
    id,
    name: p.name || `Player-${id.slice(0, 4)}`,
    ownerName: p.ownerName || p.name || '',
    species: p.species || RANDOM_SPECIES[Math.floor(Math.random() * RANDOM_SPECIES.length)],
    pos: p.pos || { x: 112, y: 96 },
    tilePos: p.tilePos || { x: 7, y: 6 },
    direction: p.direction || 'down',
    state: p.state || 'idle',
    mood: p.mood || 'happy',
    frame: p.frame || 0,
    color: p.color || PALETTE.freshGreen,
    isLocal: false,
  };
}
