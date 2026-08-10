/**
 * UpdateNotification - Desktop App Auto-Update UI
 * Shows update availability, download progress, and restart button
 * Only visible in Electron desktop app
 */

import { useEffect, useState, useCallback } from 'react';
import { isDesktopApp, type UpdateInfo, type DownloadProgress } from '../../types/electron.types';
import { logger } from '../../utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';

type UpdateState = 
  | 'idle'           // No update activity
  | 'checking'       // Checking for updates
  | 'available'      // Update available, waiting for user to download
  | 'downloading'    // Download in progress
  | 'downloaded'     // Ready to install
  | 'error';         // Error occurred

interface UpdateNotificationState {
  state: UpdateState;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress | null;
  error: string | null;
}

export function UpdateNotification() {
  // Early return for web - don't even use hooks if not desktop
  // This prevents any potential issues with electron API calls in web
  if (typeof window === 'undefined' || !window.electronAPI) {
    return null;
  }

  return <UpdateNotificationInner />;
}

function UpdateNotificationInner() {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [update, setUpdate] = useState<UpdateNotificationState>({
    state: 'idle',
    updateInfo: null,
    progress: null,
    error: null,
  });
  const [dismissed, setDismissed] = useState(false);

  // Subscribe to update events from Electron
  useEffect(() => {
    if (!isDesktopApp() || !window.electronAPI) return;

    const api = window.electronAPI;

    // Update available
    const unsubAvailable = api.onUpdateAvailable((info) => {
      logger.info('Update available:', info.version);
      setUpdate({
        state: 'available',
        updateInfo: info,
        progress: null,
        error: null,
      });
      setDismissed(false);
    });

    // No update available
    const unsubNotAvailable = api.onUpdateNotAvailable((info) => {
      logger.debug('No update available, current is latest:', info.version);
      setUpdate((prev) => ({ ...prev, state: 'idle' }));
    });

    // Download progress
    const unsubProgress = api.onUpdateDownloadProgress((progress) => {
      setUpdate((prev) => ({
        ...prev,
        state: 'downloading',
        progress,
      }));
    });

    // Update downloaded
    const unsubDownloaded = api.onUpdateDownloaded((info) => {
      logger.info('Update downloaded:', info.version);
      setUpdate({
        state: 'downloaded',
        updateInfo: info,
        progress: null,
        error: null,
      });
    });

    // Error
    const unsubError = api.onUpdateError((error) => {
      logger.error('Update error:', error.message);
      setUpdate((prev) => ({
        ...prev,
        state: 'error',
        error: error.message,
      }));
    });

    // Cleanup
    return () => {
      unsubAvailable();
      unsubNotAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  // Handle download button click
  const handleDownload = useCallback(async () => {
    if (!window.electronAPI) return;
    
    setUpdate((prev) => ({ ...prev, state: 'downloading', progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 } }));
    
    const result = await window.electronAPI.downloadUpdate();
    if (!result.success) {
      setUpdate((prev) => ({
        ...prev,
        state: 'error',
        error: result.error || 'Download failed',
      }));
    }
  }, []);

  // Handle restart button click
  const handleRestart = useCallback(() => {
    if (!window.electronAPI) return;
    window.electronAPI.quitAndInstall();
  }, []);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Handle check for updates (manual)
  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI) return;
    
    setUpdate((prev) => ({ ...prev, state: 'checking' }));
    
    const result = await window.electronAPI.checkForUpdates();
    if (!result.success) {
      setUpdate({
        state: 'error',
        updateInfo: null,
        progress: null,
        error: result.error || 'Check failed',
      });
    }
  }, []);

  // Don't render if dismissed and not downloading/downloaded
  if (dismissed && update.state !== 'downloading' && update.state !== 'downloaded') {
    return null;
  }

  // Don't render if idle
  if (update.state === 'idle') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className="bg-card border border-border rounded-lg shadow-lg p-4">
        {/* Update Available */}
        {update.state === 'available' && update.updateInfo && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 text-2xl">🚀</div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground">
                  {t('Доступно обновление', 'Update available')}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('Версия', 'Version')} {update.updateInfo.version} {t('готова к загрузке', 'is ready to download')}
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('Закрыть', 'Close')}
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleDownload}
                className="flex-1 bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm font-medium hover:bg-primary/90"
              >
                {t('Загрузить', 'Download')}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
              >
                {t('Позже', 'Later')}
              </button>
            </div>
          </>
        )}

        {/* Checking */}
        {update.state === 'checking' && (
          <div className="flex items-center gap-3">
            <div className="animate-spin">⏳</div>
            <span className="text-sm text-muted-foreground">
              {t('Проверка обновлений...', 'Checking for updates...')}
            </span>
          </div>
        )}

        {/* Downloading */}
        {update.state === 'downloading' && update.progress && (
          <>
            <div className="flex items-center gap-3">
              <div className="animate-pulse">📥</div>
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-foreground">{t('Загрузка обновления...', 'Downloading update...')}</span>
                  <span className="text-muted-foreground">
                    {update.progress.percent.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${update.progress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatBytes(update.progress.transferred)} / {formatBytes(update.progress.total)}
                  {update.progress.bytesPerSecond > 0 && (
                    <span className="ml-2">
                      ({formatBytes(update.progress.bytesPerSecond)}/{t('с', 's')})
                    </span>
                  )}
                </p>
              </div>
            </div>
          </>
        )}

        {/* Downloaded - Ready to Install */}
        {update.state === 'downloaded' && update.updateInfo && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 text-2xl">✅</div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground">
                  {t('Обновление загружено', 'Update downloaded')}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('Версия', 'Version')} {update.updateInfo.version} {t('готова к установке. Перезапустите приложение для применения.', 'is ready to install. Restart the app to apply.')}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleRestart}
                className="flex-1 bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700"
              >
                {t('Перезапустить сейчас', 'Restart now')}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground"
              >
                {t('Позже', 'Later')}
              </button>
            </div>
          </>
        )}

        {/* Error */}
        {update.state === 'error' && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 text-2xl">⚠️</div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-foreground">
                  {t('Ошибка обновления', 'Update error')}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {update.error || t('Не удалось проверить или загрузить обновление', 'Failed to check for or download the update')}
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('Закрыть', 'Close')}
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleCheckForUpdates}
                className="flex-1 bg-muted text-foreground px-3 py-1.5 rounded text-sm font-medium hover:bg-muted/80"
              >
                {t('Попробовать снова', 'Try again')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default UpdateNotification;
