// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PROJECT_TOOLS } from '../tool-definitions/project.js';
import { AGENT_TOOLS } from '../tool-definitions/index.js';
import { evaluateToolGate } from '../capability-gate.js';
import { buildToolList } from '../../mcp/buildToolList.js';

describe('document import tool registration', () => {
  it.each(['import_document_file', 'check_document_import'])('advertises %s through the shared tool list', (name) => {
    expect(PROJECT_TOOLS.some((tool) => tool.function.name === name)).toBe(true);
    expect(AGENT_TOOLS.some((tool) => tool.function.name === name)).toBe(true);
    expect(buildToolList().some((tool) => tool.name === name)).toBe(true);
  });

  it('adds optional language without changing create_document requirements', () => {
    const definition = PROJECT_TOOLS.find((tool) => tool.function.name === 'create_document').function;
    expect(definition.parameters.properties.language.enum).toEqual(['en', 'ru']);
    expect(definition.parameters.required).toEqual(['widget_id', 'title']);
  });

  it('keeps both tools behind the existing capability gate', () => {
    const context = { agentId: 20, allowedTools: [{ function: { name: 'create_document' } }] };
    expect(evaluateToolGate('import_document_file', context, true)).toEqual({ permitted: false, violation: true });
    expect(evaluateToolGate('check_document_import', context, true)).toEqual({ permitted: false, violation: true });
  });
});
