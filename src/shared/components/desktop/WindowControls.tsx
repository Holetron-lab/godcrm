/**
 * Window Controls for Desktop App
 * Custom titlebar controls (minimize, maximize, close) for frameless Electron window
 * Only rendered on Windows/Linux desktop app
 */

import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { isDesktopApp, getPlatform } from '@/shared/types/electron.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export const WindowControls = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [isMaximized, setIsMaximized] = useState(false);
  
  // Only show on Windows/Linux desktop app (macOS has native controls)
  const platform = getPlatform();
  const shouldShow = isDesktopApp() && platform !== 'darwin' && platform !== 'web';

  useEffect(() => {
    if (!shouldShow || !window.electronAPI) return;
    
    // Check initial maximized state
    window.electronAPI.windowIsMaximized().then(setIsMaximized);
    
    // Listen for window state changes (resize events)
    const handleResize = () => {
      window.electronAPI?.windowIsMaximized().then(setIsMaximized);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [shouldShow]);

  if (!shouldShow) return null;

  const handleMinimize = () => {
    window.electronAPI?.windowMinimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.windowMaximize();
    // Toggle state immediately for responsiveness
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.windowClose();
  };

  return (
    <div className="flex items-center -mr-4 select-none" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Separator */}
      <div className="w-px h-5 bg-[var(--border-primary)] mx-2" />
      
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className="w-11 h-9 flex items-center justify-center hover:bg-[var(--bg-tertiary)] transition-colors"
        title={t('Свернуть', 'Minimize')}
      >
        <Minus className="w-4 h-4 text-[var(--text-secondary)]" />
      </button>
      
      {/* Maximize/Restore */}
      <button
        onClick={handleMaximize}
        className="w-11 h-9 flex items-center justify-center hover:bg-[var(--bg-tertiary)] transition-colors"
        title={isMaximized ? t('Восстановить', 'Restore') : t('Развернуть', 'Maximize')}
      >
        {isMaximized ? (
          // Restore icon (two overlapping squares)
          <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        ) : (
          // Maximize icon (single square)
          <Square className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
        )}
      </button>
      
      {/* Close */}
      <button
        onClick={handleClose}
        className="w-11 h-9 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors group"
        title={t('Закрыть', 'Close')}
      >
        <X className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-white" />
      </button>
    </div>
  );
};
