import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { EditProjectModal } from '../EditProjectModal';

vi.mock('@/features/projects/hooks/useProjectsQuery', () => ({ useUpdateProjectMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: () => ({ user: { id: 1 } }) }));
vi.mock('@/shared/components/ui/Modal', () => ({ Modal: ({ title, children }: { title: string; children: React.ReactNode }) => <div><h2>{title}</h2>{children}</div> }));
vi.mock('@/shared/components/access/UserAccessPanel', () => ({ UserAccessPanel: () => null }));
vi.mock('@/features/tables/components/UniversalTable/EmojiPicker', () => ({ EmojiPicker: () => null }));

afterEach(() => localStorage.removeItem('god-crm-language'));

describe('edit project modal language', () => {
  it.each([
    ['en', 'Edit project "Shop"', 'Display', 'Primary color'],
    ['ru', 'Редактирование проекта "Shop"', 'Отображение', 'Основной цвет'],
  ])('renders the %s locale', (language, title, tab, color) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider>
      <EditProjectModal open onOpenChange={() => {}} project={{ id: 7, owner_id: 1, space_id: 11, name: 'Shop' }} />
    </LanguageProvider>);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    expect(screen.getByText(color)).toBeInTheDocument();
  });
});
