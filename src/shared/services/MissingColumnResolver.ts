/**
 * MissingColumnResolver Service
 * ADR-031: Missing Column Resolution Dialog
 * 
 * Central service for resolving missing column errors
 * with intelligent matching and caching
 */
import { ColumnType } from '@/shared/types';
import {
  calculateLevenshtein,
  isTypeCompatible,
  areSynonyms,
  ValidationResult,
  validateSampleValues
} from '@/shared/utils/columnCompatibility';

/**
 * Minimal column model interface
 */
export interface ColumnModel {
  id: string;
  name: string;
  type: ColumnType;
  config?: Record<string, unknown>;
}

/**
 * Context about where the missing column error occurred
 */
export interface MissingColumnContext {
  /** Source of the error */
  source: 'import' | 'widget' | 'relation' | 'formula' | 'api';
  
  /** Table information */
  tableId: number | string;
  tableName: string;
  
  /** Missing column info */
  missingColumnKey: string;
  expectedType?: ColumnType;
  sampleValues?: unknown[];
  
  /** Usage context for advanced resolution */
  usageContext?: {
    widgetId?: string;
    relationConfig?: Record<string, unknown>;
    formulaExpression?: string;
  };
}

/**
 * Result of column resolution
 */
export interface ResolutionResult {
  /** Action taken */
  action: 'create' | 'map' | 'skip' | 'cancel';
  
  /** For 'create' action */
  newColumn?: {
    name: string;
    type: ColumnType;
    config?: Record<string, unknown>;
  };
  
  /** For 'map' action */
  mappedColumnId?: string;
  mappedColumnName?: string;
  
  /** Apply this resolution to all similar errors */
  applyToAll?: boolean;
  
  /** Mapping rules for batch operations */
  mappingRules?: Record<string, string>;
}

/**
 * Column with similarity info
 */
export interface SimilarColumn {
  column: ColumnModel;
  score: number;
  reasons: string[];
}

/**
 * Source labels for UI
 */
export const SOURCE_LABELS: Record<MissingColumnContext['source'], string> = {
  import: 'Импорт данных',
  widget: 'Виджет',
  relation: 'Связь между таблицами',
  formula: 'Формула',
  api: 'API запрос'
};

/**
 * MissingColumnResolver class
 * 
 * Handles resolution of missing column errors with:
 * - Smart column matching (Levenshtein + synonyms + type)
 * - Auto-detection of column types from sample data
 * - Caching for "apply to all" scenarios
 */
export class MissingColumnResolver {
  /** Cache for "apply to all" resolutions */
  private resolutionCache: Map<string, ResolutionResult> = new Map();

  /**
   * Generate cache key from context
   */
  private getCacheKey(context: MissingColumnContext): string {
    return `${context.tableId}:${context.missingColumnKey}`;
  }

  /**
   * Cache a resolution result
   */
  cacheResolution(context: MissingColumnContext, result: ResolutionResult): void {
    if (result.applyToAll) {
      this.resolutionCache.set(this.getCacheKey(context), result);
    }
  }

  /**
   * Get cached resolution if exists
   */
  getCachedResolution(context: MissingColumnContext): ResolutionResult | undefined {
    return this.resolutionCache.get(this.getCacheKey(context));
  }

  /**
   * Clear resolution cache
   */
  clearCache(): void {
    this.resolutionCache.clear();
  }

