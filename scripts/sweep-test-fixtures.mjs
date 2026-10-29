#!/usr/bin/env node
// sweep-test-fixtures.mjs — remove fixture rows left behind in godcrm_test.
//
// Not to be confused with scripts/cleanup-test-data.js, which is the
// owner-gated ADR-0009 Phase 2 tool for pruning legacy test junk out of a
// combat master. This one only ever runs against the test contour and only
// touches the `@test.godcrm.local` namespace minted by
// backend/tests/helpers/workspace-fixture.js.
//
// A killed or crashed run leaves its user/space/project behind; enough of them
// and suites that count or list rows start drifting between runs. Run this
// after an interrupted suite, or from `make test-clean`.
//
//   node scripts/sweep-test-fixtures.mjs

import '../backend/test/setup.js'; // pins the contour, then refuses anything but a *_test DB
import { sweepStaleFixtures } from '../backend/tests/helpers/workspace-fixture.js';
import { destroyAdapter } from '../backend/database/connection.js';

const removed = await sweepStaleFixtures();

console.log(
  removed
    ? `[sweep] removed ${removed} stale fixture workspace(s) from ${process.env.POSTGRES_DB}`
    : `[sweep] nothing to remove in ${process.env.POSTGRES_DB}`
);

await destroyAdapter();
