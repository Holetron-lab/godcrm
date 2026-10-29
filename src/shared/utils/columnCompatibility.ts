/**
 * Column Compatibility Utilities
 * ADR-031: Missing Column Resolution Dialog
 * 
 * Provides utilities for checking type compatibility,
 * value validation, and text similarity calculations
 */
import { ColumnType } from '@/shared/types';

/**
 * Groups of synonymous words for semantic matching
 * Used to find similar columns by name meaning
 */
export const SYNONYM_GROUPS: string[][] = [
  ['id', 'identifier', 'key', 'code', 'код', 'идентификатор'],
  ['name', 'title', 'label', 'название', 'имя', 'наименование'],
  ['status', 'state', 'статус', 'состояние'],
  ['date', 'time', 'datetime', 'дата', 'время'],
  ['price', 'cost', 'amount', 'sum', 'цена', 'стоимость', 'сумма'],
  ['user', 'author', 'owner', 'creator', 'assignee', 'пользователь', 'автор', 'владелец'],
  ['description', 'desc', 'text', 'content', 'body', 'описание', 'текст', 'содержание'],
  ['category', 'type', 'kind', 'group', 'категория', 'тип', 'вид', 'группа'],
  ['priority', 'importance', 'urgency', 'приоритет', 'важность', 'срочность'],
  ['color', 'colour', 'цвет'],
  ['email', 'mail', 'почта', 'емейл'],
  ['phone', 'telephone', 'tel', 'mobile', 'телефон', 'мобильный'],
  ['address', 'location', 'адрес', 'местоположение'],
  ['count', 'quantity', 'qty', 'amount', 'количество', 'кол-во'],
  ['created', 'created_at', 'create_date', 'создано', 'дата_создания'],
  ['updated', 'updated_at', 'modified', 'modified_at', 'изменено', 'дата_изменения'],
  ['active', 'enabled', 'is_active', 'активный', 'включен'],
  ['deleted', 'removed', 'is_deleted', 'удален', 'удалено'],
  ['note', 'notes', 'comment', 'comments', 'remark', 'заметка', 'комментарий', 'примечание'],
  ['image', 'photo', 'picture', 'avatar', 'изображение', 'фото', 'картинка'],
  ['file', 'attachment', 'document', 'файл', 'вложение', 'документ']
];

/**
 * Type compatibility matrix
 * Defines which column types can be mapped to each other
 */
// Legacy types remain readable; missing entries allow identity mappings only.
type CompatibleColumnType = ColumnType | 'dialog' | 'chat';
const TYPE_COMPATIBILITY: Partial<Record<CompatibleColumnType, CompatibleColumnType[]>> = {
  text: ['text', 'number', 'email', 'url', 'phone', 'select', 'multi-select'],
  number: ['number', 'text'],
  email: ['email', 'text'],
  url: ['url', 'text'],
  phone: ['phone', 'text'],
  datetime: ['datetime', 'text'],
  time: ['time', 'text'],
  checkbox: ['checkbox', 'text', 'number'],
  select: ['select', 'text', 'multi-select'],
  'multi-select': ['multi-select', 'select', 'text'],
  relation: ['relation'], // Relation only maps to relation
  person: ['person', 'relation'],
  file: ['file', 'url', 'text'],
  password: ['password', 'text'],
  formula: ['formula'],
  table: ['table'],
  rollup: ['rollup'],
  button: ['button'],
  image: ['image', 'file', 'url', 'text'],
  audio: ['audio', 'file', 'url', 'text'],
  dialog: ['dialog', 'text'],
  vector: ['vector'],
  chat: ['chat', 'dialog', 'text'],
  color: ['color', 'text'],
  json: ['json', 'text'],
  // ADR-151
  order: ['order', 'number'],
  actor: ['actor']
};

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy name matching
 */
export function calculateLevenshtein(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return matrix[s1.length][s2.length];
}

/**
 * Check if source type can be mapped to target type
 */
export function isTypeCompatible(sourceType: ColumnType, targetType: ColumnType): boolean {
  if (sourceType === targetType) return true;
  
  const compatibleTypes = TYPE_COMPATIBILITY[targetType];
  return compatibleTypes?.includes(sourceType) ?? false;
}

/**
 * Check if a value is compatible with a column type
 */
export function isValueCompatible(value: unknown, columnType: ColumnType): boolean {
  // Null/undefined always compatible (will be empty)
  if (value === null || value === undefined) return true;
  
  const strValue = String(value).trim();
  
  switch (columnType) {
    case 'number':
      return !isNaN(Number(strValue)) && strValue !== '';
      
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue);
      
    case 'url':
      return /^https?:\/\/.+/.test(strValue);
      
    case 'phone':
      return /^[\d\s\-+()]{7,}$/.test(strValue);
      
    case 'checkbox':
      return (
        typeof value === 'boolean' ||
        strValue === 'true' ||
        strValue === 'false' ||
        strValue === '1' ||
        strValue === '0' ||
        strValue === 'yes' ||
        strValue === 'no'
      );
      
    case 'datetime': {
        const date = new Date(strValue);
        return !isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2200;
    }
      
    case 'time':
      return /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(strValue);
      
    case 'color':
      return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(strValue) || strValue.length <= 10;
      
    case 'text':
    case 'select':
    case 'multi-select':
    default:
      // Text accepts anything
      return true;
  }
}

/**
 * Find synonym group that contains the given word
 */
export function findSynonymGroup(word: string): string[] | undefined {
  const normalized = word.toLowerCase().replace(/[_-]/g, '');
  return SYNONYM_GROUPS.find(group => 
    group.some(s => normalized.includes(s) || s.includes(normalized))
  );
}

/**
 * Check if two words are synonyms
 */
export function areSynonyms(word1: string, word2: string): boolean {
  const n1 = word1.toLowerCase().replace(/[_-]/g, '');
  const n2 = word2.toLowerCase().replace(/[_-]/g, '');
  
  for (const group of SYNONYM_GROUPS) {
    const has1 = group.some(s => n1.includes(s) || s.includes(n1));
    const has2 = group.some(s => n2.includes(s) || s.includes(n2));
    if (has1 && has2) return true;
  }
  
  return false;
}

/**
 * Validation result for column mapping
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Validate that a value can be stored in a column type
 * Returns detailed validation result
 */
export function validateValueForColumn(
  value: unknown,
  columnType: ColumnType
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return { valid: true };
  }

  if (!isValueCompatible(value, columnType)) {
    return {
      valid: false,
      error: `Значение "${String(value).slice(0, 50)}..." несовместимо с типом ${columnType}`
    };
  }

  return { valid: true };
}

/**
 * Check if all sample values are compatible with column type
 */
export function validateSampleValues(
  sampleValues: unknown[],
  columnType: ColumnType
): ValidationResult {
  const nonEmpty = sampleValues.filter(v => v !== null && v !== undefined && v !== '');
  if (nonEmpty.length === 0) {
    return { valid: true };
  }

  const incompatible = nonEmpty.filter(v => !isValueCompatible(v, columnType));
  
  if (incompatible.length === 0) {
    return { valid: true };
  }

  if (incompatible.length === nonEmpty.length) {
    return {
      valid: false,
      error: `Все значения несовместимы с типом ${columnType}`
    };
  }

  return {
    valid: true,
    warning: `${incompatible.length} из ${nonEmpty.length} значений не соответствуют типу ${columnType}`
  };
}
