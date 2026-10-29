import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext/AIChatProvider';
import { MailPage } from '@/features/mail/MailPage';
import { mailApi } from '@/features/mail/api/mailApi';
import { MailComposer } from '@/features/mail/components/MailComposer';
import { MailReplyBar } from '@/features/mail/components/MailReplyBar';
import { MailLinkPopover } from '@/features/mail/components/MailLinkPopover';
import { RecipientInput } from '@/features/mail/components/RecipientInput';
import type { MailMessage } from '@/features/mail/types';

localStorage.setItem('god-crm-language', 'ru');
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const kind = params.get('kind') || 'composer';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const message: MailMessage = {
  id: 'fixture', folder: 'inbox', fromName: 'Sender', fromAddress: 'sender@example.test',
  to: ['reader@example.test'], subject: 'Test', body: '<p>Hello</p>'.repeat(20), preview: 'Hello', date: '2026-09-25', read: true,
};
client.setQueryData(['mail', 'people-tables', 11], {
  tables: [{ id: 1, key: 'people', display_name: 'People' }], default_table_id: 1,
});
client.setQueryData(['mail', 'people-columns', 1], [{ name: 'email', displayName: 'Email' }]);
client.setQueryData(['mail', 'people-rows', 1, 'email', 'sender@example.test'], []);
const pagination = kind === 'pagination';
const messages = pagination ? Array.from({ length: 73 }, (_, n) => ({
  ...message, id: `fixture-${n}`, subject: `Message ${n + 1}`,
  date: new Date(Date.UTC(2026, 0, 1, 0, -n)).toISOString(),
})) : [message];
let failNextPage = pagination;
mailApi.messages = async (_space, _folder, _connector, offset = 0) => {
  if (failNextPage) { failNextPage = false; throw new Error('Fixture page failure'); }
  return messages.slice(offset, offset + 50);
};
for (const connector of [null, 1]) {
  client.setQueryData(['mail', 'messages', undefined, 'pages', ['inbox'], connector], {
    pages: [{ messages: messages.slice(0, 50), next: pagination ? [{ folder: 'inbox', offset: 50 }] : [] }],
    pageParams: [[{ folder: 'inbox', offset: 0 }]],
  });
}
client.setQueryData(['connectors', 'compatible', undefined, 'mail'], [{
  id: 1, account_name: 'Test mailbox', email: 'reader@example.test', status: 'active',
}]);

function Fixture() {
  const [body, setBody] = useState('<p>Hello</p>');
  const [to, setTo] = useState(['first@example.test']);
  const [sent, setSent] = useState(0);
  return <main className="h-dvh p-2 md:p-4">
    {(kind === 'page' || pagination) && <MailPage />}
    {kind === 'reply' && <MailReplyBar mode="new" spaceId={undefined} connectorId={1} />}
    {kind === 'picker' && <MailLinkPopover spaceId={11} message={message}
      trigger={<button type="button">Привязать письмо</button>} />}
    {kind === 'composer' && <>
      <MailComposer value={body} onChange={setBody} onSend={() => setSent(n => n + 1)}
        header={<RecipientInput value={to} onChange={setTo} ariaLabel="Кому" />} />
      <output aria-label="Отправлено">{sent}</output>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><QueryClientProvider client={client}><MemoryRouter><AIChatStubProvider><Fixture /></AIChatStubProvider></MemoryRouter></QueryClientProvider></LanguageProvider>
);
