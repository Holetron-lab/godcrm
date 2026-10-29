import { describe, expect, it } from 'vitest';
import { formatCellValue, getOptionInfo } from '../printHtmlGenerator';
const column: Parameters<typeof formatCellValue>[0] = {
  id: '1', tableId: '2', name: 'value', displayName: 'Value', type: 'text', config: {},
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
};
describe('printing persisted column types', () => {
  it.each(['number', 'integer', 'float', 'decimal'])('formats numeric type %s', type => {
    expect(formatCellValue({ ...column, type }, 1234.5, false, undefined)).toBe((1234.5).toLocaleString('ru-RU'));
  });
  it('reads legacy options and escapes labels in formatted output', () => {
    const legacy = { ...column, type: 'multi_select', settings: { options: [{ value: 'one', label: '<img src=x>' }] } };
    expect(getOptionInfo('one', legacy, undefined).label).toBe('<img src=x>');
    expect(formatCellValue(legacy, ['one'], true, undefined)).toContain('&lt;img src=x&gt;');
    expect(formatCellValue(legacy, ['one'], true, undefined)).not.toContain('<img');
  });
});
