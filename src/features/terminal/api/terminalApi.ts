/**
 * Terminal API - ADR-076
 * API client functions for terminal sessions and commands.
 */

import { apiClient } from '@/shared/utils/apiClient';

// ============================================================
// Types
// ============================================================

export interface TerminalSession {
  id: number;
  user_id: number;
  title: string;
  cwd: string;
  status: string;
  created_at: string;
  updated_at: string;
  command_count?: number;
  commands?: TerminalCommand[];
}

export interface TerminalCommand {
  id: number;
  session_id: number;
  command: string;
  output: string | null;
  exit_code: number | null;
  risk_level: 'safe' | 'medium' | 'dangerous';
  approval_status: 'auto' | 'auto_logged' | 'pending' | 'approved' | 'rejected';
  approved_by: number | null;
  source: 'user' | 'agent';
  agent_name: string | null;
  execution_time_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

interface ExecuteResponse {
  needsApproval: boolean;
  sessionId?: number;
  commandId?: number;
  command: TerminalCommand | string;
  riskLevel?: string;
  message?: string;
}

// ============================================================
// Session API
// ============================================================

export async function listSessions(): Promise<TerminalSession[]> {
  const res = await apiClient.get<ApiResponse<TerminalSession[]>>('/terminal/sessions');
  return res.data;
}

export async function createSession(title?: string, cwd?: string): Promise<TerminalSession> {
  const res = await apiClient.post<ApiResponse<TerminalSession>>('/terminal/sessions', { title, cwd });
  return res.data;
}

export async function getSession(sessionId: number): Promise<TerminalSession> {
  const res = await apiClient.get<ApiResponse<TerminalSession>>(`/terminal/sessions/${sessionId}`);
  return res.data;
}

export async function closeSession(sessionId: number): Promise<void> {
  await apiClient.delete(`/terminal/sessions/${sessionId}`);
}

// ============================================================
// Command API
// ============================================================

export async function executeCommand(
  sessionId: number,
  command: string,
  options?: { source?: string; agentName?: string }
): Promise<ExecuteResponse> {
  const res = await apiClient.post<ApiResponse<ExecuteResponse>>(
    `/terminal/sessions/${sessionId}/execute`,
    { command, ...options }
  );
  return res.data;
}

export async function quickExecute(
  command: string,
  options?: { source?: string; agentName?: string }
): Promise<ExecuteResponse> {
  const res = await apiClient.post<ApiResponse<ExecuteResponse>>(
    '/terminal/execute',
    { command, ...options }
  );
  return res.data;
}

export async function getCommands(
  sessionId: number,
  afterId?: number,
  limit?: number
): Promise<TerminalCommand[]> {
  const params = new URLSearchParams();
  if (afterId) params.set('after', String(afterId));
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const res = await apiClient.get<ApiResponse<TerminalCommand[]>>(
    `/terminal/sessions/${sessionId}/commands${qs ? `?${qs}` : ''}`
  );
  return res.data;
}

export interface PendingCommand extends TerminalCommand {
  session_title?: string | null;
  session_user_id?: number | null;
}

export async function listPendingCommands(): Promise<PendingCommand[]> {
  const res = await apiClient.get<ApiResponse<PendingCommand[]>>('/terminal/commands/pending');
  return res.data;
}

export async function approveCommand(commandId: number): Promise<TerminalCommand> {
  const res = await apiClient.post<ApiResponse<TerminalCommand>>(
    `/terminal/commands/${commandId}/approve`
  );
  return res.data;
}

export async function rejectCommand(commandId: number): Promise<TerminalCommand> {
  const res = await apiClient.post<ApiResponse<TerminalCommand>>(
    `/terminal/commands/${commandId}/reject`
  );
  return res.data;
}
