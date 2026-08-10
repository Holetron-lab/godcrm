module.exports = {
  apps: [
    {
      name: 'godcrm',
      script: 'backend/server.js',
      cwd: '/root/production/business-crm',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '4G',
      kill_timeout: 15000,
      wait_ready: false,
      listen_timeout: 30000,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        VERIFICATION_COLUMN_ENABLED: 'true',
      },
    },
    {
      // ADR-156 Phase 5A: BDD test runner worker
      name: 'bdd-runner',
      script: 'backend/workers/bdd-runner.js',
      cwd: '/root/production/business-crm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      restart_delay: 3000,
      watch: false,
      // env intentionally empty → inherit shell/PM2 parent env (JWT_SECRET, POSTGRES_*, etc.)
      env: {},
    },
  ],
};
