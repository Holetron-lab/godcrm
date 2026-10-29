import { expect, it } from 'vitest';
import { PackageCheck, Table2 } from 'lucide-react';
import { getWidgetIcon } from '../components/widgetIcon';

it('distinguishes procurement from a regular table preset, including serialized API config', () => {
  const config = { procurement: { supplier_table_id: 6 } };
  expect(getWidgetIcon('table_view', config)).toBe(PackageCheck);
  expect(getWidgetIcon('table_view', JSON.stringify(config))).toBe(PackageCheck);
  for (const value of [undefined, null, {}, '{invalid', 'null', '42', { procurement: null }]) {
    expect(getWidgetIcon('table_view', value)).toBe(Table2);
  }
});
