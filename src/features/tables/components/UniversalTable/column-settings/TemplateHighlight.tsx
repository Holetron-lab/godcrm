import React from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * Component to highlight template variables in text
 * Shows valid columns in green, invalid in red
 */
interface TemplateHighlightProps {
  text: string;
  availableColumns: Set<string>;
}

// System variables that are always valid
const SYSTEM_VARIABLES = new Set(['row_id', 'value']);

export const TemplateHighlight: React.FC<TemplateHighlightProps> = ({ text, availableColumns }) => {
  const { t } = useLanguage();
  if (!text) return null;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = /\{\{(\w+)\}\}/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    
    const varName = match[1];
    // Check if variable is valid (column name or system variable)
    const isValid = availableColumns.has(varName) || SYSTEM_VARIABLES.has(varName);
    const isSystemVar = SYSTEM_VARIABLES.has(varName);
    
    parts.push(
      <code
        key={`var-${match.index}`}
        className={`px-1 rounded text-xs font-mono ${
          isValid 
            ? isSystemVar
              ? 'bg-primary-100 dark:bg-primary-300 text-primary-700 dark:text-primary-300' // System vars in blue
              : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' // Column vars in green
            : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' // Invalid in red
        }`}
        title={t(isSystemVar ? 'columnSettings.template.systemVariable' : isValid ? 'columnSettings.template.column' : 'columnSettings.template.missing')}
      >
        {match[0]}
      </code>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  
  if (parts.length === 0) return null;
  
  return (
    <div className="mt-1.5 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-0.5">
      {parts}
    </div>
  );
};
