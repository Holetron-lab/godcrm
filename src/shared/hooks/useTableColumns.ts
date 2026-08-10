/**
 * Re-export useTableColumns hook from tables feature
 * 
 * This hook fetches columns for a specific table and is used by:
 * - Widgets for column mapping
 * - Column settings editor
 * - Project access configuration
 * 
 * @see ADR-069 TASK-013
 */
export { useTableColumns } from '@/features/tables/hooks/useTableColumns';
