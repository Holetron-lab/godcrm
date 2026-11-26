export interface TicketEmbedConfig {
  clientId: string;
}

export function isTicketEmbedRequest(pathname?: string, search?: string): boolean {
  if (typeof window === 'undefined' && (pathname === undefined || search === undefined)) return false;
  const params = new URLSearchParams(search ?? window.location.search);
  return (pathname ?? window.location.pathname) === '/embed/chat' && params.get('auth') === 'ticket';
}

export function getTicketEmbedConfig(search?: string, pathname?: string): TicketEmbedConfig | null {
  if (!isTicketEmbedRequest(pathname, search)) return null;
  const clientId = new URLSearchParams(search ?? window.location.search).get('client_id');
  return clientId ? { clientId } : null;
}
