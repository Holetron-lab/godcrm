/**
 * ADR-091 Phase 2 / Ticket #41161 (AC17): Unit tests for response-mode utilities
 *
 * Tests for isMessageRelevantToAgent() and extractKeywords().
 * These functions power the `topic_only` response mode, where an agent
 * only auto-responds when the message matches its area of expertise.
 */

import { describe, it, expect } from 'vitest';
import { isMessageRelevantToAgent, extractKeywords, STOP_WORDS } from '../response-mode.js';

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------
describe('extractKeywords', () => {
  it('extracts meaningful words from plain text', () => {
    const keywords = extractKeywords('The quick brown fox jumps over the lazy dog');
    expect(keywords).toContain('quick');
    expect(keywords).toContain('brown');
    expect(keywords).toContain('fox');
    expect(keywords).toContain('jumps');
    expect(keywords).toContain('lazy');
    expect(keywords).toContain('dog');
  });

  it('filters out common stop words', () => {
    const keywords = extractKeywords('the a an is are was were be been being have has had');
    expect(keywords).toEqual([]);
  });

  it('filters out words shorter than 3 characters', () => {
    const keywords = extractKeywords('AI is an ok ML tool');
    // 'tool' is the only word with 3+ chars that is not a stop word
    expect(keywords).toContain('tool');
    expect(keywords).not.toContain('AI');
    expect(keywords).not.toContain('is');
    expect(keywords).not.toContain('an');
    expect(keywords).not.toContain('ok');
    expect(keywords).not.toContain('ML');
  });

  it('returns lowercased keywords', () => {
    const keywords = extractKeywords('JavaScript TypeScript React');
    expect(keywords).toContain('javascript');
    expect(keywords).toContain('typescript');
    expect(keywords).toContain('react');
  });

  it('de-duplicates keywords', () => {
    const keywords = extractKeywords('sales sales Sales SALES');
    const salesCount = keywords.filter(k => k === 'sales').length;
    expect(salesCount).toBe(1);
  });

  it('handles punctuation and special characters', () => {
    const keywords = extractKeywords('CRM-based, project! management (system)');
    expect(keywords).toContain('crm');
    expect(keywords).toContain('based');
    expect(keywords).toContain('project');
    expect(keywords).toContain('management');
    expect(keywords).toContain('system');
  });

  it('returns empty array for null/undefined/empty input', () => {
    expect(extractKeywords(null)).toEqual([]);
    expect(extractKeywords(undefined)).toEqual([]);
    expect(extractKeywords('')).toEqual([]);
  });

  it('returns empty array for non-string input', () => {
    expect(extractKeywords(123)).toEqual([]);
    expect(extractKeywords({})).toEqual([]);
  });

  it('handles text with only stop words', () => {
    expect(extractKeywords('the and for with from')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STOP_WORDS set
// ---------------------------------------------------------------------------
describe('STOP_WORDS', () => {
  it('is a non-empty Set', () => {
    expect(STOP_WORDS).toBeInstanceOf(Set);
    expect(STOP_WORDS.size).toBeGreaterThan(0);
  });

  it('contains common English stop words', () => {
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('and')).toBe(true);
    expect(STOP_WORDS.has('for')).toBe(true);
    expect(STOP_WORDS.has('with')).toBe(true);
  });

  it('contains agent-domain generic words', () => {
    expect(STOP_WORDS.has('agent')).toBe(true);
    expect(STOP_WORDS.has('assistant')).toBe(true);
    expect(STOP_WORDS.has('help')).toBe(true);
    expect(STOP_WORDS.has('respond')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isMessageRelevantToAgent
// ---------------------------------------------------------------------------
describe('isMessageRelevantToAgent', () => {
  // --- Matching cases ---

  it('returns true when message contains keyword from agent description', () => {
    const agent = {
      name: 'Sales Bot',
      description: 'Handles sales pipeline and revenue tracking',
      system_prompt: 'You are a sales assistant.'
    };
    expect(isMessageRelevantToAgent('What is our current revenue?', agent)).toBe(true);
  });

  it('returns true when message contains keyword from agent name', () => {
    const agent = {
      name: 'Billing Support',
      description: 'Answers billing questions'
    };
    expect(isMessageRelevantToAgent('I need billing information', agent)).toBe(true);
  });

  it('returns true when message contains keyword from system_prompt', () => {
    const agent = {
      name: 'Code Helper',
      description: 'Helps with code',
      system_prompt: 'You specialize in JavaScript, TypeScript, and Python programming.'
    };
    expect(isMessageRelevantToAgent('How do I write a function in Python?', agent)).toBe(true);
  });

  it('returns true when message contains keyword from main_instructions', () => {
    const agent = {
      name: 'HR Bot',
      main_instructions: 'Handle recruitment, onboarding, and payroll inquiries.'
    };
    expect(isMessageRelevantToAgent('When is my next payroll date?', agent)).toBe(true);
  });

  it('returns true when message contains keyword from tags (array)', () => {
    const agent = {
      name: 'Data Bot',
      description: 'Data tasks',
      tags: ['analytics', 'reporting', 'dashboards']
    };
    expect(isMessageRelevantToAgent('Can you build me a dashboard for reporting?', agent)).toBe(true);
  });

  it('returns true when message contains keyword from tags (string)', () => {
    const agent = {
      name: 'Ops Bot',
      description: 'Operations',
      tags: 'infrastructure deployment monitoring'
    };
    expect(isMessageRelevantToAgent('Check the monitoring status', agent)).toBe(true);
  });

  it('is case-insensitive', () => {
    const agent = {
      name: 'Marketing Agent',
      description: 'SEO and Content Marketing campaigns'
    };
    expect(isMessageRelevantToAgent('Tell me about SEO best practices', agent)).toBe(true);
    expect(isMessageRelevantToAgent('tell me about seo best practices', agent)).toBe(true);
    expect(isMessageRelevantToAgent('TELL ME ABOUT SEO BEST PRACTICES', agent)).toBe(true);
  });

  // --- Non-matching cases ---

  it('returns false when message has no overlap with agent keywords', () => {
    const agent = {
      name: 'Sales Bot',
      description: 'Handles sales pipeline and revenue tracking',
      system_prompt: 'You are a sales assistant.'
    };
    expect(isMessageRelevantToAgent('What is the weather today?', agent)).toBe(false);
  });

  it('returns false when message contains only stop words that match', () => {
    const agent = {
      name: 'The Helper Agent',
      description: 'An assistant that helps with things'
    };
    // "the", "helper", "agent", "assistant", "help", "things" -- "helper" and "things" are not stop words
    // But the message only has stop words
    expect(isMessageRelevantToAgent('the and or for with', agent)).toBe(false);
  });

  // --- Edge cases ---

  it('returns false for null messageContent', () => {
    const agent = { name: 'Bot', description: 'test' };
    expect(isMessageRelevantToAgent(null, agent)).toBe(false);
  });

  it('returns false for empty string messageContent', () => {
    const agent = { name: 'Bot', description: 'test' };
    expect(isMessageRelevantToAgent('', agent)).toBe(false);
  });

  it('returns false for non-string messageContent', () => {
    const agent = { name: 'Bot', description: 'test' };
    expect(isMessageRelevantToAgent(123, agent)).toBe(false);
    expect(isMessageRelevantToAgent({}, agent)).toBe(false);
  });

  it('returns false for null agentConfig', () => {
    expect(isMessageRelevantToAgent('some message', null)).toBe(false);
  });

  it('returns false for undefined agentConfig', () => {
    expect(isMessageRelevantToAgent('some message', undefined)).toBe(false);
  });

  it('returns false for non-object agentConfig', () => {
    expect(isMessageRelevantToAgent('some message', 'not an object')).toBe(false);
  });

  it('returns false for agent with no name/description/prompt/tags', () => {
    expect(isMessageRelevantToAgent('some message', {})).toBe(false);
    expect(isMessageRelevantToAgent('some message', { id: 1 })).toBe(false);
  });

  it('returns false when agent config yields only stop words as keywords', () => {
    const agent = {
      name: 'The',
      description: 'An assistant that can help',
    };
    // All meaningful words from config ("assistant", "help") are in STOP_WORDS
    expect(isMessageRelevantToAgent('random unrelated message', agent)).toBe(false);
  });

  it('handles agent config where description contains numbers', () => {
    const agent = {
      name: 'Finance Bot',
      description: 'Tracks Q4 2025 quarterly earnings and 10K filings'
    };
    expect(isMessageRelevantToAgent('What about our quarterly earnings?', agent)).toBe(true);
  });

  it('handles substring matching correctly (keyword is part of message word)', () => {
    const agent = {
      name: 'Data Analyst',
      description: 'Handles database queries and data analysis'
    };
    // "database" contains "data" as a substring, and "data" is a keyword
    expect(isMessageRelevantToAgent('I need database queries', agent)).toBe(true);
  });

  it('works with a realistic multi-field agent config', () => {
    const agent = {
      name: 'DevOps Engineer',
      description: 'Manages CI/CD pipelines, Kubernetes clusters, and cloud infrastructure',
      system_prompt: 'You are a DevOps specialist. Help with Docker, Terraform, AWS, and deployment automation.',
      main_instructions: 'Monitor uptime, handle incidents, optimize costs.',
      tags: ['devops', 'infrastructure', 'cloud', 'kubernetes']
    };

    // Relevant messages
    expect(isMessageRelevantToAgent('How do I deploy to Kubernetes?', agent)).toBe(true);
    expect(isMessageRelevantToAgent('Set up a Docker container for the API', agent)).toBe(true);
    expect(isMessageRelevantToAgent('What are our cloud infrastructure costs?', agent)).toBe(true);
    expect(isMessageRelevantToAgent('Help with terraform modules', agent)).toBe(true);

    // Irrelevant messages
    expect(isMessageRelevantToAgent('What are the sales numbers for Q4?', agent)).toBe(false);
    expect(isMessageRelevantToAgent('Schedule a team meeting for Monday', agent)).toBe(false);
  });
});
