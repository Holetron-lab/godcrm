#!/usr/bin/env node
// Run after publish-time file exclusions, before the public build.
const fs = require('node:fs');
const path = require('node:path');

function publicRouter(source) {
  for (const [component, route] of [['PalevoChecker', 'palevo'], ['VspomilLanding', 'vspomnil']]) {
    source = source.replace(new RegExp(`^const ${component} = lazy\\([^\\n]+\\);\\r?\\n`, 'm'), '');
    source = source.replace(new RegExp(`  \\{\\s*path: ['"]/${route}['"],\\s*element: <${component} />,[\\s]*errorElement: <ErrorBoundaryPage />\\s*\\},?\\r?\\n`, 'g'), '');
    if (source.includes(component)) throw new Error(`Unrecognized public router wiring: ${component}`);
  }
  return source;
}

if (require.main === module) {
  const snapshot = process.argv[2];
  if (!snapshot) throw new Error('usage: node scripts/public-router.cjs <excluded-public-snapshot>');
  for (const component of ['PalevoChecker', 'VspomilLanding']) {
    if (fs.existsSync(path.join(snapshot, 'src/features/public', `${component}.tsx`))) {
      throw new Error('Apply public file exclusions before transforming the router');
    }
  }
  const file = path.join(snapshot, 'src/app/router.tsx');
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, publicRouter(source));
}
module.exports = { publicRouter };
