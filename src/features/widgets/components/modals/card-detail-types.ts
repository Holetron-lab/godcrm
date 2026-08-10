import type { ColumnModel } from '@/features/tables/types/table.types';

// Type for card data
export interface CardData {
  id: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

// Relation data map: tableId -> Map<value, { label, color }>
// Keys can be string or number depending on source — lookups handle both
export type RelationDataMap = Map<string | number, Map<string, { label: string; color?: string }>>;

export interface CardDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: CardData | null;
  columns: ColumnModel[];
  visibleFields?: string[];
  onSave?: (cardId: string, data: Record<string, unknown>) => void;
  titleField?: string;
  groupByField?: string;
  initialTab?: 'details' | 'files' | 'comments'; // Kept for API compatibility
  tableId?: number | string;
  relationData?: RelationDataMap;
  descriptionField?: string; // Kept for backward compat; layout is now universal by column type
  onOpenChat?: (rowId: string) => void;
  onAttachToChat?: (rowId: string) => void;
  onAttachToMessage?: (rowId: string) => void;
}

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  uploadedAt: Date;
}
