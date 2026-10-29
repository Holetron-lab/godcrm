import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { AgentWorkingIndicator } from './AgentWorkingIndicator';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AgentWorkingIndicator', () => {
  it('stops its timer when finished and can resume on the next turn', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T10:00:00Z'));
    const { rerender } = render(<AgentWorkingIndicator metadata={{ agent_status: 'thinking', started_at: '2026-09-11T10:00:00Z' }} />);
    expect(screen.getByText('Думает')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText('3s')).toBeInTheDocument();
    rerender(<AgentWorkingIndicator metadata={{ agent_status: 'finished', placeholder: false }} />);
    expect(screen.queryByText('Думает')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<AgentWorkingIndicator metadata={{ agent_status: 'tool_call' }} />);
    expect(screen.getByText('Инструмент')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
  });
});
