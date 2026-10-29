// godcrm.ai serves only the public marketing surface; everything else lives on app.godcrm.ai.
// This util is the single source of truth for the bounce rule — used by main.tsx (initial page load)
// and by the router subscriber (in-app SPA navigations).

export const MARKETING_HOSTS = ['godcrm.ai', 'www.godcrm.ai'];
export const APP_HOST = 'app.godcrm.ai';
export const MARKETING_PATHS = ['/welcome', '/hltrn', '/palevo', '/vspomnil', '/s', '/invitations', '/reset-password'];

// hltrn.cc / www.hltrn.cc apex serves the Holetron UMBRELLA landing (HoletronLanding),
// NOT the app and NOT the godcrm.ai product landing. crm.hltrn.cc stays the app host —
// only the bare apex hosts below flip to the umbrella hero. (Umbrella up 2026-06-27.)
export const HOLETRON_HOSTS = ['hltrn.cc', 'www.hltrn.cc'];

export const isMarketingHost = (hostname: string): boolean =>
  MARKETING_HOSTS.includes(hostname);

export const isHoletronHost = (hostname: string): boolean =>
  HOLETRON_HOSTS.includes(hostname);

export const isMarketingPath = (pathname: string): boolean => {
  if (pathname === '/') return true;
  return MARKETING_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
};

// BOUNCE DISABLED (owner request 2026-06-19): godcrm.ai now serves the full app
// directly — nginx proxies all paths and godcrm.ai is already in CORS_ORIGINS, so
// there is no reason to teleport users to app.godcrm.ai. The "WRONG HOUSE" interstitial
// is gone. Kept as a no-op (returns null) so callers in main.tsx/router.tsx stay wired
// and re-enabling is a one-line revert. Args intentionally unused.
export const getMarketingBounceUrl = (
  _hostname: string,
  _pathname: string,
  _search = '',
  _hash = ''
): string | null => null;

// Marketing CTA buttons (/auth/*) stay on the current host — no longer hard-link to
// app.godcrm.ai, matching the disabled bounce above. godcrm.ai/auth/* is served by nginx.
export const marketingAuthHref = (path: string): string => path;

// Visible bounce — paints a brutal "wrong house" notice before sending the user to
// app.godcrm.ai. Used by main.tsx (initial load) and router.tsx (SPA navigation).
// Without the notice, the bounce looks like a random flash and the user thinks
// the site broke (see incident: CORS_BLOCKED → "something broke. try again.").
export const bounceToApp = (target: string): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  try {
    document.documentElement.style.background = '#000';
    document.body.style.cssText = 'margin:0;background:#000;color:#fff;font-family:ui-monospace,Menlo,Consolas,monospace;';
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;">
        <div style="border:2px solid #fff;padding:20px 28px;max-width:520px;">
          <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#f87171;">wrong house.</div>
          <div style="margin-top:10px;font-size:22px;font-weight:900;letter-spacing:-.02em;text-transform:lowercase;">app lives on <u>app.godcrm.ai</u>.</div>
          <div style="margin-top:14px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9ca3af;">teleporting…</div>
        </div>
      </div>`;
  } catch {
    // DOM not ready — skip the notice, the redirect below still fires.
  }
  window.setTimeout(() => window.location.replace(target), 600);
};
