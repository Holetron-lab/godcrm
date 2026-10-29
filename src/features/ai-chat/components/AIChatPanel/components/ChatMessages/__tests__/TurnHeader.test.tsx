import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { TurnHeader } from '../ChatTurn/TurnHeader';
import { HumanChatPresenceContext } from '@/features/ai-chat/hooks/useHumanChatPresence';

const props = { turnType: 'agent' as const, senderName: 'Frontend Developer', timestamp: '13:47' };

describe('TurnHeader avatar', () => {
  it.each(['/uploads/avatars/agent.jpg', 'https://example.test/agent.png'])(
    'renders an image icon %s without exposing its URL as text', (agentIcon) => {
      const { container } = render(<TurnHeader {...props} agentIcon={agentIcon} />);
      expect(screen.getByRole('img', { name: props.senderName })).toHaveAttribute('src', agentIcon);
      expect(container).not.toHaveTextContent(agentIcon);
      fireEvent.error(screen.getByRole('img'));
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(container).not.toHaveTextContent(agentIcon);
      expect(screen.getByLabelText(props.senderName)).toHaveTextContent('F');
    },
  );

  it('preserves emoji icons', () => {
    render(<TurnHeader {...props} agentIcon="🎨" />);
    expect(screen.getByLabelText(props.senderName)).toHaveTextContent('🎨');
  });

  it('preserves human avatar URLs', () => {
    render(<TurnHeader {...props} turnType="human" senderAvatar="/uploads/avatars/human.jpg" />);
    expect(screen.getByRole('img', { name: props.senderName })).toHaveAttribute('src', '/uploads/avatars/human.jpg');
  });

  it('shows online only for a human active in the same conversation', () => {
    const value = { conversationId: 11, known: true, onlineUserIds: new Set([7]) };
    const { rerender } = render(<HumanChatPresenceContext.Provider value={value}><TurnHeader {...props} turnType="human" senderUserId={7} conversationId={11} /></HumanChatPresenceContext.Provider>);
    expect(screen.getByRole('img', { name: 'Активен в этом чате' })).toBeInTheDocument();
    rerender(<HumanChatPresenceContext.Provider value={value}><TurnHeader {...props} turnType="human" senderUserId={7} conversationId={12} /></HumanChatPresenceContext.Provider>);
    expect(screen.queryByRole('img', { name: 'Активен в этом чате' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Активность в чате неизвестна' })).toBeInTheDocument();
  });
});
