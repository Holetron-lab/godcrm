import { useState } from 'react';
import { Gift, Copy, Check, Link2 } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/authStore';

/**
 * ADR-188 Block F — referral surface, visible to EVERY user.
 * Shows the user's own `referral_code` (from F4 `/auth/me`) plus a copyable
 * deep-link that pre-fills `?ref=<code>` on the register page (Block C seam).
 */
export const ReferralSettings = () => {
  const user = useAuthStore((state) => state.user);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const code = user?.referral_code ?? null;
  const link = code
    ? `${window.location.origin}/auth/register?ref=${encodeURIComponent(code)}`
    : null;

  const copy = async (value: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked (insecure ctx / permissions) — no-op, value stays selectable */
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-[var(--color-primary-500)]" />
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Your referral</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Share your link — anyone who signs up through it is linked to you.
          </p>
        </div>
      </div>

      {code ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Referral code */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">Referral code</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-sm tracking-wider text-[var(--text-primary)]">
                {code}
              </code>
              <button
                type="button"
                onClick={() => copy(code, 'code')}
                aria-label="Copy referral code"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--color-primary-500)]"
              >
                {copied === 'code' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Referral link */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">Invite link</p>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
                <Link2 className="h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)]" />
                <span className="truncate text-sm text-[var(--text-primary)]" title={link ?? undefined}>{link}</span>
              </div>
              <button
                type="button"
                onClick={() => link && copy(link, 'link')}
                aria-label="Copy invite link"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--color-primary-500)]"
              >
                {copied === 'link' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-4 text-sm text-[var(--text-tertiary)]">
          Your referral code isn’t available yet. Sign out and back in to refresh it.
        </p>
      )}
    </div>
  );
};
