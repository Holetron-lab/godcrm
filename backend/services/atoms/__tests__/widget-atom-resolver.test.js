// ADR-0003 Phase 2 · T-127902 / T-127912
//
// Unit tests for widget-atom-resolver + widget-atom-serializer. No DB:
// the resolver takes an injected `loadWidget` loader so we can exercise
// happy-path, missing-widget, and merge precedence in isolation.

import { describe, it, expect } from 'vitest';
import { resolveWidgetAtom } from '../widget-atom-resolver.js';
import {
  serializeWidgetAtom,
  parseWidgetAtom,
  _stableStringify,
} from '../widget-atom-serializer.js';

function makeLoader(widgetsById) {
  return async (id) => widgetsById[id] ?? null;
}

describe('resolveWidgetAtom', () => {
  it('resolves happy-path: widget.config + no override', async () => {
    const atom = { widget_ref: 218 };
    const loadWidget = makeLoader({
      218: { id: 218, preset_name: 'bdd-panel', config: { cols: ['id', 'name'] }, title: 'ADRs' },
    });
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out.fallback).toBe(false);
    expect(out.preset).toBe('bdd-panel');
    expect(out.widget.id).toBe(218);
    expect(out.resolved_settings).toEqual({ cols: ['id', 'name'] });
  });

  it('shallow merge: settings_override wins over widget.config', async () => {
    const atom = {
      widget_ref: 9,
      settings_override: { b: 3, c: 4 },
    };
    const loadWidget = makeLoader({
      9: { id: 9, preset_name: 'ticket-filter', config: { a: 1, b: 2 } },
    });
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out.resolved_settings).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('parses widget.config when stored as a JSON string', async () => {
    const atom = { widget_ref: 5 };
    const loadWidget = makeLoader({
      5: { id: 5, preset_name: 'bdd-panel', config: '{"x":1}' },
    });
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out.resolved_settings).toEqual({ x: 1 });
  });

  it('broken widget_ref → fallback (widget_not_found)', async () => {
    const atom = { widget_ref: 9999 };
    const loadWidget = makeLoader({});
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out).toEqual({
      widget: null,
      fallback: true,
      reason: 'widget_not_found',
      widget_ref: 9999,
    });
  });

  it('missing widget_ref → fallback (no_widget_ref)', async () => {
    const out = await resolveWidgetAtom({ level: 'widget' }, { loadWidget: makeLoader({}) });
    expect(out.fallback).toBe(true);
    expect(out.reason).toBe('no_widget_ref');
  });

  it('non-numeric widget_ref → fallback', async () => {
    const out = await resolveWidgetAtom(
      { widget_ref: 'not-a-number' },
      { loadWidget: makeLoader({}) }
    );
    expect(out.fallback).toBe(true);
    expect(out.reason).toBe('no_widget_ref');
  });

  it('falls back to preset_name from config when widget.preset_name missing', async () => {
    const atom = { widget_ref: 7 };
    const loadWidget = makeLoader({
      7: { id: 7, preset_name: null, config: { preset_name: 'from-config' } },
    });
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out.preset).toBe('from-config');
  });

  it('empty override object is treated as no-op', async () => {
    const atom = { widget_ref: 1, settings_override: {} };
    const loadWidget = makeLoader({
      1: { id: 1, preset_name: 'bdd-panel', config: { a: 1 } },
    });
    const out = await resolveWidgetAtom(atom, { loadWidget });
    expect(out.resolved_settings).toEqual({ a: 1 });
  });
});

