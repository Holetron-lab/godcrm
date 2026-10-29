import { useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useBoundRowDisplay } from '../useBoundRowDisplay';
import { useChatAgentSettings } from '../useChatAgentSettings';
import { useChatMutations } from '../useChatMutations';
import { useDataSourceConfig } from '../useDataSourceConfig';

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSpacesStore.getState().reset();
  vi.mocked(apiClient.put).mockResolvedValue({ success: true });
  vi.mocked(apiClient.patch).mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  useSpacesStore.getState().reset();
});

it('keeps empty bound-row options stable and does not refetch on unrelated renders', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => url.endsWith('/columns')
    ? { data: [] } : { row: { data: {} } });
  const { result, rerender } = renderHook(() => useBoundRowDisplay({ table_id: 42, row_id: 7 }), {
    wrapper: ProvidersWrapper,
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const { statusOptions, secondaryOptions } = result.current;
  rerender();
  expect(result.current.statusOptions).toBe(statusOptions);
  expect(result.current.secondaryOptions).toBe(secondaryOptions);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(result.current.title).toBe('#7');
});

it('hydrates sources once per space and saves each configuration once', async () => {
  type Params = Parameters<typeof useDataSourceConfig>[0];
  const config = { tableId: 42, tableName: 'Files', projectId: 1 };
  const favoritesConfig = { documents: config };
  vi.mocked(apiClient.get).mockResolvedValue({ data: { space: {
    tickets_config: config, files_config: config, favorites_config: favoritesConfig,
  } } });
  const { result, rerender } = renderHook(({ spaceId }) => {
    const [tasks, setTasksSource] = useState<Parameters<Params['setTasksSource']>[0]>();
    const [files, setFilesSource] = useState<Parameters<Params['setFilesSource']>[0]>();
    const [favorites, setFavoritesConfig] = useState<Parameters<Params['setFavoritesConfig']>[0]>();
    const actions = useDataSourceConfig({ effectiveSpaceId: spaceId, currentSpace: null,
      allTablesDataMain: undefined, setTasksSource, setFilesSource, setFavoritesConfig });
    return { ...actions, tasks, files, favorites };
  }, { initialProps: { spaceId: 11 }, wrapper: ProvidersWrapper });
  await waitFor(() => expect(result.current.files).toEqual(config));
  expect(result.current.tasks).toEqual(config);
  expect(result.current.favorites).toEqual(favoritesConfig);
  expect(apiClient.get).toHaveBeenCalledTimes(3);
  rerender({ spaceId: 11 });
  expect(apiClient.get).toHaveBeenCalledTimes(3);
  await act(async () => {
    result.current.updateTasksSource(config);
    result.current.updateFilesSource(config);
    result.current.updateFavoritesConfig(favoritesConfig);
  });
  expect(apiClient.patch).toHaveBeenCalledTimes(3);
  expect(apiClient.patch).toHaveBeenCalledWith('/spaces/11', { tickets_config: config });
  expect(apiClient.patch).toHaveBeenCalledWith('/spaces/11', { files_config: config });
  expect(apiClient.patch).toHaveBeenCalledWith('/spaces/11', { favorites_config: favoritesConfig });
  expect(localStorage.getItem('chat-files-source-11')).toBe(JSON.stringify(config));
  await act(async () => rerender({ spaceId: 12 }));
  expect(apiClient.get).toHaveBeenCalledTimes(6);
  expect(vi.mocked(apiClient.get).mock.calls.slice(3).map(([url]) => url)).toEqual([
    '/spaces/12', '/spaces/12', '/spaces/12',
  ]);
  expect(apiClient.patch).toHaveBeenCalledTimes(3);
});

