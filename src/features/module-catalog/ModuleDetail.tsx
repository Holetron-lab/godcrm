// ADR-207 §2.7 — the module as a dialog over the catalog, laid out like a marketplace listing (owner, chat
// 3813, 13.11.2026, after Notion's template gallery): the name and the arrows to the neighbouring modules
// in the header, "View module" and "Get module" at the bottom right; the gallery always on the left, with
// the market counters, the long description and the reviews below it; on the right what the module amounts to in
// this space — the tables it glues to, creates and seeds — then the short description and the details.
// "Get module" turns the right to where it goes: the install plan on the tree of the space, with the
// example rows switch and Confirm. The owner of the module edits its texts and its gallery in place.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ExternalLink, Image as ImageIcon, Lock, Package, Pencil, Play, Star, Trash2, Upload } from 'lucide-react';
import { Link, type To } from 'react-router-dom';
import type { PlanSummary } from '@/features/module-install';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { uploadModuleMedia } from './api';
import { categoryName } from './catalog';
import { composition } from './composition';
import type { CatalogModule, ModuleMedia, ModuleMetaPatch } from './types';

export interface ModuleDetailProps {
  module: CatalogModule;
  /** Closes the dialog: Escape, the backdrop, the close button. */
  onClose: () => void;
  /** The neighbouring modules of the catalog: the arrows of the header. */
  previous?: { name: string; href: To };
  next?: { name: string; href: To };
  /** Where an install of this module already in the space opens: "View module" leads there. */
  viewHref?: To;
  /** Runs the install: the Confirm of the install step. */
  onInstall: () => void;
  /** Confirm is off for now: the plan is on its way, has a blocking conflict, or an install is running. */
  installDisabled?: boolean;
  /** Why Confirm is off, when there is a reason to tell. */
  installHint?: string | null;
  /** The install plan of the module in this space (`InstallPlanView`): the install step. */
  plan?: ReactNode;
  /** What the plan amounts to: "What is inside" on the right. Absent while the plan is on its way. */
  summary?: PlanSummary;
  /** Given to the owner of the module only: saves the texts edited in place. */
  onSave?: (patch: ModuleMetaPatch) => Promise<void>;
}

const headingClass = 'text-base font-semibold text-[var(--text-primary)]';
const arrowClass = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]';
const stepClass = `rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] ${ring}`;
const linkButtonClass = 'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium '
  + `text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)] ${ring} focus-visible:ring-offset-2`;
// Full screen below `lg`; a window over the catalog from `lg` up, where the two columns scroll on their own.
const modalClass = 'flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none p-0 lg:h-[90vh] lg:w-[min(96vw,80rem)] lg:rounded-2xl';

