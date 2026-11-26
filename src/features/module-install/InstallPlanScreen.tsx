// ADR-207 §2.5–2.6 — the install screen: the plan state of `useInstallPlan` on screen. InstallPlanScreen
// owns the state itself; InstallPlanView draws a state another component owns (the module page, whose
// Install button runs the same install).
import { useId } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { exampleTables, setExamples } from './bindings';
import { InstallPlanTree } from './InstallPlanTree';
import type { InstallPlan } from './types';
import { useInstallPlan, type InstallPlanState, type UseInstallPlanOptions } from './useInstallPlan';

export interface InstallPlanViewProps {
  state: InstallPlanState;
  /** Dashboards a tile can be moved to, besides the module's own. */
  dashboards?: { id: number; name: string }[];
  /** Off when whoever shows the plan runs the install from a button of its own (the module page). */
  withInstall?: boolean;
}

export interface InstallPlanScreenProps extends UseInstallPlanOptions {
  dashboards?: InstallPlanViewProps['dashboards'];
}

const NO_DASHBOARDS: { id: number; name: string }[] = [];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One switch for every example table (owner, chat 3813, 13.11.2026): off by default, on when the user wants the module filled in. */
function ExamplesSwitch({ state, plan }: { state: InstallPlanState; plan: InstallPlan }) {
  const { t } = useLanguage();
  const id = useId();
  const { blueprint } = state;
  const tables = exampleTables(blueprint);
  if (tables.length === 0) return null;
  const declared = [...(blueprint.tables ?? []), ...(blueprint.requires?.tables ?? [])];
  const name = (key: string) => declared.find((table) => table.key === key)?.display_name || plan.tables.find((table) => table.key === key)?.name || key;
  const rows = (blueprint.seed ?? []).filter((group) => group.example).reduce((count, group) => count + (group.rows?.length ?? 0), 0);
  const on = tables.every((key) => state.bindings.tables?.[key]?.seed === true);
  return (
    <div className="border-b border-[var(--border-primary)] p-3 text-sm text-[var(--text-primary)]">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={on}
          aria-describedby={`${id}-note`}
          onChange={(event) => state.setBindings(setExamples(state.bindings, blueprint, plan, event.target.checked))}
        />
        <span>
          {t('moduleInstall.examples.label')}
          <span id={`${id}-note`} className="block text-xs text-[var(--text-secondary)]">
            {t('moduleInstall.examples.note', { count: rows, tables: tables.map(name).join(', ') })}
          </span>
        </span>
      </label>
    </div>
  );
}

export function InstallPlanView({ state, dashboards = NO_DASHBOARDS, withInstall = true }: InstallPlanViewProps) {
  const { t } = useLanguage();
  const { blueprint, role, adminOnly, plan, tree } = state;

  if (state.loading) return <p role="status" className="p-4 text-sm text-[var(--text-secondary)]">{t('moduleInstall.loading')}</p>;

  if (!state.allowed) {
    return (
      <div className="space-y-3 p-4 text-sm text-[var(--text-primary)]">
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {role === 'viewer' ? t('moduleInstall.locked.viewer') : t('moduleInstall.locked.admin')}
        </p>
        {role !== 'viewer' && (
          <ul aria-label={t('moduleInstall.locked.branches')} className="space-y-1 pl-6 text-[var(--text-secondary)]">
            {adminOnly.map((section) => (
              <li key={section}>
                {t(`moduleInstall.section.${section}`)}: {(blueprint[section] ?? []).map((entry) => ('title' in entry && entry.title) || entry.key).join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!plan || !tree) {
    if (!state.error) return <p role="status" className="p-4 text-sm text-[var(--text-secondary)]">{t('moduleInstall.loading')}</p>;
    return (
      <div role="alert" className="space-y-3 p-4 text-sm text-[var(--text-primary)]">
        <p>{t('moduleInstall.planFailed')}: {message(state.error)}</p>
        <Button variant="secondary" size="sm" onClick={state.retry}>{t('moduleInstall.retry')}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {state.failure && <p role="alert" className="border-b border-[var(--border-primary)] p-3 text-sm text-red-700 dark:text-red-400">{state.failure}</p>}
      {state.linked && <p className="border-b border-[var(--border-primary)] p-3 text-sm text-[var(--text-primary)]">{state.linked}</p>}
      <ExamplesSwitch state={state} plan={plan} />
      <InstallPlanTree
        blueprint={blueprint}
        tree={tree}
        plan={plan}
        bindings={state.bindings}
        onBindingsChange={state.setBindings}
        targetColumns={state.targetColumns}
        dashboards={dashboards}
        busy={state.busy}
        installing={state.installing}
        onInstall={withInstall ? state.install : undefined}
      />
    </div>
  );
}

/** The plan as a screen of its own: it scrolls itself, since the view takes the height of the tree. */
export function InstallPlanScreen({ dashboards, ...options }: InstallPlanScreenProps) {
  return <div className="h-full overflow-y-auto"><InstallPlanView state={useInstallPlan(options)} dashboards={dashboards} /></div>;
}
