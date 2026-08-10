/**
 * VisibilityCheckbox - 4-state visibility checkbox component
 * Cycles through: visible -> hidden -> partial -> inherit
 */

import { Eye, EyeOff, Minus } from 'lucide-react';
import type { TableVisibilityState } from '../../types/schema-editor.types';

export const VisibilityCheckbox = ({
  state,
  onChange,
  t,
}: {
  state: TableVisibilityState;
  onChange: (newState: TableVisibilityState) => void;
  t: (key: string) => string;
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextState: Record<TableVisibilityState, TableVisibilityState> = {
      'visible': 'hidden',
      'hidden': 'partial',
      'partial': 'inherit',
      'inherit': 'visible',
    };
    onChange(nextState[state]);
  };

  const getIcon = () => {
    switch (state) {
      case 'visible':
        return <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-green-400" />;
      case 'hidden':
        return <EyeOff className="w-3.5 h-3.5 text-rose-600 dark:text-red-400" />;
      case 'partial':
        return <Minus className="w-3.5 h-3.5 text-amber-600 dark:text-yellow-400" />;
      case 'inherit':
      default:
        return <Eye className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 opacity-50" />;
    }
  };

  const getTitle = () => {
    switch (state) {
      case 'visible': return t('schemaEditor.visibility.visibleClick');
      case 'hidden': return t('schemaEditor.visibility.hiddenClick');
      case 'partial': return t('schemaEditor.visibility.partialClick');
      case 'inherit': return t('schemaEditor.visibility.inheritClick');
    }
  };

  return (
    <button
      onClick={handleClick}
      title={getTitle()}
      className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors flex-shrink-0"
    >
      {getIcon()}
    </button>
  );
};
