import { apiClient } from '@/shared/utils/apiClient';
import type { SMTPConfig, BackupInfo, BackupsResponse, DbStatsResponse } from '../types/system.types';

export const systemApi = {
  fetchSettings: () => apiClient.request<{ success: boolean; data: Record<string, string> }>('/system/settings'),
  saveSmtpSettings: (payload: SMTPConfig) =>
    apiClient.request<{ success: boolean; message: string }>('/system/smtp-settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  verifySmtpCode: (code: string) =>
    apiClient.request<{ success: boolean; message: string }>('/system/smtp-verify', {
      method: 'POST',
      body: JSON.stringify({ code })
    }),

  // ADR-039: Backup Management
  fetchBackups: () => 
    apiClient.request<{ success: boolean; data: BackupsResponse }>('/system/backups'),
  
  createBackup: () =>
    apiClient.request<{ success: boolean; data: BackupInfo }>('/system/backups/create', {
      method: 'POST'
    }),
  
  downloadBackup: (filename: string) =>
    `/api/v3/system/backups/${encodeURIComponent(filename)}/download`,

  // ADR-039: DB Monitoring
  fetchDbStats: () =>
    apiClient.request<{ success: boolean; data: DbStatsResponse }>('/system/db/stats'),
  
  runVacuum: () =>
    apiClient.request<{ success: boolean; data: { message: string; executed_at: string } }>('/system/db/vacuum', {
      method: 'POST'
    })
};
