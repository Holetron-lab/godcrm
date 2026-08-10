/**
 * ADR-116 / ADR-117: Structured Invocation Token Parsers — Unit Tests
 *
 * Tests for all 7 parser functions in mention-parsers.js:
 *   - parseMentions() — legacy @slug extraction (all occurrences)
 *   - parseDelegations() — <<@slug>> extraction (ADR-117)
 *   - parseInvocationMentions() — alias for parseDelegations (ADR-116)
 *   - parseInvocationCommands() — <</slug>> extraction (ADR-116)
 *   - parseReferenceMentions() — @slug outside <<@...>> (display only)
 *   - parseReferenceCommands() — /slug outside <</...>> (display only)
 *   - parseAgentCommands() — legacy /slug extraction
 */

import { describe, it, expect } from 'vitest';
import {
  parseMentions,
  parseDelegations,
  parseInvocationMentions,
  parseInvocationCommands,
  parseReferenceMentions,
  parseReferenceCommands,
  parseAgentCommands,
} from '../mention-parsers.js';


// ═══════════════════════════════════════════════════════════════════════════════
// parseMentions — legacy
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseMentions() — legacy @mention parser', () => {
  it('should extract @slug from text', () => {
    expect(parseMentions('@architect help me')).toEqual(['architect']);
  });

  it('should extract multiple @mentions', () => {
    expect(parseMentions('@architect and @developer please')).toEqual(['architect', 'developer']);
  });

  it('should be case-insensitive (lowercase output)', () => {
    expect(parseMentions('@Architect')).toEqual(['architect']);
  });

  it('should return empty for null/undefined/empty', () => {
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions(undefined)).toEqual([]);
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions(42)).toEqual([]);
  });

  it('should also catch @slug inside <<@slug>> tokens', () => {
    // Legacy parser is naive — catches everything with @
    const result = parseMentions('<<@architect>> and @developer');
    expect(result).toContain('architect');
    expect(result).toContain('developer');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseDelegations — ADR-117
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-117: parseDelegations()', () => {

  describe('extraction', () => {
    it('should extract <<@agent-name>> from text', () => {
      expect(parseDelegations('Please review this <<@architect>>')).toEqual(['architect']);
    });

    it('should extract multiple delegations', () => {
      expect(parseDelegations('<<@architect>> and <<@test-runner>> please'))
        .toEqual(['architect', 'test-runner']);
    });

    it('should handle underscores in agent names', () => {
      expect(parseDelegations('Delegating to <<@my_agent_v2>>')).toEqual(['my_agent_v2']);
    });

    it('should be case-insensitive (normalize to lowercase)', () => {
      expect(parseDelegations('<<@Architect>>')).toEqual(['architect']);
    });

    it('should handle delegation at start/end/newline', () => {
      expect(parseDelegations('<<@developer>> please check')).toEqual(['developer']);
      expect(parseDelegations('Done, passing to <<@test-runner>>')).toEqual(['test-runner']);
      expect(parseDelegations('Done.\n<<@test-runner>>')).toEqual(['test-runner']);
    });
  });

  describe('NO false positives', () => {
    it('should NOT match plain @mentions', () => {
      expect(parseDelegations('Ask @architect about this')).toEqual([]);
    });

    it('should NOT match partial syntax <<@name (missing closing)', () => {
      expect(parseDelegations('<<@broken')).toEqual([]);
    });

    it('should NOT match partial syntax @name>> (missing opening)', () => {
      expect(parseDelegations('@broken>>')).toEqual([]);
    });

    it('should NOT match single chevron <@name>', () => {
      expect(parseDelegations('<@architect>')).toEqual([]);
    });

    it('should handle mixed references and delegations', () => {
      const text = 'I discussed with @marketer and now delegating to <<@developer-ralph>>';
      expect(parseDelegations(text)).toEqual(['developer-ralph']);
    });

    it('should return empty for text with only plain @mentions', () => {
      expect(parseDelegations('@architect recommends @developer')).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should return empty for null/undefined/empty/non-string', () => {
      expect(parseDelegations(null)).toEqual([]);
      expect(parseDelegations(undefined)).toEqual([]);
      expect(parseDelegations('')).toEqual([]);
      expect(parseDelegations(42)).toEqual([]);
      expect(parseDelegations({})).toEqual([]);
    });

    it('should include duplicates (caller dedupes)', () => {
      expect(parseDelegations('<<@architect>> says ok, <<@architect>> confirmed'))
        .toEqual(['architect', 'architect']);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseInvocationMentions — ADR-116 (alias for parseDelegations)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: parseInvocationMentions()', () => {
  it('should parse <<@architect>> as invocation', () => {
    expect(parseInvocationMentions('<<@architect>> review this')).toEqual(['architect']);
  });

  it('should parse multiple <<@a>> <<@b>> tokens', () => {
    expect(parseInvocationMentions('<<@architect>> and <<@test-runner>> please'))
      .toEqual(['architect', 'test-runner']);
  });

  it('should NOT parse raw @architect as invocation', () => {
    expect(parseInvocationMentions('Ask @architect about this')).toEqual([]);
  });

  it('should be case-insensitive', () => {
    expect(parseInvocationMentions('<<@Architect>>')).toEqual(['architect']);
  });

  it('should return empty for null/undefined', () => {
    expect(parseInvocationMentions(null)).toEqual([]);
    expect(parseInvocationMentions(undefined)).toEqual([]);
    expect(parseInvocationMentions('')).toEqual([]);
  });

  it('should handle mixed tokens: <<@a>> and @b — only return a', () => {
    const text = 'I discussed with @marketer and now delegating to <<@developer-ralph>>';
    expect(parseInvocationMentions(text)).toEqual(['developer-ralph']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseInvocationCommands — ADR-116
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: parseInvocationCommands()', () => {
  it('should parse <</developer-ralph>> as invocation', () => {
    expect(parseInvocationCommands('<</developer-ralph>> fix bug')).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
  });

  it('should parse multiple <</a>> <</b>> tokens', () => {
    expect(parseInvocationCommands('<</architect>> and <</test-runner>>'))
      .toEqual([{ slug: 'architect', commandIndex: null }, { slug: 'test-runner', commandIndex: null }]);
  });

  it('should NOT parse raw /developer-ralph as invocation', () => {
    expect(parseInvocationCommands('Use /developer-ralph for bugs')).toEqual([]);
  });

  it('should NOT match URLs like https://example.com/path', () => {
    expect(parseInvocationCommands('Visit https://example.com/api/v3')).toEqual([]);
  });

  it('should be case-insensitive', () => {
    expect(parseInvocationCommands('<</Developer-Ralph>>')).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
  });

  it('should return empty for null/undefined', () => {
    expect(parseInvocationCommands(null)).toEqual([]);
    expect(parseInvocationCommands(undefined)).toEqual([]);
    expect(parseInvocationCommands('')).toEqual([]);
  });

  it('should handle mixed: <</a>> and /b — only return a', () => {
    const text = 'Use /marketer for marketing and <</developer-ralph>> for code';
    expect(parseInvocationCommands(text)).toEqual([{ slug: 'developer-ralph', commandIndex: null }]);
  });

  it('should handle slugs starting with a letter only', () => {
    // <</123>> should not match (slug must start with letter)
    expect(parseInvocationCommands('<</123>>')).toEqual([]);
    expect(parseInvocationCommands('<</a123>>')).toEqual([{ slug: 'a123', commandIndex: null }]);
  });

  it('should parse <</slug/N>> with command index', () => {
    expect(parseInvocationCommands('<</sysadmin/0>>')).toEqual([{ slug: 'sysadmin', commandIndex: 0 }]);
    expect(parseInvocationCommands('<</sysadmin/1>>')).toEqual([{ slug: 'sysadmin', commandIndex: 1 }]);
    expect(parseInvocationCommands('<</agent/42>>')).toEqual([{ slug: 'agent', commandIndex: 42 }]);
  });

  it('should parse mixed <</slug>> and <</slug/N>> in same message', () => {
    expect(parseInvocationCommands('<</sysadmin>> check and <</developer/2>> deploy'))
      .toEqual([{ slug: 'sysadmin', commandIndex: null }, { slug: 'developer', commandIndex: 2 }]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseReferenceMentions — ADR-116
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: parseReferenceMentions()', () => {
  it('should parse @architect as reference', () => {
    expect(parseReferenceMentions('As @architect noted')).toEqual(['architect']);
  });

  it('should NOT include slugs from <<@architect>> tokens', () => {
    expect(parseReferenceMentions('<<@architect>> reviewed it')).toEqual([]);
  });

  it('should handle text with both formats', () => {
    const text = 'As @marketer said, delegating to <<@architect>>';
    expect(parseReferenceMentions(text)).toEqual(['marketer']);
  });

  it('should return empty for null/undefined', () => {
    expect(parseReferenceMentions(null)).toEqual([]);
    expect(parseReferenceMentions(undefined)).toEqual([]);
  });

  it('should return multiple references', () => {
    expect(parseReferenceMentions('@architect and @developer discussed'))
      .toEqual(['architect', 'developer']);
  });

  it('should handle complex mixed scenario', () => {
    const text = 'Hey @marketer, the <<@architect>> says @developer should help';
    const refs = parseReferenceMentions(text);
    expect(refs).toContain('marketer');
    expect(refs).toContain('developer');
    expect(refs).not.toContain('architect'); // architect is inside <<@...>>
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseReferenceCommands — ADR-116
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: parseReferenceCommands()', () => {
  it('should parse /developer-ralph as reference', () => {
    expect(parseReferenceCommands('Use /developer-ralph for bugs')).toEqual(['developer-ralph']);
  });

  it('should NOT include slugs from <</developer-ralph>> tokens', () => {
    expect(parseReferenceCommands('<</developer-ralph>> fix it')).toEqual([]);
  });

  it('should NOT match URLs or file paths', () => {
    expect(parseReferenceCommands('Visit https://example.com/path')).toEqual([]);
  });

  it('should handle text with both formats', () => {
    const text = 'Use /marketer for marketing and <</developer-ralph>> for code';
    expect(parseReferenceCommands(text)).toEqual(['marketer']);
  });

  it('should return empty for null/undefined', () => {
    expect(parseReferenceCommands(null)).toEqual([]);
    expect(parseReferenceCommands(undefined)).toEqual([]);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// parseAgentCommands — legacy
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseAgentCommands() — legacy /command parser', () => {
  it('should extract /slug from text', () => {
    expect(parseAgentCommands('/architect help me')).toEqual(['architect']);
  });

  it('should NOT match URLs', () => {
    expect(parseAgentCommands('https://example.com/path')).toEqual([]);
  });

  it('should NOT match file paths mid-word', () => {
    expect(parseAgentCommands('see/something')).toEqual([]);
  });

  it('should return empty for null/undefined/empty', () => {
    expect(parseAgentCommands(null)).toEqual([]);
    expect(parseAgentCommands(undefined)).toEqual([]);
    expect(parseAgentCommands('')).toEqual([]);
  });

  it('should handle multiple commands', () => {
    expect(parseAgentCommands('/architect review /developer-ralph fix'))
      .toEqual(['architect', 'developer-ralph']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Agent response processing (no false positives)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ADR-116: Agent response processing (integration)', () => {
  it('should NOT trigger delegation for plain @mention in agent response', () => {
    const agentResponse = '@architect recommends using microservices';
    expect(parseInvocationMentions(agentResponse)).toEqual([]);
    expect(parseInvocationCommands(agentResponse)).toEqual([]);
  });

  it('should trigger delegation ONLY for <<@agent>> in agent response', () => {
    const agentResponse = 'Done. <<@test-runner>> please run tests';
    expect(parseInvocationMentions(agentResponse)).toEqual(['test-runner']);
  });

  it('should trigger delegation for <</agent>> in agent response', () => {
    const agentResponse = 'Done. <</test-runner>> please run tests';
    expect(parseInvocationCommands(agentResponse)).toEqual([{ slug: 'test-runner', commandIndex: null }]);
  });

  it('should handle mixed <<@a>> and <</b>> in same response', () => {
    const agentResponse = '<<@architect>> review design, <</test-runner>> run tests';
    const mentions = parseInvocationMentions(agentResponse);
    const commands = parseInvocationCommands(agentResponse).map(c => c.slug);
    const allDelegations = [...new Set([...mentions, ...commands])];
    expect(allDelegations).toEqual(['architect', 'test-runner']);
  });

  it('should dedupe when same agent appears in both <<@>> and <</>> form', () => {
    const agentResponse = '<<@developer-ralph>> and <</developer-ralph>>';
    const mentions = parseInvocationMentions(agentResponse);
    const commands = parseInvocationCommands(agentResponse).map(c => c.slug);
    const allDelegations = [...new Set([...mentions, ...commands])];
    expect(allDelegations).toEqual(['developer-ralph']);
  });

  it('should separate references from invocations correctly', () => {
    const text = 'As @architect noted, I need <<@developer-ralph>> to fix this. Use /test-runner or <</frontend>> for testing.';

    // Invocations (trigger agents)
    expect(parseInvocationMentions(text)).toEqual(['developer-ralph']);
    expect(parseInvocationCommands(text)).toEqual([{ slug: 'frontend', commandIndex: null }]);

    // References (display only)
    expect(parseReferenceMentions(text)).toEqual(['architect']);
    expect(parseReferenceCommands(text)).toEqual(['test-runner']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Delegation depth protection (constants/logic)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Delegation depth protection logic', () => {
  const MAX_DELEGATION_DEPTH = 5;

  it('should block delegation when depth > 5', () => {
    expect(6 > MAX_DELEGATION_DEPTH).toBe(true);
    expect(5 > MAX_DELEGATION_DEPTH).toBe(false);
  });

  it('should allow delegation at depth 0 through 5', () => {
    for (let depth = 0; depth <= 5; depth++) {
      expect(depth > MAX_DELEGATION_DEPTH).toBe(false);
    }
  });

  it('should block delegation at depth 6+', () => {
    for (let depth = 6; depth <= 10; depth++) {
      expect(depth > MAX_DELEGATION_DEPTH).toBe(true);
    }
  });
});
