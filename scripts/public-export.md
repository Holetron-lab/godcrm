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

## Reconcile public history before publication

Compare the sanitized candidate against **both** public heads. Before staging,
compare their `git ls-tree -r --name-only <public-sha>` inventories with the
candidate's reviewed file manifest and actual files. `git diff <public-sha>`
does not include untracked additions: a file present in the candidate can look
deleted when it is absent from the snapshot's current index. Do not restore old
public code merely to silence that diff, or approve deletion from that diff alone.

The [2026-10-23 reconciliation](./public-history-reconciliation.json) reviews
31 disputed paths at pinned source and public SHAs: 22 must remain, one has an
existing replacement, and eight were intentionally removed. It records content
hashes, replacement paths and deletion commits. Migrations 088–090, principal
resolution, tool auditing and mailbox provisioning are already present in the
source and sanitized snapshot; their apparent deletion was an untracked-file
artifact. Preserve applied migration filenames and contents.

For the next export, recheck all decisions against the new committed source,
sanitized contents and current remote heads. Explicitly stage the reviewed
manifest, including its new files and approved deletions. Then compare the
**staged** tree against each public head and require every unexpected removal
to have a reviewed decision. If a retained path changes during sanitization,
review that transformation rather than treating file presence as equivalence.

Keep both public histories; never import private commit ancestry or force-push.
The pinned Forgejo and GitHub heads have no common ancestor. Publishing the
same reconciled tree to both therefore requires preserving both public heads
in its ancestry; a normal fast-forward from just one head is insufficient.
This reconciliation does not replace secret scanning, dependency audit, the
full aggregate, staging Gate 1, or self-host build and API smoke. Historical
mail provisioning/backfill/probe scripts are retained, not authorized to run
against live systems as part of an export check.
