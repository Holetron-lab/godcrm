import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { SpaceCard } from '@/features/spaces/components/SpaceCard';
import { defaultSpaceCardSettings } from '@/features/spaces/types/spaceCardSettings.types';
import type { SpaceModel, SpaceProject } from '@/features/spaces/types/space.types';

localStorage.setItem('god-crm-language', 'en');
const space: SpaceModel & { projects: SpaceProject[] } = {
  id: 11, owner_id: 1, name: 'Fixture space', type: 'business',
  description: 'Keyboard-accessible space card', created_at: '', updated_at: '',
  user_access_level: 'owner',
  projects: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: `Project ${i}` })),
  users: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Member ${i}`, role: 'viewer' })),
};
function Fixture() {
  const [events, setEvents] = useState<string[]>([]);
  const location = useLocation();
  const record = (event: string) => setEvents(previous => [...previous, event]);
  return <main className="p-4">
    <h1>Space card fixture</h1>
    <button type="button">Before card</button>
    <div className="h-[480px] sm:h-[160px] my-4">
      <SpaceCard space={space} mobileMode={window.innerWidth < 640} rowHeightPx={160} onClick={() => record('open')}
        onCreateProject={() => record('create')} onSettingsClick={() => record('settings')}
        onSizeChange={(_, size) => record(size)}
        cardSettings={{ ...defaultSpaceCardSettings, size: 'threeQuarter' }} />
    </div>
    <button type="button">After card</button>
    <output aria-label="Events">{events.join(',')}</output>
    <output aria-label="Location">{location.pathname}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><MemoryRouter><Fixture /></MemoryRouter></LanguageProvider>
);
