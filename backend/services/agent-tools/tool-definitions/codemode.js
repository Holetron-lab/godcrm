export const CODEMODE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_crm_script',
      description: [
        'Compose multiple permitted CRM tools in one JavaScript program.',
        'Use this for batches and aggregation; use a direct tool for one call.',
        'The code is the body of an async function.',
        'Call tools as await crm.<toolName>(args).',
        'Use crm.tools() to list callable names and descriptions.',
        'Use crm.describe(name) to read a full JSON schema.',
        'Return one JSON-serializable value.',
        'console.log/warn/error output is captured.',
        'No require, imports, process, filesystem or network access exists.',
        'A capped setTimeout(callback, ms) is available.',
        'Default timeout is 10 seconds; maximum is 60 seconds.',
        'At most 50 inner CRM calls are executed.',
        'Inner calls use your own permissions and are audited individually.',
        'The result is truncated at 64 KB.',
        'Nested run_crm_script calls are forbidden.',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Async JavaScript function body' },
          timeout_ms: { type: 'number', minimum: 1, maximum: 60000, description: 'Optional wall timeout, default 10000' },
          purpose: { type: 'string', description: 'One-line purpose recorded in audit details' },
        },
        required: ['code'],
      },
    },
  },
];
