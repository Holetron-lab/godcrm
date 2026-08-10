import { useState, useEffect } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { formatDistanceToNow } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { TableModel } from '../types/table.types';

interface SyncStatusBarProps {
  table: TableModel;
  isSyncing?: boolean;
  progress?: number;
}

export function SyncStatusBar({ table, isSyncing = false, progress = 0 }: SyncStatusBarProps) {
  const { t, language } = useLanguage();
  
  // Safety check
  if (!table || !table.id) {
    return null;
  }
  
  // Don't show for 'own' tables
  if (!table.table_type || table.table_type === 'own') {
    return null;
  }

  const formatLastSync = (dateStr: string | null | undefined) => {
    if (!dateStr) return t('dataSources.card.never');
    
    try {
      const locale = language === 'ru' ? ru : enUS;
      return formatDistanceToNow(new Date(dateStr), {
        addSuffix: true,
        locale
      });
    } catch {
      return t('dataSources.card.never');
    }
  };

  const calculateNextSync = () => {
    if (!table.last_sync_at || !table.sync_interval_minutes) {
      return null;
    }
    
    try {
      const lastSync = new Date(table.last_sync_at);
      const nextSync = new Date(lastSync.getTime() + table.sync_interval_minutes * 60 * 1000);
      const locale = language === 'ru' ? ru : enUS;
      
      return formatDistanceToNow(nextSync, {
        addSuffix: true,
        locale
      });
    } catch {
      return null;
    }
  };

  const nextSync = calculateNextSync();

  return (
    <div className={`px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 ${isSyncing ? 'animate-pulse' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-xl ${isSyncing ? 'animate-spin' : ''}`}>
            🔄
          </span>
          
          <div className="text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              {t('dataSources.card.lastSync')}: 
            </span>
            <strong className="ml-1 text-gray-900 dark:text-gray-100">
              {formatLastSync(table.last_sync_at)}
            </strong>
            
            {nextSync && table.sync_enabled && (
              <span className="ml-3 text-gray-500 dark:text-gray-500">
                • Next: {nextSync}
              </span>
            )}
          </div>
        </div>
        
        {isSyncing && progress > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-48 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary-500 dark:bg-primary-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {progress}%
            </span>
          </div>
        )}
        
        {!table.sync_enabled && (
          <div className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 text-xs rounded-md">
            ⚠️ Sync disabled
          </div>
        )}
      </div>
    </div>
  );
}
