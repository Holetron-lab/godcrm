import { useState } from 'react';
import {
  ChevronRight, ChevronDown, Zap,
} from 'lucide-react';
import type { ColumnTypeDetails } from './types';

export function FeatureCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
  };

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

export function QuickStartStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-500 text-white font-semibold flex items-center justify-center">
        {number}
      </span>
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </li>
  );
}

export function ExampleCard({ emoji, title, items }: { emoji: string; title: string; items: string[] }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{emoji}</span>
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
      </div>
      <ul className="text-sm text-[var(--text-secondary)] space-y-1">
        {items.map((item, i) => (
          <li key={i}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ActionCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-start gap-3">
      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
        {icon}
      </div>
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

export function ViewTypeCard({ icon, title, description, color, useCases }: { icon: React.ReactNode; title: string; description: string; color: string; useCases: string[] }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
    pink: 'bg-pink-500/10 text-pink-500',
    green: 'bg-green-500/10 text-green-500',
    indigo: 'bg-indigo-500/10 text-indigo-500',
  };

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-2">{description}</p>
          <div className="flex flex-wrap gap-2">
            {useCases.map((useCase, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                {useCase}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColumnTypeAccordion({
  type,
  name,
  description,
  details
}: {
  type: string;
  name: string;
  description: string;
  details: ColumnTypeDetails;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <code className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] rounded text-primary-400 w-28 text-center flex-shrink-0">
          {type}
        </code>
        <div className="flex-1 text-left">
          <span className="font-medium text-[var(--text-primary)]">{name}</span>
          <span className="text-[var(--text-tertiary)] mx-2">—</span>
          <span className="text-sm text-[var(--text-secondary)]">{description}</span>
        </div>
        <ChevronDown className={`w-5 h-5 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
          <div className="grid grid-cols-2 gap-4 mt-4">
            {/* Features */}
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">✨ Возможности</h4>
              <ul className="space-y-1">
                {details.features.map((feature, i) => (
                  <li key={i} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">•</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {/* Settings */}
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">⚙️ Настройки</h4>
              <div className="space-y-1">
                {details.settings.map((setting, i) => (
                  <div key={i} className="text-xs">
                    <code className="text-violet-400 bg-violet-500/10 px-1 rounded">{setting.name}</code>
                    <span className="text-[var(--text-tertiary)]"> — {setting.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Example */}
          <div className="mt-4 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
            <span className="text-xs text-[var(--text-tertiary)]">Пример: </span>
            <code className="text-xs text-emerald-400">{details.example}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export function ColumnTypeRow({ type, name, description }: { type: string; name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] rounded text-primary-400 w-24 text-center">
        {type}
      </code>
      <div className="flex-1">
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        <span className="text-[var(--text-tertiary)] mx-2">—</span>
        <span className="text-sm text-[var(--text-secondary)]">{description}</span>
      </div>
    </div>
  );
}

export function SettingCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <h4 className="font-medium text-[var(--text-primary)] text-sm">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

export function FilterTypeCard({ title, description, example }: { title: string; description: string; example: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] mb-2">{description}</p>
      <code className="block px-3 py-2 text-xs bg-[var(--bg-tertiary)] rounded-lg text-emerald-400">
        {example}
      </code>
    </div>
  );
}

export function WidgetCard({ icon, name, color }: { icon: React.ReactNode; name: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500',
    cyan: 'bg-cyan-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    pink: 'bg-pink-500',
    green: 'bg-green-500',
  };

  return (
    <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${colorClasses[color]} flex items-center justify-center text-white`}>
        {icon}
      </div>
      <span className="font-medium text-[var(--text-primary)]">{name}</span>
    </div>
  );
}

export function TriggerCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0" />
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

export function ActionTypeCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <ChevronRight className="w-5 h-5 text-primary-500 flex-shrink-0" />
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

export function AutomationExample({ trigger, action }: { trigger: string; action: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 text-sm">
        <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500">КОГДА</span>
        <span className="text-[var(--text-primary)]">{trigger}</span>
      </div>
      <div className="flex items-center gap-2 text-sm mt-2">
        <span className="px-2 py-1 rounded bg-primary-500/10 text-primary-500">ТОГДА</span>
        <span className="text-[var(--text-primary)]">{action}</span>
      </div>
    </div>
  );
}

export function ApiEndpoint({
  method,
  path,
  description,
  body,
  query
}: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  body?: object;
  query?: string;
}) {
  const methodColors = {
    GET: 'bg-emerald-500/10 text-emerald-500',
    POST: 'bg-primary-500/10 text-primary-500',
    PATCH: 'bg-yellow-500/10 text-yellow-500',
    DELETE: 'bg-red-500/10 text-red-500',
  };

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3 mb-2">
        <span className={`px-2 py-1 rounded text-xs font-mono font-medium ${methodColors[method]}`}>
          {method}
        </span>
        <code className="text-[var(--text-primary)] font-mono text-sm">{path}</code>
        {query && <code className="text-[var(--text-secondary)] font-mono text-xs">{query}</code>}
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      {body && (
        <pre className="mt-2 p-2 rounded bg-[var(--bg-primary)] text-xs text-[var(--text-secondary)] overflow-x-auto">
          {JSON.stringify(body, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-[var(--border-primary)]">
      <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
      </div>
      <pre className="p-4 bg-[var(--bg-primary)] text-sm text-[var(--text-secondary)] overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ToolRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-violet-500/20 rounded text-violet-400 font-mono">
        {name}
      </code>
      <span className="text-sm text-[var(--text-secondary)]">{description}</span>
    </div>
  );
}
