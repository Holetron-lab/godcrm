// ADR-207 W4.2 — ModuleCatalog: cards, counters by origin, the administrator gate and the filters.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { NO_FILTERS } from '../catalog';
import { ModuleCatalog, type ModuleCatalogProps } from '../ModuleCatalog';
import type { CatalogFilters } from '../types';
import { external, internal, kanban, modules } from './fixtures';

const onFiltersChange = vi.fn<(filters: CatalogFilters) => void>();
const onInstall = vi.fn();
const onRetry = vi.fn();
const onMaxColsChange = vi.fn();
const moduleHref = (module: { id: number }) => `/m/${module.id}`;

const catalog = (props: Partial<ModuleCatalogProps> = {}) => (
  <MemoryRouter>
    <ModuleCatalog modules={modules} categories={['general', 'support']} filters={NO_FILTERS}
      onFiltersChange={onFiltersChange} onInstall={onInstall} moduleHref={moduleHref} maxCols={6} onMaxColsChange={onMaxColsChange} onRetry={onRetry} {...props} />
  </MemoryRouter>
);
const open = (props: Partial<ModuleCatalogProps> = {}) => renderWithProviders(catalog(props), { language: 'en' });
const card = (name: string) => screen.getByRole('article', { name });
const categories = () => within(screen.getByRole('navigation', { name: 'Categories' }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('module card', () => {
  it('shows origin as a badge, category and version, the description and how many tables and apps it has', () => {
    const board = { ...kanban, blueprint: { ...kanban.blueprint, tables: [{ key: 'tickets' }], apps: [{ key: 'board', preset: 'kanban_board' }, { key: 'list', preset: 'table_view' }], media: [{ type: 'image' as const, url: '/m/board.png' }] } };
    open({ modules: [board, internal] });
    const kanbanCard = within(card('Kanban'));
    expect(kanbanCard.getByText('Built-in')).toBeInTheDocument();
    expect(kanbanCard.getByText('General · v2.0.0')).toBeInTheDocument();
    expect(kanbanCard.getByText('Cards in columns by status')).toBeInTheDocument();
    expect(kanbanCard.getByText('Tables: 1')).toBeInTheDocument();
    expect(kanbanCard.getByText('Apps: 2')).toBeInTheDocument();
    // The first screenshot shows through the card.
    expect(card('Kanban').querySelector('[style*="board.png"]')).not.toBeNull();
    expect(within(card('SLA rules')).getByText('Internal')).toBeInTheDocument();
    expect(within(card('SLA rules')).getByText('support · v1.0.0')).toBeInTheDocument();
    expect(within(card('SLA rules')).getByText('Tables: 0')).toBeInTheDocument();
    expect(card('SLA rules').querySelector('[style*="url("]')).toBeNull();
  });

  it('leads to the page of the module', () => {
    open();
    expect(within(card('Kanban')).getByRole('link', { name: 'Kanban' })).toHaveAttribute('href', '/m/1');
    expect(within(card('Mail bridge')).getByRole('link', { name: 'Mail bridge' })).toHaveAttribute('href', '/m/4');
  });

  it('shows rating and installs for built-in and external modules only', () => {
    open();
    // The star carries the label for screen readers only: the rating reads "Rating 4.6" as one span.
    expect(within(card('Kanban')).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'Rating 4.6')).toBeInTheDocument();
    expect(within(card('Kanban')).getByText('Installs: 120')).toBeInTheDocument();
    expect(within(card('Mail bridge')).getByText('Installs: 57')).toBeInTheDocument();
    expect(within(card('SLA rules')).queryByText(/Rating|Installs/)).not.toBeInTheDocument();
    // No counters from the server — no empty placeholders.
    expect(within(card('AI Agents')).queryByText(/Rating|Installs/)).not.toBeInTheDocument();
  });

  it('hands a module the user may install to Install', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Install Kanban' }));
    expect(onInstall).toHaveBeenCalledWith(kanban);
  });

  it('keeps an administrator-only module visible, explains why and disables Install', () => {
    open();
    const install = screen.getByRole('button', { name: 'Install AI Agents' });
    expect(install).toBeDisabled();
    expect(install).toHaveAccessibleDescription(/Administrator required/);
    expect(within(card('AI Agents')).getByText('Administrator required')).toBeVisible();
  });

  it('tells a viewer that the member role is needed', () => {
    open({ modules: [{ ...kanban, can_install: false }] });
    expect(screen.getByRole('button', { name: 'Install Kanban' })).toBeDisabled();
    expect(within(card('Kanban')).getByText('Member role required')).toBeVisible();
  });

  it('marks a module that is not published yet', () => {
    open({ modules: [{ ...internal, status: 'draft' }] });
    expect(within(card('SLA rules')).getByText('Draft')).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('changes one filter and keeps the others', async () => {
    const user = userEvent.setup();
    const filters: CatalogFilters = { origin: 'default', components: ['table'], category: 'support', canInstall: false, search: 'kan' };
    open({ filters });

    await user.click(screen.getByRole('radio', { name: 'External' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, origin: 'external' });
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, origin: undefined });

    await user.click(screen.getByRole('checkbox', { name: 'Agents' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, components: ['table', 'agent'] });
    await user.click(screen.getByRole('checkbox', { name: 'Tables' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, components: [] });

    await user.click(categories().getByRole('button', { name: 'General' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, category: 'general' });
    await user.click(categories().getByRole('button', { name: 'All' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, category: undefined });

    await user.click(screen.getByRole('checkbox', { name: 'I can install myself' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, canInstall: true });

    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'b');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, search: 'kanb' });
  });

  it('reflects the current filters in the controls', () => {
    open({ filters: { origin: 'internal', components: ['app'], category: 'support', canInstall: true, search: 'sla' } });
    expect(screen.getByRole('radio', { name: 'Internal' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Apps' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tiles' })).not.toBeChecked();
    expect(categories().getByRole('button', { name: 'support' })).toHaveAttribute('aria-current', 'page');
    expect(categories().getByRole('button', { name: 'All' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('support');
    expect(screen.getByRole('checkbox', { name: 'I can install myself' })).toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Search modules' })).toHaveValue('sla');
  });

  it('lists every category of the catalog as a top menu, "All" first', () => {
    open();
    expect(categories().getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'General', 'support']);
    expect(categories().getByRole('button', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Module catalog');
  });

  it('carries the "Max cols" of the workspaces page: the chosen count is pressed, another one is handed up', async () => {
    const user = userEvent.setup();
    open();
    const cols = within(screen.getByRole('group', { name: 'Max cols' }));
    expect(cols.getAllByRole('button').map(button => button.textContent)).toEqual(['4', '5', '6', '7', '8']);
    expect(cols.getByRole('button', { name: '6' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(cols.getByRole('button', { name: '4' }));
    expect(onMaxColsChange).toHaveBeenCalledWith(4);
  });

  it('works from the keyboard: arrows move the origin, Space toggles a component', async () => {
    const user = userEvent.setup();
    open();
    screen.getByRole('radio', { name: 'All' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, origin: 'default' });
    screen.getByRole('checkbox', { name: 'Services' }).focus();
    await user.keyboard(' ');
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...NO_FILTERS, components: ['service'] });
  });
});

describe('states', () => {
  it('announces how many modules were found', () => {
    open({ modules: [kanban, external] });
    expect(screen.getByRole('status')).toHaveTextContent('Modules found: 2');
  });

  it('offers to clear the filters when nothing matches', async () => {
    const user = userEvent.setup();
    open({ modules: [], filters: { ...NO_FILTERS, origin: 'external', search: 'zzz' } });
    expect(screen.getByText('No modules match these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });

  it('says the catalog is empty when no filter is set', () => {
    open({ modules: [] });
    expect(screen.getByText('No modules in the catalog yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows loading, then a failure with a way to retry', async () => {
    const user = userEvent.setup();
    const { rerender } = open({ modules: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('Loading the catalog…');
    rerender(catalog({ modules: undefined, categories: [], error: 'Network down' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The catalog could not be loaded: Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
