// Read a running daemon directly. Never import the PM2 API/start a daemon.
const axon = require('/usr/lib/node_modules/pm2/modules/pm2-axon');
const rpc = require('/usr/lib/node_modules/pm2/modules/pm2-axon-rpc');
const fs = require('node:fs');
const path = '/root/.pm2/rpc.sock';
if (!fs.existsSync(path) || !fs.statSync(path).isSocket()) process.exit(69);
const socket = axon.socket('req');
const client = new rpc.Client(socket);
const timeout = setTimeout(() => { socket.close(); process.exit(69); }, 4000);
socket.once('error', () => { clearTimeout(timeout); socket.close(); process.exit(69); });
socket.once('connect', () => {
  client.call('getMonitorData', {}, (error, rows) => {
    clearTimeout(timeout);
    if (error || !Array.isArray(rows)) { socket.close(); process.exit(69); }
    const names = new Set(['godcrm', 'godcrm-edit', 'deploy-bot']);
    const data = rows.filter(row => names.has(row.name)).map(row => ({
      name: row.name, pid: Number(row.pid),
      status: ['online', 'stopped', 'errored', 'stopping', 'launching'].includes(row.pm2_env?.status)
        ? row.pm2_env.status : 'unknown',
      uptime: Number(row.pm2_env?.pm_uptime), restarts: Number(row.pm2_env?.restart_time),
    }));
    process.stdout.write(JSON.stringify(data) + '\n');
    socket.close();
  });
});
socket.connect(path);
