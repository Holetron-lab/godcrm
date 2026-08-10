import React from 'react';
import {
  Square,
  Columns2,
  Columns3,
  Columns4,
  PlusCircle,
  Pencil,
  Link,
} from 'lucide-react';
import type { ColumnModel } from '../../types/table.types';
import type {
  FormConfig,
  FormField,
  FormDivider,
  FormTextBlock,
  FormPageBreak,
  FormFieldWidth,
  ModalSize,
} from '../../types/form-config.types';

// View modes for the form
export type ViewMode = 'with-keys' | 'standard' | 'compact';

// Interface for combined elements
export type FormItem = FormField | FormDivider | FormTextBlock | FormPageBreak;

// Form type values
export type FormTypeValue = 'add_row' | 'edit_row' | 'custom';

// Width options for fields
export const WIDTH_OPTIONS: { value: FormFieldWidth; label: string; icon: React.ReactNode }[] = [
  { value: 'full', label: '100%', icon: React.createElement(Square, { className: 'w-4 h-4' }) },
  { value: 'half', label: '50%', icon: React.createElement(Columns2, { className: 'w-4 h-4' }) },
  { value: 'third', label: '33%', icon: React.createElement(Columns3, { className: 'w-4 h-4' }) },
  { value: 'quarter', label: '25%', icon: React.createElement(Columns4, { className: 'w-4 h-4' }) },
];

// Modal size options
export const MODAL_SIZE_OPTIONS: { value: ModalSize; label: string; width: string }[] = [
  { value: 'sm', label: 'Маленькое (S)', width: 'max-w-md' },
  { value: 'md', label: 'Среднее (M)', width: 'max-w-xl' },
  { value: 'lg', label: 'Большое (L)', width: 'max-w-3xl' },
  { value: 'xl', label: 'Очень большое (XL)', width: 'max-w-5xl' },
  { value: '2xl', label: 'Огромное (2XL)', width: 'max-w-7xl' },
  { value: 'full', label: 'На весь экран', width: 'max-w-[95vw]' },
];

// Form type options with Lucide icons
export const FORM_TYPE_OPTIONS: { value: FormTypeValue; label: string; IconComponent: React.ComponentType<{ className?: string }> }[] = [
  { value: 'add_row', label: 'Форма добавления', IconComponent: PlusCircle },
  { value: 'edit_row', label: 'Форма редактирования', IconComponent: Pencil },
  { value: 'custom', label: 'Кастомная форма', IconComponent: Link },
];

// Check element type
export const isField = (item: FormItem): item is FormField =>
  !('type' in item) || item.type === 'field' || item.type === undefined;
export const isDivider = (item: FormItem): item is FormDivider =>
  'type' in item && item.type === 'divider';
export const isTextBlock = (item: FormItem): item is FormTextBlock =>
  'type' in item && item.type === 'text';
export const isPageBreak = (item: FormItem): item is FormPageBreak =>
  'type' in item && item.type === 'page-break';

export interface FormBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: FormConfig, formTypes: FormTypeValue[]) => void;
  columns: ColumnModel[];
  initialConfig?: FormConfig | null;
  initialFormType?: FormTypeValue;
  initialFormTypes?: FormTypeValue[];
  savedConfigs?: { id: number; name: string; formTypes: FormTypeValue[]; createdAt?: string }[];
  onLoadConfig?: (configId: number) => void;
  tableName?: string;
  tableId?: number;
  sampleData?: Record<string, unknown>;
}
