/**
 * StatusBar - VS Code-like status bar at the bottom of the window
 * Layout: [Settings Help | WiFi Server User] ... [QuickLinks] ... [ChatIndicators | Bug v1.0.0]
 */

import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Settings, HelpCircle, Cloud, Wifi, WifiOff, Database, Bug,
  Link as LinkIcon, Plus, X, ChevronLeft, ChevronRight, Pencil,
  Bell, BrainCircuit, Loader2, Send, CheckCircle2,
  MessageSquare, ChevronDown,
} from 'lucide-react';
import { isDesktopApp } from '@/shared/types/electron.types';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useBugReport } from '@/shared/hooks/useBugReport';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { StatusBarContext } from './StatusBarContext';
import { useAIChat } from '@/features/ai-chat/context/AIChatContext';

/* ─── Quick Links Storage ─── */
interface QuickLink {
  id: string;
  label: string;
  icon?: string;
  url: string;
}

interface QuickLinksConfig {
  links: QuickLink[];
  displayCount: number;
  showLabels: boolean;
  scrollMode: 'single' | 'page';
}

const DEFAULT_QUICK_LINKS_CONFIG: QuickLinksConfig = {
  links: [],
  displayCount: 5,
  showLabels: true,
  scrollMode: 'single',
};

const loadQuickLinksConfig = (): QuickLinksConfig => {
  try {
    const stored = localStorage.getItem('statusbar_quick_links');
    if (stored) return { ...DEFAULT_QUICK_LINKS_CONFIG, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_QUICK_LINKS_CONFIG;
};

const saveQuickLinksConfig = (config: QuickLinksConfig) => {
  localStorage.setItem('statusbar_quick_links', JSON.stringify(config));
};

/* ─── Quick Links Settings Modal ─── */
const QuickLinksSettingsModal = ({
  isOpen,
  onClose,
  config,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  config: QuickLinksConfig;
  onSave: (config: QuickLinksConfig) => void;
}) => {
  const { t } = useLanguage();
  const [local, setLocal] = useState(config);
  const [editingLink, setEditingLink] = useState<QuickLink | null>(null);

  useEffect(() => {
    if (isOpen) setLocal(config);
  }, [isOpen, config]);

  if (!isOpen) return null;

  const addLink = () => {
    setEditingLink({ id: crypto.randomUUID(), label: '', icon: '', url: '' });
  };

  const saveLink = () => {
    if (!editingLink || !editingLink.url) return;
    const exists = local.links.find(l => l.id === editingLink.id);
    const links = exists
      ? local.links.map(l => (l.id === editingLink.id ? editingLink : l))
      : [...local.links, editingLink];
    setLocal({ ...local, links });
    setEditingLink(null);
  };

  const removeLink = (id: string) => {
    setLocal({ ...local, links: local.links.filter(l => l.id !== id) });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl w-[420px] max-h-[80vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('statusBar.quickLinks')}</h3>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Display settings */}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-[var(--text-secondary)]">
              {t('statusBar.linkCount')}
              <input
                type="number"
                min={1}
                max={20}
                value={local.displayCount}
                onChange={e => setLocal({ ...local, displayCount: Number(e.target.value) })}
                className="mt-1 w-full px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs"
              />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              {t('statusBar.scroll')}
              <select
                value={local.scrollMode}
                onChange={e => setLocal({ ...local, scrollMode: e.target.value as 'single' | 'page' })}
                className="mt-1 w-full px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs"
              >
                <option value="single">{t('statusBar.scrollSingle')}</option>
                <option value="page">{t('statusBar.scrollPage')}</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={local.showLabels}
              onChange={e => setLocal({ ...local, showLabels: e.target.checked })}
              className="rounded"
            />
            {t('statusBar.showTitles')}
          </label>

          {/* Links list */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-[var(--text-secondary)] mb-1">{t('statusBar.links')}</div>
            {local.links.map(link => (
              <div key={link.id} className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--bg-secondary)] text-xs">
                <span className="flex-1 truncate text-[var(--text-primary)]">
                  {link.icon && <span className="mr-1">{link.icon}</span>}
                  {link.label || link.url}
                </span>
                <button
                  onClick={() => setEditingLink(link)}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => removeLink(link.id)}
                  className="text-[var(--text-tertiary)] hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Edit/Add link form */}
          {editingLink && (
            <div className="space-y-2 p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
              <input
                placeholder={t('statusBar.name')}
                value={editingLink.label}
                onChange={e => setEditingLink({ ...editingLink, label: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs"
              />
              <input
                placeholder={t('statusBar.urlPlaceholder')}
                value={editingLink.url}
                onChange={e => setEditingLink({ ...editingLink, url: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs"
              />
              <input
                placeholder={t('statusBar.iconOptional')}
                value={editingLink.icon || ''}
                onChange={e => setEditingLink({ ...editingLink, icon: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveLink}
                  className="px-3 py-1 rounded bg-[var(--color-primary-500)] text-white text-xs hover:bg-[var(--color-primary-600)]"
                >
                  {t('statusBar.save')}
                </button>
                <button
                  onClick={() => setEditingLink(null)}
                  className="px-3 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-tertiary)]"
                >
                  {t('statusBar.cancel')}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={addLink}
            className="flex items-center gap-1 text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)]"
          >
            <Plus className="w-3 h-3" /> {t('statusBar.addLink')}
          </button>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-[var(--border-primary)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            {t('statusBar.cancel')}
          </button>
          <button
            onClick={() => {
              onSave(local);
              onClose();
            }}
            className="px-3 py-1.5 rounded bg-[var(--color-primary-500)] text-white text-xs hover:bg-[var(--color-primary-600)]"
          >
            {t('statusBar.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Quick Links Bar ─── */
const QuickLinksBar = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [config, setConfig] = useState(loadQuickLinksConfig);
  const [offset, setOffset] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const visible = config.links.slice(offset, offset + config.displayCount);
  const canPrev = offset > 0;
  const canNext = offset + config.displayCount < config.links.length;

  const scrollBy = (dir: 1 | -1) => {
    const step = config.scrollMode === 'page' ? config.displayCount : 1;
    setOffset(prev => Math.max(0, Math.min(prev + dir * step, config.links.length - config.displayCount)));
  };

  const handleSave = (newConfig: QuickLinksConfig) => {
    setConfig(newConfig);
    saveQuickLinksConfig(newConfig);
    setOffset(0);
  };

  const handleLinkClick = (link: QuickLink) => {
    if (link.url.startsWith('http')) {
      window.open(link.url, '_blank');
    } else {
      navigate(link.url);
    }
  };

  if (config.links.length === 0) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 opacity-40 hover:opacity-80"
          title={t('statusBar.configureQuickLinks')}
        >
          <LinkIcon className="w-3 h-3" />
          <Plus className="w-2.5 h-2.5" />
        </button>
        <QuickLinksSettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          config={config}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {canPrev && (
        <button onClick={() => scrollBy(-1)} className="px-0.5 hover:bg-white/10 rounded transition-colors">
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}

      {visible.map(link => (
        <button
          key={link.id}
          onClick={() => handleLinkClick(link)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 max-w-[120px] truncate"
          title={link.label || link.url}
        >
          {link.icon && <span className="text-[10px]">{link.icon}</span>}
          {config.showLabels && <span className="truncate">{link.label || link.url}</span>}
          {!config.showLabels && !link.icon && <LinkIcon className="w-3 h-3" />}
        </button>
      ))}

      {canNext && (
        <button onClick={() => scrollBy(1)} className="px-0.5 hover:bg-white/10 rounded transition-colors">
          <ChevronRight className="w-3 h-3" />
        </button>
      )}

      <button
        onClick={() => setShowSettings(true)}
        className="px-1 py-0.5 rounded transition-colors hover:bg-white/10 opacity-60 hover:opacity-100"
        title={t('statusBar.configureQuickLinks')}
      >
        <Settings className="w-2.5 h-2.5" />
      </button>

      <QuickLinksSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        onSave={handleSave}
      />
    </div>
  );
};

/* ─── Chat Indicators (right section) ─── */
const ChatIndicators = () => {
  const { t } = useLanguage();
  const [showCommands, setShowCommands] = useState(false);
  const commandsRef = useRef<HTMLDivElement>(null);

  const { isAgentProcessing, processingAgentName, currentConversationId, openChat, createNewConversation } = useAIChat();

  // Close commands dropdown on outside click
  useEffect(() => {
    if (!showCommands) return;
    const handler = (e: MouseEvent) => {
      if (commandsRef.current && !commandsRef.current.contains(e.target as Node)) setShowCommands(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCommands]);

  return (
    <div className="flex items-center gap-1.5">
      {/* Active chat indicator */}
      {currentConversationId && (
        <button
          onClick={openChat}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
          title={`Chat #${currentConversationId}`}
        >
          <MessageSquare className="w-3 h-3" />
          <span className="text-[10px]">#{currentConversationId}</span>
        </button>
      )}

      {/* Notifications placeholder — wired to polling later */}
      <button
        onClick={openChat}
        className="relative flex items-center px-1 py-0.5 rounded transition-colors hover:bg-white/10"
        title={t('statusBar.notifications')}
      >
        <Bell className="w-3 h-3" />
      </button>

      {/* Agent context */}
      <button
        className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 opacity-60"
        title={t('statusBar.agentContext')}
      >
        <BrainCircuit className="w-3 h-3" />
      </button>

      {/* Work status */}
      <div
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
          isAgentProcessing ? 'text-yellow-400' : 'text-emerald-400 opacity-60'
        }`}
        title={isAgentProcessing ? `${processingAgentName || t('statusBar.agentFallback')} ${t('statusBar.working')}` : t('statusBar.ready')}
      >
        {isAgentProcessing ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px] max-w-[80px] truncate">{processingAgentName || 'Working'}</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3 h-3" />
            <span className="text-[10px]">Ready</span>
          </>
        )}
      </div>

      {/* Quick commands dropdown */}
      <div className="relative" ref={commandsRef}>
        <button
          onClick={() => setShowCommands(!showCommands)}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
          title={t('statusBar.quickCommands')}
        >
          <Send className="w-3 h-3" />
          <ChevronDown className="w-2.5 h-2.5" />
        </button>

        {showCommands && (
          <div className="absolute bottom-full right-0 mb-1 w-52 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-xl z-[100] py-1">
            <button
              onClick={() => { openChat(); setShowCommands(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Send className="w-3 h-3" />
              {t('statusBar.sendToThisChat')}
            </button>
            <button
              onClick={() => { createNewConversation(); openChat(); setShowCommands(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('statusBar.newChat')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Main StatusBar ─── */
export const StatusBar = () => {
  const { t } = useLanguage();
  const user = useAuthStore(state => state.user);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { isBugModalOpen, openBugModal, closeBugModal, submitBug, bugTable, bugColumns } = useBugReport();

  const statusBarContext = useContext(StatusBarContext);
  const customActions = statusBarContext?.actions || [];

  // Listen to online/offline events
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Detect actual API host — for web use window.location, for desktop use stored URL
  const getApiHost = useCallback(() => {
    if (isDesktopApp()) {
      try {
        const stored = localStorage.getItem('api_url');
        if (stored) return new URL(stored).hostname;
      } catch {}
      return 'crm.hltrn.cc';
    }
    return window.location.hostname;
  }, []);

  const apiHost = getApiHost();
  const isCloud = apiHost.includes('hltrn.cc');
  const isDev = apiHost.includes('devcrm') || apiHost.includes('dev') || apiHost === 'localhost';
  const envLabel = isDev ? 'DEV' : 'PROD';

  return (
    <footer className="flex-shrink-0 h-6 flex items-center px-2 bg-[var(--bg-secondary)] border-t border-[var(--border-primary)] text-[var(--text-secondary)] text-xs select-none">
      {/* ═══ LEFT: Settings, Help | Connection, Server, User ═══ */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center px-1.5 py-0.5 rounded transition-colors ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`
          }
          title={t('nav.settings')}
        >
          <Settings className="w-3 h-3" />
        </NavLink>

        {/* Help */}
        <NavLink
          to="/help"
          className={({ isActive }) =>
            `flex items-center px-1.5 py-0.5 rounded transition-colors ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`
          }
          title={t('nav.help')}
        >
          <HelpCircle className="w-3 h-3" />
        </NavLink>

        {/* Separator */}
        <div className="w-px h-3 bg-[var(--border-primary)] mx-1" />

        {/* Connection Status */}
        <div className="flex items-center gap-1" title={isOnline ? 'Online' : 'Offline'}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3 text-yellow-300" />}
        </div>

        {/* API Server */}
        <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity" title={`API: ${apiHost}`}>
          {isCloud ? <Cloud className="w-3 h-3" /> : <Database className="w-3 h-3" />}
          <span>{apiHost}</span>
          {isDev && (
            <span className="ml-0.5 px-1 py-px rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400 leading-none">
              {envLabel}
            </span>
          )}
        </div>

        {/* Current user */}
        {user && <span className="opacity-60 ml-1">{user.email}</span>}
      </div>

      {/* ═══ CENTER: Quick Links ═══ */}
      <div className="flex-1 flex items-center justify-center min-w-0 mx-3">
        {/* Custom actions from pages */}
        {customActions.length > 0 && (
          <>
            {customActions.map(action => (
              <div key={action.id}>{action.component}</div>
            ))}
            <div className="w-px h-3 bg-[var(--border-primary)] mx-2" />
          </>
        )}
        <QuickLinksBar />
      </div>

      {/* ═══ RIGHT: Chat indicators | Bug, Version ═══ */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <ChatIndicators />

        {/* Separator */}
        <div className="w-px h-3 bg-[var(--border-primary)] mx-1" />

        {/* Report Bug */}
        <button
          onClick={openBugModal}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
          title={t('statusBar.reportBug')}
        >
          <Bug className="w-3 h-3" />
        </button>

        {/* Version */}
        <span className="opacity-60">v{__APP_VERSION__}</span>
      </div>

      {/* Bug Report Modal */}
      <AddRowModal
        isOpen={isBugModalOpen}
        onClose={closeBugModal}
        onConfirm={submitBug}
        columns={bugColumns}
        tableId={bugTable?.id}
        tableName={bugTable?.displayName || bugTable?.name}
      />
    </footer>
  );
};
