import { Button } from '@/shared/components/ui/Button';
import { logger } from '@/shared/utils/logger';
import { Play, Zap, Send, ExternalLink, Copy, Trash2, Edit, MoreHorizontal } from 'lucide-react';
import { useCallback, useState } from 'react';
import { showToast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/utils/cn';
import type { ButtonColumnConfig } from '../../types/table.types';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonCellProps {
  value?: unknown;
  rowId: string;
  rowData: Record<string, unknown>;
  columnId: string;
  config?: ButtonColumnConfig;
  onAutomationTrigger?: (automationId: string, rowId: string, rowData: Record<string, unknown>) => Promise<void>;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  play: Play,
  zap: Zap,
  send: Send,
  link: ExternalLink,
  copy: Copy,
  trash: Trash2,
  edit: Edit,
  more: MoreHorizontal,
};

// Map external variant names to internal ones
const variantMap: Record<string, ButtonVariant> = {
  'default': 'primary',
  'secondary': 'secondary',
  'outline': 'secondary',
  'ghost': 'ghost',
  'destructive': 'danger'
};

const sizeMap: Record<string, ButtonSize> = {
  'sm': 'sm',
  'default': 'md',
  'lg': 'lg'
};

export function ButtonCell({ 
  rowId, 
  rowData, 
  config,
  onAutomationTrigger 
}: ButtonCellProps) {
  const [isLoading, setIsLoading] = useState(false);
  
  const buttonConfig: ButtonColumnConfig = {
    label: 'Действие',
    icon: 'zap',
    variant: 'secondary',
    size: 'sm',
    ...config,
  };

  const IconComponent = buttonConfig.icon ? ICON_MAP[buttonConfig.icon] || Zap : Zap;
  
  // Map variant and size to internal types
  const mappedVariant = variantMap[buttonConfig.variant || 'secondary'] || 'secondary';
  const mappedSize = sizeMap[buttonConfig.size || 'sm'] || 'sm';

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!buttonConfig.action) {
      showToast('Действие не настроено', 'info');
      return;
    }

    setIsLoading(true);
    
    try {
      switch (buttonConfig.action.type) {
        case 'automation':
          if (buttonConfig.action.automationId && onAutomationTrigger) {
            await onAutomationTrigger(buttonConfig.action.automationId, rowId, rowData);
            showToast('Автоматизация запущена', 'success');
          } else {
            showToast('Автоматизация не настроена', 'error');
          }
          break;
          
        case 'url':
          if (buttonConfig.action.url) {
            let url = buttonConfig.action.url;
            for (const [key, value] of Object.entries(rowData)) {
              url = url.replace(`{${key}}`, String(value || ''));
            }
            window.open(url, '_blank');
          }
          break;
          
        case 'copy':
          if (buttonConfig.action.copyField) {
            const valueToCopy = rowData[buttonConfig.action.copyField];
            if (valueToCopy) {
              await navigator.clipboard.writeText(String(valueToCopy));
              showToast('Скопировано в буфер обмена', 'success');
            }
          }
          break;
          
        case 'custom':
          showToast('Кастомное действие', 'info');
          break;
          
        default:
          showToast('Действие выполнено', 'success');
      }
    } catch (error) {
      logger.error('Button action error:', error);
      showToast('Ошибка выполнения действия', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [buttonConfig.action, rowId, rowData, onAutomationTrigger]);

  return (
    <div className="flex items-center justify-center h-full py-1">
      <Button
        variant={mappedVariant}
        size={mappedSize}
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          'h-7 px-2.5 text-xs font-medium',
          isLoading && 'opacity-70'
        )}
      >
        <IconComponent className="w-3.5 h-3.5 mr-1.5" />
        {buttonConfig.label}
      </Button>
    </div>
  );
}

export default ButtonCell;
