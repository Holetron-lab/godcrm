/**
 * Where to send the user after a successful login (Bugs 1552/229244, ADR-203 S1).
 *
 * The auth guard in Layout stores the path it bounced from in
 * `location.state.from`. Anything that is not an in-app path — an absolute
 * URL, a protocol-relative `//host`, or one of the auth pages themselves
 * (`/login`, `/auth/*`…) — must not be used as a return target: the first two
 * are open redirects, the last ones loop back onto a page that has no
 * authenticated route and end on the 404.
 */

export const DEFAULT_POST_LOGIN_PATH = '/spaces';

/** Paths that never make sense as a post-login return target. */
const AUTH_PATH_PREFIXES = ['/auth', '/login', '/register', '/reset-password'];

export function isSafeReturnPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
  // Browsers strip controls and treat backslashes as URL separators.
  if (/[\\\s\p{Cc}]/u.test(path)) return false;
  try {
    // Decode only the pathname for validation, never the opaque query/fragment.
    const decodedPathname = decodeURIComponent(path.split(/[?#]/, 1)[0]);
    if (/[\\?#\p{Cc}]/u.test(decodedPathname) || decodedPathname.startsWith('//')) return false;
    const pathname = new URL(decodedPathname, 'https://return.invalid').pathname.toLowerCase();
    if (pathname.startsWith('//')) return false;
    return !AUTH_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

export function resolvePostLoginTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  return isSafeReturnPath(from) ? from : DEFAULT_POST_LOGIN_PATH;
}
