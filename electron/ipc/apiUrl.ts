import { ipcMain, app, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { bindUploadsAuth, unbindUploadsAuth } from './auth';

const DEFAULT_API_URL = 'https://crm.hltrn.cc/api/v3';
const SETTINGS_FILE = 'settings.json';

export async function getCurrentApiUrl(): Promise<string> {
  const s = await readSettings();
  return s.apiUrl ?? DEFAULT_API_URL;
}

interface Settings {
  apiUrl?: string;
}

async function readSettings(): Promise<Settings> {
  const file = path.join(app.getPath('userData'), SETTINGS_FILE);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const file = path.join(app.getPath('userData'), SETTINGS_FILE);
  const current = await readSettings();
  const next = { ...current, ...patch };
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf-8');
}

export function registerApiUrlHandlers(): void {
  ipcMain.handle('apiUrl:get', async () => {
    const s = await readSettings();
    return s.apiUrl ?? DEFAULT_API_URL;
  });

  ipcMain.handle('apiUrl:set', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return false;
    }
    await writeSettings({ apiUrl: url });
    unbindUploadsAuth();
    bindUploadsAuth(url);
    return true;
  });

  ipcMain.handle('apiUrl:test', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { success: false, error: 'Invalid URL' };
    }
    return new Promise<{ success: boolean; data?: unknown; error?: string }>((resolve) => {
      try {
        const origin = url.replace(/\/$/, '').replace(/\/api\/v3$/i, '');
        const probeUrl = origin + '/api/health';
        const request = net.request({ method: 'GET', url: probeUrl });
        request.on('response', (response) => {
          const ok = response.statusCode >= 200 && response.statusCode < 400;
          let body = '';
          response.on('data', (chunk) => {
            body += chunk.toString();
          });
          response.on('end', () => {
            resolve(
              ok
                ? { success: true, data: body.slice(0, 512) }
                : { success: false, error: `HTTP ${response.statusCode}` }
            );
          });
        });
        request.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
        request.end();
      } catch (err) {
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
}
