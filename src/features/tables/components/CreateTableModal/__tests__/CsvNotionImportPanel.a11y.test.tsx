import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CsvNotionImportPanel } from '../CsvNotionImportPanel';

it('opens and closes the import log with the keyboard without transforming files', async () => {
  const user = userEvent.setup();
  const transform = vi.fn();
  function Harness() {
    const [expanded, setExpanded] = useState(false);
    return <CsvNotionImportPanel notionImportLog={[{ text: 'Resolved reference', resolved: true }]} notionImportLogExpanded={expanded} setNotionImportLogExpanded={setExpanded} csvFilesBeforeNotionImport={null} notionValueDisplay="names" setNotionValueDisplay={() => {}} notionOutputFormat="comma" setNotionOutputFormat={() => {}} notionCreateIdColumn={false} setNotionCreateIdColumn={() => {}} applyNotionTransform={transform} updateNotionIdsByName={() => {}} undoNotionImport={() => {}} setNotionImportPanelVisible={() => {}} t={key => key} />;
  }
  render(<Harness />);
  const toggle = screen.getByRole('button', { name: 'tables.create.log (1)' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByText('Resolved reference')).toBeInTheDocument();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard(' ');
  expect(screen.queryByText('Resolved reference')).not.toBeInTheDocument();
  expect(transform).not.toHaveBeenCalled();
});
