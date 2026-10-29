import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { useStepGroups } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn/useStepGroups';
import { StepGroupsPanel } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn/StepGroupsPanel';
import type { StepGroup } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn/types';
import type { ChatMessage } from '@/features/ai-chat/types';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const group: StepGroup = { type: 'tools', first_id: 10, last_id: 10, count: 1, agent_id: 7 };
const call: ChatMessage = { id: '10', role: 'assistant', contentType: 'tool_call', content: '{"tool":"Read","input":{}}', timestamp: new Date() };
const result: ChatMessage = { id: '20', role: 'tool', contentType: 'tool_result', content: 'Loaded result', timestamp: new Date() };
let firstFetch = true;

function Fixture() {
  const [earlier, setEarlier] = useState(false);
  const groups: StepGroup[] = [...(earlier ? [{ ...group, type: 'thinking' as const, first_id: 1, last_id: 1, preview: 'Earlier history' }] : []), group, { ...group, first_id: 20, last_id: 20 }];
  const messages: Array<ChatMessage & { _step_groups_before: StepGroup[] }> = [{ id: '100', role: 'assistant', content: '', timestamp: new Date(), _step_groups_before: groups }];
  const sg = useStepGroups(messages, {
    isProcessing: false, isLastTurn: false,
    fetchToolStepsPreview: async (after: number) => {
      if (after === 9 && firstFetch) { firstFetch = false; return []; }
      return after === 9 ? [call] : [result];
    },
  });
  return <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]">
    <h1 className="text-xl mb-4">История шагов</h1>
    <button type="button" className="block mb-4 underline" onClick={() => setEarlier(true)}>Загрузить раннюю историю</button>
    <button type="button" className="block mb-4 underline" aria-expanded={sg.masterExpanded} onClick={() => sg.setMasterExpanded(value => !value)}>Шаги: {sg.totalHiddenSteps}</button>
    {sg.masterExpanded && <StepGroupsPanel {...sg}
      onLoadGroup={sg.handleLoadGroup}
      onToggleReasoning={(key, expanded) => sg.setReasoningExpanded(prev => ({ ...prev, [key]: expanded }))}
      onToggleToolGroup={key => sg.setCollapsedToolGroups(prev => ({ ...prev, [key]: !prev[key] }))} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
