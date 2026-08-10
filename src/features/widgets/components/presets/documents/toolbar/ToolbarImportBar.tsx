import { logger } from '@/shared/utils/logger';
import { X, Loader2, FileText } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import { flattenSectionTreeV4 } from '../../../../utils/parseMarkdownToAtoms';

export function ToolbarImportModeLeft() {
  const ctx = useDocumentsContext();

  const handleCancelCreate = () => {
    ctx.setIsCreatingMode(false);
    ctx.setImportFile(null);
    ctx.setImportTree([]);
    ctx.setNewDocName('');
    ctx.setNewDocCategory('');
    ctx.setNewDocDescription('');
    ctx.setImportValidation({ errors: [], warnings: [] });
  };

  return (
    <>
      <button
        onClick={handleCancelCreate}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-sm border border-[var(--border-primary)] hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500",
          ctx.isMobile && "px-2 py-1 text-xs"
        )}
      >
        <X className="w-4 h-4" /> {!ctx.isMobile && 'Отменить импорт'}
      </button>
      <div className="w-px h-6 bg-[var(--border-primary)]" />
      <span className="text-sm text-[var(--text-secondary)]">
        {ctx.importFile?.name || 'Новый документ'}
      </span>
    </>
  );
}

type ToolbarImportModeRightProps = {
  importError: string | null;
  setImportError: (err: string | null) => void;
};

export function ToolbarImportModeRight({ importError, setImportError }: ToolbarImportModeRightProps) {
  const ctx = useDocumentsContext();

  const handleImport = async () => {
    if (!ctx.newDocName.trim() || ctx.importTree.length === 0) return;
    setImportError(null); // Clear previous error
    try {
      // Use detected language (not 'auto' fallback to 'en')
      const importLang = ctx.importLanguage === 'auto' ? 'ru' : ctx.importLanguage;

      // First create the document
      const createResult = await ctx.createDocument({
        registryTableId: ctx.registryTableId,
        name: ctx.newDocName,
        description: ctx.newDocDescription || undefined,
        category: ctx.newDocCategory || undefined,
      });

      // API returns { success, data: { document_id, table_id, slug, name } }
      const documentId = createResult?.data?.document_id;
      const tableId = createResult?.data?.table_id;

      if (documentId && tableId) {
        // Import all sections with language field for backend to handle
        const flatSections = flattenSectionTreeV4(ctx.importTree).filter(s => s.selected);

        await ctx.importSections({
          documentId,
          sections: flatSections.map(s => ({
            level: s.level,
            title: s.title,
            content: s.content,
            language: importLang,  // Backend will create column if needed
            order: s.order,
          })),
        });

        // Reset import state and select the new document
        ctx.setIsCreatingMode(false);
        ctx.setImportFile(null);
        ctx.setImportTree([]);
        ctx.setNewDocName('');
        ctx.setNewDocCategory('');
        ctx.setNewDocDescription('');
        ctx.setImportLanguage('auto'); // Reset to auto for next import
        ctx.setSelectedDocumentId(documentId);

        // Refresh documents list
        ctx.refresh();
      } else {
        logger.error('Create document failed: missing document_id or table_id', createResult);
        setImportError('Ошибка создания документа');
      }
    } catch (err: unknown) {
      logger.error('Import failed:', err);
      // Parse error message
      let errorMessage = 'Ошибка импорта';
      try {
        const errStr = err instanceof Error ? err.message : String(err);
        const errData = JSON.parse(errStr);
        if (errData?.error?.code === 'DUPLICATE_SLUG') {
          errorMessage = `Документ с таким названием уже существует. Измените название.`;
        } else if (errData?.error?.message) {
          errorMessage = errData.error.message;
        }
      } catch { /* ignore JSON parse errors */ }
      setImportError(errorMessage);
    }
  };

  return (
    <>
      {/* Error message - hidden on mobile for space */}
      {importError && !ctx.isMobile && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
          <X className="w-4 h-4 flex-shrink-0" />
          <span>{importError}</span>
          <button
            onClick={() => setImportError(null)}
            className="ml-1 p-0.5 hover:bg-red-500/20 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <button
        onClick={handleImport}
        disabled={!ctx.newDocName.trim() || ctx.importTree.length === 0 || ctx.isCreating || ctx.isImporting}
        className={cn(
          "px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 hover:bg-[var(--color-primary-600)]",
          ctx.isMobile && "px-3 py-1.5 text-xs"
        )}
      >
        {ctx.isCreating || ctx.isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {!ctx.isMobile && 'Импорт'}
      </button>

      {/* Language selector for import */}
      <select
        value={ctx.importLanguage}
        onChange={(e) => ctx.setImportLanguage(e.target.value as 'en' | 'ru' | 'auto')}
        className={cn(
          "px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm",
          ctx.isMobile && "px-2 py-1 text-xs"
        )}
      >
        <option value="ru">🇷🇺 {ctx.isMobile ? 'RU' : 'Русский'}</option>
        <option value="en">🇬🇧 {ctx.isMobile ? 'EN' : 'English'}</option>
      </select>
    </>
  );
}
