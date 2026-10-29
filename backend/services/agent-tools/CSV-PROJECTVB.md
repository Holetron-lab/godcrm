# ProjectVB CSV capability — conversation 3731

Backend change for @developer-ralph; business processing belongs to @agent-vibe.
Target: Ring 0 / app.godcrm.ai. Ring 1 is excluded.

## Contract

One new callable tool: `project_csv`, actions `read`, `create`, `verify`.
The existing MCP builder advertises it automatically through AGENT_TOOLS;
general filesystem tools remain in SKIP_TOOLS. The public MCP allowlist is unchanged.

Authorization is enforced in the handler even when the general tool allowlist
gate is warn-only: runtime agentId 241656 and spaceId 7819; current row
100887/241656 must be active, slug agent-vibe, space 7819, tools containing
project_csv. Project 8406 must still belong to space 7819. Source/target files
must be registered local files in project 8406, with space 7819 or a legacy
NULL space (project ownership is independently checked). No arbitrary host paths,
network downloads, other projects or public publication.

Read parses the entire file, including invalid tails, then returns whole-record
pages and total_records. Continue using next_offset and the original sha256.
All values are strings, with whitespace, empty cells and leading zeros preserved.
Supported delimiters: comma, semicolon, tab; explicit UTF-8 (default), Windows-1251,
UTF-16LE. No delimiter/encoding guessing. Invalid input fails without partial success.

Create selects zero-based source columns and supplies output header names; ALL
data rows remain in their original order. It does not filter, normalize cell
values, insert missing columns or perform the later MoySklad conversion.
Requires source sha256, ordered columns, explicit version and formula_policy.
Output is basename_vNNN.csv, UTF-8 BOM, quoted cells, CRLF, source delimiter,
private registry entry in 7819/8406. Exclusive file creation prevents overwrite
and concurrent version collisions. A complete disk readback compares every
projected cell; a transaction inserts the file and verifies all stored metadata.
Verify reopens both files, checks both digests and compares every expected cell.

Formula policy reject fails on formula-like values. Only an explicit apostrophe
policy prefixes them, including headers; escaped_cells reports the change.
Quoting CSV alone does not neutralize spreadsheet formulas.

Limits fail explicitly: 20 MiB input/output, 100000 data records, 256 columns,
1 MiB parser record buffer. Read pages contain at most 48 KiB of header/cell JSON;
an individual record exceeding this page budget cannot be displayed but can be
processed server-side by create/verify within the parser limits. Counts are parsed
CSV records, not physical lines. Client datasets are never included in git.

## Installation and activation

No migrations, new packages, frontend change or manual live edits. Dependencies
already installed: csv-parse (tested 6.2.1), Zod 3.x. Use the repository lockfile.
Use the exact committed SHA supplied in the handoff, not a later moving HEAD.

@deployment-executor: review the package and arrange the existing authorized
deployment channel with the owner/deploy-bot. Run required release gate 1 and
environment smoke for the candidate. Only deploy-bot/owner may restart Ring 0.
The executor's review-only passport is not an installation channel; if unavailable,
report BLOCKED_CHANNEL. No test writes to production. No Ring 1 actions.

@agent-smith: after inspecting the live registry schema, add project_csv to the
existing tools of agent 100887/241656; preserve its other fields. Update its
capability instructions to permit only this scoped CSV workflow (not shell or
general filesystem tools). Read back all changed fields. Launch a fresh runtime
with AGENT_ID=241656 and MCP_SPACE_ID=7819; a slug-only fallback is insufficient.
Do not reuse the developer's space-11 MCP session for acceptance.

## Acceptance from the actual agent-vibe launch

Source: `/uploads/projects/8406/file_1791379282735_30f80f94a0e2fa39.csv`.
No customer file was processed by the developer tests; fixtures are synthetic.

1. Confirm project_csv appears in tools/list and the resolved caller is 241656
   in space 7819. Read the source with its verified delimiter/encoding. Record
   SHA256, headers, exact total_records; traverse next_offset until null if all
   rows must be inspected. Pin sha256 on every subsequent page.
2. Map the owner's 15 output headers to actual zero-based source columns. Do
   not infer missing business fields or silently drop records. Use the next
   unused version, e.g. basename altegio_common and version 1. If a version
   exists, inspect it before deliberately selecting another version. Preserve
   the source as-is; if a separately named versioned source copy is required,
   create an identity projection with all original columns and its own basename.
3. Call create with the exact source sha256, mapping and formula_policy=reject
   unless the owner explicitly chose apostrophe transformation. Capture returned
   file_id/url/name/size/sha256/source_sha256/total_records/escaped_cells/verified.
4. Call verify with the same source, mapping and policy, and returned target_url
   and target_sha256. It must return verified=true and the same record count.
   Confirm the owner can see/download the private file in ProjectVB.

Output header order: Группа; Наименование:; Цена продажи:; Закупочная цена:;
Характеристика:Материал; Характеристика:Резьба; Характеристика:Толщина;
Характеристика:Длина; Характеристика:Внутренний диаметр;
Характеристика:Размер топа; Характеристика:Цвет кристалла;
Характеристика:Камень; Характеристика:Опал; Характеристика:Цвет стразы;
Характеристика:Покрытие.

This actual runtime cycle and owner download are release acceptance, not proved
by unit tests or static registration. The task remains open until that evidence.

## Failure and rollback

CSV_VERSION_EXISTS never overwrites. A disk file can remain reserved after a
write/readback/DB failure; it is not reported as success. Do not blindly retry with
another version or remove files: inspect the expected URL and registry first.
An ambiguous DB commit can already have published the file. Preserve evidence;
an authorized operator resolves it. Registry transaction rollback and filesystem
creation are not represented as one atomic operation.

If activation fails, remove only the project_csv grant through Agent Smith's
authorized schema/readback workflow. Existing private outputs and source stay
intact. Any code rollback/restart is a separate owner/deploy-bot operation.

## Validation

Synthetic CSV tests run through scripts/ops-runner.py in a container without
network, host credentials, runtime sockets or real DB; the DB boundary is mocked.
Tests cover multiline quoted Cyrillic, empty cells, leading zeros, >100 KiB,
all-cell independent comparison, tampering/digest change, encodings, record
paging, authorization, path traversal/symlinks, version races, formula policy,
size failures, registry failure/readback and shared executor/MCP registration.
Run alongside publicMcp.test.js and capability-gate.test.js. Exact SHA and artifact
directory are supplied in the final handoff. Frontend build is not required for
this backend-only diff; release gate 1/live smoke and real DB/runtime acceptance
are pending deployment work and must not be marked passed from these tests.

References: https://csv.js.org/parse/options/ and https://csv.js.org/parse/api/sync/.
