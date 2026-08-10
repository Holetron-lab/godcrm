/**
 * Terminal Feature - ADR-076
 * Exports for use in widgets, AI Chat panel, and standalone module.
 */

export { TerminalPanel } from './components/TerminalPanel';
export { TerminalOutput } from './components/TerminalOutput';
export { TerminalInput } from './components/TerminalInput';
export { CommandApprovalDialog } from './components/CommandApprovalDialog';
export { CommandApprovalBar } from './components/CommandApprovalBar';
export { useTerminalSession } from './hooks/useTerminalSession';
export { usePendingAgentApproval } from './hooks/usePendingAgentApproval';
export { parseAnsi, stripAnsi } from './utils/ansiParser';
export type { TerminalSession, TerminalCommand, PendingCommand } from './api/terminalApi';
