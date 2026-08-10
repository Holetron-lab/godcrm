import { z } from 'zod';
import { ApiResponse } from '@/shared/types';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
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
}

export type AuthResponse = ApiResponse<{ accessToken: string; user: AuthUser }>;
export type ForgotPasswordResponse = ApiResponse<{ status: 'queued' }>;
