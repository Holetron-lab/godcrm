import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { clearEmbedAuth, setEmbedAuth } from '@/features/auth/store/authStore';
import type { AuthUser } from '@/features/auth/types/auth.types';
import { getTicketEmbedConfig, isTicketEmbedRequest, type TicketEmbedConfig } from './ticketEmbedConfig';

export { getTicketEmbedConfig, isTicketEmbedRequest };
export type { TicketEmbedConfig };

const EMBED_SPACE_ID = 35;
const REAUTH_TIMEOUT_MS = 10_000;

export interface EmbedTicketSession {
  user: AuthUser;
  spaceId: number;
  expiresIn: number;
}

interface EmbedTicketAuthState {
  status: 'loading' | 'ready' | 'error';
  session: EmbedTicketSession | null;
  error: string | null;
}

interface RedemptionResponse {
  data?: {
    accessToken?: string;
    expiresIn?: number;
    user?: AuthUser;
    space_id?: number;
  };
}

function getParentOrigin(): string | null {
  try {
    const referrer = new URL(document.referrer);
    return referrer.protocol === 'https:' || referrer.protocol === 'http:' ? referrer.origin : null;
  } catch {
    return null;
  }
}

export function useEmbedTicketAuth(config: TicketEmbedConfig | null) {
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<EmbedTicketAuthState>({ status: 'loading', session: null, error: null });
  const clientId = config?.clientId;

  useEffect(() => {
    if (!clientId) {
      setState({ status: 'error', session: null, error: 'Embed client configuration is missing.' });
      return;
    }
    const parentOrigin = getParentOrigin();
    if (!parentOrigin) {
      setState({ status: 'error', session: null, error: 'Embed parent origin is unavailable.' });
      return;
    }

    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let reauthTimer: ReturnType<typeof setTimeout> | undefined;
    let reauthPromise: Promise<string | null> | null = null;
    let resolveReauth: ((token: string | null) => void) | null = null;

    const finishReauth = (token: string | null) => {
      if (reauthTimer) clearTimeout(reauthTimer);
      reauthTimer = undefined;
      resolveReauth?.(token);
      resolveReauth = null;
    };

    const fail = () => {
      if (!active) return;
      apiClient.setAccessToken(null);
      setState({ status: 'error', session: null, error: 'Embed session could not be established. Request a fresh ticket.' });
      finishReauth(null);
    };

    const redeem = async (ticket: string) => {
      const response = await fetch('/api/v3/embed/session', {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ client_id: clientId, ticket, parent_origin: parentOrigin }),
      });
      if (!response.ok) {
        fail();
        return;
      }
      const payload = await response.json() as RedemptionResponse;
      const data = payload.data;
      if (!active) return;
      if (!data?.accessToken || !data.user || data.space_id !== EMBED_SPACE_ID ||
          typeof data.expiresIn !== 'number' || data.expiresIn <= 0) {
        fail();
        return;
      }

      setEmbedAuth(data.accessToken, data.user);
      setState({
        status: 'ready',
        session: { user: data.user, spaceId: EMBED_SPACE_ID, expiresIn: data.expiresIn },
        error: null,
      });
      finishReauth(data.accessToken);
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => { void requestReauth(); }, data.expiresIn * 1000);
    };

    const requestReauth = (): Promise<string | null> => {
      if (reauthPromise) return reauthPromise;
      apiClient.setAccessToken(null);
      reauthPromise = new Promise<string | null>((resolve) => {
        resolveReauth = resolve;
        reauthTimer = setTimeout(fail, REAUTH_TIMEOUT_MS);
      });
      window.parent.postMessage({ type: 'godcrm-embed:reauth', version: 1, client_id: clientId }, parentOrigin);
      return reauthPromise.finally(() => { reauthPromise = null; });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.version !== 1) return;
      if (data.type === 'godcrm-embed:bootstrap-error') {
        fail();
        return;
      }
      if (data.type === 'godcrm-embed:bootstrap' && typeof data.ticket === 'string' && data.ticket) {
        void redeem(data.ticket).catch(fail);
      }
    };

    window.addEventListener('message', onMessage);
    apiClient.setAccessToken(null);
    apiClient.setEmbedReauthHandler(requestReauth);
    setState({ status: 'loading', session: null, error: null });
    window.parent.postMessage({ type: 'godcrm-embed:ready', version: 1, client_id: clientId }, parentOrigin);

    return () => {
      active = false;
      if (expiryTimer) clearTimeout(expiryTimer);
      if (reauthTimer) clearTimeout(reauthTimer);
      finishReauth(null);
      window.removeEventListener('message', onMessage);
      apiClient.setEmbedReauthHandler(null);
      clearEmbedAuth();
    };
  }, [clientId, retryCount]);

  return {
    ...state,
    retry: () => {
      setState({ status: 'loading', session: null, error: null });
      setRetryCount((count) => count + 1);
    },
  };
}
