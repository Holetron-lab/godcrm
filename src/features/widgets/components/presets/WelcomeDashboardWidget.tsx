import { useMemo } from 'react';
import { Sparkles, ShoppingBag, Settings as SettingsIcon } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';
import { useAuthStore } from '@/features/auth/store/authStore';
import copy from '../../../../../shared/starter-pack-copy.json';

interface StarterTablesMap {
  [slug: string]: number;
}

interface WelcomeConfig {
  starter_tables_map?: StarterTablesMap;
}

function deriveFirstName(fullName: string | undefined | null): string {
  if (!fullName) return 'друг';
  const first = fullName.trim().split(/\s+/)[0];
  return first || 'друг';
}

export function WelcomeDashboardWidget({ widget }: PresetWidgetProps) {
  const user = useAuthStore((s) => s.user);
  const firstName = useMemo(() => deriveFirstName(user?.name), [user?.name]);

  const cfg = (widget.config ?? {}) as WelcomeConfig;
  const tablesMap = cfg.starter_tables_map ?? {};

  const heroTitle = copy.hero.greeting.replace('{{name}}', firstName);
  const torChatHref = `/chat?agent=${copy.hero.cta_agent_slug}`;
  const tip = copy.tip_ribbon;

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto bg-gradient-to-b from-amber-50/40 to-white">
      {/* Hero */}
      <section className="text-center max-w-2xl mx-auto pt-4">
        <h1 className="text-3xl font-semibold text-gray-900 mb-3">{heroTitle}</h1>
        <p className="text-base text-gray-600 mb-6 leading-relaxed">{copy.hero.subtitle}</p>
        <a
          href={torChatHref}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium text-sm transition-colors shadow-sm"
        >
          {copy.hero.cta_label}
        </a>
      </section>

      {/* 3 Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full mx-auto">
        {copy.cards.map((card) => {
          const tableSlug = 'table_slug' in card ? card.table_slug : undefined;
          const agentSlug = 'agent_slug' in card ? card.agent_slug : undefined;
          const tableId = tableSlug ? tablesMap[tableSlug] : undefined;
          const href = agentSlug
            ? `/chat?agent=${agentSlug}`
            : tableId
              ? `/tables/${tableId}?action=new`
              : undefined;

          const disabled = !href;

          return (
            <article
              key={card.key}
              className={`flex flex-col p-5 rounded-xl border bg-white transition-shadow ${
                disabled
                  ? 'border-gray-200 opacity-60'
                  : 'border-gray-200 hover:shadow-md hover:border-amber-200'
              }`}
            >
              <div className="text-3xl mb-3">{card.icon}</div>
              <h3 className="text-base font-semibold text-gray-900 mb-1.5">{card.title}</h3>
              <p className="text-sm text-gray-600 mb-4 flex-1 leading-relaxed">{card.body}</p>
              {href ? (
                <a
                  href={href}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium transition-colors"
                >
                  {card.cta}
                </a>
              ) : (
                <span
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium cursor-not-allowed"
                  title="Стартовые таблицы ещё инициализируются"
                >
                  {card.cta}
                </span>
              )}
            </article>
          );
        })}
      </section>

      {/* Tip Ribbon */}
      <section className="max-w-4xl w-full mx-auto mt-2">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50/70 border border-amber-100">
          <Sparkles className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-gray-700 leading-relaxed">
            <span>{tip.lead}</span>
            <a
              href={tip.settings_anchor}
              className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-800 underline-offset-2 hover:underline"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              {tip.settings_label}
            </a>
            <span>{tip.mid}</span>
            {tip.marketplace_enabled ? (
              <a
                href={tip.marketplace_anchor}
                className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-800 underline-offset-2 hover:underline"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                {tip.marketplace_label}
              </a>
            ) : (
              <span
                className="inline-flex items-center gap-1 font-medium text-amber-700/60 cursor-help"
                title={tip.marketplace_tooltip}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                {tip.marketplace_label} ({tip.marketplace_tooltip.toLowerCase()})
              </span>
            )}
            <span>{tip.trail}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
