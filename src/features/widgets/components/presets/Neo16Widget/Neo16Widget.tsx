/**
 * 16Neo Widget — 16-bit Pixel Art Virtual Office
 * User IS their animal avatar — moves through the office as their pixel pet
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresetWidgetProps } from '../../../types/widget.types';
import { Neo16Renderer } from './renderer';
import { useGameLoop } from './useGameLoop';
import { useMultiplayer } from './useMultiplayer';
import { PALETTE, SPECIES_CONFIG } from './types';

// ── Chat Panel ───────────────────────────────────────
function ChatPanel({
  messages,
  onSend,
  onClose,
}: {
  messages: { id: string; authorName: string; text: string; timestamp: number }[];
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSend(input);
      setInput('');
    }
  };

  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex flex-col border-l"
      style={{
        width: 280,
        backgroundColor: PALETTE.deepNight,
        borderColor: PALETTE.darkWall,
        fontFamily: 'monospace',
        zIndex: 10,
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: PALETTE.darkWall, color: PALETTE.cyan }}
      >
        <span className="text-sm font-bold">💬 Chat</span>
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 rounded hover:opacity-80"
          style={{ backgroundColor: PALETTE.darkWall, color: PALETTE.pale }}
        >
          ESC
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs" style={{ color: PALETTE.midGrey }}>
            Press Enter to chat...
          </p>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="text-xs">
            <span style={{ color: msg.authorId === 'local' ? PALETTE.cyan : PALETTE.peach }}>
              {msg.authorName}
            </span>
            <span style={{ color: PALETTE.lightGrey }}> {msg.text}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-t" style={{ borderColor: PALETTE.darkWall }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type message..."
          autoFocus
          className="w-full px-2 py-1 text-xs rounded outline-none"
          style={{
            backgroundColor: PALETTE.darkWall,
            color: PALETTE.pale,
            border: `1px solid ${PALETTE.shadow}`,
            fontFamily: 'monospace',
          }}
          onKeyDown={e => e.stopPropagation()}
        />
      </form>
    </div>
  );
}

// ── HUD / Status Bar ─────────────────────────────────
function HUD({ animalName, species, mood, tilePos }: {
  animalName: string;
  species: string;
  mood: string;
  tilePos: { x: number; y: number };
}) {
  const cfg = SPECIES_CONFIG[species as keyof typeof SPECIES_CONFIG];
  const emoji = cfg?.label ?? '🐾';

  return (
    <div
      className="absolute top-2 left-2 flex items-center gap-3 px-3 py-1.5 rounded"
      style={{
        backgroundColor: `${PALETTE.deepNight}dd`,
        fontFamily: 'monospace',
        fontSize: 11,
        color: PALETTE.pale,
        zIndex: 5,
      }}
    >
      <span style={{ color: PALETTE.cyan }}>{emoji} {animalName}</span>
      <span>|</span>
      <span style={{ color: PALETTE.peach }}>{mood}</span>
      <span>|</span>
      <span style={{ color: PALETTE.midGrey }}>({tilePos.x},{tilePos.y})</span>
    </div>
  );
}

function Controls() {
  return (
    <div
      className="absolute bottom-2 left-2 flex items-center gap-2 px-3 py-1.5 rounded"
      style={{
        backgroundColor: `${PALETTE.deepNight}dd`,
        fontFamily: 'monospace',
        fontSize: 10,
        color: PALETTE.midGrey,
        zIndex: 5,
      }}
    >
      <span><kbd style={{ color: PALETTE.pale }}>WASD</kbd> move</span>
      <span>|</span>
      <span><kbd style={{ color: PALETTE.pale }}>Enter</kbd> chat</span>
    </div>
  );
}

// ── Main Widget ──────────────────────────────────────
export function Neo16Widget({ widget: _widget }: PresetWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Neo16Renderer | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const mp = useMultiplayer('You');
  const { state, sendMessage } = useGameLoop(size.w, size.h, {
    emitMove: mp.emitMove,
  });

  // ── Init renderer ─────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new Neo16Renderer();
    rendererRef.current = renderer;

    renderer.init(canvasRef.current).catch(console.error);

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // ── Resize observer ───────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
      rendererRef.current?.resize(Math.floor(width), Math.floor(height));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Render loop ───────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    let rafId: number;
    const draw = () => {
      const s = state;
      // All entities are animals — local + NPCs + remote players
      const allAnimals = [s.localAnimal, ...s.remoteAnimals, ...mp.remotePlayers];
      renderer.render(s.room, allAnimals, s.chatBubbles, s.camera);
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [state]);

  const handleCloseChat = useCallback(() => {
    // Rely on Enter key toggle from useGameLoop
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ backgroundColor: PALETTE.deepNight, imageRendering: 'pixelated' }}
      tabIndex={0}
    >
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        style={{
          width: '100%',
          height: '100%',
          imageRendering: 'pixelated',
        }}
      />

      {/* HUD */}
      <HUD
        animalName={state.localAnimal.name}
        species={state.localAnimal.species}
        mood={state.localAnimal.mood}
        tilePos={state.localAnimal.tilePos}
      />

      {/* Connection status */}
      <div
        className="absolute top-2 right-2 flex items-center gap-2 px-2 py-1 rounded"
        style={{
          backgroundColor: `${PALETTE.deepNight}dd`,
          fontFamily: 'monospace',
          fontSize: 10,
          color: mp.connected ? PALETTE.freshGreen : PALETTE.red,
          zIndex: 5,
        }}
      >
        <span>{mp.connected ? '●' : '○'} {mp.playerCount} online</span>
      </div>

      {/* Controls hint */}
      <Controls />

      {/* Chat Panel */}
      {state.showChatPanel && (
        <ChatPanel
          messages={mp.connected ? mp.chatMessages : state.chatHistory}
          onSend={(text) => {
            if (mp.connected) {
              mp.emitChat(text);
            } else {
              sendMessage(text);
            }
          }}
          onClose={handleCloseChat}
        />
      )}
    </div>
  );
}
