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
import { render, screen } from '@testing-library/react';
import type { ChatMessage } from '../../../../../types';

// ─── Icon mocks — inline functions to avoid hoisting issues ─────────────────
vi.mock('lucide-react', () => ({
  Bot: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="bot-icon" {...p} />,
  User: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="user-icon" {...p} />,
  MoreVertical: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="more-vertical-icon" {...p} />,
  Copy: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="copy-icon" {...p} />,
  Forward: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="forward-icon" {...p} />,
  Trash2: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="trash-icon" {...p} />,
  Ban: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="ban-icon" {...p} />,
  Key: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="key-icon" {...p} />,
  ExternalLink: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="external-link-icon" {...p} />,
  Wrench: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="wrench-icon" {...p} />,
  Zap: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="zap-icon" {...p} />,
  Plus: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="plus-icon" {...p} />,
  ChevronDown: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="chevron-down-icon" {...p} />,
  ChevronRight: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="chevron-right-icon" {...p} />,
  Brain: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="brain-icon" {...p} />,
  MessageSquare: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="message-square-icon" {...p} />,
  Loader2: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="loader-icon" {...p} />,
  CheckCircle2: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="check-circle-icon" {...p} />,
  XCircle: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="x-circle-icon" {...p} />,
  Terminal: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="terminal-icon" {...p} />,
  Link2: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="link2-icon" {...p} />,
  ClipboardList: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="clipboard-list-icon" {...p} />,
  Circle: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="circle-icon" {...p} />,
  AlertTriangle: ({ className, ...p }: { className?: string; [k: string]: unknown }) => <div className={className} data-testid="alert-triangle-icon" {...p} />,
}));

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
    it('renders "Human" badge text for human turn', () => {
      render(<ChatTurn {...defaultHumanProps} />);
      expect(screen.getByText('Human')).toBeInTheDocument();
    });

    it('renders "Agent" badge text for agent turn', () => {
      render(<ChatTurn {...defaultAgentProps} />);
      expect(screen.getByText('Agent')).toBeInTheDocument();
    });

    it('does NOT render badge when isFirstInGroup=false (header hidden)', () => {
      render(<ChatTurn {...defaultHumanProps} isFirstInGroup={false} />);
      expect(screen.queryByText('Human')).not.toBeInTheDocument();
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
});
