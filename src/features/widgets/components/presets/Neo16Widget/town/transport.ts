import { call } from '../learning/transport';
import type { WorldTransport, WorldView } from './types';

export const worldTransport: WorldTransport = {
  enter: async (widgetId) => (await call<WorldView>('POST', '/worlds', { data: { widget_id: widgetId } })).body,
  read: async (id, widgetId) => (await call<WorldView>('GET', `/worlds/${id}?widget_id=${widgetId}`)).body,
  command: async (id, envelope) =>
    (await call<Awaited<ReturnType<WorldTransport['command']>>>('POST', `/worlds/${id}/commands`, { data: envelope })).body,
};
