import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SectionTreeNodeV4 } from '../../../../utils/parseMarkdownToAtoms';

let context: ReturnType<typeof usePreviewState>;
vi.mock('../DocumentsContext', () => ({ useDocumentsContext: () => context }));
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <p>{content}<a href="#guide" onClick={event => event.preventDefault()}>Guide</a></p>
  ),
}));
import { DocumentsImportPreview } from '../DocumentsImportPreview';

function usePreviewState() {
  const [editingImportOrder, setEditingImportOrder] = useState<number | null>(null);
  const [editingImportData, setEditingImportData] = useState<{ title?: string; content?: string }>({});
  const [newDocName, setNewDocName] = useState('Import title');
  const [newDocDescription, setNewDocDescription] = useState('Import description');
  const [activePreviewOrder, setActivePreviewOrder] = useState<number | null>(null);
  const importTree: SectionTreeNodeV4[] = [
    { selected: true, expanded: true, section: { title: '', level: 'h2', content: 'Heading', order: 10 }, children: [] },
    { selected: true, expanded: true, section: { title: '', level: 'text', content: 'Markdown content', order: 20 }, children: [] },
    { selected: true, expanded: true, section: { title: '', level: 'divider', content: '', order: 30 }, children: [] },
  ];
  return {
    importTree, editingImportOrder, setEditingImportOrder, editingImportData, setEditingImportData,
    newDocName, setNewDocName, newDocDescription, setNewDocDescription,
    activePreviewOrder, setActivePreviewOrder, previewRef: useRef<HTMLDivElement>(null),
    contentSearchQuery: '', previewMode: 'none', atomSections: {},
    setRightPanelOpen: vi.fn(), setShowFileUploadModal: vi.fn(),
  };
}

function Preview() {
  context = usePreviewState();
  return <DocumentsImportPreview />;
}

describe('import preview keyboard editing', () => {
  it('edits title and description from the keyboard without losing typing focus', async () => {
    const user = userEvent.setup();
    render(<Preview />);
    const heading = screen.getByRole('heading', { name: 'Import title' });
    const title = within(heading).getByRole('button');
    title.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Название документа' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Revised title');
    expect(input).toHaveFocus();
    expect(context.newDocName).toBe('Revised title');
    await user.click(screen.getByRole('button', { name: 'Завершить редактирование названия' }));
    expect(screen.getByRole('heading', { name: 'Revised title' })).toBeVisible();
    const description = screen.getByRole('button', { name: 'Import description' });
    description.focus();
    await user.keyboard(' ');
    const textarea = screen.getByRole('textbox', { name: 'Описание документа' });
    expect(textarea).toHaveFocus();
    await user.type(textarea, ' revised');
    expect(context.newDocDescription).toBe('Import description revised');
  });

  it('opens section editing with Enter and keeps markdown links independent', async () => {
    const user = userEvent.setup();
    render(<Preview />);
    await user.click(screen.getByRole('link', { name: 'Guide' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const section = screen.getByRole('button', { name: 'Heading' });
    section.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Заголовок раздела' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Завершить редактирование раздела' }));
    const contentEdit = screen.getByRole('button', { name: 'Редактировать раздел 20' });
    contentEdit.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('textbox', { name: 'Содержимое раздела' })).toHaveFocus();
  });

  it('selects a divider with Space', async () => {
    const user = userEvent.setup();
    render(<Preview />);
    screen.getByRole('button', { name: 'Выбрать разделитель 30' }).focus();
    await user.keyboard(' ');
    expect(context.activePreviewOrder).toBe(30);
  });
});
