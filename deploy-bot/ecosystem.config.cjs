module.exports = {
  apps: [{
    name: 'deploy-bot',
    script: 'bot.js',
    cwd: '/root/production/business-crm/deploy-bot',
    env: {
      NODE_ENV: 'production'
    },
    restart_delay: 5000,
    max_restarts: 10
  }]
};
