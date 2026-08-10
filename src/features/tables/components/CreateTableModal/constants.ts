import type { ColumnDefinitionInput } from '../../types/table.types';

export const defaultColumns: ColumnDefinitionInput[] = [
  {
    name: 'created_at',
    displayName: 'Created',
    type: 'date',
    isReadonly: true,
    config: {
      appearance: {
        align: 'left',
        indicator: { type: 'emoji', value: '🕒' }
      }
    },
    width: 160
  },
  {
    name: 'title',
    displayName: 'Title',
    type: 'text',
    isRequired: true,
    config: {
      appearance: {
        align: 'left',
        indicator: { type: 'emoji', value: '🧱' }
      }
    },
    width: 220
  },
  {
    name: 'status',
    displayName: 'Status',
    type: 'select',
    config: {
      options: [
        { label: 'Draft', value: 'draft', color: '#a855f7' },
        { label: 'Active', value: 'active', color: '#22c55e' },
        { label: 'Done', value: 'done', color: '#0ea5e9' }
      ],
      appearance: {
        align: 'center',
        indicator: { type: 'badge', color: '#0ea5e9' }
      }
    },
    width: 160
  }
];

export const cloneDefaultColumns = (): ColumnDefinitionInput[] =>
  defaultColumns.map((column) => JSON.parse(JSON.stringify(column)) as ColumnDefinitionInput);

export const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `tbl_${Date.now()}`;

// Color palette for ColorPicker
export const COLUMN_COLORS: (string | null)[] = [
  null, '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b'
];

// Column emoji options
export const COLUMN_EMOJIS = [
  '📊', '📈', '📉', '📋', '📁', '📂', '📄', '📝', '📌', '📎', '🔖', '🏷️', '📦', '🗂️', '🗃️', '💼',
  '🎯', '🔑', '🔒', '🔓', '✅', '❌', '⭐', '🌟', '💡', '⚡', '🔥', '💎', '🏆', '🎉', '✨', '💫',
  '🚀', '💪', '👍', '👎', '👀', '💬', '📢', '👤', '👥', '🧑‍💼', '👨‍💻', '👩‍💻', '🤝',
  '💰', '💵', '💳', '🏦', '📅', '🗓️', '⏰', '⏱️', '🕐', '📆', '🔔', '🔕', '⌛', '⏳',
  '🏠', '🏢', '🏭', '🚗', '✈️', '🚢', '📱', '💻', '🖥️', '🖨️',
  '🌍', '🌎', '🌏', '☀️', '🌙', '🌈', '🌊', '🌲', '🌸',
  '🍎', '🍕', '🍔', '☕', '🍷', '🎂', '🍫', '🥗', '🥤', '🍿',
  '➡️', '⬅️', '⬆️', '⬇️', '🔄', '♻️', '🔗', '📧', '🌐', '💠'
];
