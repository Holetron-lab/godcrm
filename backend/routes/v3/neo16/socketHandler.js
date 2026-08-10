/**
 * 16Neo — Socket.IO handler for multiplayer office
 * Manages: room join/leave, player position sync, chat relay, pet state
 */

// In-memory room state (single-server, no Redis needed yet)
const rooms = new Map(); // roomId -> { players: Map<socketId, PlayerState>, pets: Map<petId, PetState> }

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { players: new Map(), pets: new Map() });
  }
  return rooms.get(roomId);
}

export function initNeo16Socket(io) {
  const neo = io.of('/neo16');

  neo.on('connection', (socket) => {
    let currentRoomId = null;
    let playerData = null;

    // ── Join room ──────────────────────────────────
    socket.on('room:join', ({ roomId, player, pet }) => {
      currentRoomId = roomId || 'default-office';
      playerData = {
        id: socket.id,
        name: player?.name || `User-${socket.id.slice(0, 4)}`,
        pos: player?.pos || { x: 112, y: 96 },
        tilePos: player?.tilePos || { x: 7, y: 6 },
        direction: 'down',
        state: 'idle',
        frame: 0,
        color: player?.color || '#457b9d',
      };

      socket.join(currentRoomId);
      const room = getOrCreateRoom(currentRoomId);
      room.players.set(socket.id, playerData);

      // Register pet if provided
      if (pet) {
        const petData = {
          id: `pet_${socket.id}`,
          name: pet.name || 'Pet',
          species: pet.species || 'corgi',
          pos: pet.pos || { x: 80, y: 96 },
          tilePos: pet.tilePos || { x: 5, y: 6 },
          direction: 'down',
          mood: pet.mood || 'happy',
          frame: 0,
          ownerId: socket.id,
        };
        room.pets.set(petData.id, petData);
      }

      // Send current room state to the joining player
      socket.emit('room:state', {
        players: Object.fromEntries(room.players),
        pets: Object.fromEntries(room.pets),
      });

      // Notify others
      socket.to(currentRoomId).emit('player:joined', {
        player: playerData,
        pet: pet ? room.pets.get(`pet_${socket.id}`) : null,
      });
    });

    // ── Player position update (throttled by client) ──
    socket.on('player:move', ({ pos, tilePos, direction, state, frame }) => {
      if (!currentRoomId) return;
      const room = getOrCreateRoom(currentRoomId);
      const p = room.players.get(socket.id);
      if (!p) return;

      p.pos = pos;
      p.tilePos = tilePos;
      p.direction = direction;
      p.state = state;
      p.frame = frame;

      // Broadcast to others in room
      socket.to(currentRoomId).volatile.emit('player:moved', {
        id: socket.id,
        pos, tilePos, direction, state, frame,
      });
    });

    // ── Pet position update ───────────────────────
    socket.on('pet:move', ({ petId, pos, tilePos, direction, mood }) => {
      if (!currentRoomId) return;
      const room = getOrCreateRoom(currentRoomId);
      const pet = room.pets.get(petId);
      if (!pet || pet.ownerId !== socket.id) return;

      pet.pos = pos;
      pet.tilePos = tilePos;
      pet.direction = direction;
      if (mood) pet.mood = mood;

      socket.to(currentRoomId).volatile.emit('pet:moved', {
        petId, pos, tilePos, direction, mood,
      });
    });

    // ── Chat message ──────────────────────────────
    socket.on('chat:message', ({ text }) => {
      if (!currentRoomId || !playerData || !text?.trim()) return;

      const msg = {
        id: `msg_${Date.now()}_${socket.id.slice(0, 4)}`,
        authorId: socket.id,
        authorName: playerData.name,
        text: text.trim().slice(0, 500), // limit length
        timestamp: Date.now(),
      };

      // Broadcast to everyone in room (including sender)
      neo.to(currentRoomId).emit('chat:message', msg);
    });

    // ── Disconnect ────────────────────────────────
    socket.on('disconnect', () => {
      if (!currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      room.players.delete(socket.id);
      room.pets.delete(`pet_${socket.id}`);

      socket.to(currentRoomId).emit('player:left', { id: socket.id });

      // Cleanup empty rooms
      if (room.players.size === 0) {
        rooms.delete(currentRoomId);
      }
    });
  });

  return neo;
}
