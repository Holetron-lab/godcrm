import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useTablesBootstrap } from '@/features/tables/hooks/useTablesBootstrap';
import { UniversalTable } from '@/features/tables/components/UniversalTable/UniversalTable';

localStorage.setItem('god-crm-language', 'ru');
useAuthStore.setState({ user: { id: 'fixture', name: 'Fixture', email: 'fixture@example.test', role: 'admin' }, initialized: true });
useTablesStore.setState({ activeTableId: '100965' });
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function Fixture() {
  const { loading, error } = useTablesBootstrap();
  return <main className="p-4"><h1>Поставщики — проверка сортировки</h1>{error ? <p role="alert">Ошибка загрузки</p> : loading ? <p role="status">Загрузка</p> : <UniversalTable compact />}</main>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><LanguageProvider><QueryClientProvider client={client}><AIChatStubProvider><Fixture /></AIChatStubProvider></QueryClientProvider></LanguageProvider></MemoryRouter>);
