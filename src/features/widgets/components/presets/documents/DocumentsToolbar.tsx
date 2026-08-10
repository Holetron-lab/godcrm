/**
 * Documents Toolbar
 *
 * Thin container composing toolbar sub-modules from ./toolbar/.
 * See T-127863 for the split rationale.
 */

import { useState } from 'react';
import { X, Menu, PanelLeft } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDocumentsContext } from './DocumentsContext';
import { ToolbarImportModeLeft, ToolbarImportModeRight } from './toolbar/ToolbarImportBar';
import { ToolbarCreateMenu } from './toolbar/ToolbarCreateMenu';
import { ToolbarSearch } from './toolbar/ToolbarSearch';
import { ToolbarAtomsModeActions } from './toolbar/ToolbarAtomsModeActions';
import { ToolbarViewActions } from './toolbar/ToolbarViewActions';
import { ToolbarLanguageSelector } from './toolbar/ToolbarLanguageSelector';
import { ToolbarExportActions } from './toolbar/ToolbarExportActions';
import { ToolbarMobileOverflow } from './toolbar/ToolbarMobileOverflow';

export function DocumentsToolbar() {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();
  const [importError, setImportError] = useState<string | null>(null);

  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2 h-[50px] border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] shrink-0",
      ctx.isMobile && "px-2 gap-1"
    )}>
      <div className="flex items-center gap-2">
        {/* Mobile hamburger menu button to toggle sidebar */}
        {ctx.isMobile && !ctx.isCreatingMode && (
          <button
            onClick={() => ctx.setMobileSidebarOpen(!ctx.mobileSidebarOpen)}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] min-h-[44px] min-w-[44px] flex items-center justify-center md:hidden"
            title={t('documents.menu')}
          >
            {ctx.mobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}

        {/* Sidebar toggle for tablet/desktop when collapsed */}
        {!ctx.isMobile && ctx.sidebarCollapsed && (
          <button
            onClick={() => ctx.setSidebarCollapsed(false)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] hidden md:flex"
            title={t('documents.showPanel')}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {ctx.isCreatingMode ? <ToolbarImportModeLeft /> : <ToolbarCreateMenu />}
      </div>

      <ToolbarSearch />

      <div className={cn("flex items-center gap-2", ctx.isMobile && "gap-1")}>
        {/* Atoms view mode buttons */}
        {ctx.atomsViewMode && <ToolbarAtomsModeActions />}

        {ctx.isCreatingMode ? (
          <ToolbarImportModeRight importError={importError} setImportError={setImportError} />
        ) : (
          <>
            {/* === Desktop-only: view mode / structure / atoms / preview / scale === */}
            {!ctx.isMobile && <ToolbarViewActions />}

            {/* === Always visible: Language selector === */}
            <ToolbarLanguageSelector />

            {/* === Desktop-only: refresh / export / print / copy / delete / view scale === */}
            {!ctx.isMobile && <ToolbarExportActions />}

            {/* === Mobile overflow menu === */}
            {ctx.isMobile && <ToolbarMobileOverflow />}
          </>
        )}
      </div>
    </div>
  );
}
