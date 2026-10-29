/**
 * ApiSettings - Component for configuring API server URL in desktop app
 * Only renders when running inside Electron
 */
import { useState, useEffect, useCallback, useId } from 'react';
import { Server, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { isDesktopApp } from '@/shared/types/electron.types';
import { setApiBaseUrl } from '@/shared/utils/apiClient';

interface ConnectionStatus {
  status: 'idle' | 'checking' | 'success' | 'error';
  message?: string;
  serverVersion?: string;
}

export const ApiSettings = () => {
  const apiUrlId = useId();
  const [apiUrl, setApiUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ status: 'idle' });
  const [appInfo, setAppInfo] = useState<{
    version: string;
    platform: string;
    electron: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load current API URL on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const url = await window.electronAPI.getApiUrl();
        setApiUrl(url);
        setOriginalUrl(url);
        
        const info = await window.electronAPI.getAppInfo();
        setAppInfo(info);
        
        // Test connection on load
        testConnection(url);
      }
    };
    loadSettings();
  }, []);

  const testConnection = useCallback(async (url: string) => {
    setConnectionStatus({ status: 'checking' });
    
    if (!window.electronAPI) {
      setConnectionStatus({ status: 'error', message: 'Electron API not available' });
      return;
    }

    const result = await window.electronAPI.testApiConnection(url);
    
    if (result.success) {
      const data = result.data as { version?: string; database?: string };
      setConnectionStatus({
        status: 'success',
        message: 'Connection successful',
        serverVersion: data?.version,
      });
    } else {
      setConnectionStatus({
        status: 'error',
        message: result.error || 'Connection failed',
      });
    }
  }, []);

  const handleSave = async () => {
    if (!window.electronAPI || apiUrl === originalUrl) return;
    
    setIsSaving(true);
    
    // Test connection first
    const result = await window.electronAPI.testApiConnection(apiUrl);
    
    if (result.success) {
      await window.electronAPI.setApiUrl(apiUrl);
      setApiBaseUrl(apiUrl);
      setOriginalUrl(apiUrl);
      setConnectionStatus({
        status: 'success',
        message: 'Settings saved. Reloading...',
      });
      
      // Reload app to apply new API URL
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      setConnectionStatus({
        status: 'error',
        message: `Cannot save: ${result.error || 'Connection failed'}`,
      });
    }
    
    setIsSaving(false);
  };

  const handleReset = () => {
    setApiUrl(originalUrl);
    setConnectionStatus({ status: 'idle' });
  };

  // Only render in desktop app
  if (!isDesktopApp()) {
    return null;
  }

  const hasChanges = apiUrl !== originalUrl;

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Server className="h-5 w-5 text-[var(--color-primary-500)]" />
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            API Server Configuration
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Configure the backend server URL for this desktop application
          </p>
        </div>
      </div>

      {/* App Info */}
      {appInfo && (
        <div className="flex flex-wrap gap-4 text-xs text-[var(--text-tertiary)]">
          <span>GOD CRM Desktop v{appInfo.version}</span>
          <span>•</span>
          <span>Platform: {appInfo.platform}</span>
          <span>•</span>
          <span>Electron: {appInfo.electron}</span>
        </div>
      )}

      {/* API URL Input */}
      <div className="space-y-2">
        <label htmlFor={apiUrlId} className="block text-sm font-medium text-[var(--text-secondary)]">
          API Server URL
        </label>
        <div className="flex gap-2">
          <input
            id={apiUrlId}
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://crm.company.local/api/v3"
            className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Button
            variant="secondary"
            onClick={() => testConnection(apiUrl)}
            disabled={connectionStatus.status === 'checking'}
          >
            {connectionStatus.status === 'checking' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Test</span>
          </Button>
        </div>
      </div>

      {/* Connection Status */}
      {connectionStatus.status !== 'idle' && (
        <div className={`flex items-center gap-2 text-sm ${
          connectionStatus.status === 'success' 
            ? 'text-green-500' 
            : connectionStatus.status === 'error' 
              ? 'text-red-500' 
              : 'text-[var(--text-secondary)]'
        }`}>
          {connectionStatus.status === 'checking' && (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Testing connection...</span>
            </>
          )}
          {connectionStatus.status === 'success' && (
            <>
              <CheckCircle className="h-4 w-4" />
              <span>{connectionStatus.message}</span>
              {connectionStatus.serverVersion && (
                <span className="text-[var(--text-tertiary)]">
                  (Server: {connectionStatus.serverVersion})
                </span>
              )}
            </>
          )}
          {connectionStatus.status === 'error' && (
            <>
              <XCircle className="h-4 w-4" />
              <span>{connectionStatus.message}</span>
            </>
          )}
        </div>
      )}

      {/* Preset URLs */}
      <div className="space-y-2">
        <p className="block text-sm font-medium text-[var(--text-tertiary)]">
          Quick presets:
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setApiUrl('https://crm.hltrn.cc/api/v3')}
            className={`px-3 py-1 text-xs rounded-full border ${
              apiUrl === 'https://crm.hltrn.cc/api/v3'
                ? 'bg-primary-500 text-white border-primary-500'
                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            ☁️ Cloud (crm.hltrn.cc)
          </button>
          <button
            onClick={() => setApiUrl('https://devcrm.hltrn.cc/api/v3')}
            className={`px-3 py-1 text-xs rounded-full border ${
              apiUrl === 'https://devcrm.hltrn.cc/api/v3'
                ? 'bg-primary-500 text-white border-primary-500'
                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            🧪 Dev (devcrm.hltrn.cc)
          </button>
          <button
            onClick={() => setApiUrl('http://localhost:5000/api/v3')}
            className={`px-3 py-1 text-xs rounded-full border ${
              apiUrl === 'http://localhost:5000/api/v3'
                ? 'bg-primary-500 text-white border-primary-500'
                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            💻 Local (localhost:5000)
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      {hasChanges && (
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="secondary" onClick={handleReset} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving || connectionStatus.status === 'checking'}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save & Reload'
            )}
          </Button>
        </div>
      )}
    </div>
  );
};
