# Excel import backend — ticket 1708/244525

Scope: XLSX and BIFF5/8 XLS values, without images. The existing CSV/Notion
frontend remains separate. No Java installation, DB migration or new import
screen is needed. **Backend availability does not mean UI/release acceptance.**

## Preview contract

`POST /api/v3/projects/:projectId/tables/excel-preview`

Authenticated multipart request with one `file` and optional `sheetIndex` (a
zero-based decimal integer string). Do not set Content-Type manually when using
FormData. Same project restriction and space write gate as creating a table.

Without `sheetIndex`, returns the sheet list and `sheet: null`: the user must
choose a sheet. Re-send the original File with a selected index to get its data.
No data is persisted by preview, error, cancellation, or retry.

Response uses the normal `{ success: true, data: ... }` envelope:

```ts
type ExcelPreview = {
  format: 'xls' | 'xlsx';
  sheets: Array<{
    index: number; name: string; rowCount: number; columnCount: number; hidden: boolean;
  }>;
  sheet: null | {
    index: number; name: string; rowCount: number; columnCount: number; hidden: boolean;
    rows: string[][];
    values: Array<Array<string | number | boolean | null>>;
    emptyRowCount: number;
    skippedCellCount: number;
  };
  warnings: Array<{
    code: string; message: string; sheetIndex?: number; rowIndex?: number; colIndex?: number;
  }>;
  limits: Record<string, number>;
};
```

Both matrices start at A1. Empty rows/columns and duplicate/blank header strings
are retained. Array indices are source coordinates, not compacted positions.
Use `colIndex`, never `headers.indexOf(header)`, when projecting/excluding columns.
Header toggle and column naming/type/exclusion are frontend projections. Other
sheets are never appended implicitly. Cancel stale preview requests/results on
sheet changes. Preview requests are rate limited; 429 means retry later.

`rows` contains display text (including numeric leading zeros); use it for text
columns and display. `values` holds numbers/booleans/null and ISO wall-clock date
strings (`2026-10-08T12:34:56`, with no invented time zone). For a selected `date`
column project to `YYYY-MM-DD`; for `datetime` retain the ISO value including
seconds. For a selected number column use the raw numeric value, not the formatted
display text. Do not route Excel dates through `new Date(...).toISOString()` or
Excel files through the Notion relation transformations.

Always display warnings before creation. `OBJECTS_IGNORED` is present on every
book (it is an explicit general notice, not an object count). Formula evaluation,
VBA and network fetches are never invoked. `FORMULA_CACHE_MISSING` and `CELL_ERROR`
leave the cell empty and increment `skippedCellCount`. BIFF can store an
uncalculated formula as a numeric zero indistinguishable from a real cached zero:
`FORMULA_CACHE_UNVERIFIED` preserves the stored zero and explicitly asks the user
to verify/recalculate the source workbook. Do not hide this warning or claim the
cache was verified. Text/URL values are never downloaded or rendered as HTML.

Limits: 10 MiB file, 50 MiB actual/declared ZIP expansion, 2000 ZIP entries,
20 sheets, 10000 rows/256 columns per sheet, 200000 stored cells per book and
200000 cells in each output rectangle, 8 MiB projected text, 1000 cell warnings.
Each parse has a 15 second deadline and 192 MiB old-generation heap limit; up to
two uploads/parsers per server process. This is a resource boundary, not an OS
security sandbox. ZIP entries are streamed, size/CRC checked and never extracted
to disk; only the validated in-memory container is passed to SheetJS.
Damaged, encrypted, renamed non-Excel and oversized inputs return structured
400/413/422 errors, never partial success. XLSX macros disguised as XLSX are
rejected; XLS macro code is not executed. Raw BIFF2/3/4, XML/HTML disguised as XLS,
XLSB and XLSM are outside this contract.

## Creation and retry (existing endpoints)

Generate a UUID `importId` for each chosen workbook/sheet import and retain it
across retries. Freeze the creation and row payloads once creation starts.