it('keeps settings in the effective DM space and saves summary to the selected chat', async () => {
  const space = { id: 11, owner_id: 1, name: 'Test', type: 'team' as const,
    created_at: '', updated_at: '', settings: { default_agent_id: 3, quick_emojis: ['👍'] } };
  useSpacesStore.getState().setSpaces([space, { ...space, id: 12,
    settings: { default_agent_id: 4, quick_emojis: ['🔥'] } }]);
  const agents: Parameters<typeof useChatAgentSettings>[0]['agents'] = [];
  const { result, rerender } = renderHook(({ conversationId, spaceId }) => {
    const [defaultAgentId, setDefaultAgentId] = useState<number | null>(null);
    const [quickEmojis, setQuickEmojis] = useState<string[]>([]);
    const settings = useChatAgentSettings({ currentConversationId: conversationId,
      userConversationId: 102, contextSpaceId: spaceId, agents, setDefaultAgentId, setQuickEmojis });
    return { ...settings, defaultAgentId, quickEmojis };
  }, { initialProps: { conversationId: 101 as number | null, spaceId: 11 }, wrapper: ProvidersWrapper });
  expect(result.current.defaultAgentId).toBe(3);
  expect(result.current.quickEmojis).toEqual(['👍']);
  await act(async () => { await result.current.saveSummaryAgent(5); });
  rerender({ conversationId: null, spaceId: 12 });
  expect(result.current.defaultAgentId).toBe(4);
  expect(result.current.quickEmojis).toEqual(['🔥']);
  await act(async () => {
    await result.current.saveSummaryAgent(6);
    await result.current.saveTranslationAgent(7);
  });
  expect(apiClient.patch).toHaveBeenCalledTimes(2);
  expect(apiClient.patch).toHaveBeenNthCalledWith(1, '/chat/conversations/101/settings', { summary_agent_id: 5 });
  expect(apiClient.patch).toHaveBeenNthCalledWith(2, '/chat/conversations/102/settings', { summary_agent_id: 6 });
  expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/spaces/12', {
    settings: { default_agent_id: 4, quick_emojis: ['🔥'], translation_agent_id: 7 },
  });
  expect(result.current.translationAgentId).toBe(7);
  expect(useSpacesStore.getState().currentSpace).toBeNull();
  expect(useSpacesStore.getState().getSpaceById(11)?.settings).toEqual(space.settings);
  rerender({ conversationId: 103, spaceId: 12 });
  expect(apiClient.patch).toHaveBeenCalledTimes(2);
  expect(apiClient.put).toHaveBeenCalledTimes(1);
});

it('does not reschedule reaction loading when only the language changes', async () => {
  const params: Parameters<typeof useChatMutations>[0] = {
    currentAgent: null, chatOperatorId: null, chatModelId: '', chatSystemPrompt: '',
    setIsSavingAgentSettings: vi.fn(), setContextSettings: vi.fn(), setDefaultAgentId: vi.fn(),
    setIsSavingDefaultAgent: vi.fn(), setQuickEmojis: vi.fn(), setIsSavingEmojis: vi.fn(),
    setMessageReactions: vi.fn(), loadAgents: vi.fn(), refetchUserMessages: vi.fn(),
  };
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { 1: {} } });
  const { result } = renderHook(() => ({ ...useChatMutations(params), ...useLanguage() }), {
    wrapper: ProvidersWrapper,
  });
  const fetchReactions = result.current.fetchReactionsForMessages;
  act(() => result.current.setLanguage('en'));
  expect(result.current.fetchReactionsForMessages).toBe(fetchReactions);
  await act(async () => {
    await result.current.fetchReactionsForMessages([]);
    await result.current.fetchReactionsForMessages([1]);
  });
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/chat/messages/reactions/batch', { messageIds: [1] });
  const merge = vi.mocked(params.setMessageReactions).mock.calls[0][0];
  expect(merge({ 2: {} })).toEqual({ 1: {}, 2: {} });
});