function Gallery({ media, icon }: { media: ModuleMedia[]; icon?: string }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLUListElement>(null);
  const current = media[index] ?? media[0];
  const title = (item: ModuleMedia, at: number) => item.title || t('moduleCatalog.detail.media.item', { index: at + 1 });
  const go = (step: number) => setIndex(at => (at + step + media.length) % media.length);

  // The strip follows the viewer: the chosen thumbnail is always in sight.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [index]);

  if (!current) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)]">
        <span aria-hidden="true" className="text-5xl">{icon || <ImageIcon className="h-10 w-10" />}</span>
        <p>{t('moduleCatalog.detail.media.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {current.type === 'video'
          // eslint-disable-next-line jsx-a11y/media-has-caption -- the author's video; captions come with the media (captions_url) when there are any
          ? <video key={current.url} controls preload="metadata" src={current.url} poster={current.thumbnail_url} className="aspect-video w-full" aria-label={title(current, index)}>
              {current.captions_url && <track kind="captions" src={current.captions_url} />}
            </video>
          : <img key={current.url} src={current.url} alt={title(current, index)} className="aspect-video w-full object-contain" />}
        {media.length > 1 && (
          <>
            <button type="button" className={`${arrowClass} left-2`} aria-label={t('moduleCatalog.detail.media.previous')} onClick={() => go(-1)}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" className={`${arrowClass} right-2`} aria-label={t('moduleCatalog.detail.media.next')} onClick={() => go(1)}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <p role="status" className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              {t('moduleCatalog.detail.media.counter', { index: index + 1, count: media.length })}
            </p>
          </>
        )}
      </div>
      {media.length > 1 && (
        <ul ref={strip} className="flex gap-2 overflow-x-auto pb-1">
          {media.map((item, at) => (
            <li key={item.url} className="flex-shrink-0">
              <button type="button" aria-pressed={at === index} aria-label={t('moduleCatalog.detail.media.show', { title: title(item, at) })} onClick={() => setIndex(at)}
                className={`relative block h-[4.5rem] w-32 overflow-hidden rounded-md border-2 border-transparent bg-[var(--bg-secondary)] opacity-70 hover:opacity-100 aria-pressed:border-[var(--color-primary-500)] aria-pressed:opacity-100 ${ring}`}>
                {item.thumbnail_url || item.type === 'image'
                  ? <img src={item.thumbnail_url || item.url} alt="" className="h-full w-full object-cover" />
                  : <span className="flex h-full items-center justify-center bg-black px-1 text-center text-xs text-white">{title(item, at)}</span>}
                {item.type === 'video' && (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-full bg-black/60 p-1.5 text-white"><Play className="h-4 w-4 fill-current" /></span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const failureText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const iconButtonClass = '-my-1 px-2';

interface EditableGalleryProps {
  media: ModuleMedia[];
  icon?: string;
  /** Absent for everyone but the owner: then the gallery is only watched. Receives the whole new list. */
  onSave?: (media: ModuleMedia[]) => Promise<void>;
}

/** The gallery with the owner's pencil: uploads, captions, order and removal, saved as one list. */
function EditableGallery({ media, icon, onSave }: EditableGalleryProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<ModuleMedia[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = (item: ModuleMedia, at: number) => item.title || t('moduleCatalog.detail.media.item', { index: at + 1 });

  if (draft === null) {
    return (
      <>
        {onSave && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="-mt-1.5 -mr-2 px-2" aria-label={t('moduleCatalog.detail.edit.open', { what: t('moduleCatalog.detail.media.label') })} onClick={() => { setError(null); setDraft(media); }}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        <Gallery media={media} icon={icon} />
      </>
    );
  }

  const busy = saving || uploading;
  const edit = (change: (items: ModuleMedia[]) => ModuleMedia[]) => setDraft(items => (items === null ? items : change(items)));
  const move = (at: number, step: number) => edit(items => {
    const next = [...items];
    next.splice(at + step, 0, ...next.splice(at, 1));
    return next;
  });
  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const added = await uploadModuleMedia(files);
      edit(items => [...items, ...added]);
    } catch (failure) {
      setError(t('moduleCatalog.detail.media.edit.uploadFailed', { error: failureText(failure) }));
    } finally {
      setUploading(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (failure) {
      setError(t('moduleCatalog.detail.edit.failed', { error: failureText(failure) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={event => { void submit(event); }} className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.media.edit.hint')}</p>
      {draft.length > 0 && (
        <ol aria-label={t('moduleCatalog.detail.media.edit.list')} className="flex flex-col gap-2">
          {draft.map((item, at) => (
            <li key={item.url} className="flex items-center gap-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2">
              <span className="flex h-14 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                {item.thumbnail_url || item.type === 'image'
                  ? <img src={item.thumbnail_url || item.url} alt="" className="h-full w-full object-cover" />
                  : <Play className="h-5 w-5 fill-current text-white" aria-hidden="true" />}
              </span>
              <input type="text" aria-label={t('moduleCatalog.detail.media.edit.caption', { index: at + 1 })} value={item.title ?? ''} disabled={busy}
                onChange={event => edit(items => items.map((entry, i) => (i === at ? { ...entry, title: event.target.value || undefined } : entry)))}
                className="min-w-0 flex-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] disabled:opacity-60" />
              <span className="flex flex-shrink-0 items-center">
                {at > 0 && (
                  <Button type="button" variant="ghost" size="sm" className={iconButtonClass} disabled={busy} aria-label={t('moduleCatalog.detail.media.edit.up', { title: title(item, at) })} onClick={() => move(at, -1)}>
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                {at < draft.length - 1 && (
                  <Button type="button" variant="ghost" size="sm" className={iconButtonClass} disabled={busy} aria-label={t('moduleCatalog.detail.media.edit.down', { title: title(item, at) })} onClick={() => move(at, 1)}>
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" className={iconButtonClass} disabled={busy} aria-label={t('moduleCatalog.detail.media.edit.remove', { title: title(item, at) })} onClick={() => edit(items => items.filter((_, i) => i !== at))}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-primary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-within:ring-2 focus-within:ring-[var(--color-primary-500)] ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t('moduleCatalog.detail.media.edit.add')}
          <input type="file" accept="image/*,video/*" multiple disabled={busy} className="sr-only"
            onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }} />
        </label>
        {uploading && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.media.edit.uploading')}</p>}
      </div>
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving} disabled={uploading}>{saving ? t('moduleCatalog.detail.edit.saving') : t('moduleCatalog.detail.edit.save')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(null); setError(null); }}>{t('moduleCatalog.detail.edit.cancel')}</Button>
      </div>
    </form>
  );
}

interface EditableProps {
  /** The heading of the panel; the pencil sits next to it. */
  heading: ReactNode;
  /** What the text is, for the pencil's label and the field. */
  label: string;
  value: string;
  rows: number;
  /** Absent for everyone but the owner: then the text is only read. */
  onSave?: (value: string) => Promise<void>;
  children: ReactNode;
}

/** A text of the module page the owner edits where it is shown. */
function Editable({ heading, label, value, rows, onSave, children }: EditableProps) {
  const { t } = useLanguage();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSave || draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        {heading}
        {onSave && !editing && (
          <Button variant="ghost" size="sm" className="-my-1.5 -mr-2 px-2" aria-label={t('moduleCatalog.detail.edit.open', { what: label })} onClick={() => setDraft(value)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={event => { void submit(event); }} className="flex flex-col gap-2">
          <textarea id={id} aria-label={label} rows={rows} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
            className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--color-primary-500)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] disabled:opacity-60" />
          {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-700 dark:text-red-400">{t('moduleCatalog.detail.edit.failed', { error })}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={saving}>{saving ? t('moduleCatalog.detail.edit.saving') : t('moduleCatalog.detail.edit.save')}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setDraft(null); setError(null); }}>{t('moduleCatalog.detail.edit.cancel')}</Button>
          </div>
        </form>
      ) : children}
    </>
  );
}

/** The blueprint's components by kind: what "What is inside" shows when there is no plan of a space to show. */
function Composition({ module }: { module: CatalogModule }) {
  const { t } = useLanguage();
  const groups = composition(module.blueprint);
  if (groups.length === 0) return <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.composition.empty')}</p>;
  return (
    <div className="divide-y divide-[var(--border-primary)]">
      {groups.map((group, at) => (
        <details key={group.kind} open={at === 0} className="group py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)] marker:text-[var(--text-tertiary)]">
            {t(`moduleCatalog.detail.composition.${group.kind}`)} <span className="text-[var(--text-secondary)]">({group.items.length})</span>
          </summary>
          <ul className="mt-2 space-y-1 pl-4 text-sm">
            {group.items.map(item => (
              <li key={item.key} className="flex flex-wrap items-baseline gap-x-2">
                {item.icon && <span aria-hidden="true">{item.icon}</span>}
                <span className="text-[var(--text-primary)]">{item.title}</span>
                {item.hint && <span className="text-xs text-[var(--text-secondary)]">{item.hint}</span>}
                {item.columns != null && <span className="text-xs text-[var(--text-secondary)]">{t('moduleCatalog.detail.composition.columns', { count: item.columns })}</span>}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** What the plan amounts to in this space: glued, created and left-out tables, the seed, the surfaces. */
function Summary({ summary }: { summary: PlanSummary }) {
  const { t } = useLanguage();
  const listClass = 'mt-1 space-y-0.5 pl-4 text-[var(--text-secondary)]';
  return (
    <div className="flex flex-col gap-3 text-sm text-[var(--text-primary)]">
      <div>
        <p className="font-medium">{t('moduleCatalog.detail.confirm.connect', { count: summary.connect.length })}</p>
        {summary.connect.length > 0 && (
          <ul aria-label={t('moduleCatalog.detail.confirm.connectList')} className={listClass}>
            {summary.connect.map(table => <li key={table.name}>{table.name} → {table.target}</li>)}
          </ul>
        )}
      </div>
      <div>
        <p className="font-medium">{t('moduleCatalog.detail.confirm.create', { count: summary.create.length })}</p>
        {summary.create.length > 0 && <ul aria-label={t('moduleCatalog.detail.confirm.createList')} className={listClass}>{summary.create.map(table => <li key={table}>{table}</li>)}</ul>}
      </div>
      {summary.skip.length > 0 && (
        <div>
          <p className="font-medium">{t('moduleCatalog.detail.confirm.skip', { count: summary.skip.length })}</p>
          <ul aria-label={t('moduleCatalog.detail.confirm.skipList')} className={listClass}>{summary.skip.map(table => <li key={table}>{table}</li>)}</ul>
        </div>
      )}
      {summary.seed.length > 0 && (
        <div>
          <p className="font-medium">{t('moduleCatalog.detail.confirm.seed')}</p>
          <ul aria-label={t('moduleCatalog.detail.confirm.seed')} className={listClass}>
            {summary.seed.map(table => <li key={table.name}>{t('moduleCatalog.detail.confirm.seedRows', { name: table.name, count: table.insert })}</li>)}
          </ul>
        </div>
      )}
      <p className="text-[var(--text-secondary)]">{t('moduleCatalog.detail.confirm.surfaces', { apps: summary.apps, tiles: summary.tiles })}</p>
      <p className="text-[var(--text-secondary)]">{t('moduleCatalog.detail.confirm.changes', { count: summary.changes })}</p>
    </div>
  );
}

export function ModuleDetail({ module, onClose, previous, next, viewHref, onInstall, installDisabled = false, installHint = null, plan, summary, onSave }: ModuleDetailProps) {
  const { t, language } = useLanguage();
  const id = useId();
  const { blueprint } = module;
  const name = blueprint.title || module.key;
  const market = module.origin !== 'internal';
  const author = blueprint.author
    || (module.origin === 'default' ? t('moduleCatalog.detail.specs.builtIn') : module.publisher_space_id != null ? t('moduleCatalog.detail.specs.space', { id: module.publisher_space_id }) : null);
  const reviews = module.reviews ?? [];
  const reviewsCount = module.reviews_count ?? (module.reviews ? reviews.length : null);
  const specs: [string, string | null][] = [
    [t('moduleCatalog.detail.specs.origin'), t(`moduleCatalog.originBadge.${module.origin}`)],
    [t('moduleCatalog.detail.specs.version'), module.version],
    [t('moduleCatalog.detail.specs.category'), categoryName(t, module.category)],
    [t('moduleCatalog.detail.specs.author'), author],
    [t('moduleCatalog.detail.specs.role'), t(module.required_role === 'admin' ? 'moduleCatalog.detail.specs.roleAdmin' : 'moduleCatalog.detail.specs.roleMember')],
    [t('moduleCatalog.detail.specs.updated'), module.updated_at ? new Date(module.updated_at).toLocaleDateString(language) : null],
  ];

  // Get module: the right turns to where it goes and asks to confirm; the left keeps the gallery.
  const [confirming, setConfirming] = useState(false);
  const gate = `${id}-gate`;
  const hint = `${id}-hint`;
  const preparing = <p role="status" className="p-4 text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.confirm.preparing')}</p>;

  return (
    <Modal
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={name}
      description={blueprint.description || t('moduleCatalog.detail.noDescription')}
      size="full"
      className={modalClass}
      contentClassName="mt-0 flex max-h-none min-h-0 flex-1 flex-col overflow-visible pr-0"
      header={(
        <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3 pr-12 lg:px-6 lg:pr-14">
          {(previous || next) && (
            <nav aria-label={t('moduleCatalog.detail.neighbours')} className="flex items-center">
              {previous
                ? <Link to={previous.href} className={stepClass} aria-label={t('moduleCatalog.detail.previousModule', { name: previous.name })}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
                : <span aria-hidden="true" className="p-1.5 text-[var(--text-tertiary)]"><ChevronLeft className="h-5 w-5" /></span>}
              {next
                ? <Link to={next.href} className={stepClass} aria-label={t('moduleCatalog.detail.nextModule', { name: next.name })}><ChevronRight className="h-5 w-5" aria-hidden="true" /></Link>
                : <span aria-hidden="true" className="p-1.5 text-[var(--text-tertiary)]"><ChevronRight className="h-5 w-5" /></span>}
            </nav>
          )}
          <span aria-hidden="true" className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--bg-tertiary)] text-3xl">
            {blueprint.icon || <Package className="h-7 w-7 text-[var(--text-secondary)]" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold text-[var(--text-primary)]">{name}</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              {categoryName(t, module.category)} · {t(`moduleCatalog.originBadge.${module.origin}`)} · {t('moduleCatalog.card.version', { version: module.version })}
            </p>
          </div>
        </header>
      )}
      footer={!confirming ? (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {viewHref && (
              <Link to={viewHref} className={linkButtonClass}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t('moduleCatalog.detail.view')}
              </Link>
            )}
            <Button disabled={!module.can_install} aria-label={t('moduleCatalog.detail.getNamed', { name })} aria-describedby={module.can_install ? undefined : gate} onClick={() => setConfirming(true)}>
              {t('moduleCatalog.detail.get')}
            </Button>
          </div>
          {!module.can_install && (
            <p id={gate} className="flex items-start gap-1.5 text-xs text-[var(--text-primary)]">
              <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {module.required_role === 'admin'
                ? <span><strong className="font-medium">{t('moduleCatalog.card.adminRequired')}</strong> <span className="text-[var(--text-secondary)]">{t('moduleCatalog.card.adminHint')}</span></span>
                : <strong className="font-medium">{t('moduleCatalog.card.memberRequired')}</strong>}
            </p>
          )}
        </div>
      ) : undefined}
    >
          {/* The gallery column gives way to the plan on the install step: the tree needs the room. */}
          <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden ${confirming ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'}`}>
            <div className="flex flex-col gap-5 p-4 lg:min-h-0 lg:overflow-y-auto lg:px-6">
              <section aria-label={t('moduleCatalog.detail.media.label')}>
                <EditableGallery media={blueprint.media ?? []} icon={blueprint.icon} onSave={onSave && (media => onSave({ media }))} />
              </section>

              <section aria-labelledby={`${id}-summary`} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
                <h2 id={`${id}-summary`} className="sr-only">{t('moduleCatalog.detail.summary.label')}</h2>
                {market ? (
                  <dl className="grid grid-cols-3 divide-x divide-[var(--border-primary)] text-center">
                    <div>
                      <dt className="text-xs text-[var(--text-secondary)]">{t('moduleCatalog.detail.summary.rating')}</dt>
                      <dd className="mt-1 inline-flex items-center gap-1 text-xl font-semibold text-[var(--text-primary)]">
                        {module.rating != null ? <><Star className="h-4 w-4 fill-current" aria-hidden="true" />{module.rating}</> : <span className="text-sm font-normal text-[var(--text-secondary)]">{t('moduleCatalog.detail.summary.noRating')}</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-secondary)]">{t('moduleCatalog.detail.summary.installs')}</dt>
                      <dd className="mt-1 inline-flex items-center gap-1 text-xl font-semibold text-[var(--text-primary)]"><Download className="h-4 w-4" aria-hidden="true" />{module.installs ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-secondary)]">{t('moduleCatalog.detail.summary.reviews')}</dt>
                      <dd className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{reviewsCount ?? 0}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.summary.internal')}</p>
                )}
              </section>

              <section aria-labelledby={`${id}-readme`} className="flex flex-col gap-2">
                <Editable heading={<h2 id={`${id}-readme`} className={headingClass}>{t('moduleCatalog.detail.readme.label')}</h2>}
                  label={t('moduleCatalog.detail.edit.readme')} value={blueprint.readme ?? ''} rows={12}
                  onSave={onSave && (readme => onSave({ readme }))}>
                  {blueprint.readme
                    ? <MarkdownPreview content={blueprint.readme} />
                    : <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.readme.empty')}</p>}
                </Editable>
              </section>

              <section aria-labelledby={`${id}-reviews`} className="flex flex-col gap-2">
                <h2 id={`${id}-reviews`} className={headingClass}>{t('moduleCatalog.detail.reviews.label')}</h2>
                {!market ? <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.reviews.internal')}</p>
                : reviews.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.reviews.empty')}</p>
                : (
                  <ul className="divide-y divide-[var(--border-primary)]">
                    {reviews.map(review => (
                      <li key={review.id} className="space-y-1 py-3 text-sm first:pt-0">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <strong className="font-medium text-[var(--text-primary)]">{review.author}</strong>
                          <span className="inline-flex items-center gap-1 text-[var(--text-primary)]">
                            <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />{t('moduleCatalog.detail.reviews.rating', { value: review.rating })}
                          </span>
                          <time dateTime={review.created_at} className="text-xs text-[var(--text-secondary)]">{new Date(review.created_at).toLocaleDateString(language)}</time>
                        </p>
                        {review.text && <p className="whitespace-pre-line text-[var(--text-primary)]">{review.text}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="flex flex-col border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] lg:min-h-0 lg:border-l lg:border-t-0">
              {confirming ? (
                <section aria-labelledby={`${id}-where`} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 lg:overflow-y-auto">
                    <div className="flex flex-col gap-1 p-4">
                      <h2 id={`${id}-where`} className={headingClass}>{t('moduleCatalog.detail.plan.label')}</h2>
                      <p className="text-sm text-[var(--text-secondary)]">{t('moduleCatalog.detail.plan.hint')}</p>
                    </div>
                    <div className="border-t border-[var(--border-primary)]">{plan ?? preparing}</div>
                  </div>
                  <footer className="flex flex-col gap-2 border-t border-[var(--border-primary)] p-4">
                    <Button size="lg" disabled={installDisabled || !summary} aria-label={t('moduleCatalog.detail.confirm.installNamed', { name })} aria-describedby={installHint ? hint : undefined} onClick={onInstall}>
                      {t('moduleCatalog.detail.confirm.install')}
                    </Button>
                    {installHint && <p id={hint} className="text-xs text-[var(--text-primary)]">{installHint}</p>}
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>{t('moduleCatalog.detail.confirm.cancel')}</Button>
                  </footer>
                </section>
              ) : (
                <section aria-labelledby={`${id}-about`} className="flex flex-col gap-4 p-4 lg:min-h-0 lg:overflow-y-auto">
                  <Editable heading={<h2 id={`${id}-about`} className={headingClass}>{t('moduleCatalog.detail.about')}</h2>}
                    label={t('moduleCatalog.detail.edit.description')} value={blueprint.description ?? ''} rows={3}
                    onSave={onSave && (description => onSave({ description }))}>
                    <p className="text-sm text-[var(--text-primary)]">{blueprint.description || t('moduleCatalog.detail.noDescription')}</p>
                  </Editable>
                  <section aria-labelledby={`${id}-inside`} className="flex flex-col gap-2 border-t border-[var(--border-primary)] pt-3">
                    <h2 id={`${id}-inside`} className={headingClass}>{t('moduleCatalog.detail.composition.label')}</h2>
                    {summary ? <Summary summary={summary} /> : plan ? preparing : <Composition module={module} />}
                  </section>
                  <dl aria-label={t('moduleCatalog.detail.specs.label')} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-[var(--border-primary)] pt-3 text-sm">
                    {specs.map(([label, value]) => value && (
                      <div key={label} className="contents">
                        <dt className="text-[var(--text-secondary)]">{label}</dt>
                        <dd className="text-[var(--text-primary)]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <ul aria-label={t('moduleCatalog.components.legend')} className="flex flex-wrap gap-1.5">
                    {module.components.map(component => (
                      <li key={component} className="rounded-full border border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{t(`moduleCatalog.components.${component}`)}</li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
    </Modal>
  );
}
