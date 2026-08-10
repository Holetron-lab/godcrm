// @vitest-environment jsdom
// ADR-0031 §Z / WP-24 — ChatLinkCard render + grouping contracts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import ChatLinkCard from '../ChatTurn/ChatLinkCard';
import {
  groupMovedSourceStubs,
  groupMovedTarget,
  buildMovedFromBannerIndex,
} from '../ChatTurn/movedGrouping';
import type { ChatMessage } from '../../../types';

// Stub lucide icons so render tests stay snappy.
vi.mock('lucide-react', () => {
  const stub = (testid: string) => (p: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid={testid} {...p} />
  );
  return {
    Bot: stub('bot'),
    ChevronDown: stub('chevron-down'),
    ChevronUp: stub('chevron-up'),
    Inbox: stub('inbox'),
    Link2: stub('link2'),
    MessageCircle: stub('message-circle'),
    Users: stub('users'),
    User: stub('user'),
  };
});

// Mock the hook with a controllable singleton.
const mockSummaryState: { data?: unknown; isLoading: boolean; error?: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
vi.mock('../../../../../hooks/useChatSummary', () => ({
  useChatSummary: () => mockSummaryState,
}));

afterEach(() => {
  cleanup();
  mockSummaryState.data = undefined;
  mockSummaryState.isLoading = false;
  mockSummaryState.error = undefined;
});

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      {ui}
    </QueryClientProvider>
  );
};

const movedMsg = (id: number, target: number, ids: number[], batchId?: string, ts = '2026-05-08T10:00:00Z'): ChatMessage => ({
  id: String(id),
  role: 'user',
  content: '',
  contentType: 'moved',
  timestamp: new Date(ts),
  metadata: {
    moved_to: { conversation_id: target, message_id: ids[0], message_ids: ids, batch_id: batchId },
  },
});

const targetMsg = (id: number, source: number, sourceMsgId: number, batchId?: string, ts = '2026-05-08T10:00:00Z'): ChatMessage => ({
  id: String(id),
  role: 'user',
  content: 'hi',
  timestamp: new Date(ts),
  metadata: {
    moved_from: { conversation_id: source, message_id: sourceMsgId, batch_id: batchId },
  },
});