// Match the production hook order: agent settings, data sources, then mutations.
function usePanelSettings(contextSpaceId: number, conversationId = 101) {
  const [defaultAgentId, setDefaultAgentId] = useState<number | null>(null);
  const [quickEmojis, setQuickEmojis] = useState<string[]>([]);
  const [isSavingDefaultAgent, setIsSavingDefaultAgent] = useState(false);
  const currentSpace = useSpacesStore(state => state.currentSpace);
  const settings = useChatAgentSettings({ contextSpaceId, currentConversationId: conversationId,
    userConversationId: null, agents: [], setDefaultAgentId, setQuickEmojis });
  useDataSourceConfig({ effectiveSpaceId: contextSpaceId, currentSpace,
    allTablesDataMain: undefined, setTasksSource: ignore, setFilesSource: ignore,
    setFavoritesConfig: ignore });
  const mutations = useChatMutations({ effectiveSpaceId: contextSpaceId,
    currentAgent: null, chatOperatorId: null, chatModelId: '', chatSystemPrompt: '',
    setDefaultAgentId, setQuickEmojis, setIsSavingDefaultAgent,
    setIsSavingAgentSettings: ignore, setContextSettings: ignore, setIsSavingEmojis: ignore,
    setMessageReactions: ignore, loadAgents: ignore, refetchUserMessages: ignore });
  return { ...settings, ...mutations, defaultAgentId, quickEmojis, isSavingDefaultAgent };
}

const ignore = () => {};
const savedSpace = { id: 11, owner_id: 1, name: 'Development', type: 'team' as const,
  created_at: '', updated_at: '', projects: [], settings: { default_agent_id: 44465, quick_emojis: ['🔥'] } };

it.each(['embed', 'DM', 'dashboard', 'different current space'])('%s preserves effective-space settings with data sources mounted', async mode => {
  // The API also returns JSON strings although SpaceModel declares only objects.
  const space = { ...savedSpace, settings: (mode === 'DM'
    ? JSON.stringify(savedSpace.settings) : savedSpace.settings) as unknown as typeof savedSpace.settings };
  useSpacesStore.getState().setSpaces([space]);
  if (mode === 'dashboard') useSpacesStore.getState().setCurrentSpace(space);
  if (mode === 'different current space') useSpacesStore.getState().setCurrentSpace({
    ...savedSpace, id: 12, settings: { default_agent_id: 9, quick_emojis: ['👍'] },
  });
  vi.mocked(apiClient.get).mockResolvedValue({ data: { space: {} } });
  const { result, rerender, unmount } = renderHook(({ conversationId }) => usePanelSettings(11, conversationId), {
    initialProps: { conversationId: 101 }, wrapper: ProvidersWrapper,
  });
  await waitFor(() => expect(result.current.defaultAgentId).toBe(44465));
  expect(result.current.quickEmojis).toEqual(['🔥']);
  const reads = vi.mocked(apiClient.get).mock.calls.length;
  rerender({ conversationId: 102 });
  expect(result.current.defaultAgentId).toBe(44465);
  expect(apiClient.get).toHaveBeenCalledTimes(reads);
  await act(async () => { await result.current.saveDefaultAgent(7); });
  expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/spaces/11', {
    settings: { default_agent_id: 7, quick_emojis: ['🔥'] },
  });
  expect(result.current.defaultAgentId).toBe(7);
  expect(result.current.isSavingDefaultAgent).toBe(false);
  unmount();
  const reopened = renderHook(() => usePanelSettings(11, 102), { wrapper: ProvidersWrapper });
  await waitFor(() => expect(reopened.result.current.defaultAgentId).toBe(7));
  expect(reopened.result.current.quickEmojis).toEqual(['🔥']);
});

it('hydrates a late space and resets settings when switching to an unconfigured space', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { space: {} } });
  const { result, rerender } = renderHook(({ spaceId }) => usePanelSettings(spaceId), {
    initialProps: { spaceId: 11 }, wrapper: ProvidersWrapper,
  });
  expect(result.current.defaultAgentId).toBeNull();
  await act(async () => { useSpacesStore.getState().setSpaces([
    savedSpace, { ...savedSpace, id: 12, settings: {} },
  ]); });
  expect(result.current.defaultAgentId).toBe(44465);
  await act(async () => rerender({ spaceId: 12 }));
  expect(result.current.defaultAgentId).toBeNull();
  expect(result.current.quickEmojis).toEqual(['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮']);
  await act(async () => rerender({ spaceId: 11 }));
  expect(result.current.defaultAgentId).toBe(44465);
  expect(apiClient.put).not.toHaveBeenCalled();
});
