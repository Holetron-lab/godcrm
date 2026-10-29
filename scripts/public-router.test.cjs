const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicRouter } = require('./public-router.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/app/router.tsx'), 'utf8');

test('public snapshot removes excluded promo imports and routes', () => {
  const output = publicRouter(source);
  assert.doesNotMatch(output, /PalevoChecker|VspomilLanding|path: '\/(palevo|vspomnil)'/);
  assert.match(output, /path: '\/login', element: <LegacyAuthRedirect/);
  assert.match(output, /path: '\/register', element: <LegacyAuthRedirect/);
  assert.match(output, /const \{ search, hash \} = useLocation/);
  assert.match(output, /path: '\/embed\/chat'/);
  assert.equal(publicRouter(output), output);
});

test('unexpected remaining references fail closed', () => {
  assert.throws(() => publicRouter(source + '\nconst extra = PalevoChecker;'), /Unrecognized/);
});
