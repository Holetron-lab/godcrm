/**
 * Terminal approval fixture — mirrors AIChatPanel, which mounts TerminalPanel
 * twice (ChatInputArea + panel footer) over the same session. Session 1 starts
 * with a pending dangerous command; the fixture API records approve/reject.
 * `?panels=1` mounts a single panel.
 */
import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TerminalPanel } from '@/features/terminal/components/TerminalPanel';
import { apiClient } from '@/shared/utils/apiClient';

const panels = Number(new URLSearchParams(location.search).get('panels') || 2);
const session = { id: 1, title: 'Terminal 1', status: 'active', cwd: '/fixture' };
const command = {
  id: 10, session_id: 1, command: 'sudo nginx -t && sudo systemctl reload nginx', output: null,
  exit_code: null, risk_level: 'dangerous', approval_status: 'pending', approved_by: null,
  source: 'user', agent_name: null, execution_time_ms: null, created_at: new Date().toISOString(), completed_at: null,
};
const calls: string[] = [];
apiClient.request = (async (url: string, options?: RequestInit) => {
  const method = options?.method || 'GET';
  calls.push(`${method} ${url}`);
  document.getElementById('calls')!.textContent = JSON.stringify(calls);
  if (url === '/terminal/sessions' && method === 'GET') return { data: [session] };
  if (url === '/terminal/sessions/1' && method === 'GET') return { data: { ...session, commands: [{ ...command }] } };
  if (url.startsWith('/terminal/sessions/1/commands') && method === 'GET') {
    const after = Number(new URL(url, location.origin).searchParams.get('after') || 0);
    return { data: command.id > after ? [{ ...command }] : [] };
  }
  const decision = url.match(/^\/terminal\/commands\/10\/(approve|reject)$/);
  if (decision && method === 'POST') {
    command.approval_status = decision[1] === 'approve' ? 'approved' : 'rejected';
    return { data: { ...command } };
  }
  throw new Error(`Unexpected fixture API: ${method} ${url}`);
}) as typeof apiClient.request;
apiClient.get = (url, options) => apiClient.request(url, { ...options, method: 'GET' });
apiClient.post = (url, body, options) => apiClient.request(url, { ...options, method: 'POST', body: JSON.stringify(body) });
apiClient.delete = (url, options) => apiClient.request(url, { ...options, method: 'DELETE' });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="p-4 flex flex-col gap-4">
      <output id="calls" aria-label="API calls" className="sr-only">[]</output>
      {Array.from({ length: panels }, (_, i) => (
        <div key={i} style={{ height: 260 }}><TerminalPanel className="h-full" /></div>
      ))}
    </main>
  </QueryClientProvider>,
);
