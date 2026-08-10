interface ConsolePanelProps {
  errors: string[];
  warnings?: string[];
  logs?: string[];
}

export function ConsolePanel({ errors, warnings = [], logs = [] }: ConsolePanelProps) {
  const hasMessages = errors.length > 0 || warnings.length > 0 || logs.length > 0;

  if (!hasMessages) {
    return (
      <div className="h-32 border-t bg-gray-900 text-white p-4 font-mono text-sm">
        <div className="text-gray-500">Console (no messages)</div>
      </div>
    );
  }

  return (
    <div className="h-32 border-t bg-gray-900 text-white p-4 font-mono text-sm overflow-y-auto">
      <div className="space-y-1">
        {errors.map((error, i) => (
          <div key={`error-${i}`} className="text-red-400">
            ❌ {error}
          </div>
        ))}
        {warnings.map((warning, i) => (
          <div key={`warning-${i}`} className="text-yellow-400">
            ⚠️ {warning}
          </div>
        ))}
        {logs.map((log, i) => (
          <div key={`log-${i}`} className="text-gray-300">
            ℹ️ {log}
          </div>
        ))}
      </div>
    </div>
  );
}
