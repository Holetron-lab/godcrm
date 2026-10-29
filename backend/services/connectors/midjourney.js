import { z } from 'zod';
import { remoteMcpSchema, remoteMcpFetch } from './remoteMcp.js';

// Reuse the public HTTPS transport: DNS checked at socket creation, no
// redirects/proxies, bounded response size. Discord credentials stay in relay.
export const midjourneySettings = z.object({
  url: remoteMcpSchema.shape.url,
  access_token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/),
}).strict();

export async function requestMidjourney(settings, path, schema, body) {
  const { url, access_token } = midjourneySettings.parse(settings);
  const response = await remoteMcpFetch(`${url.replace(/\/+$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'mj-api-secret': access_token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Midjourney relay request failed');
  }
  return schema.parse(await response.json());
}
