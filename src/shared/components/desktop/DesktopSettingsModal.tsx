/**
 * Desktop Settings Modal
 * Unified settings modal for Electron desktop app
 * Accessible via right-click context menu → "Настройки"
 * Uses shared Modal component
 */

import { useState, useEffect } from 'react';
import { Server, CheckCircle, XCircle, Loader2, Info, Monitor, Keyboard, Globe } from 'lucide-react';
import { Modal, Button } from '@/shared/components/ui';
import { isDesktopApp } from '@/shared/types/electron.types';
import { setApiBaseUrl } from '@/shared/utils/apiClient';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface DesktopSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Keyboard shortcuts list
const SHORTCUTS = [
  { keys: 'Ctrl + R', action: 'Обновить страницу', actionEn: 'Reload page' },
  { keys: 'Ctrl + Shift + I', action: 'Инструменты разработчика', actionEn: 'Developer tools' },
  { keys: 'Ctrl + =', action: 'Увеличить масштаб', actionEn: 'Zoom in' },
  { keys: 'Ctrl + -', action: 'Уменьшить масштаб', actionEn: 'Zoom out' },
  { keys: 'Ctrl + 0', action: 'Сбросить масштаб', actionEn: 'Reset zoom' },
  { keys: 'Ctrl + ,', action: 'Настройки', actionEn: 'Settings' },
  { keys: 'F11', action: 'Полноэкранный режим', actionEn: 'Fullscreen mode' },
  { keys: 'Alt', action: 'Показать меню', actionEn: 'Show menu' },
  { keys: 'Ctrl + Q', action: 'Выход', actionEn: 'Quit' },
];

