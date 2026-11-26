// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const loaderSource = readFileSync(new URL('../../../../public/embed.js', import.meta.url), 'utf8');
const crmOrigin = 'https://app.godcrm.ai';
const parentOrigin = 'https://admin.sixtynine.ru';
const openWindows = [];

function loadEmbed(attributes = {}) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="csrf-token" content="level-csrf-token"></head><body></body></html>', {
    url: `${parentOrigin}/admin`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  openWindows.push(dom);
  const { window } = dom;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  const script = window.document.createElement('script');
  script.src = `${crmOrigin}/embed.js`;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  Object.defineProperty(window.document, 'currentScript', { configurable: true, get: () => script });
  window.eval(loaderSource);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const frame = window.document.querySelector('iframe');
  if (!frame) throw new Error('Embed iframe was not created');
  return { dom, window, frame };
}

function sendFrameMessage(window, frame, data, options = {}) {
  window.dispatchEvent(new window.MessageEvent('message', {
    origin: options.origin ?? crmOrigin,
    source: options.source === undefined ? frame.contentWindow : options.source,
    data,
  }));
}

afterEach(() => {
  while (openWindows.length) openWindows.pop()?.window.close();
  vi.restoreAllMocks();
});

describe('ADR-210 embed loader ticket contract', () => {
  it('runs ready/bootstrap/reauth with exact origin and source without exposing tickets', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ticket: 'first-ticket', expires_in: 60 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ticket: 'fresh-ticket', expires_in: 60 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const { window, frame } = loadEmbed({
      'data-auth': 'ticket',
      'data-client-id': 'level',
      'data-ticket-url': '/api/embed/godcrm/ticket',
      'data-space': '11',
    });
    Object.defineProperty(window, 'fetch', { configurable: true, value: fetchMock });
    const postMessage = vi.spyOn(frame.contentWindow, 'postMessage');

    expect(frame.src).toBe(`${crmOrigin}/embed/chat?mode=overlay&auth=ticket&client_id=level`);
    sendFrameMessage(window, frame, { type: 'godcrm-embed:ready', version: 1, client_id: 'level' }, {
      origin: 'https://evil.example',
    });
    sendFrameMessage(window, frame, { type: 'godcrm-embed:ready', version: 1, client_id: 'level' }, {
      source: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    sendFrameMessage(window, frame, { type: 'godcrm-embed:ready', version: 1, client_id: 'level' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`${parentOrigin}/api/embed/godcrm/ticket`, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': 'level-csrf-token' },
    }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      type: 'godcrm-embed:bootstrap', version: 1, ticket: 'first-ticket',
    }, crmOrigin));
    expect(postMessage.mock.calls.every(([, targetOrigin]) => targetOrigin === crmOrigin)).toBe(true);

    sendFrameMessage(window, frame, { type: 'godcrm-embed:reauth', version: 1, client_id: 'level' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(postMessage).toHaveBeenLastCalledWith({
      type: 'godcrm-embed:bootstrap', version: 1, ticket: 'fresh-ticket',
    }, crmOrigin));
    expect(frame.src).not.toContain('first-ticket');
    expect(frame.src).not.toContain('fresh-ticket');
    expect(frame.src).not.toContain('space=');
    expect(JSON.stringify(window.localStorage)).not.toContain('first-ticket');
    expect(JSON.stringify(window.localStorage)).not.toContain('fresh-ticket');
  });

  it('switches ticket embed presentation without navigating the Level host', () => {
    const { window, frame } = loadEmbed({
      'data-auth': 'ticket',
      'data-client-id': 'level',
      'data-ticket-url': '/api/embed/godcrm/ticket',
    });
    const hostUrl = window.location.href;
    const tab = window.document.querySelector('button');
    if (!tab) throw new Error('Embed tab was not created');
    tab.click();

    sendFrameMessage(window, frame, { type: 'godcrm-embed:mode', mode: 'split' });
    expect(window.location.href).toBe(hostUrl);
    expect(frame.src).toBe(`${crmOrigin}/embed/chat?mode=split&auth=ticket&client_id=level`);
    expect(window.document.documentElement.style.marginRight).toBe('400px');

    sendFrameMessage(window, frame, { type: 'godcrm-embed:mode', mode: 'overlay' });
    expect(window.location.href).toBe(hostUrl);
    expect(frame.src).toBe(`${crmOrigin}/embed/chat?mode=overlay&auth=ticket&client_id=level`);
    expect(window.document.documentElement.style.marginRight).toBe('');
    expect(frame.src).not.toContain('space=');
  });

  it('keeps the existing cookie embed and non-sensitive close message compatible', () => {
    const { window, frame } = loadEmbed({ 'data-space': '11' });
    const fetchMock = vi.fn();
    Object.defineProperty(window, 'fetch', { configurable: true, value: fetchMock });
    const tab = window.document.querySelector('button');
    if (!tab) throw new Error('Embed tab was not created');

    expect(frame.src).toBe(`${crmOrigin}/embed/chat?space=11&mode=overlay`);
    tab.click();
    expect(frame.style.display).toBe('block');
    sendFrameMessage(window, frame, { type: 'godcrm-embed:close' });
    expect(frame.style.display).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
