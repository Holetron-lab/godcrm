import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { HeaderActionsMenu } from '@/shared/components/layout/HeaderActionsMenu';
import { SpaceCard } from '@/features/spaces/components/SpaceCard';
import { DeleteProjectModal } from '@/features/projects/components/DeleteProjectModal';
import { DeleteSpaceModal } from '@/features/spaces/components/DeleteSpaceModal';
import type { SpaceModel } from '@/features/spaces/types/space.types';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') || 'project';
document.documentElement.dataset.theme = params.get('theme') || 'light';
localStorage.setItem('god-crm-language', 'en');
const space: SpaceModel = { id: 42, owner_id: 1, name: 'Example', type: 'personal', created_at: '', updated_at: '' };
const project = { id: 42, name: 'Example', space_id: 7 };
const noop = () => {};

function Fixture() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Parent deletion</h1>
    <output aria-label="Location">{location.pathname}</output>
    {kind === 'space-card'
      ? <SpaceCard space={space} userAccessLevel="owner" onDelete={() => setOpen(true)} />
      : <HeaderActionsMenu t={t} isActionsMenuOpen={menuOpen} setIsActionsMenuOpen={setMenuOpen}
          currentProject={kind === 'project' ? project : null} currentSpace={space}
          currentTable={null} currentWidgetId={null} currentWidget={null}
          setIsCreateTableModalOpen={noop} setIsCreateProjectModalOpen={noop} setIsDataSourceWizardOpen={noop}
          setIsEditWidgetSettingsModalOpen={noop} setEditProjectId={noop} setIsEditProjectModalOpen={noop}
          setIsEditSpaceModalOpen={noop} setIsEditTableModalOpen={noop}
          setIsDeleteSpaceModalOpen={setOpen} openDeleteProjectModal={() => setOpen(true)} />}
    {kind === 'project'
      ? <DeleteProjectModal open={open} onOpenChange={setOpen} project={project} />
      : open && <DeleteSpaceModal open={open} onOpenChange={setOpen} space={space} />}
  </main>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><QueryClientProvider client={client}><MemoryRouter initialEntries={['/original']}>
    <Fixture />
  </MemoryRouter></QueryClientProvider></LanguageProvider>,
);