export const DesktopSettingsModal = ({ isOpen, onClose }: DesktopSettingsModalProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [activeTab, setActiveTab] = useState<'server' | 'loader' | 'shortcuts' | 'about'>('server');
  
  // Server settings
  const [serverUrl, setServerUrl] = useState('');
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  
  // Remote Loader settings (ADR-029)
  const [appUrl, setAppUrl] = useState('');
  const [loadMode, setLoadMode] = useState<'remote' | 'local' | 'auto'>('auto');
  const [appUrlStatus, setAppUrlStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  
  // App info
  const [appInfo, setAppInfo] = useState<{
    version: string;
    platform: string;
    arch: string;
    electron: string;
    chrome: string;
    node: string;
  } | null>(null);

  // Load settings on open
  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getApiUrl().then((url) => {
        setServerUrl(url);
        setOriginalUrl(url);
        checkConnection(url);
      });
      window.electronAPI.getAppInfo().then(setAppInfo);
      
      // Load Remote Loader settings (ADR-029)
      if (window.electronAPI.getAppUrl) {
        window.electronAPI.getAppUrl().then(setAppUrl);
      }
      if (window.electronAPI.getLoadMode) {
        window.electronAPI.getLoadMode().then(setLoadMode);
      }
    }
  }, [isOpen]);

  const checkConnection = async (url: string) => {
    if (!window.electronAPI) return;
    setServerStatus('checking');
    setServerError(null);
    
    const result = await window.electronAPI.testApiConnection(url);
    if (result.success) {
      setServerStatus('success');
    } else {
      setServerStatus('error');
      setServerError(result.error || t('Не удалось подключиться', 'Failed to connect'));
    }
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;
    
    setServerStatus('checking');
    const result = await window.electronAPI.testApiConnection(serverUrl);
    
    if (result.success) {
      await window.electronAPI.setApiUrl(serverUrl);
      setApiBaseUrl(serverUrl);
      setOriginalUrl(serverUrl);
      setServerStatus('success');
      onClose();
      // Reload to apply new API URL
      window.location.reload();
    } else {
      setServerStatus('error');
      setServerError(result.error || t('Не удалось подключиться к серверу', 'Failed to connect to server'));
    }
  };

  const handleCancel = () => {
    setServerUrl(originalUrl);
    setServerStatus('idle');
    setServerError(null);
    onClose();
  };

  // Remote Loader handlers (ADR-029)
  const checkAppUrl = async (url: string) => {
    if (!window.electronAPI?.checkServerHealth) return;
    setAppUrlStatus('checking');
    const isOnline = await window.electronAPI.checkServerHealth(url);
    setAppUrlStatus(isOnline ? 'online' : 'offline');
  };

  const handleSaveLoader = async () => {
    if (!window.electronAPI) return;
    if (window.electronAPI.setAppUrl) {
      await window.electronAPI.setAppUrl(appUrl);
    }
    if (window.electronAPI.setLoadMode) {
      await window.electronAPI.setLoadMode(loadMode);
    }
    if (window.electronAPI.reloadApp) {
      await window.electronAPI.reloadApp();
    }
    onClose();
  };

  if (!isDesktopApp()) return null;

  const tabs = [
    { id: 'server' as const, label: t('Сервер', 'Server'), icon: Server },
    { id: 'loader' as const, label: t('Загрузка', 'Loading'), icon: Globe },
    { id: 'shortcuts' as const, label: t('Горячие клавиши', 'Shortcuts'), icon: Keyboard },
    { id: 'about' as const, label: t('О программе', 'About'), icon: Info },
  ];

  const footer = (activeTab === 'server' || activeTab === 'loader') ? (
    <div className="flex justify-end gap-3 w-full">
      <Button variant="secondary" onClick={handleCancel}>
        {t('Отмена', 'Cancel')}
      </Button>
      <Button
        onClick={handleSave}
        loading={serverStatus === 'checking'}
      >
        {t('Сохранить', 'Save')}
      </Button>
    </div>
  ) : undefined;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleCancel()}
      title={t('Настройки', 'Settings')}
      size="md"
      footer={footer}
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-[var(--bg-tertiary)] rounded-lg">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center justify-center gap-2 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Server Tab */}
      {activeTab === 'server' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {t('Адрес сервера API', 'API server address')}
            </label>
            <div className="relative">
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://crm.example.com/api/v3"
                className="w-full px-4 py-2.5 pr-10 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {serverStatus === 'checking' && <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />}
                {serverStatus === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
                {serverStatus === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              </div>
            </div>
            {serverStatus === 'error' && serverError && (
              <p className="mt-2 text-sm text-red-500">{serverError}</p>
            )}
            {serverStatus === 'success' && (
              <p className="mt-2 text-sm text-green-500">{t('✓ Подключение установлено', '✓ Connection established')}</p>
            )}
          </div>
          
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <Info className="w-5 h-5 text-[var(--text-tertiary)] flex-shrink-0" />
            <p className="text-sm text-[var(--text-secondary)]">
              {t('Укажите адрес вашего сервера GOD CRM. Для облачной версии используйте', 'Enter the address of your GOD CRM server. For the cloud version use')}{' '}
              <code className="px-1 py-0.5 bg-[var(--bg-primary)] rounded text-[var(--accent-primary)]">
                https://crm.hltrn.cc/api/v3
              </code>
            </p>
          </div>
        </div>
      )}

      {/* Loader Tab (ADR-029) */}
      {activeTab === 'loader' && (
        <div className="space-y-6">
          {/* Load Mode */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">{t('Режим загрузки', 'Load mode')}</label>
            <div className="space-y-2">
              {[
                { value: 'auto' as const, label: t('Авто', 'Auto'), desc: t('С сервера, fallback на локальную версию', 'From server, fallback to local version') },
                { value: 'remote' as const, label: t('Удалённый', 'Remote'), desc: t('Только с сервера (требует интернет)', 'Server only (requires internet)') },
                { value: 'local' as const, label: t('Локальный', 'Local'), desc: t('Встроенная версия (offline)', 'Built-in version (offline)') },
              ].map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)] cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors">
                  <input
                    type="radio"
                    name="loadMode"
                    value={opt.value}
                    checked={loadMode === opt.value}
                    onChange={(e) => setLoadMode(e.target.value as typeof loadMode)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-[var(--text-primary)]">{opt.label}</div>
                    <div className="text-sm text-[var(--text-secondary)]">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          
          {/* App URL (only for remote/auto) */}
          {loadMode !== 'local' && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">{t('URL приложения', 'App URL')}</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                  placeholder="https://crm.hltrn.cc"
                  className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
                />
                <Button
                  variant="secondary"
                  onClick={() => checkAppUrl(appUrl)}
                  loading={appUrlStatus === 'checking'}
                >
                  {t('Проверить', 'Check')}
                </Button>
              </div>
              {appUrlStatus === 'online' && (
                <div className="flex items-center gap-2 mt-2 text-green-500">
                  <CheckCircle className="w-4 h-4" />
                  {t('Сервер доступен', 'Server available')}
                </div>
              )}
              {appUrlStatus === 'offline' && (
                <div className="flex items-center gap-2 mt-2 text-red-500">
                  <XCircle className="w-4 h-4" />
                  {t('Сервер недоступен', 'Server unavailable')}
                </div>
              )}
            </div>
          )}
          
          {/* Info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <Info className="w-5 h-5 text-[var(--text-tertiary)] flex-shrink-0" />
            <p className="text-sm text-[var(--text-secondary)]">
              {t('Режим "Авто" загружает приложение с сервера, при недоступности — использует встроенную версию.', 'The "Auto" mode loads the app from the server and falls back to the built-in version when unavailable.')}
            </p>
          </div>
          
          {/* Apply button */}
          <div className="flex justify-end">
            <Button onClick={handleSaveLoader}>
              {t('Применить и перезагрузить', 'Apply and reload')}
            </Button>
          </div>
        </div>
      )}

      {/* Shortcuts Tab */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-2">
          {SHORTCUTS.map((shortcut, index) => (
            <div 
              key={index}
              className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span className="text-sm text-[var(--text-secondary)]">{t(shortcut.action, shortcut.actionEn)}</span>
              <kbd className="px-2.5 py-1 text-xs font-mono bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)]">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </div>
      )}

      {/* About Tab */}
      {activeTab === 'about' && appInfo && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Monitor className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">GOD CRM Desktop</h3>
              <p className="text-sm text-[var(--text-secondary)]">{t('Версия', 'Version')} {appInfo.version}</p>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between py-2 border-b border-[var(--border-secondary)]">
              <span className="text-sm text-[var(--text-secondary)]">{t('Платформа', 'Platform')}</span>
              <span className="text-sm text-[var(--text-primary)]">{appInfo.platform} ({appInfo.arch})</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[var(--border-secondary)]">
              <span className="text-sm text-[var(--text-secondary)]">Electron</span>
              <span className="text-sm text-[var(--text-primary)]">{appInfo.electron}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[var(--border-secondary)]">
              <span className="text-sm text-[var(--text-secondary)]">Chrome</span>
              <span className="text-sm text-[var(--text-primary)]">{appInfo.chrome}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-[var(--text-secondary)]">Node.js</span>
              <span className="text-sm text-[var(--text-primary)]">{appInfo.node}</span>
            </div>
          </div>
          
          <p className="text-xs text-[var(--text-tertiary)] text-center mt-4">
            © 2026 GOD CRM Team. All rights reserved.
          </p>
        </div>
      )}
    </Modal>
  );
};
