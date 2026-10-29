import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../FilePreviewModal';

vi.mock('@google/model-viewer', () => ({}));
afterEach(cleanup);

const markdown = '# Document\n\nSelected paragraph\n\n| Column |\n| --- |\n| Value |\n\n![Diagram](/diagram.png)';

it('keeps document nodes, selection and table scroll across parent updates', () => {
  const view = () => <FilePreviewModal isOpen onClose={() => {}} fileName="Document"
    fileType="markdown" inlineContent={markdown} extraHeaderActions={<button>В модуль</button>} />;
  const { rerender } = render(view());
  const paragraph = screen.getByText('Selected paragraph');
  const heading = screen.getByRole('heading', { name: 'Document', level: 1 });
  const image = screen.getByRole('img', { name: 'Diagram' });
  const table = screen.getByRole('table');
  const scroll = table.parentElement!;
  scroll.scrollLeft = 120;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  for (let tick = 0; tick < 5; tick++) {
    rerender(view());
    expect(screen.getByText('Selected paragraph')).toBe(paragraph);
    expect(screen.getByRole('heading', { name: 'Document', level: 1 })).toBe(heading);
    expect(screen.getByRole('img', { name: 'Diagram' })).toBe(image);
    expect(screen.getByRole('table')).toBe(table);
    expect(scroll.scrollLeft).toBe(120);
    expect(selection.toString()).toBe('Selected paragraph');
  }
});

it('still updates document content and theme and preserves an unsaved draft on parent updates', () => {
  const view = (content: string) => <FilePreviewModal isOpen onClose={() => {}} fileName="Document"
    fileType="markdown" inlineContent={content} canEdit onSave={async () => {}} />;
  const { rerender } = render(view(markdown));
  fireEvent.click(screen.getByTitle('Light background'));
  expect(screen.getByRole('heading', { name: 'Document', level: 1 })).toHaveClass('text-gray-900');
  rerender(view('# Updated document'));
  expect(screen.getByRole('heading', { name: 'Updated document', level: 1 })).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Edit'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved draft' } });
  rerender(view('# Updated document'));
  expect(screen.getByRole('textbox')).toHaveValue('Unsaved draft');
});
