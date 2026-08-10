// Main chat panel component (ADR-024: Restored v2)
export { AIChatPanel } from './components/AIChatPanel';
export { AIChatProvider, useAIChat } from './context/AIChatContext';

// ADR-024: Telegram-like components (alternative)
export { TelegramChatLayout } from './components/TelegramChatLayout';
export { ChatListView } from './components/ChatListView';
export { ChatConversationView } from './components/ChatConversationView';

// Shared components
export { MentionInput } from './components/MentionInput';
export { TaskSelector } from './components/TaskSelector';
export { ChatSettings } from './components/ChatSettings';
export { ParticipantSelector } from './components/ParticipantSelector';
export { RowBinding } from './components/RowBinding';
export { ChatBindingSettings } from './components/ChatBindingSettings';
export type { MentionUser, MentionInputProps } from './components/MentionInput';
export type { TaskSelectorProps } from './components/TaskSelector';
export type { ChatSettingsProps } from './components/ChatSettings';
export type { ParticipantSelectorProps, Participant, ParticipantType } from './components/ParticipantSelector';
export type { RowBindingProps, BoundRow } from './components/RowBinding';
export type { ChatBindingConfig, ChatBindingSettingsProps } from './components/ChatBindingSettings';
export type { ChatPreview, ChatListViewProps } from './components/ChatListView';
export type { ChatMessageItem, ChatMessageItemContentType, ChatInfo, ChatConversationViewProps } from './components/ChatConversationView';
export type { ChatMessageItemTurn } from './utils/groupChatMessageItems';
export { AgentTurnBubble } from './components/AgentTurnBubble';
export type { TelegramChatLayoutProps } from './components/TelegramChatLayout';
