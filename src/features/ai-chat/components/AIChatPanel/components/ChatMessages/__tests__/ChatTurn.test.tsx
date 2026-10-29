/**
 * ChatTurn — Unit Tests
 *
 * ADR-082: Consecutive bubble merging
 * AC2: TurnHeader (avatar + name + badge) shown ONLY for the first message
 *      in a consecutive run from the same sender.
 * AC3: user_type badges display correctly for 'human' and 'agent' turns.
 * AC5: Border-radius classes applied based on isFirstInGroup / isLastInGroup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
// ChatTurn's subtree calls useLanguage, which throws without a provider — that
// error aborted module load, so this file reported 0 tests, not 24 failures.
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import type { ChatMessage } from '../../../../../types';
import { groupMessagesIntoTurns } from '../../../../../utils/groupMessagesIntoTurns';

// ─── Icon mocks — inline functions to avoid hoisting issues ─────────────────
// lucide-react is auto-mocked: any icon a component adds resolves to a stub,
// so a new <Icon/> can no longer fail every test in this file (see src/tests/lucideMock.tsx).
vi.mock('lucide-react', async () => (await import('@/tests/lucideMock')).lucideMock({ XCircle: 'x-circle-icon' }));

vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined | null)[]) =>
    classes.filter(Boolean).join(' '),
}));

vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

vi.mock('../ChatAttachmentRenderer', () => ({
  ChatAttachmentRenderer: () => <div data-testid="attachment-renderer" />,
}));

vi.mock('../../../../HighlightedText', () => ({
  HighlightedText: ({ text }: { text: string }) => (
    <span data-testid="highlighted-text">{text}</span>
  ),
}));

vi.mock('../ToolApprovalBubble', () => ({
  ToolApprovalBubble: () => <div data-testid="tool-approval-bubble" />,
}));

vi.mock('../PlanWidget', () => ({
  PlanWidget: ({ tasks }: { tasks: Array<{ id: number; title: string; status: string }> }) => (
    <div data-testid="plan-widget" data-task-count={tasks.length} />
  ),
}));

vi.mock('../../../../../utils/parseToolName', () => ({
  parseToolName: (_content: string) => 'Bash',
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import { ChatTurn } from '../ChatTurn';
import { turnTimeSpan } from '../ChatTurn/helpers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHumanMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date('2024-01-20T10:00:00Z'),
    sender_id: 1,
    ...overrides,
  };
}

function makeAgentMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-2',
    role: 'assistant',
    content: 'Agent response',
    contentType: 'text',
    timestamp: new Date('2024-01-20T10:01:00Z'),
    ...overrides,
  };
}

const defaultHumanProps = {
  messages: [makeHumanMessage()],
  turnType: 'human' as const,
  senderName: 'Alice',
  isFirstInGroup: true,
  isLastInGroup: true,
};

const defaultAgentProps = {
  messages: [makeAgentMessage()],
  turnType: 'agent' as const,
  senderName: 'AI Assistant',
  isFirstInGroup: true,
  isLastInGroup: true,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChatTurn — ADR-082 Consecutive Bubble Merging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── AC2: Header visibility ──────────────────────────────────────────────

  describe('AC2: TurnHeader visibility', () => {
    it('shows sender name when isFirstInGroup=true', () => {
      render(<ChatTurn {...defaultHumanProps} />);
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('hides sender name when isFirstInGroup=false', () => {
      render(<ChatTurn {...defaultHumanProps} isFirstInGroup={false} />);
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });

    it('shows avatar icon when isFirstInGroup=true for human turn', () => {
      render(<ChatTurn {...defaultHumanProps} />);
      // User icon inside TurnHeader
      expect(screen.getAllByTestId('user-icon').length).toBeGreaterThan(0);
    });

    it('hides header entirely when isFirstInGroup=false — no user icon in header', () => {
      const { container } = render(
        <ChatTurn {...defaultHumanProps} isFirstInGroup={false} />,
      );
      // No mb-2 header div (the header wrapper has mb-2)
      const headerDivs = container.querySelectorAll('.mb-2');
      expect(headerDivs.length).toBe(0);
    });

    it('shows Bot icon in header for agent turn when isFirstInGroup=true', () => {
      render(<ChatTurn {...defaultAgentProps} />);
      expect(screen.getAllByTestId('bot-icon').length).toBeGreaterThan(0);
    });
  });

  // ─── AC3: user_type badges ───────────────────────────────────────────────

  describe('AC3: user_type badges', () => {
    it('renders user icon badge for human turn', () => {
      // Badge renders User icon (no text), check for blue badge styling
      const { container } = render(<ChatTurn {...defaultHumanProps} />);
      const badge = container.querySelector('.bg-blue-500\\/15');
      expect(badge).toBeInTheDocument();
    });

    it('renders bot icon badge for agent turn', () => {
      // Badge renders Bot icon (no text), check for purple badge styling
      const { container } = render(<ChatTurn {...defaultAgentProps} />);
      const badge = container.querySelector('.bg-purple-500\\/15');
      expect(badge).toBeInTheDocument();
    });

    it('does NOT render badge when isFirstInGroup=false (header hidden)', () => {
      const { container } = render(<ChatTurn {...defaultHumanProps} isFirstInGroup={false} />);
      // No badge should exist since header is hidden
      const badge = container.querySelector('.bg-blue-500\\/15');
      expect(badge).not.toBeInTheDocument();
    });

    it('Human badge has blue color classes', () => {
      const { container } = render(<ChatTurn {...defaultHumanProps} />);
      // The badge span should include blue color styling
      const badge = container.querySelector('.bg-blue-500\\/15');
      expect(badge).toBeInTheDocument();
    });

    it('Agent badge has purple color classes', () => {
      const { container } = render(<ChatTurn {...defaultAgentProps} />);
      const badge = container.querySelector('.bg-purple-500\\/15');
      expect(badge).toBeInTheDocument();
    });
  });

  // ─── AC5: Border-radius grouping ────────────────────────────────────────

  describe('AC5: Border-radius for grouped bubbles', () => {
    it('applies rounded-xl (full) when solo (first AND last in group)', () => {
      const { container } = render(
        <ChatTurn {...defaultHumanProps} isFirstInGroup={true} isLastInGroup={true} />,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('rounded-xl');
    });

    it('applies rounded-t-xl when first but not last in group', () => {
      const { container } = render(
        <ChatTurn
          {...defaultHumanProps}
          isFirstInGroup={true}
          isLastInGroup={false}
        />,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('rounded-t-xl');
    });

    it('applies rounded-b-xl when last but not first in group', () => {
      const { container } = render(
        <ChatTurn
          {...defaultHumanProps}
          isFirstInGroup={false}
          isLastInGroup={true}
        />,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('rounded-b-xl');
    });

    it('applies no rounding when in middle of group', () => {
      const { container } = render(
        <ChatTurn
          {...defaultHumanProps}
          isFirstInGroup={false}
          isLastInGroup={false}
        />,
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).not.toContain('rounded-xl');
      expect(wrapper.className).not.toContain('rounded-t-xl');
      expect(wrapper.className).not.toContain('rounded-b-xl');
    });
  });

  // ─── Message content rendering ──────────────────────────────────────────

  describe('Message content rendering', () => {
    it('renders human message content as HighlightedText', () => {
      render(<ChatTurn {...defaultHumanProps} markdownEnabled={false} />);
      expect(screen.getByTestId('highlighted-text')).toHaveTextContent(
        'Hello world',
      );
    });

    it('renders agent message content via MarkdownPreview when markdownEnabled', () => {
      render(<ChatTurn {...defaultAgentProps} markdownEnabled={true} />);
      expect(screen.getByTestId('markdown-preview')).toHaveTextContent(
        'Agent response',
      );
    });

    it('renders deleted message placeholder for human turn', () => {
      const deletedMsg = makeHumanMessage({ is_deleted: true });
      render(
        <ChatTurn
          {...defaultHumanProps}
          messages={[deletedMsg]}
        />,
      );
      expect(screen.getByText('Сообщение удалено')).toBeInTheDocument();
    });

    it('shows processing spinner in header when isProcessing=true', () => {
      render(
        <ChatTurn {...defaultAgentProps} isProcessing={true} isFirstInGroup={true} />,
      );
      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });

    it('does not show processing spinner when isProcessing=false', () => {
      render(
        <ChatTurn {...defaultAgentProps} isProcessing={false} isFirstInGroup={true} />,
      );
      expect(screen.queryByTestId('loader-icon')).not.toBeInTheDocument();
    });
  });

  // ─── Padding based on group position ────────────────────────────────────

  describe('Padding adjusts for group position', () => {
    it('applies pt-3 when isFirstInGroup=true', () => {
      const { container } = render(
        <ChatTurn {...defaultHumanProps} isFirstInGroup={true} />,
      );
      const innerDiv = container.querySelector('.pt-3');
      expect(innerDiv).toBeInTheDocument();
    });

    it('applies pt-1 when isFirstInGroup=false (tighter for grouped messages)', () => {
      const { container } = render(
        <ChatTurn {...defaultHumanProps} isFirstInGroup={false} />,
      );
      const innerDiv = container.querySelector('.pt-1');
      expect(innerDiv).toBeInTheDocument();
    });
  });

  // ─── Sender name display ─────────────────────────────────────────────────

  describe('Sender name', () => {
    it('displays provided senderName in header', () => {
      render(<ChatTurn {...defaultHumanProps} senderName="Bob Smith" />);
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    });

    it('displays agent name in header for agent turn', () => {
      render(<ChatTurn {...defaultAgentProps} senderName="Architect" />);
      expect(screen.getByText('Architect')).toBeInTheDocument();
    });
  });

  // ─── Header time span — history-loaded bubbles ────────────────────────────
  // History loads lazily: the steps are collapsed into `_step_groups_before`
  // on the final message, so the turn holds ONE message. The span must still
  // run from the first hidden step to the final message, exactly as it does
  // for a live-streamed bubble whose steps are real messages.

  describe('Header time span', () => {
    const withGroups = (groups: Array<{ first_at?: string; last_at?: string }>) =>
      Object.assign(makeAgentMessage({ timestamp: new Date('2024-01-20T10:05:00Z') }), {
        _step_groups_before: groups.map((g, i) => ({ type: 'tools', count: 1, first_id: i, last_id: i, ...g })),
      });

    it('turnTimeSpan: single message, no groups → no end', () => {
      expect(turnTimeSpan([makeAgentMessage()])).toEqual({
        start: new Date('2024-01-20T10:01:00Z'),
        end: undefined,
      });
    });

    it('turnTimeSpan: start comes from the earliest hidden step group', () => {
      const msg = withGroups([
        { first_at: '2024-01-20T10:01:00Z', last_at: '2024-01-20T10:02:00Z' },
        { first_at: '2024-01-20T10:03:00Z', last_at: '2024-01-20T10:04:00Z' },
      ]);
      expect(turnTimeSpan([msg])).toEqual({
        start: '2024-01-20T10:01:00Z',
        end: new Date('2024-01-20T10:05:00Z'),
      });
    });

    it('turnTimeSpan: groups after the last message extend the end', () => {
      const msg = Object.assign(makeAgentMessage(), {
        _step_groups_after: [{ type: 'tools', count: 1, first_id: 9, last_id: 9, first_at: '2024-01-20T10:09:00Z', last_at: '2024-01-20T10:09:00Z' }],
      });
      expect(turnTimeSpan([msg]).end).toBe('2024-01-20T10:09:00Z');
    });

    it('turnTimeSpan: ignores groups without timestamps and unparsable values', () => {
      const msg = withGroups([{}, { first_at: 'not-a-date' }]);
      expect(turnTimeSpan([msg])).toEqual({
        start: new Date('2024-01-20T10:05:00Z'),
        end: undefined,
      });
    });

    it('renders "start - end" for a history-loaded single-message agent turn', () => {
      const msg = withGroups([{ first_at: '2024-01-20T10:01:00Z', last_at: '2024-01-20T10:04:00Z' }]);
      const { container } = render(<ChatTurn {...defaultAgentProps} messages={[msg]} />);
      expect(container.textContent).toMatch(/\d{2}:\d{2} - \d{2}:\d{2}/);
    });

    it('renders a single time when the whole turn falls in one minute', () => {
      const msg = withGroups([{ first_at: '2024-01-20T10:05:10Z', last_at: '2024-01-20T10:05:20Z' }]);
      const { container } = render(<ChatTurn {...defaultAgentProps} messages={[msg]} />);
      expect(container.textContent).not.toMatch(/–/);
    });
  });
});


describe('ChatTurn plan placement', () => {
  it('keeps one latest plan after the answer when steps are expanded or collapsed', () => {
    render(<ChatTurn
      turnType="agent"
      senderName="Agent"
      messages={[
        makeAgentMessage({ id: 'thinking', contentType: 'thinking', content: 'Working' }),
        makeAgentMessage({ id: 'plan', contentType: 'plan', content: JSON.stringify({ tasks: [{ id: 1, title: 'First', status: 'pending' }] }) }),
        makeAgentMessage({ id: 'latest-plan', contentType: 'plan', content: JSON.stringify({ tasks: [{ id: 1, title: 'First', status: 'completed' }, { id: 2, title: 'Second', status: 'pending' }] }) }),
        makeAgentMessage({ id: 'answer', content: 'Final answer' }),
      ]}
    />);
    const toggle = screen.getByRole('button', { name: /Шагов:/ });
    for (let i = 0; i < 3; i++) {
      const plans = screen.getAllByTestId('plan-widget');
      expect(plans).toHaveLength(1);
      expect(plans[0]).toHaveAttribute('data-task-count', '2');
      expect(screen.getByText('Final answer').compareDocumentPosition(plans[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(toggle);
    }
  });
});


it('renders the carried plan only in the new bubble as soon as it starts', () => {
  const messages = [
    makeAgentMessage({ id: '201', agentId: 42, agentName: 'Dev', contentType: 'plan', content: JSON.stringify({ tasks: [{ id: 1, title: 'Check', status: 'in_progress' }] }) }),
    makeAgentMessage({ id: '202', agentId: 42, agentName: 'Dev', content: 'First answer' }),
  ];
  const view = (input: ChatMessage[]) => <>{groupMessagesIntoTurns(input, {}, true).map(turn => (
    <section key={turn.id} data-testid={turn.id}><ChatTurn {...turn} /></section>
  ))}</>;
  const { rerender } = render(view(messages));
  const oldBubble = screen.getByTestId('plan-widget').closest('section');
  rerender(view([...messages, makeAgentMessage({ id: '203', agentId: 42, agentName: 'Dev', contentType: 'thinking', content: 'Continuing' })]));
  expect(screen.getAllByTestId('plan-widget')).toHaveLength(1);
  expect(oldBubble).not.toContainElement(screen.getByTestId('plan-widget'));
  expect(screen.getByTestId('plan-widget').closest('section')).not.toBe(oldBubble);
  expect(oldBubble).toContainElement(screen.getByText('First answer'));
});

it('places the human voice attachment above the transcript in grouped chat', () => {
  const message = makeHumanMessage({ content: 'Voice transcript', attachments: [{ id: 'voice', name: 'voice.webm', type: 'audio/webm', size: 5, url: '/uploads/voice.webm' }] });
  render(<ChatTurn {...defaultHumanProps} messages={[message]} />);
  const attachment = screen.getByTestId('attachment-renderer');
  expect(attachment.compareDocumentPosition(screen.getByText('Voice transcript')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
