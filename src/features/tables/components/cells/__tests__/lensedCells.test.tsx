/**
 * ADR-205 D4 — cells consume the server lens map instead of downloading the related table.
 * AC6: no `/rows?limit=5000` request when the server map covers the column.
 * AC4/AC7: image column with relation + config.file.prefix renders prefix + suffix, per key.
 */
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { renderCellValue } from '../../UniversalTable/renderCellValue';
import { SelectCell } from '../SelectCell';
import { TextCell } from '../TextCell';
import { MultiSelectCell } from '../MultiSelectCell';
import { resolveLens, type RelationsMap } from '../../../utils/resolveLens';
import type { ColumnModel, ColumnRelationConfig } from '../../../types/table.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn(), getAccessToken: () => null } }));

const relation: ColumnRelationConfig = { enabled: true, tableId: '7820', valueColumn: 'sku', labelColumn: 'image' };
const relations: RelationsMap = {
  product: {
    'sku-1': { value: 'products/a.jpg', label: 'Chair A', color: '#112233' },
    'sku-2': { value: 'products/b.jpg', label: 'Chair B' },
  },
};

let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) {
  return (
    <LanguageProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </LanguageProvider>
  );
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiClient.request).mockReset().mockResolvedValue({ data: { rows: [{ id: '1', data: { sku: 'sku-1', image: 'fetched/a.jpg' } }] } });
});
afterEach(() => { cleanup(); client.clear(); });

const column = (type: string, config: ColumnModel['config'] = {}): ColumnModel => ({
  id: '42', tableId: '1', name: 'product', displayName: 'Product', type: type as ColumnModel['type'],
  config: { relation, ...config }, isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
});
const rows = [{ id: 'r1', data: { product: 'sku-1' } }];
// `map` is explicit on purpose: a default parameter would swallow an intentional `undefined`.
const cell = (col: ColumnModel, value: unknown, map: RelationsMap | undefined) =>
  render(<Wrapper>{renderCellValue({ column: col, value, rowId: 'r1', rowData: { product: value }, rowMutation: { mutate: vi.fn() }, rows, tableId: 1, relations: map })}</Wrapper>);

describe('cells fed by the server lens map (AC6)', () => {
  it('SelectCell / TextCell / MultiSelectCell render the related label without any request', async () => {
    const lensed = resolveLens('sku-1', relation, relations.product);
    render(<Wrapper>
      <SelectCell value="sku-1" relation={relation} lensed={lensed} />
      <TextCell value="sku-1" relation={relation} lensed={lensed} />
      <MultiSelectCell value="sku-1, sku-2" relation={{ ...relation, storageFormat: 'comma' }} lensed={resolveLens('sku-1, sku-2', { ...relation, storageFormat: 'comma' }, relations.product)} />
    </Wrapper>);
    expect(screen.getAllByText('Chair A')).toHaveLength(3);
    expect(screen.getByText('Chair B')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it('falls back to the shared client lookup when no server map covers the column', async () => {
    cell(column('select'), 'sku-1', undefined);
    await waitFor(() => expect(screen.getByText('fetched/a.jpg')).toBeInTheDocument());
    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(apiClient.request).toHaveBeenCalledWith('/tables/7820/rows?limit=5000');
  });

  it('keeps the raw key visible when the server map has no entry for it (D1.5)', () => {
    cell(column('select'), 'ghost', relations);
    expect(screen.getByText('ghost')).toBeInTheDocument();
    expect(apiClient.request).not.toHaveBeenCalled();
  });
});

describe('image lens: related-row suffix + column prefix (AC4 / AC7)', () => {
  const imageColumn = (storageFormat?: ColumnRelationConfig['storageFormat']) =>
    column('image', { relation: { ...relation, storageFormat, multiple: Boolean(storageFormat) }, file: { prefix: 'https://cdn.example.com/' }, image: { displayMode: 'grid' } });

  it('renders prefix + suffix for a single key, without upload controls and without a request', () => {
    cell(imageColumn(), 'sku-1', relations);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/products/a.jpg');
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it.each([
    ['comma', 'sku-1, sku-2'],
    ['json', '["sku-1","sku-2"]'],
  ] as const)('renders one image per key for storageFormat %s', (storageFormat, stored) => {
    cell(imageColumn(storageFormat), stored, relations);
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('src'))).toEqual([
      'https://cdn.example.com/products/a.jpg',
      'https://cdn.example.com/products/b.jpg',
    ]);
  });

  it('shows the stored key in raw mode', () => {
    render(<Wrapper>{renderCellValue({ column: imageColumn(), value: 'sku-1', rowId: 'r1', rawMode: true, rowMutation: { mutate: vi.fn() }, rows, tableId: 1, relations })}</Wrapper>);
    expect(screen.getByText('sku-1')).toBeInTheDocument();
  });
});
