import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TerminalPanel } from '@/features/terminal/components/TerminalPanel';
import { CommandApprovalDialog } from '@/features/terminal/components/CommandApprovalDialog';
import { apiClient } from '@/shared/utils/apiClient';

let sessions = [1, 2, 3].map(id => ({ id, title: `Terminal ${id}`, status: 'active', cwd: '/fixture' }));
const calls: string[] = [];
apiClient.request = (async (url: string, options?: RequestInit) => {
  const method = options?.method || 'GET';
  calls.push(`${method} ${url}`);
  document.getElementById('calls')!.textContent = JSON.stringify(calls);
  if (url === '/terminal/sessions' && method === 'GET') return { data: sessions };
  const match = url.match(/^\/terminal\/sessions\/(\d+)(.*)$/);
  if (match) {
    const id = Number(match[1]);
    if (method === 'DELETE' && !match[2]) { sessions = sessions.filter(s => s.id !== id); return {}; }
    if (method === 'GET' && !match[2]) return { data: { ...sessions.find(s => s.id === id), commands: [] } };
    if (method === 'GET' && match[2].startsWith('/commands')) return { data: [] };
    if (method === 'POST' && match[2] === '/execute') {
      document.getElementById('submitted')!.textContent = String(options?.body);
      return { data: { needsApproval: false } };
    }
  }
  throw new Error(`Unexpected fixture API: ${method} ${url}`);
}) as typeof apiClient.request;
apiClient.get = (url, options) => apiClient.request(url, { ...options, method: 'GET' });
apiClient.post = (url, body, options) => apiClient.request(url, { ...options, method: 'POST', body: JSON.stringify(body) });
apiClient.delete = (url, options) => apiClient.request(url, { ...options, method: 'DELETE' });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Fixture() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const finish = (action: string) => { setResult(action); setOpen(false); };
  return <main className="p-4">
    <button type="button" onClick={() => { setBusy(false); setResult(''); setOpen(true); }}>Open approval</button>
    <button type="button" onClick={() => { setBusy(true); setResult(''); setOpen(true); }}>Open busy approval</button>
    <output aria-label="Approval result">{result}</output>
    <output id="calls" aria-label="API calls" className="sr-only">[]</output>
    <output id="submitted" aria-label="Submitted command" className="sr-only" />
    <TerminalPanel />
    <CommandApprovalDialog isOpen={open} command={'echo "<fixture>"'} riskLevel="dangerous"
      issuerLabel="Fixture agent" issuerIsAgent onApprove={() => finish('approve')}
      onReject={() => finish('reject')} onAlwaysAllow={() => finish('allow')}
      isPolicyWriting={busy} policyError={busy ? 'Fixture policy error' : null} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
