import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast } from './visual.mjs';
import { metricsValue } from './metrics.mjs';
test('computed contrast for accepted Type style', () => {
  const ratio = contrast({ color: 'rgb(255, 255, 255)', backgrounds: [{ color: 'rgb(29, 78, 216)', opacity: '1', image: 'none' }] });
  assert.ok(ratio > 6.7 && ratio < 6.71);
});
test('unsupported gradient/opacity never becomes PASS', () => {
  assert.ok(Number.isNaN(contrast({ color: 'white', backgrounds: [] })));
  assert.ok(Number.isNaN(contrast({ color: 'rgb(255, 255, 255)', backgrounds: [{ color: 'rgb(0, 0, 0)', opacity: '.5', image: 'none' }] })));
});
test('missing metrics stay undefined', () => {
  assert.deepEqual(metricsValue({ lcp: [], inp: [], cls: [], clsObserved: false }), { lcp: undefined, inp: undefined, cls: undefined });
});
test('INP groups interactions; CLS uses sessions', () => {
  const result = metricsValue({ lcp: [123], inp: [{id:1,duration:30},{id:1,duration:50},{id:2,duration:20}], cls: [{time:0,value:.1},{time:100,value:.2},{time:2000,value:.2}], clsObserved: true });
  assert.equal(result.inp,50); assert.ok(Math.abs(result.cls-.3)<1e-6); assert.equal(result.lcp,123);
});
test('observed no-shift CLS is a valid zero', () => {
  assert.equal(metricsValue({ lcp:[],inp:[],cls:[],clsObserved:true }).cls,0);
});
