/**
 * Form Configuration Types
 * For visual form builder and dynamic form rendering
 */

export type FormFieldWidth = 'full' | 'half' | 'third' | 'quarter' | 'auto';

export type FormLayoutType = 'grid' | 'columns' | 'tabs' | 'sections';

export type ConditionOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface FieldCondition {
  field: string;         // Column ID to check
  operator: ConditionOperator;
  value?: unknown;       // Value to compare (not needed for is_empty/is_not_empty)
}

export interface FieldValidation {
  min?: number;          // Min value (for number) or min length (for text)
  max?: number;          // Max value or max length
  pattern?: string;      // Regex pattern
  message?: string;      // Custom error message
}

export type FormElementType = 'field' | 'divider' | 'text' | 'page-break';

export interface FormDivider {
  id: string;
  type: 'divider';
  order: number;
  page?: number;         // Page number (1-based)
}

export type TextBlockContentType = 'markdown' | 'html';

export interface FormTextBlock {
  id: string;
  type: 'text';
  content: string;            // Markdown/HTML content
  contentType?: TextBlockContentType; // Content type (default: markdown)
  order: number;
  page?: number;
  width?: FormFieldWidth;     // Text block width (default: full)
}

export interface FormPageBreak {
  id: string;
  type: 'page-break';
  order: number;
  buttonText?: string;        // Custom button text (default: "Далее")
  showBackButton?: boolean;   // Show "Back" button (default: true)
  saveIntermediate?: boolean; // Save data after this page before continuing
}

export interface FormField {
  id: string;            // Unique field ID
  type?: 'field';        // Element type (default: field)
  columnId: string;      // Reference to column
  label?: string;        // Override column displayName
  placeholder?: string;  // Input placeholder (example text when empty)
  helpText?: string;     // Description/hint for users
  description?: string;  // Markdown description shown under field
  width: FormFieldWidth; // Field width in grid
  row?: number;          // Grid row position (for precise placement)
  col?: number;          // Grid column position
  order: number;         // Order within section/form
  page?: number;         // Page number (1-based, for multi-page forms)
  hidden?: boolean;      // Hide field
  readonly?: boolean;    // Make read-only
  required?: boolean;    // Make required
  defaultValue?: unknown;// Default value for new rows (supports {{column_name}} variables)
  validation?: FieldValidation;
  conditions?: FieldCondition[];  // Show/hide based on other fields
  // Text field specific
  expandable?: boolean;  // Auto-expand textarea
  rows?: number;         // Default height in rows (for textarea)
}

export type FormElement = FormField | FormDivider | FormTextBlock | FormPageBreak;

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  icon?: string;         // Emoji or icon name
  collapsed?: boolean;   // Start collapsed
  collapsible?: boolean; // Allow collapse
  fields: string[];      // Field IDs in this section
  order: number;
}

export interface FormTab {
  id: string;
  title: string;
  icon?: string;
  sections: string[];    // Section IDs in this tab
  order: number;
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';

export interface FormConfig {
  version: number;       // Schema version for migrations
  layout: FormLayoutType;
  columns?: number;      // Number of columns in grid (1-4)
  pages?: number;        // Number of pages (1-10, default: 1)
  fields: FormField[];
  elements?: FormElement[]; // Additional elements (dividers, text blocks, page breaks)
  sections?: FormSection[];
  tabs?: FormTab[];
  settings?: {
    showLabels?: boolean;
    showKeys?: boolean;   // Show column keys in form (deprecated, use viewMode)
    viewMode?: 'with-keys' | 'standard' | 'compact'; // Display mode
    labelPosition?: 'top' | 'left' | 'floating';
    spacing?: 'compact' | 'normal' | 'relaxed';
    modalSize?: ModalSize; // Modal dialog size (sm, md, lg, xl, 2xl, full)
    submitButtonText?: string;
    cancelButtonText?: string;
  };
}

export interface FormConfigResponse {
  id: number;
  tableId: number;
  formType: 'edit' | 'add';
  name?: string;
  config: FormConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// Default empty form config
export const DEFAULT_FORM_CONFIG: FormConfig = {
  version: 1,
  layout: 'grid',
  columns: 2,
  fields: [],
  sections: [],
  settings: {
    showLabels: true,
    labelPosition: 'top',
    spacing: 'normal',
  }
};

// Generate default form config from columns
export function generateDefaultFormConfig(
  columns: { id: string; name: string; displayName?: string; type: string }[]
): FormConfig {
  const fields: FormField[] = columns
    .filter(col => !['id', 'created_at', 'updated_at'].includes(col.name.toLowerCase()))
    .map((col, index) => ({
      id: `field_${col.id}`,
      columnId: col.id,
      label: col.displayName || col.name,
      width: col.type === 'textarea' ? 'full' : 'half',
      order: index,
    }));

  return {
    version: 1,
    layout: 'grid',
    columns: 2,
    fields,
    settings: {
      showLabels: true,
      labelPosition: 'top',
      spacing: 'normal',
    }
  };
}
