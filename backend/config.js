// Load environment variables BEFORE any other imports.
// override:true so .env wins over PM2's cached env (otherwise `pm2 restart`
// re-injects stale values from the daemon and dotenv silently skips).
import dotenv from 'dotenv';
dotenv.config({ override: true });

// Re-export config values
export const config = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev_refresh_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY,
  DATABASE_PATH: process.env.DATABASE_PATH || '/var/lib/business-crm-data/crm.db',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || 'godcrm_refresh'
};

// SEC-8: Removed JWT_SECRET logging for security
