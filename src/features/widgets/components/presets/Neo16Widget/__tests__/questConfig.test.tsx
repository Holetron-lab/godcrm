/**
 * Neo16 W2-S6 — the quest a widget opens comes from the widget row's `config`
 * (`quest_key`, `content_version`), with `DEFAULT_QUEST` only as the fallback for
 * rows that carry no such fields.
 *
 * Proven end-to-end through the real `Neo16Widget` → `LearningPanel` →
 * `useLearningSession` chain: the office's heavy parts (PixiJS renderer, socket
 * multiplayer, game loop) are stubbed, and the HTTP transport is replaced by a
 * recorder so the exact `start_session` payload sent for a given `config` is
 * observed. A quest the server rejects must surface as the server's own error
 * (`QUEST_NOT_FOUND` / `VALIDATION_ERROR`) on the panel — never be swapped for the
 * default quest.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Neo16Widget } from '../Neo16Widget';
import { readQuestConfig } from '../learning/questConfig';
import { DEFAULT_QUEST } from '../learning/useLearningSession';
import {
  Neo16ApiError,
  type Envelope,
  type Neo16Transport,
  type SessionState,
  type StartResult,
} from '../learning/types';
import type { Widget } from '@/features/widgets/types/widget.types';

// ── stubs for the office (not under test) ──────────────────────────────────────

vi.mock('../renderer', () => ({
  Neo16Renderer: class {
    init = vi.fn(async () => undefined);
    resize = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../useMultiplayer', () => ({
  useMultiplayer: () => ({
    connected: false, playerCount: 1, remotePlayers: [], chatMessages: [], emitMove: vi.fn(), emitChat: vi.fn(),
  }),
}));
vi.mock('../useGameLoop', () => ({
  useGameLoop: () => ({
    state: {
      room: {},
      localAnimal: { name: 'You', species: 'cat', mood: 'happy', tilePos: { x: 0, y: 0 } },
      remoteAnimals: [], chatBubbles: [], chatHistory: [], camera: { x: 0, y: 0 }, showChatPanel: false,
    },
    sendMessage: vi.fn(),
  }),
}));

// ── recording transport (replaces the HTTP client the panel builds by default) ──

const starts: Envelope[] = [];
let startImpl: (env: Envelope) => Promise<{ status: number; body: StartResult }>;

vi.mock('../learning/transport', () => ({
  createHttpTransport: (): Neo16Transport => ({
    startSession: (env) => { starts.push(JSON.parse(JSON.stringify(env)) as Envelope); return startImpl(env); },
    sendCommand: vi.fn(async () => { throw new Error('not expected in this test'); }),
    getState: vi.fn(async () => { throw new Error('not expected in this test'); }),
  }),
}));

function stateFor(questKey: string, version: number): SessionState {
  return {
    session: { id: 7, status: 'active', state_version: 0, goals_done: [], quest_key: questKey, content_version: version },
    quest: {
      id: 1, key: questKey, version, title: `Quest ${questKey}`, xp: 10, intro: 'intro',
      preparation: { phrases: [] },
      npcs: [{ key: 'nora', name: 'Nora Blake', role: 'Receptionist' }],
      goals: [{ key: 'g1', intent: 'ask_time', npc: 'nora', title: 'Goal one', requires: [] }],
    },
    turns: [],
    progress: { id: 9, status: 'active', xp: 0, attempts: 1 },
  };
}

const okStart = async (env: Envelope) => {
  const p = env.payload as { quest_key: string; content_version: number };
  return { status: 201, body: { session_id: 7, world_id: 3, resumed: false, progress_id: 9, state: stateFor(p.quest_key, p.content_version) } };
};

const MODULE_TAG = { __module: { key: 'neo16', version: '0.2.0' } };

function makeWidget(config: Record<string, unknown>): Widget {
  return {
    id: 42, dashboard_id: 1, source_widget_id: null, code: null, code_version: 1, description: null,
    is_module: false, module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
    widget_type: 'preset', preset_name: '16neo', title: 'Neo16', icon: '🎮',
    config: config as Widget['config'],
    position: { x: 0, y: 0, w: 12, h: 8 }, is_visible: true, order_index: 0, created_by: 1,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}

beforeAll(() => {
  // jsdom has no ResizeObserver; the widget observes its container for canvas sizing.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  starts.length = 0;
  startImpl = okStart;
});

// ── readQuestConfig (pure) ─────────────────────────────────────────────────────

describe('readQuestConfig', () => {
  it('yields nothing for an empty / non-object / null-field config (→ DEFAULT_QUEST in the hook)', () => {
    expect(readQuestConfig({})).toEqual({});
    expect(readQuestConfig(null)).toEqual({});
    expect(readQuestConfig('x')).toEqual({});
    expect(readQuestConfig({ quest_key: null, content_version: undefined })).toEqual({});
  });

  it('passes present fields through, coercing only numeric strings', () => {
    expect(readQuestConfig({ quest_key: 'office_tour', content_version: 3 })).toEqual({ questKey: 'office_tour', contentVersion: 3 });
    expect(readQuestConfig({ content_version: '2' })).toEqual({ contentVersion: 2 });
    expect(readQuestConfig({ quest_key: 'only_key' })).toEqual({ questKey: 'only_key' });
  });

  it('does not repair a malformed value — it is left for the server to reject', () => {
    const r = readQuestConfig({ quest_key: 'Bad Key', content_version: 'abc' });
    expect(r.questKey).toBe('Bad Key');
    expect(Number.isNaN(r.contentVersion)).toBe(true);
  });
});

// ── Neo16Widget → start_session payload ────────────────────────────────────────

describe('Neo16Widget quest selection from config (W2-S6)', () => {
  it('sends config.quest_key / content_version in start_session and shows that quest', async () => {
    render(<Neo16Widget widget={makeWidget({ ...MODULE_TAG, quest_key: 'office_tour', content_version: 3 })} data={[]} />);

    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0].command).toBe('start_session');
    expect(starts[0].widget_id).toBe(42);
    expect(starts[0].payload).toEqual({ quest_key: 'office_tour', content_version: 3 });
    expect(await screen.findByText(/Quest office_tour/)).toBeInTheDocument();
  });

  it('falls back to DEFAULT_QUEST when the config carries no quest fields', async () => {
    render(<Neo16Widget widget={makeWidget({ ...MODULE_TAG })} data={[]} />);

    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0].payload).toEqual({ quest_key: DEFAULT_QUEST.quest_key, content_version: DEFAULT_QUEST.content_version });
    expect(DEFAULT_QUEST).toEqual({ quest_key: 'arrange_meeting', content_version: 1 });
  });

  it('surfaces QUEST_NOT_FOUND for an unknown config key — no retry with the default quest', async () => {
    startImpl = async () => { throw new Neo16ApiError(404, 'QUEST_NOT_FOUND', 'quest not found'); };
    render(<Neo16Widget widget={makeWidget({ ...MODULE_TAG, quest_key: 'no_such_quest', content_version: 1 })} data={[]} />);

    const notice = await screen.findByTestId('notice-config');
    expect(notice).toHaveTextContent('QUEST_NOT_FOUND');
    expect(notice).toHaveTextContent('no_such_quest@1');
    expect(notice).toHaveAttribute('role', 'alert');
    // exactly one start, with the configured key — the default was never tried
    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toEqual({ quest_key: 'no_such_quest', content_version: 1 });
  });

  it('surfaces VALIDATION_ERROR for a malformed config value instead of repairing it', async () => {
    startImpl = async () => {
      throw new Neo16ApiError(400, 'VALIDATION_ERROR', 'invalid payload', { fieldErrors: { content_version: ['Expected number'] } });
    };
    render(<Neo16Widget widget={makeWidget({ ...MODULE_TAG, quest_key: 'office_tour', content_version: 'abc' })} data={[]} />);

    const notice = await screen.findByTestId('notice-config');
    expect(notice).toHaveTextContent('VALIDATION_ERROR');
    expect(starts).toHaveLength(1);
    // NaN serialises to null on the wire — the server, not the client, decides.
    expect(starts[0].payload.quest_key).toBe('office_tour');
    expect(starts[0].payload.content_version).toBeNull();
  });
});
