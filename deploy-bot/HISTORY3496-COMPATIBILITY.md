# Existing Играемся scope — ticket 246779 / conversation 2068

Importer pin: a3bc0a1380dca49bdbdf995a4a2f989880f9623c.
This supersedes the F1/F2 pin fb1e7c10: it intentionally changes behavior.
Deployment review must assess the new importer, not infer byte equivalence.
The installer still compares exact Git bytes for every importer file, including
historical-related.js; no guard is bypassed.

Changes: optional exact destination ID/name with verified owner, personal-space
ACL and no additional grants; private conversation/files without space edits;
related schema/data digest, only two known ClipForge tables and inert column
configuration; new project/table/column/row IDs with job and row-chip remapping;
rollback restricted to these imported objects and blocked by post-import edits.
Source identities and metadata are provenance, never target execution authority.
Conversation, message, participant and file rows stay locked through verification
and rollback. The concurrent-edit regression reproduces the previous loss window
and verifies that a conflicting write cannot slip through the transaction.
All original data is retained in project settings; projected rows use new video
URLs and job IDs. No source agents, automation settings, public grants or jobs
are installed. All values use parameters in connection.js transactions.

The existing-space gate accepts personal/internal: fileGuard's existing personal
space check admits only its owner or explicit grants; import refuses grants.
The destination is rechecked on each operation. General shared-space import is
not implemented. An explicitly invited continuation agent still needs normal
conversation membership; this importer never creates that invitation.

Related table trigger review: registry_provenance_trg calls
registry_provenance_check, returns NEW for table_type != documents_registry,
and otherwise only validates author/time/title. SHA-256 of pg_get_triggerdef,
newline and pg_get_functiondef is pinned to
3fb87c93aad08d0260e7b6a1be8e47b3bedbf80418366381f36b99afae71d46d.
Unknown/different triggers abort; no trigger is disabled. Destination column
presence, required values and JSONB storage are checked before writes.

Archived-only message 687540 is preserved separately in the input package. The
6061-message fresh snapshot is authoritative for the imported conversation; no
silent union with the previous 6045-message snapshot occurs.

Sources: [Zod 3 validation](https://v3.zod.dev/) and
[PostgreSQL 16 locks](https://www.postgresql.org/docs/16/explicit-locking.html).
