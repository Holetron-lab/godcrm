import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { filesApi } from '@/features/files/api/filesApi';
import { renderCellValue } from '@/features/tables/components/UniversalTable/renderCellValue';
import type { ColumnModel } from '@/features/tables/types/table.types';
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
const column: ColumnModel = {
  id: '30', tableId: '10', name: 'images', displayName: 'Images', type: 'image',
  config: { file: { prefix: 'https://app.godcrm.ai' } }, isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
};
it('saves the image URL after a successful upload through the real table renderer', async () => {
  const mutate = vi.fn();
  vi.mocked(filesApi.upload).mockResolvedValue({ id: 'file_test', name: 'test.png', originalName: 'test.png', mimeType: 'image/png', size: 3, url: '/uploads/spaces/11/test.png' });
  const { container } = render(renderCellValue({ column, value: '', tableId: '10', rowId: '20', rows: [{ id: '20', data: { supplier: '42', '30': '' } }], rowMutation: { mutate } }), { wrapper: LanguageProvider });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['png'], 'test.png', { type: 'image/png' })] } });
  await waitFor(() => expect(filesApi.upload).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith({ rowId: '20', columnId: '30', value: '/uploads/spaces/11/test.png', data: { supplier: '42', '30': '/uploads/spaces/11/test.png' } }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
