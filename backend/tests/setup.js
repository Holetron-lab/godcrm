// Backend Test Setup - v0.002.000
// ADR-149: PostgreSQL-only

process.env.TEST_MODE = 'true';
process.env.JWT_SECRET = 'test-secret-for-vitest';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';

console.log('[Backend Setup] TEST_MODE =', process.env.TEST_MODE);
