// ADR-207 §2.7 — ModuleDetail as a dialog over the catalog: the name and the arrows in the header, View /
// Get module at the bottom right; the gallery, counters, description and reviews on the left; the module in
// the space on the right. Get module turns the right to where it goes, with Confirm. Counters and reviews
// never on an internal module.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PlanSummary } from '@/features/module-install';
import { filesApi } from '@/features/files/api/filesApi';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { ModuleDetail, type ModuleDetailProps } from '../ModuleDetail';
import type { CatalogModule } from '../types';
import { agents, internal, kanban } from './fixtures';

vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
const upload = vi.mocked(filesApi.upload);

const onInstall = vi.fn();
const onClose = vi.fn();

const pack: CatalogModule = {
  ...kanban, id: 9, key: 'kanban_pack', category: 'support', updated_at: '2026-11-01T10:00:00Z', reviews_count: 2,
  reviews: [
    { id: 1, author: 'Anna', rating: 5, text: 'Boards for every team.', created_at: '2026-10-20T10:00:00Z' },
    { id: 2, author: 'Oleg', rating: 3, created_at: '2026-10-22T10:00:00Z' },
  ],
  blueprint: {
    key: 'kanban_pack', version: '2.0.0', title: 'Kanban Pack', icon: '🎫', author: 'Dev team',
    description: 'Task tracking with dictionaries and bug reports',
    readme: '# Boards\n\nColumns **by status**.',
    media: [
      { type: 'image', url: '/m/board.png', title: 'Board' },
      { type: 'video', url: '/m/tour.mp4', title: 'Tour', thumbnail_url: '/m/tour.jpg' },
    ],
    projects: [{ key: 'main', title: 'Dictionaries', icon: '📚' }, { key: 'kanban', title: 'Boards' }],
    tables: [{ key: 'tickets', name: 'tickets', display_name: 'Tickets', columns: [{ column_name: 'what' }, { column_name: 'state' }] }, { key: 'states', name: 'ticket_states' }],
    requires: { tables: [{ key: 'users', display_name: 'Users' }] },
    apps: [{ key: 'board', preset: 'kanban_board', title: 'Kanban Board', table: 'tickets' }],
    dashboards: [{ key: 'main', title: 'Main board', tiles: [{ key: 'open', preset: 'number_widget', title: 'Open tickets' }] }],
    services: [{ key: 'mail', url: 'https://mail.example.com/mcp' }],
  },
};

const summary: PlanSummary = {
  connect: [{ name: 'Tickets', target: 'tickets #1708' }, { name: 'Users', target: 'users #12' }],
  create: ['ticket_states'],
  skip: [],
  seed: [{ name: 'ticket_states', insert: 6 }],
  apps: 1, tiles: 1, changes: 9, blocked: false,
};