  /**
   * Find similar columns in a table
   * 
   * @param tableColumns - Available columns in the table
   * @param missingKey - Name of the missing column
   * @param expectedType - Expected column type (optional)
   * @returns Array of similar columns sorted by score
   */
  findSimilarColumns(
    tableColumns: ColumnModel[],
    missingKey: string,
    expectedType?: ColumnType
  ): SimilarColumn[] {
    const results: SimilarColumn[] = [];

    for (const column of tableColumns) {
      const similarity = this.calculateSimilarity(column, missingKey, expectedType);
      if (similarity.score > 0.3) {
        results.push({
          column,
          ...similarity
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate similarity between a column and missing key
   * 
   * Factors:
   * - Name similarity (Levenshtein distance)
   * - Type match
   * - Partial match (contains)
   * - Semantic match (synonyms)
   */
  calculateSimilarity(
    column: ColumnModel,
    missingKey: string,
    expectedType?: ColumnType
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const colName = column.name.toLowerCase();
    const keyName = missingKey.toLowerCase();

    // 1. Name similarity (Levenshtein distance)
    const distance = calculateLevenshtein(colName, keyName);
    const maxLen = Math.max(colName.length, keyName.length);
    const nameSimilarity = maxLen > 0 ? 1 - distance / maxLen : 0;
    
    if (nameSimilarity > 0.6) {
      score += nameSimilarity * 0.5;
      reasons.push('похожее название');
    }

    // 2. Type match bonus
    if (expectedType && column.type === expectedType) {
      score += 0.3;
      reasons.push('совпадает тип');
    } else if (expectedType && isTypeCompatible(column.type, expectedType)) {
      score += 0.15;
      reasons.push('совместимый тип');
    }

    // 3. Partial match (one contains the other)
    if (colName.includes(keyName) || keyName.includes(colName)) {
      score += 0.2;
      reasons.push('частичное совпадение');
    }

    // 4. Semantic match (synonyms)
    if (areSynonyms(colName, keyName)) {
      score += 0.15;
      reasons.push('семантическое совпадение');
    }

    return { score: Math.min(score, 1), reasons };
  }

  /**
   * Auto-detect column type from sample values
   * 
   * @param sampleValues - Array of sample values
   * @returns Detected column type
   */
  detectColumnType(sampleValues: unknown[]): ColumnType {
    if (sampleValues.length === 0) return 'text';

    const nonNull = sampleValues.filter(v => v !== null && v !== undefined);
    if (nonNull.length === 0) return 'text';

    // All booleans?
    if (nonNull.every(v => {
      if (typeof v === 'boolean') return true;
      const str = String(v).toLowerCase();
      return str === 'true' || str === 'false' || str === 'yes' || str === 'no' || str === '1' || str === '0';
    })) {
      return 'checkbox';
    }

    // All numbers? (check after checkbox to avoid 0/1 being detected as number)
    if (nonNull.every(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== ''))) {
      return 'number';
    }

    // All valid dates?
    if (nonNull.every(v => {
      const date = new Date(String(v));
      return !isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2200;
    })) {
      return 'datetime';
    }

    // All emails?
    if (nonNull.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)))) {
      return 'email';
    }

    // All URLs?
    if (nonNull.every(v => /^https?:\/\/.+/.test(String(v)))) {
      return 'url';
    }

    // All phones?
    if (nonNull.every(v => /^[\d\s\-+()]{7,}$/.test(String(v)))) {
      return 'phone';
    }

    // Default to text
    return 'text';
  }

  /**
   * Validate mapping between source data and target column
   * 
   * @param sampleValues - Values to be mapped
   * @param targetColumn - Target column to map to
   * @returns Validation result
   */
  validateMapping(
    sampleValues: unknown[],
    targetColumn: ColumnModel
  ): ValidationResult {
    return validateSampleValues(sampleValues, targetColumn.type);
  }

  /**
   * Get suggested action based on context
   * 
   * @param context - Missing column context
   * @param tableColumns - Available columns
   * @returns Suggested action and reason
   */
  getSuggestedAction(
    context: MissingColumnContext,
    tableColumns: ColumnModel[]
  ): { action: 'create' | 'map'; reason: string; suggestedColumn?: ColumnModel } {
    const similar = this.findSimilarColumns(
      tableColumns,
      context.missingColumnKey,
      context.expectedType
    );

    // If high-confidence match exists, suggest mapping
    if (similar.length > 0 && similar[0].score > 0.7) {
      return {
        action: 'map',
        reason: `Найдено похожее поле "${similar[0].column.name}"`,
        suggestedColumn: similar[0].column
      };
    }

    // Otherwise suggest creating new column
    return {
      action: 'create',
      reason: 'Подходящее поле не найдено'
    };
  }
}

/**
 * Singleton instance
 */
export const missingColumnResolver = new MissingColumnResolver();
