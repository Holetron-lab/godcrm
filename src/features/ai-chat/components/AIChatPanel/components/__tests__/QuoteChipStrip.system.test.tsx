import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { afterEach, describe, expect, it } from 'vitest';
import { QuoteChipStrip } from '../QuoteChipStrip';
import type { ChatMessage } from '../../../../types';

afterEach(cleanup);

describe('system notification quote attribution', () => {
  it.each([1, 4])('labels %i queued notices as system', (count) => {
    const messages: ChatMessage[] = Array.from({ length: count }, (_, index) => ({
      id: String(index), role: 'assistant', senderType: 'system',
      content: 'Agent timed out', contentType: 'text', timestamp: new Date(),
    }));
    render(<QuoteChipStrip messages={messages} tone="orange" leadIcon={null} />);
    expect(screen.getAllByText(/system/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Agent:/)).toBeNull();
  });
});
