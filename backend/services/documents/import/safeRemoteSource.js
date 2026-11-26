import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { SOURCE_LIMIT } from './sourceValidation.js';

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20], ['5f00::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(address, prefix, 'ipv6');

export function assertPublicAddress(address) {
  const family = net.isIP(address);
  if (!family || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')) throw new Error('DOCUMENT_URL_ADDRESS_DENIED');
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    assertPublicAddress(address.slice(7));
  }
  return address;
}

async function resolvePublicAddress(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => {
    try { assertPublicAddress(address); return false; } catch { return true; }
  })) throw new Error('DOCUMENT_URL_ADDRESS_DENIED');
  return addresses[0];
}

function parseRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DOCUMENT_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('DOCUMENT_URL_INVALID');
  return url;
}

async function requestOnce(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const selected = await resolvePublicAddress(hostname);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: hostname,
      headers: { Accept: 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,*/*;q=0.1', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address: selected.address, family: selected.family }])
        : callback(null, selected.address, selected.family),
    }, resolve);
    request.once('error', reject);
    signal.addEventListener('abort', () => request.destroy(new Error('DOCUMENT_URL_TIMEOUT')), { once: true });
    request.end();
  });
}

export async function fetchRemoteDocument(sourceUrl, { timeoutMs = 20_000, maxRedirects = 3 } = {}) {
  let url = parseRemoteUrl(sourceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
      const response = await requestOnce(url, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirect === maxRedirects) throw new Error('DOCUMENT_URL_REDIRECT_LIMIT');
        url = parseRemoteUrl(new URL(response.headers.location, url).toString());
        continue;
      }
      if (response.statusCode !== 200) {
        response.resume();
        throw new Error('DOCUMENT_URL_FETCH_FAILED');
      }
      const declared = Number(response.headers['content-length']);
      if (declared > SOURCE_LIMIT) {
        response.destroy();
        throw new Error('DOCUMENT_SOURCE_SIZE_LIMIT');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > SOURCE_LIMIT) {
          response.destroy();
          throw new Error('DOCUMENT_SOURCE_SIZE_LIMIT');
        }
        chunks.push(chunk);
      }
      if (!size) throw new Error('DOCUMENT_SOURCE_EMPTY');
      return { bytes: Buffer.concat(chunks, size), name: path.basename(url.pathname) || 'document', contentType: response.headers['content-type']?.split(';')[0] || null };
    }
    throw new Error('DOCUMENT_URL_REDIRECT_LIMIT');
  } catch (error) {
    if (error.message?.startsWith('DOCUMENT_')) throw error;
    if (controller.signal.aborted) throw new Error('DOCUMENT_URL_TIMEOUT');
    throw new Error('DOCUMENT_URL_FETCH_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
