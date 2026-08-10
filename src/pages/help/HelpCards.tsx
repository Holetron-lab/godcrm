import { Zap, ChevronRight } from 'lucide-react';

export function FeatureCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center mb-3`}>{icon}</div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

export function QuickStartStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-500 text-white font-semibold flex items-center justify-center">{number}</span>
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
        {items.map((item, i) => <li key={i}>• {item}</li>)}
      </ul>
    </div>
  );
}

export function ActionCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-start gap-3">
      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{icon}</div>
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

export function ViewTypeCard({ icon, title, description, color, useCases }: { icon: React.ReactNode; title: string; description: string; color: string; useCases: string[] }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500', cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500', amber: 'bg-amber-500/10 text-amber-500',
    pink: 'bg-pink-500/10 text-pink-500', green: 'bg-green-500/10 text-green-500',
    indigo: 'bg-indigo-500/10 text-indigo-500',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center flex-shrink-0`}>{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-2">{description}</p>
          <div className="flex flex-wrap gap-2">
            {useCases.map((useCase, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">{useCase}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColumnTypeRow({ type, name, description }: { type: string; name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] rounded text-primary-400 w-24 text-center">{type}</code>
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
      <code className="block px-3 py-2 text-xs bg-[var(--bg-tertiary)] rounded-lg text-emerald-400">{example}</code>
    </div>
  );
}

export function WidgetCard({ icon, name, color }: { icon: React.ReactNode; name: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500', cyan: 'bg-cyan-500', emerald: 'bg-emerald-500',
    amber: 'bg-amber-500', pink: 'bg-pink-500', green: 'bg-green-500',
  };
  return (
    <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${colorClasses[color]} flex items-center justify-center text-white`}>{icon}</div>
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
        <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500">WHEN</span>
        <span className="text-[var(--text-primary)]">{trigger}</span>
      </div>
      <div className="flex items-center gap-2 text-sm mt-2">
        <span className="px-2 py-1 rounded bg-primary-500/10 text-primary-500">THEN</span>
        <span className="text-[var(--text-primary)]">{action}</span>
      </div>
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="px-4 py-3 bg-[var(--bg-tertiary)] rounded-lg overflow-x-auto">
      <code className="text-sm text-emerald-400 whitespace-pre">{code}</code>
    </pre>
  );
}

export function ApiEndpoint({ method, path, description, body, response }: { method: string; path: string; description: string; body?: string; response?: string }) {
  const methodColors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400',
    POST: 'bg-primary-500/20 text-primary-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    PATCH: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3 mb-2">
        <span className={`px-2 py-1 rounded text-xs font-mono font-semibold ${methodColors[method]}`}>{method}</span>
        <code className="text-sm text-[var(--text-primary)]">{path}</code>
      </div>
      <p className="text-sm text-[var(--text-secondary)] mb-3">{description}</p>
      {body && (
        <div className="mb-3">
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Request Body:</p>
          <CodeBlock code={body} />
        </div>
      )}
      {response && (
        <div>
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Response:</p>
          <CodeBlock code={response} />
        </div>
      )}
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
