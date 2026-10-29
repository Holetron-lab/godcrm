export const CSV_TOOLS = [{
  type: 'function',
  function: {
    name: 'project_csv',
    description: 'Scoped CSV for agent-vibe only, Vibe KZ 7819 / ProjectVB 8406. read fully parses registered local CSV (max 20 MiB, 100000 data records, 256 columns) and returns bounded pages with exact total and SHA256. Use next_offset and the same sha256 on subsequent pages. Never infer completeness from a page. create projects ALL source records into selected zero-based column indices and named headers, preserving string values/order; writes a new private basename_vNNN.csv and rereads/compares every cell before registration. Explicit version never overwrites; an existing version fails. verify independently reopens source and target and compares ALL projected cells. create/verify require source sha256, columns and formula_policy. Formula policy reject fails on spreadsheet formulas; apostrophe escapes them explicitly and reports escaped_cells. Output uses UTF-8 BOM, double-quoted cells, CRLF and the input delimiter. No arbitrary paths, URLs, filtering, row mutation, XLSX or external upload.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'create', 'verify'] },
        url: { type: 'string', description: 'Registered /uploads/projects/8406/<filename>.csv or /uploads/spaces/7819/<filename>.csv belonging to ProjectVB.' },
        delimiter: { type: 'string', enum: [',', ';', '\t'] },
        encoding: { type: 'string', enum: ['utf-8', 'windows-1251', 'utf-16le'], default: 'utf-8' },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Source digest returned by read. Required for create/verify and subsequent read pages.' },
        offset: { type: 'integer', minimum: 0, description: 'read only; zero-based data record offset, excluding header.' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'read only; default 100, response also bounded to 48 KiB of cells.' },
        columns: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'object', properties: { index: { type: 'integer', minimum: 0, maximum: 255 }, name: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['index', 'name'], additionalProperties: false } },
        formula_policy: { type: 'string', enum: ['reject', 'apostrophe'] },
        basename: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$', description: 'create only; e.g. altegio_common, without extension/version.' },
        version: { type: 'integer', minimum: 1, maximum: 999999, description: 'create only; explicit version, 1 produces _v001.csv. Existing versions are retained.' },
        target_url: { type: 'string', description: 'verify only; output URL returned by create.' },
        target_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'verify only; output digest returned by create.' },
      },
      required: ['action', 'url', 'delimiter'],
      additionalProperties: false,
    },
  },
}];