describe('serializeWidgetAtom / parseWidgetAtom', () => {
  it('serializes to the canonical 3-line fenced block', () => {
    const md = serializeWidgetAtom({
      widget_ref: 218,
      preset: 'bdd-panel',
      settings: { b: 2, a: 1 },
    });
    expect(md).toBe(
      '```widget:218 preset=bdd-panel\n{"a":1,"b":2}\n```'
    );
  });

  it('key order is deterministic regardless of input order', () => {
    const a = serializeWidgetAtom({ widget_ref: 1, preset: 'bdd-panel', settings: { z: 1, a: 2, m: 3 } });
    const b = serializeWidgetAtom({ widget_ref: 1, preset: 'bdd-panel', settings: { m: 3, a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('nested objects also sort keys deterministically', () => {
    const raw = { outer: { z: 1, a: 2 }, alpha: 9 };
    const s = _stableStringify(raw);
    expect(s).toBe('{"alpha":9,"outer":{"a":2,"z":1}}');
  });

  it('empty settings serialize to {}', () => {
    const md = serializeWidgetAtom({ widget_ref: 5, preset: 'default' });
    expect(md).toBe('```widget:5 preset=default\n{}\n```');
  });

  it('parseWidgetAtom extracts widget_ref, preset, settings_override', () => {
    const md = '```widget:42 preset=bdd-panel\n{"a":1,"b":2}\n```';
    expect(parseWidgetAtom(md)).toEqual({
      widget_ref: 42,
      preset: 'bdd-panel',
      settings_override: { a: 1, b: 2 },
    });
  });

  it('serialize → parse → serialize is a fixed point (canonical bytes)', () => {
    const md1 = serializeWidgetAtom({
      widget_ref: 218,
      preset: 'bdd-panel',
      settings: { c: 4, a: 1, b: 3 },
    });
    const parsed = parseWidgetAtom(md1);
    const md2 = serializeWidgetAtom({
      widget_ref: parsed.widget_ref,
      preset: parsed.preset,
      settings: parsed.settings_override,
    });
    expect(md2).toBe(md1);
  });

  it('round-trip through resolve: parse → resolve → serialize reproduces identical bytes', async () => {
    // Widget config + atom override. The full round-trip goes:
    //   md → parse → atom → resolve → {preset, resolved_settings}
    //   → serialize(resolved_settings) === md
    // Invariant: resolved_settings ⊇ widget.config by shallow merge, so
    // serialising the resolved map and re-parsing yields the same override,
    // which re-resolves to the same resolved_settings (idempotent).
    const widget = { id: 77, preset_name: 'bdd-panel', config: { a: 1, b: 2 } };
    const loadWidget = makeLoader({ 77: widget });

    const initialResolved = { a: 1, b: 3, c: 4 };
    const md1 = serializeWidgetAtom({
      widget_ref: 77,
      preset: 'bdd-panel',
      settings: initialResolved,
    });

    const parsed = parseWidgetAtom(md1);
    const resolved = await resolveWidgetAtom(
      { widget_ref: parsed.widget_ref, settings_override: parsed.settings_override },
      { loadWidget }
    );
    expect(resolved.fallback).toBe(false);
    expect(resolved.resolved_settings).toEqual(initialResolved);

    const md2 = serializeWidgetAtom({
      widget_ref: parsed.widget_ref,
      preset: resolved.preset,
      settings: resolved.resolved_settings,
    });
    expect(md2).toBe(md1);
  });

  it('parse rejects malformed input', () => {
    expect(() => parseWidgetAtom('not a fence')).toThrow();
    expect(() => parseWidgetAtom('```widget:abc preset=x\n{}\n```')).toThrow();
    expect(() => parseWidgetAtom('```widget:1 preset=bad name\n{}\n```')).toThrow();
    expect(() => parseWidgetAtom('```widget:1 preset=x\n{bad json}\n```')).toThrow();
    expect(() => parseWidgetAtom('```widget:1 preset=x\n[1,2,3]\n```')).toThrow();
  });

  it('serialize rejects invalid inputs', () => {
    expect(() => serializeWidgetAtom({ widget_ref: 0, preset: 'x' })).toThrow();
    expect(() => serializeWidgetAtom({ widget_ref: 1, preset: '' })).toThrow();
    expect(() => serializeWidgetAtom({ widget_ref: 1, preset: 'has spaces' })).toThrow();
  });
});
