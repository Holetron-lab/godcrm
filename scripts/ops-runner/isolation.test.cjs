const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');

test('container runs unprivileged without credentials or control sockets', () => {
  assert.equal(process.getuid(), 65534);
  for (const path of ['/work/.env', '/work/.mcp.json', '/var/run/docker.sock', '/root/.pm2/rpc.sock']) {
    assert.equal(fs.existsSync(path), false, path);
  }
  assert.equal(process.env.JWT_SECRET, undefined);
  assert.equal(process.env.POSTGRES_PASSWORD, undefined);
});
test('container has only loopback networking', () => {
  assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
});
test('dependencies and root filesystem are read-only; work is writable', () => {
  for (const path of ['/work/node_modules/.runner-write-probe', '/etc/.runner-write-probe']) {
    assert.throws(() => fs.writeFileSync(path, 'probe'), /EROFS|EACCES/);
  }
  fs.writeFileSync('/work/.runner-write-probe', 'probe');
  fs.unlinkSync('/work/.runner-write-probe');
});
