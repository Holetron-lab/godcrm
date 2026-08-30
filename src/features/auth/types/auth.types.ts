import { z } from 'zod';
import { ApiResponse } from '@/shared/types';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  /**
   * ADR-188 Block F4 — the user's own referral code, surfaced by `GET /auth/me`.
   * Optional: absent on stale persisted sessions from before F4 shipped; the
   * Settings referral section refetches `/auth/me` to stay correct.
   */
  referral_code?: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

export const loginSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов')
});

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(80, 'name is too long'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('invalid email'),
  password: z.string().min(8, 'minimum 8 characters'),
  // ADR-183-A — inviter's referral code. Named format `slug-suffix` (lowercase),
  // usually autofilled from the `?ref=<code>` deep-link but editable.
  referralCode: z
    .string()
    .trim()
    .max(48, 'referral code is too long')
    .optional()
    .or(z.literal('')),
  // Shared campaign / Tier-B unlock code (uppercase). Rendered only when the
  // owner-controlled `promo_enabled` flag is on (ADR-183-A D6).
  promoCode: z
    .string()
    .trim()
    .max(32, 'promo code is too long')
    .optional()
    .or(z.literal(''))
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Введите корректный email')
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

// What the API actually receives — form values + browser-side metadata for cohort tracking.
export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  promo_code: string | null;
  signup_source: string;
  signup_referrer: string | null;
  user_agent: string;
  /**
   * ADR-183 Block C / ADR-183-A — inviter's referral code. Prefilled from the
   * `?ref=<code>` deep-link into the visible field, editable before submit.
   * Best-effort: unknown or absent codes resolve to `referred_by = NULL`
   * server-side, never blocking the sign-up.
   */
  referral_code?: string | null;
}

export type AuthResponse = ApiResponse<{ accessToken: string; user: AuthUser }>;
export type ForgotPasswordResponse = ApiResponse<{ status: 'queued' }>;
