import { fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MailMessageChip } from './MailMessageChip';
import type { MailMessageRef } from '../types';

// useNavigate is the only external dependency; assert the deep-link it builds.
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const baseRef: MailMessageRef = {
  messageId: '12345',
  spaceId: 11,
  connectorId: 7,
  folder: 'inbox',
  subject: 'Договор на подпись',
  fromName: 'Иван Петров',
  fromAddress: 'ivan@example.com',
  to: ['me@godcrm.ai'],
  date: '2026-07-14T09:30:00.000Z',
  read: true,
  attachmentCount: 2,
  preview: 'Прикладываю финальную редакцию…',
};

const renderChip = (ref: MailMessageRef) =>
  render(
    <MemoryRouter>
      <MailMessageChip mailRef={ref} />
    </MemoryRouter>,
  );

describe('MailMessageChip (ADR-158 §P5)', () => {
  it('renders the sender, subject and an attachment indicator', () => {
    const { getByText, getByLabelText } = renderChip(baseRef);
    expect(getByText('Иван Петров')).toBeTruthy();
    expect(getByText('Договор на подпись')).toBeTruthy();
    expect(getByLabelText('есть вложения')).toBeTruthy();
  });

  it('deep-links into the reader with the message id and folder on click', () => {
    const { getByRole } = renderChip(baseRef);
    fireEvent.click(getByRole('button'));
    expect(navigate).toHaveBeenCalledWith('/mail?msg=12345&folder=inbox');
  });

  it('falls back to the address when the sender name is empty, and hides the clip with no attachments', () => {
    const { getByText, queryByLabelText } = renderChip({
      ...baseRef,
      fromName: '',
      attachmentCount: 0,
    });
    expect(getByText('ivan@example.com')).toBeTruthy();
    expect(queryByLabelText('есть вложения')).toBeNull();
  });

  it('tolerates a null date and an empty subject without throwing', () => {
    const { getByText } = renderChip({ ...baseRef, date: null, subject: '' });
    expect(getByText('(без темы)')).toBeTruthy();
  });
});
