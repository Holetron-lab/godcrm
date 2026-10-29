import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { InputArea } from '../InputArea';
import { AgentWorkingIndicator } from '../ChatMessages/ChatTurn/AgentWorkingIndicator';
import { ContextSettingsSection } from '../ChatPanels/ContextSettingsSection';

function Example() {
  const { setLanguage } = useLanguage();
  const [inputValue, setInputValue] = useState('');
  const noop = () => {};
  const fileInputRef = React.useRef(document.createElement('input'));
  return <>
    <button onClick={() => setLanguage('en')}>EN</button>
    <button onClick={() => setLanguage('ru')}>RU</button>
    <InputArea inputValue={inputValue} setInputValue={setInputValue}
      attachments={[]} setAttachments={noop} mentionedUsers={[]} setMentionedUsers={noop}
      messageBoundRows={[]} setMessageBoundRows={noop} showFilePicker={false} setShowFilePicker={noop}
      attachTab="files" setAttachTab={noop} filesSource={undefined} updateFilesSource={noop}
      projectFiles={[]} isLoadingFiles={false} filesSearch="" setFilesSearch={noop}
      effectiveSpaceId={undefined} tasksSource={undefined} chatPartner={null} hasSlashCommand={false}
      thinkingEnabled={false} setThinkingEnabled={noop} agentMode="ask" setAgentMode={noop}
      markdownEnabled={false} setMarkdownEnabled={noop} showTerminal={false} setShowTerminal={noop}
      isRecording={false} isTranscribing={false} voiceError={null} recordingDuration={0}
      startRecording={noop} stopRecording={noop} cancelRecording={noop} voiceMode="whisper"
      isLoading={false} isAgentProcessing={false} stopAgent={noop} handleSubmit={noop}
      handleFileSelect={noop} fileInputRef={fileInputRef} availableMentionUsers={[]}
      availableSlashAgents={[]} panelMode="full" />
    <AgentWorkingIndicator metadata={{ agent_status: 'starting', agent_action: 'Запускается...', placeholder: true }} />
    <ContextSettingsSection contextSettings={null} onChange={noop} onSave={noop} isSaving={false} />
  </>;
}

describe('chat localization', () => {
  it('changes the composer, agent startup and settings language without losing the draft', () => {
    renderWithProviders(<Example />, { language: 'en' });
    const input = screen.getByPlaceholderText('Message... (/ invoke an agent)');
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    expect(screen.getByText('Starting')).toBeInTheDocument();
    expect(screen.queryByText('Запускается...')).not.toBeInTheDocument();
    expect(screen.getByText('Context Depth')).toBeInTheDocument();
    fireEvent.click(screen.getByText('RU'));
    expect(screen.getByPlaceholderText('Сообщение... (/ вызвать агента)')).toBe(input);
    expect(input).toHaveValue('Keep my draft');
    expect(screen.getByText('Запускается')).toBeInTheDocument();
    expect(screen.getByText('Глубина контекста')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Инструменты'));
    expect(screen.getByTitle('Жирный **')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Эмодзи'));
    expect(screen.getByText('Часто')).toBeInTheDocument();
    fireEvent.click(screen.getByText('EN'));
    expect(screen.getByTitle('Bold **')).toBeInTheDocument();
    expect(screen.getByText('Frequent')).toBeInTheDocument();
    expect(input).toHaveValue('Keep my draft');
  });
});
