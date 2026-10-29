import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddWidgetModal } from '../AddWidgetModal';

const mocks = vi.hoisted(() => ({ create: vi.fn(), ownerCreate: vi.fn(), config: {} as Record<string, unknown> }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({ useSpacesQuery: () => ({ data: [] }) }));
vi.mock('../../hooks/useWidgets', () => ({ useCreateWidget: () => ({ mutateAsync: mocks.create }), widgetKeys: { list: (id: number) => ['widgets', id] } }));
vi.mock('../../api/widgetsApi', () => ({ createWidgetByOwner: mocks.ownerCreate }));
vi.mock('../../hooks/useWidgetLibrary', () => ({
  useSpaceWidgets: () => ({ data: [{ widget_id: 218, title: 'Source documents', preset_name: 'documents', project_id: 152, config: mocks.config }] }),
  useSpaceTables: () => ({ data: [{ table_id: 1708, name: 'Tickets', project_id: 152 }] }),
}));
function setup(embed = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AddWidgetModal isOpen onClose={() => {}} dashboardId={70} spaceId={11}
      {...(embed ? { embedMode: 'document' as const, ownerKind: 'document' as const, ownerId: 100 } : {})} />
  </QueryClientProvider>);
}
beforeEach(() => { mocks.create.mockReset().mockResolvedValue({ id: 900 }); mocks.ownerCreate.mockReset().mockResolvedValue({ id: 901 }); });
describe('document widget creation', () => {
  it.each([false, true])('preserves the document registry and settings (embed=%s)', async embed => {
    mocks.config = { registry_table_id: 2197, atoms_table_id: 2198, project_id: 152, folder_path: 'custom/docs/', title_column: 'name' };
    setup(embed);
    fireEvent.click(screen.getByRole('button', { name: /Source documents/ }));
    fireEvent.click(screen.getByRole('button', { name: /widgets.picker.documents widgets.picker.documentsDesc/ }));
    await waitFor(() => expect(embed ? mocks.ownerCreate : mocks.create).toHaveBeenCalledWith(expect.objectContaining({ config: mocks.config })));
  });
  it('keeps legacy registry bindings and supplies the source project fallback', async () => {
    mocks.config = { documents_table_id: 2197, sections_table_id: 2198, folder_path: 'legacy/docs/' };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Source documents/ }));
    fireEvent.click(screen.getByRole('button', { name: /widgets.picker.documents widgets.picker.documentsDesc/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ config: { ...mocks.config, project_id: 152 } })));
  });
  it('continues to bind table widgets to their table', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Tickets/ }));
    fireEvent.click(screen.getByRole('button', { name: /widgets.picker.tableView widgets.picker.tableViewDesc/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ config: { table_id: 1708 } })));
  });
});
