import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { TaskSelector } from '../TaskSelector';
import { ToolStepsAccordion } from '../AIChatPanel/components/ChatMessages/ChatTurn/ToolStepsAccordion';
import { AgentStepsBubble } from '../AIChatPanel/components/ChatMessages/AgentStepsBubble';

// No network is needed to exercise disclosure controls.
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockResolvedValue({ success: true, data: { rows: [] } }) } }));

describe('chat keyboard disclosures', () => {
  it('opens and closes the unbound task selector with Enter and Space without submitting a form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><TaskSelector onBind={vi.fn()} onUnbind={vi.fn()} /></form>);
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Привязать к задаче...' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Таблица')).toBeVisible();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Таблица')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps task disclosure and unlink as independent keyboard actions', async () => {
    const user = userEvent.setup();
    const unlink = vi.fn();
    render(<TaskSelector boundTaskId={42} boundTableId={7} onBind={vi.fn()} onUnbind={unlink} />);
    await user.tab();
    const toggle = screen.getByRole('button', { name: /Task #42/ });
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(unlink).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Отвязать' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(unlink).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.querySelector('button')).toBeNull();
  });

  it.each(['turn', 'legacy'] as const)('expands and collapses %s tool results without opening the terminal', async (variant) => {
    const user = userEvent.setup();
    const terminal = vi.fn();
    const props = { onOpenTerminal: terminal };
    render(variant === 'turn' ? (
      <ToolStepsAccordion {...props} steps={[{ kind: 'tool', toolName: 'Bash', result: 'fixture result', success: true }]} totalToolCount={1} markdownEnabled={false} />
    ) : (
      <AgentStepsBubble {...props} messages={[
        { id: '1', role: 'assistant', contentType: 'tool_call', content: 'Bash', timestamp: new Date() },
        { id: '2', role: 'assistant', contentType: 'tool_result', content: 'fixture result', timestamp: new Date() },
      ]} />
    ));
    const toggle = screen.getByRole('button', { name: 'Использовано инструментов: 1' });
    toggle.focus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Enter}');
    expect(screen.getByText('fixture result')).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(screen.queryByText('fixture result')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(terminal).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(terminal).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
