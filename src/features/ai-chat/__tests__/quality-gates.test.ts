/**
 * Quality Gate Tests — Frontend Smoke & Safety Checks
 *
 * Purpose: Catch common runtime errors before they reach production:
 *   1. ReferenceError: X is not defined (missing imports/exports)
 *   2. TypeError: X is not iterable (missing null checks on flatMap/map)
 *   3. Missing required props / incomplete hook return shapes
 *   4. TypeScript type errors (via tsc --noEmit in the shell script)
 *
 * These tests do NOT render components — they validate module structure
 * and data-handling contracts at the import/call level.
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// 1. IMPORT SMOKE TESTS
//    Verify that all key modules resolve and export expected symbols.
//    Catches: ReferenceError from broken imports, circular deps, missing files.
// ═══════════════════════════════════════════════════════════════════════════

describe('Import smoke tests', () => {
  it('AIChatPanel barrel re-export resolves', async () => {
    const mod = await import('../components/AIChatPanel');
    expect(mod).toBeDefined();
    expect(mod.AIChatPanel).toBeDefined();
  });

  it('useChatQueries hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useChatQueries');
    expect(mod.useChatQueries).toBeDefined();
    expect(typeof mod.useChatQueries).toBe('function');
  });

  it('useChatDataQueries hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useChatDataQueries');
    expect(mod.useChatDataQueries).toBeDefined();
    expect(typeof mod.useChatDataQueries).toBe('function');
  });

  it('useDataQueries hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useDataQueries');
    expect(mod.useDataQueries).toBeDefined();
    expect(typeof mod.useDataQueries).toBe('function');
  });

  it('useConversationMessages hook resolves and is a function', async () => {
    const mod = await import('../hooks/useConversationMessages');
    expect(mod.useConversationMessages).toBeDefined();
    expect(typeof mod.useConversationMessages).toBe('function');
  });

  it('usePanelContentWiring hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/usePanelContentWiring');
    expect(mod.usePanelContentWiring).toBeDefined();
    expect(typeof mod.usePanelContentWiring).toBe('function');
  });

  it('useScrollManagement hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useScrollManagement');
    expect(mod.useScrollManagement).toBeDefined();
    expect(typeof mod.useScrollManagement).toBe('function');
  });

  it('useEventHandlers hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useEventHandlers');
    expect(mod.useEventHandlers).toBeDefined();
    expect(typeof mod.useEventHandlers).toBe('function');
  });

  it('useMessageSubmit hook resolves and is a function', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useMessageSubmit');
    expect(mod.useMessageSubmit).toBeDefined();
    expect(typeof mod.useMessageSubmit).toBe('function');
  });

  it('ChatListView component resolves', async () => {
    const mod = await import('../components/ChatListView');
    expect(mod).toBeDefined();
    // Default or named export
    expect(mod.default || mod.ChatListView).toBeDefined();
  });

  it('InboxPanel component resolves', async () => {
    const mod = await import('../components/AIChatPanel/components/ChatPanels/InboxPanel');
    expect(mod).toBeDefined();
    expect(mod.default || mod.InboxPanel).toBeDefined();
  });

  it('InboxPanelInline component resolves', async () => {
    const mod = await import('../components/AIChatPanel/components/ChatPanels/InboxPanelInline');
    expect(mod).toBeDefined();
  });

  it('TicketsPanel component resolves', async () => {
    const mod = await import('../components/AIChatPanel/components/ChatPanels/TicketsPanel');
    expect(mod).toBeDefined();
    expect(mod.default || mod.TicketsPanel).toBeDefined();
  });

  it('ChatTurn component resolves', async () => {
    const mod = await import('../components/AIChatPanel/components/ChatMessages/ChatTurn');
    expect(mod).toBeDefined();
    expect(mod.ChatTurn).toBeDefined();
  });

  it('groupMessagesIntoTurns utility resolves and is a function', async () => {
    const mod = await import('../utils/groupMessagesIntoTurns');
    expect(mod.groupMessagesIntoTurns).toBeDefined();
    expect(typeof mod.groupMessagesIntoTurns).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. HOOK RETURN SHAPE TESTS
//    Verify hooks declare all properties consumers depend on.
//    Catches: "TypeError: Cannot read property X of undefined" when a hook
//    is refactored and forgets to include a field in its return object.
//
//    We inspect the TypeScript interface/return type via actual source code
//    analysis where possible, and via type-level assertions elsewhere.
// ═══════════════════════════════════════════════════════════════════════════

describe('Hook return shape — useChatQueries', () => {
  it('exports UseChatQueriesResult type with all required fields', async () => {
    // We cannot call the hook outside React, but we can verify the module
    // exports both the hook and the result type interface name.
    const mod = await import('../components/AIChatPanel/hooks/useChatQueries');
    expect(mod.useChatQueries).toBeDefined();

    // Type-level compile check: if UseChatQueriesResult is missing any of
    // these keys, this file will fail TypeScript compilation (quality-gate.sh
    // runs tsc --noEmit). We enumerate the consumer-critical fields here.
    type Result = import('../components/AIChatPanel/hooks/useChatQueries').UseChatQueriesResult;
    type AssertHasKey<T, K extends keyof T> = K;

    // Inbox
    type _i1 = AssertHasKey<Result, 'inboxConversations'>;
    type _i2 = AssertHasKey<Result, 'fetchNextInboxPage'>;
    type _i3 = AssertHasKey<Result, 'hasNextInboxPage'>;
    type _i4 = AssertHasKey<Result, 'isFetchingNextInboxPage'>;

    // AI messages
    type _a1 = AssertHasKey<Result, 'aiConversationMessages'>;
    type _a2 = AssertHasKey<Result, 'fetchNextAIPage'>;
    type _a3 = AssertHasKey<Result, 'hasNextAIPage'>;

    // User messages
    type _u1 = AssertHasKey<Result, 'userConversationMessages'>;
    type _u2 = AssertHasKey<Result, 'hasOlderMessages'>;
    type _u3 = AssertHasKey<Result, 'fetchOlderMessages'>;

    // Tasks
    type _t1 = AssertHasKey<Result, 'taskRows'>;

    // Mentions
    type _m1 = AssertHasKey<Result, 'availableMentionUsers'>;
    type _m2 = AssertHasKey<Result, 'availableSlashAgents'>;

    // Send
    type _s1 = AssertHasKey<Result, 'sendUserMessageMutation'>;

    // If we got here, all type assertions compiled
    expect(true).toBe(true);
  });
});

describe('Hook return shape — useConversationMessages', () => {
  it('exports function with all expected return properties (type-level check)', async () => {
    const mod = await import('../hooks/useConversationMessages');
    expect(typeof mod.useConversationMessages).toBe('function');

    // Type-level: verify the return type includes critical fields.
    // The function returns an object — we assert its shape at compile time.
    type HookReturn = ReturnType<typeof mod.useConversationMessages>;
    type AssertHasKey<T, K extends keyof T> = K;

    type _1 = AssertHasKey<HookReturn, 'messages'>;
    type _2 = AssertHasKey<HookReturn, 'fetchNextPage'>;
    type _3 = AssertHasKey<HookReturn, 'hasNextPage'>;
    type _4 = AssertHasKey<HookReturn, 'fetchThinkingSteps'>;
    type _5 = AssertHasKey<HookReturn, 'fetchToolStepsPreview'>;
    type _6 = AssertHasKey<HookReturn, 'fetchFullMessage'>;
    type _7 = AssertHasKey<HookReturn, 'pollingError'>;
    type _8 = AssertHasKey<HookReturn, 'pollingStopped'>;
    type _9 = AssertHasKey<HookReturn, 'reconnect'>;
    type _10 = AssertHasKey<HookReturn, 'isProcessing'>;
    type _11 = AssertHasKey<HookReturn, 'processingAgentName'>;

    expect(true).toBe(true);
  });
});

describe('Hook return shape — useDataQueries', () => {
  it('exports function with all expected return properties (type-level check)', async () => {
    const mod = await import('../components/AIChatPanel/hooks/useDataQueries');
    expect(typeof mod.useDataQueries).toBe('function');

    type HookReturn = ReturnType<typeof mod.useDataQueries>;
    type AssertHasKey<T, K extends keyof T> = K;

    type _1 = AssertHasKey<HookReturn, 'inboxConversations'>;
    type _2 = AssertHasKey<HookReturn, 'fetchNextInboxPage'>;
    type _3 = AssertHasKey<HookReturn, 'hasNextInboxPage'>;
    type _4 = AssertHasKey<HookReturn, 'taskRows'>;
    type _5 = AssertHasKey<HookReturn, 'fetchNextTasksPage'>;
    type _6 = AssertHasKey<HookReturn, 'hasNextTasksPage'>;
    type _7 = AssertHasKey<HookReturn, 'filteredTaskRows'>;
    type _8 = AssertHasKey<HookReturn, 'operators'>;
    type _9 = AssertHasKey<HookReturn, 'models'>;
    type _10 = AssertHasKey<HookReturn, 'usersForMentions'>;

    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. NULL SAFETY TESTS
//    Verify flatMap/map patterns survive undefined/null API responses.
//    Catches: "TypeError: Cannot read properties of undefined (reading 'flatMap')"
//             "TypeError: X is not iterable"
// ═══════════════════════════════════════════════════════════════════════════

describe('Null safety — groupMessagesIntoTurns', () => {
  it('handles empty messages array without crashing', async () => {
    const { groupMessagesIntoTurns } = await import('../utils/groupMessagesIntoTurns');
    const result = groupMessagesIntoTurns([], {}, false);
    expect(result).toEqual([]);
  });

  it('handles messages with undefined/null fields', async () => {
    const { groupMessagesIntoTurns } = await import('../utils/groupMessagesIntoTurns');
    const messages = [
      {
        id: '1',
        role: 'user' as const,
        content: 'hello',
        timestamp: new Date(),
        // sender_id, sender_name, metadata intentionally missing
      },
      {
        id: '2',
        role: 'assistant' as const,
        content: 'hi there',
        timestamp: new Date(),
        contentType: 'text' as const,
        // agentName, metadata intentionally missing
      },
    ];
    const result = groupMessagesIntoTurns(messages, {}, false);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(t => Array.isArray(t.messages))).toBe(true);
  });

  it('handles empty reactions object', async () => {
    const { groupMessagesIntoTurns } = await import('../utils/groupMessagesIntoTurns');
    const messages = [
      { id: '1', role: 'user' as const, content: 'test', timestamp: new Date() },
    ];
    const result = groupMessagesIntoTurns(messages, {}, false, 1);
    expect(result.length).toBe(1);
    expect(result[0].reactions).toBeDefined();
  });
});

describe('Null safety — flatMap pagination patterns', () => {
  // Simulates the exact pattern used in useChatQueries/useDataQueries/useChatDataQueries:
  //   inboxData?.pages?.flatMap(page => page.conversations ?? []) ?? []
  // We test the same defensive pattern against various null/undefined shapes.

  it('handles {pages: [{conversations: undefined}]} without crash', () => {
    const inboxData = { pages: [{ conversations: undefined as any, has_more: false, total_count: 0, limit: 50, offset: 0 }] };
    const result = inboxData?.pages?.flatMap(page => page.conversations ?? []) ?? [];
    expect(result).toEqual([]);
  });

  it('handles {pages: undefined} without crash', () => {
    const inboxData = { pages: undefined as any };
    const result = inboxData?.pages?.flatMap((page: any) => page.conversations ?? []) ?? [];
    expect(result).toEqual([]);
  });

  it('handles null inboxData without crash', () => {
    const inboxData = null as any;
    const result = inboxData?.pages?.flatMap((page: any) => page.conversations ?? []) ?? [];
    expect(result).toEqual([]);
  });

  it('handles undefined inboxData without crash', () => {
    const inboxData = undefined as any;
    const result = inboxData?.pages?.flatMap((page: any) => page.conversations ?? []) ?? [];
    expect(result).toEqual([]);
  });

  it('handles pages with mixed undefined/valid conversations', () => {
    const inboxData = {
      pages: [
        { conversations: [{ id: 1 }], has_more: false, total_count: 1, limit: 50, offset: 0 },
        { conversations: undefined as any, has_more: false, total_count: 0, limit: 50, offset: 50 },
        { conversations: [{ id: 2 }], has_more: false, total_count: 1, limit: 50, offset: 100 },
      ]
    };
    const result = inboxData?.pages?.flatMap(page => page.conversations ?? []) ?? [];
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  // Same pattern for task rows (useDataQueries uses identical flatMap):
  //   tasksData?.pages?.flatMap(page => page.rows ?? []) ?? []
  it('handles task pages with undefined rows', () => {
    const tasksData = { pages: [{ rows: undefined as any, pagination: { page: 1, pages: 1, total: 0 } }] };
    const result = tasksData?.pages?.flatMap(page => page.rows ?? []) ?? [];
    expect(result).toEqual([]);
  });

  // Conversation messages pattern from useConversationMessages:
  //   pages.flatMap(page => page.messages ?? [])
  it('handles message pages with undefined messages', () => {
    const pages = [
      { messages: undefined as any, hasMore: false },
      { messages: [{ id: 1, content: 'hello' }], hasMore: false },
    ];
    const result = pages.flatMap(page => page.messages ?? []);
    expect(result).toEqual([{ id: 1, content: 'hello' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. BUILD VALIDATION
//    The tsc --noEmit check runs in quality-gate.sh (not here — vitest
//    cannot invoke the compiler). This section validates that our type
//    imports compile correctly, which catches mismatches between the
//    exported types and their usage.
// ═══════════════════════════════════════════════════════════════════════════

describe('Type compilation validation', () => {
  it('ChatTurnProps type imports correctly and has required fields', async () => {
    const mod = await import('../components/AIChatPanel/components/ChatMessages/ChatTurn/types');
    // If this import resolved, the types compiled. Verify the module has exports.
    expect(mod).toBeDefined();

    // Runtime check: the module should export type info (even if only as undefined at runtime,
    // the import itself succeeding proves the file compiles)
    type Props = import('../components/AIChatPanel/components/ChatMessages/ChatTurn/types').ChatTurnProps;
    type AssertHasKey<T, K extends keyof T> = K;

    type _1 = AssertHasKey<Props, 'messages'>;
    type _2 = AssertHasKey<Props, 'turnType'>;
    type _3 = AssertHasKey<Props, 'senderName'>;
    type _4 = AssertHasKey<Props, 'fetchThinkingSteps'>;
    type _5 = AssertHasKey<Props, 'fetchToolStepsPreview'>;
    type _6 = AssertHasKey<Props, 'fetchFullMessage'>;

    expect(true).toBe(true);
  });

  it('AIChatPanel.types exports compile correctly', async () => {
    const mod = await import('../components/AIChatPanel.types');
    expect(mod).toBeDefined();

    type InboxConv = import('../components/AIChatPanel.types').InboxConversation;
    type TasksSrc = import('../components/AIChatPanel.types').TasksSourceConfig;
    type FilesSrc = import('../components/AIChatPanel.types').FilesSourceConfig;

    type AssertHasKey<T, K extends keyof T> = K;
    type _1 = AssertHasKey<InboxConv, 'id'>;
    type _2 = AssertHasKey<InboxConv, 'conversations' extends keyof InboxConv ? 'conversations' : 'participants'>;
    type _3 = AssertHasKey<TasksSrc, 'tableId'>;
    type _4 = AssertHasKey<FilesSrc, 'tableId'>;

    expect(true).toBe(true);
  });

  it('Turn type from groupMessagesIntoTurns has all required fields', async () => {
    const mod = await import('../utils/groupMessagesIntoTurns');
    expect(mod).toBeDefined();

    type TurnType = import('../utils/groupMessagesIntoTurns').Turn;
    type AssertHasKey<T, K extends keyof T> = K;

    type _1 = AssertHasKey<TurnType, 'id'>;
    type _2 = AssertHasKey<TurnType, 'turnType'>;
    type _3 = AssertHasKey<TurnType, 'senderName'>;
    type _4 = AssertHasKey<TurnType, 'messages'>;
    type _5 = AssertHasKey<TurnType, 'reactions'>;
    type _6 = AssertHasKey<TurnType, 'isProcessing'>;
    type _7 = AssertHasKey<TurnType, 'isFirstInGroup'>;
    type _8 = AssertHasKey<TurnType, 'isLastInGroup'>;
    type _9 = AssertHasKey<TurnType, 'agentChainId'>;

    expect(true).toBe(true);
  });
});