describe('ChatLinkCard — render states', () => {
  it('renders skeleton on loading', () => {
    mockSummaryState.isLoading = true;
    const { container } = render(wrap(
      <ChatLinkCard conversationId={42} direction="forward" />
    ));
    expect(container.querySelector('[data-chatlinkcard-state="loading"]')).toBeTruthy();
  });

  it('renders gray plate on forbidden', () => {
    mockSummaryState.error = { kind: 'forbidden' };
    render(wrap(<ChatLinkCard conversationId={42} direction="forward" />));
    expect(screen.getByText(/Нет доступа к чату #42/i)).toBeTruthy();
  });

  it('renders gray plate on deleted', () => {
    mockSummaryState.data = { id: 42, title: 't', deleted: true };
    render(wrap(<ChatLinkCard conversationId={42} direction="forward" />));
    expect(screen.getByText(/Чат удалён #42/i)).toBeTruthy();
  });

  it('renders header with mover name and forward title row referencing target chat', () => {
    mockSummaryState.data = {
      id: 42,
      title: 'Project chat',
      type: 'group',
      created_at: '2026-05-09T10:00:00Z',
      participants: [{ id: 1, name: 'Alice', avatar: null }],
      participants_total: 3,
      message_count: 481,
      unread_count: 1,
      agent: null,
      bound_row: null,
      icon: null,
      deleted: false,
    };
    render(wrap(
      <ChatLinkCard
        conversationId={42}
        direction="forward"
        count={5}
        movedBy={{ user_id: 9, name: 'GERATRON', avatar: null }}
      />
    ));
    // Header: who moved
    expect(screen.getByText(/Перенесено · GERATRON/)).toBeTruthy();
    // Title row: tiny inline icon + "в «Project chat»" (no #id)
    expect(screen.getByText(/в «Project chat»/)).toBeTruthy();
    // Combined meta line: #id · type · N уч. · created date
    expect(screen.getByText(/#42 · Группа · 3 уч\. · 9 мая/)).toBeTruthy();
    // Right side of footer: moved count (shortened — 5 сообщ.)
    expect(screen.getByText(/5 сообщ\./)).toBeTruthy();
  });

  it('renders backward title row with "из" preposition', () => {
    mockSummaryState.data = {
      id: 7,
      title: 'Source',
      type: 'direct',
      participants: [],
      participants_total: 0,
      message_count: 0,
      agent: null,
      bound_row: null,
      icon: null,
      deleted: false,
    };
    render(wrap(
      <ChatLinkCard
        conversationId={7}
        direction="backward"
        movedBy={{ user_id: 1, name: 'Bob', avatar: null }}
      />
    ));
    expect(screen.getByText(/из «Source»/)).toBeTruthy();
    expect(screen.getByText(/Перенесено · Bob/)).toBeTruthy();
  });

  it('renders linked-row chip when bound_row present', () => {
    mockSummaryState.data = {
      id: 42,
      title: 'ADR chat',
      type: 'row',
      created_at: '2026-05-04T10:00:00Z',
      participants: [],
      participants_total: 6,
      message_count: 50,
      unread_count: 0,
      agent: null,
      bound_row: { table_id: 2197, row_id: 139259, title: 'ADR-0031', table_name: 'Реестр документов' },
      icon: null,
      deleted: false,
    };
    render(wrap(
      <ChatLinkCard conversationId={42} direction="forward" count={3} movedBy={{ name: 'X' }} />
    ));
    expect(screen.getByText(/ADR-0031/)).toBeTruthy();
    expect(screen.getByText(/Реестр документов/)).toBeTruthy();
  });

  it('renders header without name when movedBy missing (legacy data)', () => {
    mockSummaryState.data = {
      id: 7,
      title: 'Old chat',
      type: 'direct',
      participants: [],
      participants_total: 0,
      message_count: 0,
      agent: null,
      bound_row: null,
      icon: null,
      deleted: false,
    };
    render(wrap(<ChatLinkCard conversationId={7} direction="backward" />));
    // Header shows just "Перенесено" without trailing name when actor unknown.
    const header = screen.getByText(/^Перенесено$/);
    expect(header).toBeTruthy();
  });

  it('click invokes onClick with conversationId + firstMessageId', () => {
    mockSummaryState.data = {
      id: 42, title: 'X', type: 'group',
      participants: [], participants_total: 0,
      agent: null, bound_row: null, icon: null, deleted: false,
    };
    const onClick = vi.fn();
    const { container } = render(wrap(
      <ChatLinkCard conversationId={42} direction="forward" firstMessageId={999} onClick={onClick} />
    ));
    // The card root is a wrapper <div>; the inner navigate <button> is the
    // one that fires onClick (a separate chevron button toggles expand).
    const root = container.querySelector('[data-chatlinkcard="true"]') as HTMLElement;
    expect(root).toBeTruthy();
    const navBtn = root.querySelector('button[title^="Открыть"]') as HTMLButtonElement;
    expect(navBtn).toBeTruthy();
    fireEvent.click(navBtn);
    expect(onClick).toHaveBeenCalledWith(42, 999);
  });
});

describe('groupMovedSourceStubs — forward grouping', () => {
  it('groups consecutive same-batch stubs into one group', () => {
    const msgs: ChatMessage[] = [
      movedMsg(1, 42, [201, 202, 203], 'b1'),
      movedMsg(2, 42, [201, 202, 203], 'b1'),
      movedMsg(3, 42, [201, 202, 203], 'b1'),
    ];
    const groups = groupMovedSourceStubs(msgs);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].conversationId).toBe(42);
    expect(groups[0].firstMessageId).toBe(201);
  });

  it('starts a new group when batch_id changes', () => {
    const msgs: ChatMessage[] = [
      movedMsg(1, 42, [201], 'b1'),
      movedMsg(2, 42, [301], 'b2'),
    ];
    const groups = groupMovedSourceStubs(msgs);
    expect(groups).toHaveLength(2);
  });

  it('falls back to adjacency when batch_id missing', () => {
    const msgs: ChatMessage[] = [
      movedMsg(1, 42, [201], undefined, '2026-05-08T10:00:00Z'),
      movedMsg(2, 42, [202], undefined, '2026-05-08T10:00:30Z'),
      // gap > 60s — new group
      movedMsg(3, 42, [203], undefined, '2026-05-08T10:05:00Z'),
    ];
    const groups = groupMovedSourceStubs(msgs);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[1].count).toBe(1);
  });

  it('separates groups by conversationId even with same batch', () => {
    const msgs: ChatMessage[] = [
      movedMsg(1, 42, [201], 'b1'),
      movedMsg(2, 99, [301], 'b1'),
    ];
    const groups = groupMovedSourceStubs(msgs);
    expect(groups).toHaveLength(2);
  });
});

describe('groupMovedTarget — backward grouping', () => {
  it('groups consecutive moved_from messages with same batch_id', () => {
    const msgs: ChatMessage[] = [
      targetMsg(101, 42, 201, 'b1'),
      targetMsg(102, 42, 202, 'b1'),
      targetMsg(103, 42, 203, 'b1'),
    ];
    const groups = groupMovedTarget(msgs);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].firstMessageId).toBe(201);
  });

  it('skips messages without moved_from', () => {
    const msgs: ChatMessage[] = [
      targetMsg(101, 42, 201, 'b1'),
      { id: '102', role: 'user', content: 'plain', timestamp: new Date() } as ChatMessage,
      targetMsg(103, 42, 203, 'b1'),
    ];
    const groups = groupMovedTarget(msgs);
    // Plain message breaks adjacency → 2 separate groups
    expect(groups).toHaveLength(2);
  });

  it('buildMovedFromBannerIndex puts banner only on the head', () => {
    const msgs: ChatMessage[] = [
      targetMsg(101, 42, 201, 'b1'),
      targetMsg(102, 42, 202, 'b1'),
      targetMsg(103, 42, 203, 'b1'),
    ];
    const idx = buildMovedFromBannerIndex(msgs);
    expect(idx.has('101')).toBe(true);
    expect(idx.has('102')).toBe(false);
    expect(idx.has('103')).toBe(false);
  });
});

beforeEach(() => {
  // ensure clean mock state on each test
  mockSummaryState.data = undefined;
  mockSummaryState.isLoading = false;
  mockSummaryState.error = undefined;
});