const open = (module: CatalogModule, extra: Partial<ModuleDetailProps> = {}) => renderWithProviders(
  <MemoryRouter><ModuleDetail module={module} onClose={onClose} onInstall={onInstall} {...extra} /></MemoryRouter>,
  { language: 'en' },
);
const section = (name: string) => within(screen.getByRole('region', { name }));
const dialog = () => within(screen.getByRole('dialog'));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('header', () => {
  it('is a dialog named after the module, with its category, origin and version, and closes on the X and on Escape', async () => {
    const user = userEvent.setup();
    open(pack);
    expect(screen.getByRole('dialog', { name: 'Kanban Pack' })).toBeInTheDocument();
    expect(dialog().getByRole('heading', { level: 1, name: 'Kanban Pack' })).toBeInTheDocument();
    expect(dialog().getByText('support · Built-in · v2.0.0')).toBeInTheDocument();
    await user.click(dialog().getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offers Get module at the bottom right, and View module when the space already has the module', () => {
    open(pack, { viewHref: '/widgets/77' });
    const get = dialog().getByRole('button', { name: 'Get Kanban Pack' });
    expect(get).toBeEnabled();
    expect(get.parentElement).toHaveClass('justify-end');
    expect(screen.getByRole('region', { name: 'About the module' }).compareDocumentPosition(get) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog().getByRole('link', { name: 'View module' })).toHaveAttribute('href', '/widgets/77');
    cleanup();
    open(pack);
    expect(screen.queryByRole('link', { name: 'View module' })).not.toBeInTheDocument();
  });

  it('walks the neighbouring modules with the arrows, and has none for a module alone', () => {
    open(pack, { next: { name: 'AI Agents', href: '/projects/5/modules/2' } });
    const arrows = within(dialog().getByRole('navigation', { name: 'Other modules' }));
    expect(arrows.getByRole('link', { name: 'Next module: AI Agents' })).toHaveAttribute('href', '/projects/5/modules/2');
    expect(arrows.queryByRole('link', { name: /Previous module/ })).not.toBeInTheDocument();
    cleanup();
    open(pack);
    expect(screen.queryByRole('navigation', { name: 'Other modules' })).not.toBeInTheDocument();
  });

  it('keeps Get module disabled for a module the user may not install and says why', () => {
    open(agents);
    const get = dialog().getByRole('button', { name: 'Get AI Agents' });
    expect(get).toBeDisabled();
    expect(get).toHaveAccessibleDescription(/Administrator required/);
    expect(dialog().getByText('Who can install').nextElementSibling).toHaveTextContent('Space administrator');
  });
});

describe('about and details', () => {
  it('lists the short description, the details and what the module contains on the right', () => {
    open(pack);
    const about = section('About the module');
    expect(about.getByText('Task tracking with dictionaries and bug reports')).toBeInTheDocument();
    expect(about.getByText('Origin').nextElementSibling).toHaveTextContent('Built-in');
    expect(about.getByText('Version').nextElementSibling).toHaveTextContent('2.0.0');
    expect(about.getByText('Category').nextElementSibling).toHaveTextContent('support');
    expect(about.getByText('Author').nextElementSibling).toHaveTextContent('Dev team');
    expect(about.getByText('Who can install').nextElementSibling).toHaveTextContent('Space member');
    expect(about.getByText('Updated')).toBeInTheDocument();
    expect(within(about.getByRole('list', { name: 'Contains' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Tables', 'Apps']);
  });

  it('attributes a built-in module without an author to GOD CRM and a published one to its space', () => {
    open(kanban);
    expect(dialog().getByText('Author').nextElementSibling).toHaveTextContent('GOD CRM');
    cleanup();
    open(internal);
    expect(dialog().getByText('Author').nextElementSibling).toHaveTextContent('Space #11');
  });
});

describe('gallery', () => {
  it('shows the first media and switches on a thumbnail', async () => {
    const user = userEvent.setup();
    open(pack);
    const gallery = section('Screenshots and videos');
    expect(gallery.getByRole('img', { name: 'Board' })).toHaveAttribute('src', '/m/board.png');
    expect(gallery.getByRole('button', { name: 'Show Board' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(gallery.getByRole('button', { name: 'Show Tour' }));
    expect(gallery.queryByRole('img', { name: 'Board' })).not.toBeInTheDocument();
    expect(gallery.getByLabelText('Tour').tagName).toBe('VIDEO');
    expect(gallery.getByRole('button', { name: 'Show Tour' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('walks the media with the arrows, around the ends, and counts them; a video thumbnail carries the poster', async () => {
    const user = userEvent.setup();
    open(pack);
    const gallery = section('Screenshots and videos');
    expect(gallery.getByRole('status')).toHaveTextContent('1 of 2');
    await user.click(gallery.getByRole('button', { name: 'Next' }));
    expect(gallery.getByLabelText('Tour').tagName).toBe('VIDEO');
    expect(gallery.getByRole('status')).toHaveTextContent('2 of 2');
    await user.click(gallery.getByRole('button', { name: 'Next' }));
    expect(gallery.getByRole('img', { name: 'Board' })).toBeInTheDocument();
    await user.click(gallery.getByRole('button', { name: 'Previous' }));
    expect(gallery.getByRole('status')).toHaveTextContent('2 of 2');
    expect(gallery.getByRole('button', { name: 'Show Tour' }).querySelector('img')).toHaveAttribute('src', '/m/tour.jpg');
  });

  it('has no arrows, counter or strip for a single media', () => {
    open({ ...pack, blueprint: { ...pack.blueprint, media: pack.blueprint.media!.slice(0, 1) } });
    const gallery = section('Screenshots and videos');
    expect(gallery.getByRole('img', { name: 'Board' })).toBeInTheDocument();
    expect(gallery.queryByRole('button')).not.toBeInTheDocument();
    expect(gallery.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says there are no screenshots when the author uploaded none', () => {
    open(kanban);
    expect(section('Screenshots and videos').getByText('No screenshots yet')).toBeInTheDocument();
  });
});

describe('editing in place', () => {
  it('shows no pencil to anyone but the owner', () => {
    open(pack);
    expect(screen.queryByRole('button', { name: /^Edit:/ })).not.toBeInTheDocument();
  });

  it('lets the owner edit the short description where it is shown and saves it', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    open(pack, { onSave });
    const about = section('About the module');
    await user.click(about.getByRole('button', { name: 'Edit: Short description' }));
    const field = about.getByRole('textbox', { name: 'Short description' });
    expect(field).toHaveValue('Task tracking with dictionaries and bug reports');
    await user.clear(field);
    await user.type(field, 'Boards for every team');
    await user.click(about.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ description: 'Boards for every team' });
    await waitFor(() => expect(about.queryByRole('textbox')).not.toBeInTheDocument());
    expect(about.getByRole('button', { name: 'Edit: Short description' })).toBeInTheDocument();
  });

  it('lets the owner edit the long description under the gallery, keeps the text on a failure and drops it on Cancel', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Registry offline'));
    open(pack, { onSave });
    const readme = section('Description');
    await user.click(readme.getByRole('button', { name: 'Edit: Long description (Markdown)' }));
    const field = readme.getByRole('textbox', { name: 'Long description (Markdown)' });
    expect(field).toHaveValue('# Boards\n\nColumns **by status**.');
    await user.type(field, ' More.');
    await user.click(readme.getByRole('button', { name: 'Save' }));
    expect(await readme.findByRole('alert')).toHaveTextContent('Could not save: Registry offline');
    expect(field).toHaveValue('# Boards\n\nColumns **by status**. More.');
    expect(onSave).toHaveBeenCalledWith({ readme: '# Boards\n\nColumns **by status**. More.' });

    await user.click(readme.getByRole('button', { name: 'Cancel' }));
    expect(readme.queryByRole('textbox')).not.toBeInTheDocument();
    expect(readme.getByRole('heading', { level: 1, name: 'Boards' })).toBeInTheDocument();
  });
});

describe('editing the gallery', () => {
  const gallery = () => section('Screenshots and videos');
  const items = () => within(gallery().getByRole('list', { name: 'Gallery items' })).getAllByRole('listitem');

  it('lets the owner reorder, caption and remove the media, then saves the gallery in that order', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    open(pack, { onSave });
    await user.click(gallery().getByRole('button', { name: 'Edit: Screenshots and videos' }));
    expect(gallery().getByText('The first image is the cover of the card in the catalog.')).toBeInTheDocument();
    expect(items().map(item => within(item).getByRole('textbox').getAttribute('value'))).toEqual(['Board', 'Tour']);
    expect(items()[0].querySelector('img')).toHaveAttribute('src', '/m/board.png');

    await user.click(gallery().getByRole('button', { name: 'Move Board down' }));
    expect(items().map(item => within(item).getByRole('textbox').getAttribute('value'))).toEqual(['Tour', 'Board']);
    // The ends do not wrap: the last one has no "down", the first one no "up".
    expect(gallery().queryByRole('button', { name: 'Move Board down' })).not.toBeInTheDocument();
    expect(gallery().queryByRole('button', { name: 'Move Tour up' })).not.toBeInTheDocument();

    const caption = gallery().getByRole('textbox', { name: 'Caption of media 2' });
    await user.clear(caption);
    await user.type(caption, 'Board view');
    await user.click(gallery().getByRole('button', { name: 'Remove Tour' }));
    expect(items()).toHaveLength(1);

    await user.click(gallery().getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ media: [{ type: 'image', url: '/m/board.png', title: 'Board view' }] });
    await waitFor(() => expect(gallery().queryByRole('textbox')).not.toBeInTheDocument());
    expect(gallery().getByRole('button', { name: 'Edit: Screenshots and videos' })).toBeInTheDocument();
  });

  it('uploads new screenshots and videos as internal files, appends them captioned by file name, and tells when an upload fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    upload.mockImplementation(async files => files.map(file => ({ id: file.name, name: file.name, originalName: file.name, mimeType: file.type, size: 3, url: `/uploads/${file.name}` })));
    open({ ...pack, blueprint: { ...pack.blueprint, media: undefined } }, { onSave });
    await user.click(gallery().getByRole('button', { name: 'Edit: Screenshots and videos' }));
    expect(gallery().queryByRole('list', { name: 'Gallery items' })).not.toBeInTheDocument();

    const shot = new File(['png'], 'shot.png', { type: 'image/png' });
    const clip = new File(['mp4'], 'clip.mp4', { type: 'video/mp4' });
    await user.upload(gallery().getByLabelText('Add screenshots or videos'), [shot, clip]);
    expect(upload).toHaveBeenCalledWith([shot, clip], { visibility: 'internal' });
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(items().map(item => within(item).getByRole('textbox').getAttribute('value'))).toEqual(['shot', 'clip']);
    expect(items()[0].querySelector('img')).toHaveAttribute('src', '/uploads/shot.png');

    upload.mockRejectedValueOnce(new Error('Too big'));
    await user.upload(gallery().getByLabelText('Add screenshots or videos'), new File(['x'], 'huge.png', { type: 'image/png' }));
    expect(await gallery().findByRole('alert')).toHaveTextContent('Could not upload: Too big');
    expect(items()).toHaveLength(2);

    await user.click(gallery().getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ media: [
      { type: 'image', url: '/uploads/shot.png', title: 'shot' },
      { type: 'video', url: '/uploads/clip.mp4', title: 'clip' },
    ] });
  });

  it('keeps the draft on a failure and drops it on Cancel', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Registry offline'));
    open(pack, { onSave });
    await user.click(gallery().getByRole('button', { name: 'Edit: Screenshots and videos' }));
    await user.click(gallery().getByRole('button', { name: 'Remove Tour' }));
    await user.click(gallery().getByRole('button', { name: 'Save' }));
    expect(await gallery().findByRole('alert')).toHaveTextContent('Could not save: Registry offline');
    expect(items()).toHaveLength(1);

    await user.click(gallery().getByRole('button', { name: 'Cancel' }));
    expect(gallery().queryByRole('textbox')).not.toBeInTheDocument();
    expect(gallery().getByRole('button', { name: 'Show Tour' })).toBeInTheDocument();
  });
});

describe('what is inside', () => {
  const inside = () => section('What is inside');

  it('tells what the plan amounts to in the space: glued, new and seeded tables, apps and tiles, changes', () => {
    open(pack, { plan: <output>the tree</output>, summary });
    expect(inside().getByText('Glued to tables of the space: 2')).toBeInTheDocument();
    expect(within(inside().getByRole('list', { name: 'Tables glued to the space' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Tickets → tickets #1708', 'Users → users #12']);
    expect(inside().getByText('New tables: 1')).toBeInTheDocument();
    expect(within(inside().getByRole('list', { name: 'New tables' })).getByText('ticket_states')).toBeInTheDocument();
    expect(inside().queryByText(/Left out/)).not.toBeInTheDocument();
    expect(within(inside().getByRole('list', { name: 'Sample rows' })).getByText('ticket_states: 6 rows')).toBeInTheDocument();
    expect(inside().getByText('Apps: 1 · Tiles: 1')).toBeInTheDocument();
    expect(inside().getByText('Changes in the space: 9')).toBeInTheDocument();
    // The tree itself waits for the install step.
    expect(screen.queryByText('the tree')).not.toBeInTheDocument();
  });

  it('names the tables left out, and says the plan is on its way while there is a plan but no summary yet', () => {
    open(pack, { plan: <output>the tree</output>, summary: { ...summary, skip: ['Users'] } });
    expect(within(inside().getByRole('list', { name: 'Tables left out' })).getByText('Users')).toBeInTheDocument();
    cleanup();
    open(pack, { plan: <output>the tree</output> });
    expect(inside().getByRole('status')).toHaveTextContent('Building the install plan…');
  });

  it('groups projects, tables, required tables, apps, tiles and services of the blueprint when there is no plan', () => {
    open(pack);
    expect(inside().getAllByRole('group').map(group => group.querySelector('summary')?.textContent)).toEqual([
      'Projects (2)', 'Tables (2)', 'Required tables of the space (1)', 'Apps (1)', 'Tiles (1)', 'External services (1)',
    ]);
    expect(inside().getByText('Tickets').parentElement).toHaveTextContent('Columns: 2');
    expect(inside().getByText('ticket_states')).toBeInTheDocument();
    expect(inside().getByText('Users')).toBeInTheDocument();
    expect(inside().getByText('Kanban Board').parentElement).toHaveTextContent('kanban_board');
    expect(inside().getByText('Open tickets').parentElement).toHaveTextContent('Main board');
    expect(inside().getByText('mail').parentElement).toHaveTextContent('mail.example.com');
  });

  it('reads a v1 blueprint: widgets without a dashboard are apps, on a dashboard they are tiles', () => {
    open({ ...kanban, blueprint: { ...kanban.blueprint, widgets: [{ key: 'board', preset_name: 'kanban_board' }, { key: 'count', preset_name: 'number_widget', dashboard: 'main' }] } });
    expect(inside().getAllByRole('group').map(group => group.querySelector('summary')?.textContent)).toEqual(['Apps (1)', 'Tiles (1)']);
  });

  it('says so when the blueprint lists nothing', () => {
    open(kanban);
    expect(inside().getByText('The blueprint lists no components.')).toBeInTheDocument();
  });
});

describe('counters, description and reviews', () => {
  it('shows the market counters under the gallery, then the description and the reviews', () => {
    open(pack);
    const counters = section('Rating and installs');
    expect(counters.getByText('Rating').nextElementSibling).toHaveTextContent('4.6');
    expect(counters.getByText('Installs').nextElementSibling).toHaveTextContent('120');
    expect(counters.getByText('Reviews').nextElementSibling).toHaveTextContent('2');
    const order = ['Screenshots and videos', 'Rating and installs', 'Description', 'Reviews'].map(name => screen.getByRole('region', { name }));
    order.slice(1).forEach((region, at) => expect(order[at].compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());

    const reviews = section('Reviews');
    expect(reviews.getAllByRole('listitem')).toHaveLength(2);
    expect(reviews.getByText('Anna').parentElement).toHaveTextContent('5 of 5');
    expect(reviews.getByText('Boards for every team.')).toBeInTheDocument();
  });

  it('renders the long description as Markdown', () => {
    open(pack);
    expect(section('Description').getByRole('heading', { level: 1, name: 'Boards' })).toBeInTheDocument();
    expect(section('Description').getByText('by status').tagName).toBe('STRONG');
  });

  it('tells when there is no rating, no long description and no review yet', () => {
    open({ ...kanban, rating: null, installs: null });
    expect(section('Rating and installs').getByText('No rating yet')).toBeInTheDocument();
    expect(section('Description').getByText('The author has not written a long description yet.')).toBeInTheDocument();
    expect(section('Reviews').getByText('No reviews yet.')).toBeInTheDocument();
  });

  it('keeps counters and reviews off an internal module', () => {
    open({ ...internal, rating: 5, installs: 3, reviews: [{ id: 1, author: 'x', rating: 5, created_at: '2026-10-20T10:00:00Z' }] });
    expect(section('Rating and installs').getByText('Internal modules have no market rating or install counter.')).toBeInTheDocument();
    expect(section('Reviews').getByText('Internal modules have no market reviews.')).toBeInTheDocument();
    expect(section('Reviews').queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('install', () => {
  it('turns the right to where it goes, keeps the gallery on the left, then runs the install on Confirm', async () => {
    const user = userEvent.setup();
    open(pack, { plan: <output>the tree</output>, summary, viewHref: '/widgets/77' });
    await user.click(dialog().getByRole('button', { name: 'Get Kanban Pack' }));
    expect(onInstall).not.toHaveBeenCalled();
    const where = section('Where it goes');
    expect(where.getByText('the tree')).toBeInTheDocument();
    expect(where.getByText(/what the module creates/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Screenshots and videos' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'About the module' })).not.toBeInTheDocument();
    // The header keeps the name and the close; Get and View give way to Confirm below the plan.
    expect(screen.queryByRole('button', { name: 'Get Kanban Pack' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View module' })).not.toBeInTheDocument();

    await user.click(where.getByRole('button', { name: 'Confirm and install Kanban Pack' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('waits for the plan before Confirm is on', async () => {
    const user = userEvent.setup();
    open(pack, { installDisabled: true });
    await user.click(dialog().getByRole('button', { name: 'Get Kanban Pack' }));
    const where = section('Where it goes');
    expect(where.getByRole('status')).toHaveTextContent('Building the install plan…');
    expect(where.getByRole('button', { name: 'Confirm and install Kanban Pack' })).toBeDisabled();
  });

  it('keeps Confirm off while the page says so, tells why, and goes back to About on Back', async () => {
    const user = userEvent.setup();
    open(pack, { summary: { ...summary, blocked: true }, installDisabled: true, installHint: 'Resolve the conflicts to install.' });
    await user.click(dialog().getByRole('button', { name: 'Get Kanban Pack' }));
    const confirm = screen.getByRole('button', { name: 'Confirm and install Kanban Pack' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription('Resolve the conflicts to install.');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('region', { name: 'About the module' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Where it goes' })).not.toBeInTheDocument();
    expect(dialog().getByRole('button', { name: 'Get Kanban Pack' })).toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });
});
