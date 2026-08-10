import { describe, it, expect } from 'vitest';
import {
  normalizeCheckboxes,
  toggleCheckboxByIndex,
  getCheckboxContext,
  denormalizeCheckboxes,
} from '../markdownCheckbox';

describe('markdownCheckbox', () => {
  describe('normalizeCheckboxes', () => {
    it('passes through standard GFM task lists unchanged', () => {
      const input = '- [ ] Unchecked\n- [x] Checked\n- [X] Also checked';
      expect(normalizeCheckboxes(input)).toBe(input);
    });

    it('converts [*] syntax to [x]', () => {
      expect(normalizeCheckboxes('- [*] Done task')).toBe('- [x] Done task');
    });

    it('converts standalone [*] at line start', () => {
      expect(normalizeCheckboxes('[*] Done task')).toBe('- [x] Done task');
    });

    it('converts ☐ to - [ ]', () => {
      expect(normalizeCheckboxes('- ☐ Not done')).toBe('- [ ] Not done');
    });

    it('converts ☑ to - [x]', () => {
      expect(normalizeCheckboxes('- ☑ Done')).toBe('- [x] Done');
    });

    it('converts ✅ to - [x]', () => {
      expect(normalizeCheckboxes('- ✅ Done')).toBe('- [x] Done');
    });

    it('converts ⬜ to - [ ]', () => {
      expect(normalizeCheckboxes('- ⬜ Not done')).toBe('- [ ] Not done');
    });

    it('converts □ to - [ ]', () => {
      expect(normalizeCheckboxes('- □ Not done')).toBe('- [ ] Not done');
    });

    it('converts ■ to - [x]', () => {
      expect(normalizeCheckboxes('- ■ Done')).toBe('- [x] Done');
    });

    it('converts ✓ to - [x]', () => {
      expect(normalizeCheckboxes('- ✓ Done')).toBe('- [x] Done');
    });

    it('converts ☒ to - [x]', () => {
      expect(normalizeCheckboxes('- ☒ Done')).toBe('- [x] Done');
    });

    it('converts standalone unicode at line start (no list marker)', () => {
      expect(normalizeCheckboxes('☐ Not done')).toBe('- [ ] Not done');
      expect(normalizeCheckboxes('☑ Done')).toBe('- [x] Done');
      expect(normalizeCheckboxes('✅ Done')).toBe('- [x] Done');
    });

    it('handles mixed content with headings and paragraphs', () => {
      const input = '# Title\n\nSome text\n\n- ☐ Task 1\n- ☑ Task 2\n\nMore text';
      const expected = '# Title\n\nSome text\n\n- [ ] Task 1\n- [x] Task 2\n\nMore text';
      expect(normalizeCheckboxes(input)).toBe(expected);
    });

    it('does not modify lines without checkbox patterns', () => {
      const input = 'Regular text\n- Regular list item\n## Heading';
      expect(normalizeCheckboxes(input)).toBe(input);
    });
  });

  describe('toggleCheckboxByIndex', () => {
    it('toggles unchecked to checked', () => {
      const input = '- [ ] Task 1\n- [ ] Task 2';
      expect(toggleCheckboxByIndex(input, 0)).toBe('- [x] Task 1\n- [ ] Task 2');
    });

    it('toggles checked to unchecked', () => {
      const input = '- [x] Task 1\n- [ ] Task 2';
      expect(toggleCheckboxByIndex(input, 0)).toBe('- [ ] Task 1\n- [ ] Task 2');
    });

    it('toggles the correct checkbox by index', () => {
      const input = '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3';
      expect(toggleCheckboxByIndex(input, 1)).toBe('- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3');
      expect(toggleCheckboxByIndex(input, 2)).toBe('- [ ] Task 1\n- [ ] Task 2\n- [x] Task 3');
    });

    it('handles content with non-checkbox lines between checkboxes', () => {
      const input = '# Heading\n- [ ] Task 1\nSome text\n- [x] Task 2';
      expect(toggleCheckboxByIndex(input, 0)).toBe('# Heading\n- [x] Task 1\nSome text\n- [x] Task 2');
      expect(toggleCheckboxByIndex(input, 1)).toBe('# Heading\n- [ ] Task 1\nSome text\n- [ ] Task 2');
    });

    it('handles uppercase X', () => {
      const input = '- [X] Done';
      expect(toggleCheckboxByIndex(input, 0)).toBe('- [ ] Done');
    });

    it('returns unchanged content for out-of-range index', () => {
      const input = '- [ ] Only task';
      expect(toggleCheckboxByIndex(input, 5)).toBe(input);
    });
  });

  describe('getCheckboxContext', () => {
    it('returns the nearest heading and line text', () => {
      const input = '## Section A\n- [ ] Task 1\n## Section B\n- [ ] Task 2';
      expect(getCheckboxContext(input, 0)).toEqual({ lineText: 'Task 1', heading: 'Section A' });
      expect(getCheckboxContext(input, 1)).toEqual({ lineText: 'Task 2', heading: 'Section B' });
    });

    it('returns empty heading if no heading above', () => {
      const input = '- [ ] Task 1\n## Heading\n- [ ] Task 2';
      expect(getCheckboxContext(input, 0)).toEqual({ lineText: 'Task 1', heading: '' });
    });

    it('handles h1, h2, h3 headings', () => {
      const input = '# H1\n## H2\n### H3\n- [ ] Task';
      expect(getCheckboxContext(input, 0)).toEqual({ lineText: 'Task', heading: 'H3' });
    });

    it('returns empty for out-of-range index', () => {
      const input = '- [ ] Only task';
      expect(getCheckboxContext(input, 5)).toEqual({ lineText: '', heading: '' });
    });
  });

  describe('denormalizeCheckboxes', () => {
    it('returns GFM content unchanged when original used GFM', () => {
      const content = '- [x] Done\n- [ ] Not done';
      const original = '- [x] Original\n- [ ] Original 2';
      expect(denormalizeCheckboxes(content, original)).toBe(content);
    });

    it('converts back to ☐/☑ when original used those', () => {
      const content = '- [x] Done\n- [ ] Not done';
      const original = '- ☐ Original\n- ☑ Original 2';
      const result = denormalizeCheckboxes(content, original);
      expect(result).toBe('- ☑ Done\n- ☐ Not done');
    });

    it('converts back to ✅/⬜ when original used those', () => {
      const content = '- [x] Done\n- [ ] Not done';
      const original = '- ✅ Original\n- ⬜ Original 2';
      const result = denormalizeCheckboxes(content, original);
      expect(result).toBe('- ✅ Done\n- ⬜ Not done');
    });

    it('preserves non-checkbox lines', () => {
      const content = '# Heading\n- [x] Done\nText\n- [ ] Not done';
      const original = '# Heading\n- ☑ Original\nText\n- ☐ Original 2';
      const result = denormalizeCheckboxes(content, original);
      expect(result).toBe('# Heading\n- ☑ Done\nText\n- ☐ Not done');
    });

    it('handles standalone unicode (no list marker in original)', () => {
      const content = '- [x] Done\n- [ ] Not done';
      const original = '☑ Original\n☐ Original 2';
      const result = denormalizeCheckboxes(content, original);
      expect(result).toBe('☑ Done\n☐ Not done');
    });
  });
});
