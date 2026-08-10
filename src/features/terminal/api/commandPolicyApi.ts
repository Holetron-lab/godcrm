/**
 * Command Policy API - ADR-0053 Phase C
 * Owner-only writes to `_command_policies`. Used by the terminal
 * CommandApprovalDialog "Approve & Always Allow" button.
 */

import { apiClient } from '@/shared/utils/apiClient';

export type PolicyScope = 'global' | 'space';
export type PolicyMatchType = 'exact' | 'prefix' | 'regex';
export type PolicyAction = 'allow' | 'deny';

export interface CommandPolicy {
  id: number;
  scope: PolicyScope;
  space_id: number | null;
  agent_id: number | null;
  tool_id: number | null;
  pattern: string;
  match_type: PolicyMatchType;
  action: PolicyAction;
  actor: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddCommandPolicyInput {
  scope: PolicyScope;
  pattern: string;
  match_type: PolicyMatchType;
  action: PolicyAction;
  space_id?: number;
  agent_id?: number;
  tool_id?: number;
  reason?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export async function addCommandPolicy(input: AddCommandPolicyInput): Promise<CommandPolicy> {
  const res = await apiClient.post<ApiResponse<CommandPolicy>>('/agent-permissions/policies', input);
  return res.data;
}
