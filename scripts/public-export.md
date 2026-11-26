# Public router preparation

After producing a sanitized snapshot with the existing public exclusions, run:

```sh
node /path/to/private-checkout/scripts/public-router.cjs /path/to/public-snapshot
cd /path/to/public-snapshot
npm run build
```

This step removes the excluded PalevoChecker and VspomilLanding imports and
routes. It preserves current authentication aliases, including search/hash,
and other current routes. Do not replace router.tsx with an older public copy:
that silently drops new authentication fixes. Repeated runs are idempotent;
unrecognized remaining references abort instead of leaving a broken build.

The command refuses a snapshot that still contains either excluded component.
It is only a router transform, not a full sanitizer or release approval. Keep
existing file exclusions, infrastructure/personal-data scrub, secret review,
and public-history isolation. Never merge private ancestry into public main.

Check with `node --test scripts/public-router.test.cjs`. Ring 1 remains subject
to the separate staging, quality and soaked-tag gate 2 requirements.
