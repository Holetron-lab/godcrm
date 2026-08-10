/**
 * Load Mode Indicator for Desktop App (ADR-029)
 * Shows current loading mode in status bar: 🌐 Remote | 💾 Local | ⚡ Auto
 */
import { Globe, HardDrive, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isDesktopApp } from '@/shared/types/electron.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export const LoadModeIndicator = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [mode, setMode] = useState<'remote' | 'local' | 'auto'>('auto');
  const [isRemoteActive, setIsRemoteActive] = useState(false);
  
  useEffect(() => {
    if (!isDesktopApp() || !window.electronAPI?.getLoadMode) return;
    
    window.electronAPI.getLoadMode().then(setMode);
    
    // Check if app is loaded from server (https:) or local (file:)
    setIsRemoteActive(window.location.protocol === 'https:');
  }, []);
  
  if (!isDesktopApp()) return null;
  
  const config = {
    remote: { icon: Globe, label: 'Remote', color: 'text-green-500' },
    local: { icon: HardDrive, label: 'Local', color: 'text-amber-500' },
    auto: { 
      icon: Zap, 
      label: isRemoteActive ? 'Auto (Remote)' : 'Auto (Local)', 
      color: 'text-blue-500' 
    },
  };
  
  const { icon: Icon, label, color } = config[mode];
  
  return (
    <div 
      className={`flex items-center gap-1.5 text-xs ${color}`} 
      title={`${t('Режим загрузки', 'Load mode')}: ${label}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
};
