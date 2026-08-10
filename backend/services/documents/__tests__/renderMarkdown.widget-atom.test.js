// ADR-0005 §C-10 · Phase 8b — widget-atom self-contained snapshots.
//
// Pure unit tests for atomsToMarkdown / loadWidgetsForAtoms (no DB).
// Confirms:
//  - widget atoms emit the canonical fenced block from
//    widget-atom-serializer.js
//  - the block round-trips through parseWidgetAtom
//  - a missing widget falls back to the `missing` placeholder
//  - non-widget atoms render unchanged
//
// Test isolation: this file is fully synchronous and has zero DB reach,
// so the ADR-0009 boot guard is a no-op here.

import { describe, it, expect } from 'vitest';
import { atomsToMarkdown, loadWidgetsForAtoms } from '../renderMarkdown.js';
import {
  serializeWidgetAtom,
  parseWidgetAtom,
} from '../../atoms/widget-atom-serializer.js';

const FENCE = '```';

describe('atomsToMarkdown — widget atoms (ADR-0005 §C-10 / Phase 8b)', () => {
  it('emits canonical block for widget atom with explicit widgetMap', () => {
    const atoms = [
      { level: 'h1', content: 'Doc title' },
      { level: 'text', content: 'Intro paragraph.' },
      {
        level: 'widget',
        widget_ref: 218,
        settings_override: { density: 'compact' },
      },
    ];
    const widgetMap = {
      218: { id: 218, preset_name: 'tickets-list', config: {} },
    };
    const md = atomsToMarkdown(atoms, widgetMap);

    expect(md).toContain('# Doc title');
    expect(md).toContain('Intro paragraph.');
    // Canonical fenced block format
    expect(md).toContain(`${FENCE}widget:218 preset=tickets-list`);
    // Body is the canonical settings JSON
    expect(md).toContain('{"density":"compact"}');
  });

  it('round-trips: serialize → parse yields {widget_ref, preset, settings_override}', () => {
    const atom = {
      level: 'widget',
      widget_ref: 42,
      settings_override: { a: 1, b: 'two', nested: { z: true } },
    };
    const widgetMap = {
      42: { id: 42, preset_name: 'documents', config: {} },
    };
    const md = atomsToMarkdown([atom], widgetMap);

    // Extract just the fenced block (no preceding atoms here, so md IS the block).
    const parsed = parseWidgetAtom(md);
    expect(parsed.widget_ref).toBe(42);
    expect(parsed.preset).toBe('documents');
    expect(parsed.settings_override).toEqual({ a: 1, b: 'two', nested: { z: true } });
  });

  it('round-trips deterministically: serialize(parse(serialize(x))) === serialize(x)', () => {
    const block = serializeWidgetAtom({
      widget_ref: 7,
      preset: 'bdd-panel',
      settings: { cols: ['id', 'name'], collapsed: false },
    });
    const parsed = parseWidgetAtom(block);
    const reSerialized = serializeWidgetAtom({
      widget_ref: parsed.widget_ref,
      preset: parsed.preset,
      settings: parsed.settings_override,
    });
    expect(reSerialized).toBe(block);
  });

  it('falls back to `missing` marker when widgetMap key is null', () => {
    const atoms = [
      { level: 'widget', widget_ref: 999, settings_override: { x: 1 } },
    ];
    const widgetMap = { 999: null };  // explicit "we looked, it's gone"
    const md = atomsToMarkdown(atoms, widgetMap);

    expect(md).toBe(`${FENCE}widget:999 missing\n${FENCE}`);
    // Missing-marker is intentionally NOT round-trip safe — parseWidgetAtom
    // rejects it because there is no `preset=...` segment. The marker is
    // for archive/human consumption only.
    expect(() => parseWidgetAtom(md)).toThrow();
  });

  it('falls back to `missing` marker when widgetMap key is absent', () => {
    const atoms = [{ level: 'widget', widget_ref: 123 }];
    const widgetMap = {};  // 123 not present → treat as missing
    const md = atomsToMarkdown(atoms, widgetMap);
    expect(md).toBe(`${FENCE}widget:123 missing\n${FENCE}`);
  });

  it('uses atom.preset when no widgetMap is provided (atom-as-source-of-truth)', () => {
    const atoms = [
      {
        level: 'widget',
        widget_ref: 5,
        preset: 'documents',
        settings_override: { foo: 'bar' },
      },
    ];
    const md = atomsToMarkdown(atoms);  // no widgetMap

    expect(md).toContain(`${FENCE}widget:5 preset=documents`);
    expect(md).toContain('{"foo":"bar"}');
    const parsed = parseWidgetAtom(md);
    expect(parsed.widget_ref).toBe(5);
    expect(parsed.preset).toBe('documents');
    expect(parsed.settings_override).toEqual({ foo: 'bar' });
  });

  it('emits widget:0 missing for widget atom with no usable widget_ref', () => {
    const atoms = [{ level: 'widget' /* no widget_ref */ }];
    const md = atomsToMarkdown(atoms);
    expect(md).toBe(`${FENCE}widget:0 missing\n${FENCE}`);
  });

  it('does not affect non-widget atoms (regression guard)', () => {
    const atoms = [
      { level: 'h1', content: 'Title' },
      { level: 'h2', content: 'Sub' },
      { level: 'h3', content: 'Sub-sub' },
      { level: 'divider' },
      { level: 'text', content: 'A paragraph.' },
    ];
    const md = atomsToMarkdown(atoms);
    expect(md).toBe('# Title\n\n## Sub\n\n### Sub-sub\n\n---\n\nA paragraph.');
  });

  it('mixes paragraph + widget atom into one canonical snapshot', () => {
    const atoms = [
      { level: 'text', content: 'Paragraph before the widget.' },
      { level: 'widget', widget_ref: 18, settings_override: {} },
      { level: 'text', content: 'Paragraph after.' },
    ];
    const widgetMap = {
      18: { id: 18, preset_name: 'tickets-list', config: {} },
    };
    const md = atomsToMarkdown(atoms, widgetMap);

    const expectedBlock = serializeWidgetAtom({
      widget_ref: 18,
      preset: 'tickets-list',
      settings: {},
    });
    expect(md).toBe(
      `Paragraph before the widget.\n\n${expectedBlock}\n\nParagraph after.`
    );

    // Round-trip: parse the embedded block back out.
    const parsed = parseWidgetAtom(expectedBlock);
    expect(parsed).toEqual({
      widget_ref: 18,
      preset: 'tickets-list',
      settings_override: {},
    });
  });

  it('settings_override falls back to {} for non-object/array values', () => {
    const atoms = [
      { level: 'widget', widget_ref: 1, settings_override: 'oops' },
      { level: 'widget', widget_ref: 2, settings_override: ['arr', 'is', 'invalid'] },
      { level: 'widget', widget_ref: 3, settings_override: null },
    ];
    const widgetMap = {
      1: { id: 1, preset_name: 'p', config: {} },
      2: { id: 2, preset_name: 'p', config: {} },
      3: { id: 3, preset_name: 'p', config: {} },
    };
    const md = atomsToMarkdown(atoms, widgetMap);
    // All three should serialize with empty `{}` body.
    const blocks = md.split('\n\n');
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).toMatch(/preset=p\n\{\}\n```$/);
    }
  });
});

describe('loadWidgetsForAtoms — DI loader (no DB)', () => {
  it('returns a map of {widgetId → widget|null} keyed by atom widget_refs', async () => {
    const atoms = [
      { level: 'h1', content: 'x' },
      { level: 'widget', widget_ref: 10 },
      { level: 'widget', widget_ref: 20 },
      { level: 'widget', widget_ref: 999 },  // gone
    ];
    const calls = [];
    const loadWidget = async (id) => {
      calls.push(id);
      if (id === 10) return { id: 10, preset_name: 'a', config: {} };
      if (id === 20) return { id: 20, preset_name: 'b', config: {} };
      return null;
    };
    const map = await loadWidgetsForAtoms(atoms, { loadWidget });
    expect(map[10]).toMatchObject({ id: 10, preset_name: 'a' });
    expect(map[20]).toMatchObject({ id: 20, preset_name: 'b' });
    expect(map[999]).toBeNull();
    expect(calls.sort()).toEqual([10, 20, 999]);
  });

  it('returns {} for empty atoms or atoms with no widget refs', async () => {
    expect(await loadWidgetsForAtoms([])).toEqual({});
    expect(await loadWidgetsForAtoms([{ level: 'h1', content: 'x' }])).toEqual({});
  });

  it('skips invalid widget_refs (non-numeric, zero, negative)', async () => {
    const atoms = [
      { level: 'widget', widget_ref: null },
      { level: 'widget', widget_ref: 0 },
      { level: 'widget', widget_ref: -5 },
      { level: 'widget', widget_ref: 'abc' },
    ];
    const loadWidget = async () => ({ id: 1, preset_name: 'never-called', config: {} });
    const map = await loadWidgetsForAtoms(atoms, { loadWidget });
    expect(map).toEqual({});
  });

  it('treats loader exceptions as "missing" (null in map)', async () => {
    const atoms = [{ level: 'widget', widget_ref: 7 }];
    const loadWidget = async () => { throw new Error('db down'); };
    const map = await loadWidgetsForAtoms(atoms, { loadWidget });
    expect(map[7]).toBeNull();
  });
});

describe('end-to-end: atoms → markdown → parse', () => {
  it('document with one paragraph + one widget-atom snapshots correctly', () => {
    const atoms = [
      { level: 'text', content: 'Hello world.' },
      {
        level: 'widget',
        widget_ref: 218,
        settings_override: { display_mode: 'card', filter_status: 'open' },
      },
    ];
    const widgetMap = {
      218: { id: 218, preset_name: 'tickets-list', config: {} },
    };
    const md = atomsToMarkdown(atoms, widgetMap);

    // Snapshot must contain plaintext paragraph followed by canonical block.
    expect(md.startsWith('Hello world.\n\n')).toBe(true);

    // Extract the widget block (everything after the first '\n\n').
    const block = md.slice(md.indexOf('\n\n') + 2);
    const parsed = parseWidgetAtom(block);
    expect(parsed).toEqual({
      widget_ref: 218,
      preset: 'tickets-list',
      settings_override: { display_mode: 'card', filter_status: 'open' },
    });
  });
});
