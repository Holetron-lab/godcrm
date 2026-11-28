# SMB demo migration gate

Source spaces: **SMB и Digital — 7841** and **Agent Smith — 89**.

The legacy `POST /api/v3/spaces/:id/export` API is useful for a private partial
snapshot, but it is **not a lossless space migration**. It covers projects,
universal tables and legacy documents. It does not prove preservation of
widgets, dashboards, events, conversations, files, connectors, RCLL memories or
relation targets. Do not present an import through this API as a completed move.

## Private source snapshots

Run from the source checkout with a short-lived owner token in the environment.
Never put the token or exported JSON in git, a public issue, a screen recording
or a shared download directory.

```bash
export SOURCE_URL=https://app.godcrm.ai
read -rs SOURCE_TOKEN; export SOURCE_TOKEN; echo
mkdir -m 700 /root/backups/hackathon-transfer
node deploy/selfhost/migrate/export-space.mjs 7841 /root/backups/hackathon-transfer
node deploy/selfhost/migrate/export-space.mjs 89 /root/backups/hackathon-transfer
unset SOURCE_TOKEN
```

Each export has a separate manifest and SHA-256. Secret/credential/token/API-key
tables are excluded, and sensitive columns in the remaining tables are nulled;
review the manifest's `sanitization` field. This reduces disclosure risk but does
not make business content public. `fidelity` is deliberately
`PARTIAL_NOT_A_FULL_MIGRATION`; the row counts are an inventory, not proof that
all workspace capabilities were copied.

## Required target readback

A selected-space migrator must be accepted before the move is called complete:

1. Both spaces, all projects, tables, columns and rows exist exactly once.
2. Documents and atoms render completely; widgets and dashboards resolve to the
   new table IDs.
3. Relations are remapped to target row IDs rather than copied as old pointers.
4. Tickets and calendar events retain their content and source markers.
5. Referenced uploads exist and pass file readback; content cells do not point
   at source-only paths.
6. Agent Smith agent/tool/operator assignments remain intact and agent rows are
   not silently activated or rewritten.
7. Connector payloads and other secrets are either migrated through an approved
   encrypted path or recreated manually. Plaintext secrets never enter exports.
8. RCLL is exported separately from the selected memory bank/scope and recalled
   on the target. A running RCLL container alone is not evidence of migrated memories.
9. The SMB mailbox is copied at Maildir level or replayed with deduplication;
   then IMAP sync is run and all 80 synthetic source IDs are mapped to target IDs.
10. A second import attempt is blocked or idempotent; no duplicate spaces,
    projects, rows, tickets, events or messages appear.

Until those checks are green, keep the source read-only for the affected spaces,
do not switch production DNS, and label the target as a preparation copy.

## Mail transfer

The Compose mail service stores accounts/configuration and messages in separate
named volumes. Export the existing `smb.digital` Maildir and DMS account state
only after stopping or otherwise quiescing the source mailbox, so a message
cannot arrive between the snapshot and its checksum. Recreate the target CRM
IMAP connector through the UI with a newly entered password; do not copy an
encrypted connector payload between installations with different master keys.
