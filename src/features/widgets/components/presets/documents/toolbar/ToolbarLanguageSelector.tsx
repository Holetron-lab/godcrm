import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';

export function ToolbarLanguageSelector() {
  const ctx = useDocumentsContext();

  return (
    <select
      value={ctx.currentLanguage}
      onChange={(e) => ctx.setCurrentLanguage(e.target.value)}
      className={cn(
        "px-2 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs",
        ctx.isMobile && "min-h-[44px]"
      )}
    >
      {ctx.availableLanguages.map(lang => (
        <option key={lang.code} value={lang.code}>{ctx.isMobile ? lang.code.toUpperCase() : lang.name}</option>
      ))}
    </select>
  );
}