1. `POST /api/v3/tables`: send the existing local table payload with **all columns
   in `columns`**, plus `importId`. The table and schema commit together. Repeating
   the exact creation payload returns the same table/column IDs, even if the first
   response was lost. A changed payload with the same key gets 409. JSON property
   ordering is significant for this creation request digest: retain the payload.
   External data-source creation does not accept `importId`. Receipts live in
   `universal_tables.config.file_import`; subsequent config changes must preserve
   this field. The receipt is scoped to the authenticated creator and project.
2. `POST /api/v3/tables/:id/rows/import`: send
   `{ importId, mode: 'add', rows: [{ columnKey: typedValue }] }`. Each fixed batch
   is atomic. Unknown columns, invalid types/options and any later insertion
   error roll back the batch. Do not send column definitions to this endpoint.
   The optional mode validates 1–10000 rows, 200000 cells and 8 MiB of row JSON.
   Use a single batch within these limits; if splitting is necessary, each batch
   must have its own stable UUID. Do not reuse one UUID for different chunks.
3. Response adds `imported` (total rows for that request) and `replayed` alongside
   existing `stats: { added, updated, skipped, errors }`. Replayed requests return
   `added: 0`, `imported: originalCount`, `replayed: true`. Display `imported`, plus
   source blank-row/exclusion/skipped-cell counts; zero is a valid value, not a
   blank row. Do not show success on HTTP failure.

Rows use deterministic `base_id` receipts scoped to user/table/key, protected by
a transaction row lock. Retries do not overwrite subsequent edits. A changed
payload or partial deletion gives 409; deleting **all** imported rows removes the
row receipt, so a later deliberate retry can import again. Deleting the table
also deletes its creation receipt. Keep the created table/key after partial
failure; retry rows instead of generating another table/key. Retain recovery
state on the client for reopening. Optional sidebar widgets should be created
only after successful rows; widget retries need frontend reconciliation.

Without `importId`, the existing CSV rows add/update behavior is retained. The
rows/import access gate now consistently checks project-restricted credentials
and space editor-or-higher rights, matching table creation. Existing row/schema
APIs still enforce permissions on each request.

## Evidence and remaining acceptance

Tests are next to the parser and routes. Independent synthetic POI XLS/XLSX
fixtures include images, Cyrillic, dates, booleans and a stale formula cache;
provenance is in `__tests__/fixtures/excel/README.md`. Database suites assert
`current_database() = godcrm_test` before creating their fixtures.

Verified on 2026-10-08, Node 20.20.2: **73/73 tests in 13 suites**, covering the
parser, multipart API, retry/transaction/permission paths, existing rows API and
all existing CreateTableModal CSV/Notion suites. `npm run build` passed (existing
DocumentsWidget circular-chunk and large-bundle warnings). Backend ESLint has no
errors; two pre-existing unused-variable warnings remain in `rows.js`.
Runtime requires Node's `node:zlib.crc32` (available on the tested version) and
the pinned `xlsx` plus `yauzl` production dependencies. Install from the lockfile
in writable isolated dependencies; do not modify shared worktree node_modules.

Frontend still owns: “Из файла”, picker/drop, sheet selector, preview/mapping,
warnings, type projection, exact payload/key retention, retry state, final counts,
CSV/Notion regression and browser acceptance. Staging Gate 1/smoke and deployment
are subsequent release gates, not evidence supplied by this backend change.

Sources: [SheetJS installation/pinning](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
[read options/cache behavior](https://docs.sheetjs.com/docs/api/parse-options/),
[yauzl bounded ZIP streams](https://github.com/thejoshwolfe/yauzl#openreadstreamentry-options-callback),
[Microsoft BIFF FormulaValue](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/bccb00ac-67a1-490a-9f0b-5ce59978eb9a).
The exported SheetJS `parse_zip`/`parse_xlscfb` container APIs were verified against
the pinned 0.20.3 source and independent fixture tests; upgrades must rerun them.
