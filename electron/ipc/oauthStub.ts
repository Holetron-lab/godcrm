import { ipcMain } from 'electron';

// Google OAuth via loopback — STUB in v1.
// Real impl (system-browser loopback flow + token exchange) is out of scope for ADR-0023 Phase 2.
// Returning a structured failure lets LoginForm.tsx render the fallback web-OAuth path without crashing.
export function registerOAuthStub(): void {
  ipcMain.handle('oauth:google:open', async () => ({
    success: false,
    error: 'Google OAuth not implemented in desktop v1 — use web login flow',
  }));
}
