import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import '@/styles/index.css';
import { Neo16ModuleWidget } from '../../town/TownWidget';
import type { Widget } from '@/features/widgets/types/widget.types';

// Local intercepted HTTP fixture; no credentials or live server writes.
useAuthStore.setState({ user: { id: '1', name: 'Fixture owner', email: 'owner@test.invalid', role: 'owner' } });
const response = await fetch('/fixture/widget');
const widget: Widget = await response.json();
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <div className="h-screen w-full"><Neo16ModuleWidget widget={widget} data={[]} /></div>
  </QueryClientProvider>,
);
