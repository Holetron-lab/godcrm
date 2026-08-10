/**
 * PasswordPrompt - Simple centered card for password-protected public spaces.
 *
 * ADR-105: AC3
 */

import { useState, useCallback } from 'react';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import { publicApi, PublicApiError } from './publicApi';

interface PasswordPromptProps {
  slug: string;
  spaceName?: string;
  onSuccess: () => void;
}

export function PasswordPrompt({ slug, spaceName, onSuccess }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password.trim()) return;

      setLoading(true);
      setError(null);

      try {
        await publicApi.verifyPassword(slug, password);
        onSuccess();
      } catch (err) {
        if (err instanceof PublicApiError) {
          setError(err.status === 403 ? 'Incorrect password. Please try again.' : err.message);
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    },
    [slug, password, onSuccess],
  );

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg"
        >
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
              <Lock className="h-6 w-6 text-blue-600" />
            </div>
          </div>

          {/* Title */}
          <h2 className="mb-2 text-center text-xl font-semibold text-gray-900">
            Password Required
          </h2>
          <p className="mb-6 text-center text-sm text-gray-500">
            {spaceName
              ? `Enter the password to access "${spaceName}".`
              : 'This space is password-protected.'}
          </p>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Password input */}
          <label htmlFor="public-space-password" className="sr-only">
            Password
          </label>
          <input
            id="public-space-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            disabled={loading}
            className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Unlock'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
