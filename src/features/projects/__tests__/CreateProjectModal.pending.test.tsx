import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { projectsApi, type ProjectModel } from '../api/projectsApi';

vi.mock('../api/projectsApi', () => ({ projectsApi: { create: vi.fn() } }));
vi.mock('@/features/spaces/hooks/useSpacesQuery', () => ({
  useSpacesQuery: () => ({ data: [{ id: 11, name: 'Development' }] }),
}));
vi.mock('@/shared/i18n/LanguageContext', () => ({
  availableLanguages: [],
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@/features/tables/components/UniversalTable/EmojiPicker', () => ({
  EmojiPicker: () => null,
}));

function renderModal() {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreateProjectModal open spaceId={11} onOpenChange={onOpenChange} onCreated={onCreated} />
    </QueryClientProvider>
  );
  return { onOpenChange, onCreated };
}

describe('CreateProjectModal submission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps required-name validation', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'projects.modalSubmit' }));
    expect(screen.getByText('projects.errors.nameRequired')).toBeInTheDocument();
    expect(projectsApi.create).not.toHaveBeenCalled();
  });

  it('blocks duplicate creation while pending and allows retry after failure', async () => {
    let rejectRequest!: (error: Error) => void;
    vi.mocked(projectsApi.create).mockImplementationOnce(() => new Promise((_, reject) => {
      rejectRequest = reject;
    }));
    const { onOpenChange, onCreated } = renderModal();
    const name = screen.getByPlaceholderText('projects.fields.namePlaceholder');
    fireEvent.change(name, { target: { value: '  QA project  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'projects.modalSubmit' }));
    const pending = await screen.findByRole('button', { name: 'projects.modalSubmitting' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(projectsApi.create).toHaveBeenCalledTimes(1);
    expect(projectsApi.create).toHaveBeenCalledWith({ name: 'QA project', description: undefined, logo: '⭐', space_id: 11 });
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => rejectRequest(new Error('Creation failed')));
    const retry = await screen.findByRole('button', { name: 'projects.modalSubmit' });
    expect(retry).toBeEnabled();
    expect(name).toHaveValue('  QA project  ');
    expect(screen.getAllByText('Creation failed').length).toBeGreaterThan(0);
    const project = { id: 123, name: 'QA project', space_id: 11 } as ProjectModel;
    vi.mocked(projectsApi.create).mockResolvedValueOnce(project);
    fireEvent.click(retry);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project));
    expect(projectsApi.create).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
