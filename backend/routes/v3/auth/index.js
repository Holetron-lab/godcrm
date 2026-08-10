/**
 * Auth routes index — assembles all sub-modules onto a single Express router.
 *
 * Sub-modules:
 *   - core.js          — /register, /login, /logout, /me, /refresh, /password
 *   - profile.js       — /profile, /avatar, /email
 *   - twoFactor.js     — /2fa/setup, /2fa/verify, /2fa (DELETE)
 *   - passwordReset.js — /forgot-password, /verify-reset-token, /reset-password
 *   - googleOAuth.js   — /google/*
 *
 * Shared helpers live in authShared.js.
 */
import express from 'express';
import registerCoreRoutes from './core.js';
import registerProfileRoutes from './profile.js';
import registerTwoFactorRoutes from './twoFactor.js';
import registerPasswordResetRoutes from './passwordReset.js';
import registerGoogleOAuthRoutes from './googleOAuth.js';
import registerTelegramOAuthRoutes from './telegramOAuth.js';

// Re-export requireAuth so external code can still do:
//   import { requireAuth } from './routes/v3/auth.js'
export { requireAuth } from './authShared.js';

const router = express.Router();

registerCoreRoutes(router);
registerProfileRoutes(router);
registerTwoFactorRoutes(router);
registerPasswordResetRoutes(router);
registerGoogleOAuthRoutes(router);
registerTelegramOAuthRoutes(router);

export default router;
