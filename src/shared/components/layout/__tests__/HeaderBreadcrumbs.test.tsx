// HeaderBreadcrumbs — the module catalog and the crumb a page publishes (pageCrumbStore).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HeaderBreadcrumbs } from '../HeaderBreadcrumbs';
import { usePageCrumbStore } from '../pageCrumbStore';

const labels: Record<string, string> = { 'moduleCatalog.title': 'Module catalog' };
const open = (pathname: string) => render(
  <MemoryRouter>
    <HeaderBreadcrumbs t={key => labels[key] ?? ''} pathname={pathname} currentSpace={{ id: 11, name: 'Dev', icon: '🧪' }}
      displayProject={{ id: 5, name: 'Sales', icon: '📂' }} currentTable={null} currentWidgetId={null} currentWidget={null} />
  </MemoryRouter>,
);
// The name of every crumb sits in the innermost truncating span.
const crumbs = () => screen.getAllByText((_, element) => element?.tagName === 'SPAN' && element.classList.contains('truncate') && element.children.length === 0).map(node => node.textContent);

afterEach(() => { cleanup(); usePageCrumbStore.setState({ crumb: null }); });

describe('module catalog crumbs', () => {
  it('ends with the catalog on the catalog page', () => {
    open('/projects/5/modules');
    expect(crumbs()).toEqual(['Dev', 'Sales', 'Module catalog']);
    expect(screen.queryByRole('link', { name: /Module catalog/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sales/ })).toHaveAttribute('href', '/projects/5');
  });

  it('links the catalog and ends with the module the page published', () => {
    usePageCrumbStore.setState({ crumb: { name: 'Kanban', icon: '📋' } });
    open('/projects/5/modules/1');
    expect(crumbs()).toEqual(['Dev', 'Sales', 'Module catalog', 'Kanban']);
    expect(screen.getByRole('link', { name: /Module catalog/ })).toHaveAttribute('href', '/projects/5/modules');
    expect(screen.getByText('📋')).toBeInTheDocument();
  });
});
