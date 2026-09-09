import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOtcMicro, STRATEGIES, strat10s, strat15s, strat2m, strat5m } from '../lib/otcMicroStrategies.js';

// Deterministic candle factory: baseline range with configurable overrides for
// the final candles.
function candles(n, transform = (c, i) => c) {
  const out = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 7) * 0.15;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + 0.08;
    const low = Math.min(open, close) - 0.08;
    out.push(transform({ open, high, low, close, time: 1700000000000 + i * 60000 }, i));
    price = close;
  }
  return out;
}

test('metadata covers all six horizons', () => {
  assert.deepEqual(Object.keys(STRATEGIES).map(Number).sort((a, b) => a - b), [10, 15, 30, 60, 120, 300]);
});

test('every horizon returns a decision object on normal data', () => {
  const res = analyzeOtcMicro(candles(140));
  for (const key of ['10', '15', '30', '60', '120', '300']) {
    assert.ok(res[key], `missing horizon ${key}`);
    assert.equal(res[key].horizonSeconds, Number(key));
    assert.ok(['BUY', 'SELL', null].includes(res[key].direction));
  }
});

test('insufficient data yields SKIPPED, not a crash', () => {
  const res = analyzeOtcMicro(candles(20));
  assert.equal(res['300'].qualified, false);
  assert.ok(res['300'].tags.includes('SKIPPED'));
});

test('10s: long lower wick fades to BUY', () => {
  const data = candles(60);
  const last = data.at(-1);
  data[data.length - 1] = { ...last, low: last.close - 1.2, high: last.open + 0.1 };
  const r = strat10s(data);
  assert.equal(r.direction, 'BUY');
  assert.ok(r.tags.includes('LOWER_WICK_REJECTION'));
});

test('15s: bull streak fades to SELL; breakout acceptance disqualifies', () => {
  const base = candles(56);
  const p = base.at(-1).close;
  const data = base.concat([56, 57, 58, 59].map(i => ({
    open: p, close: p + 0.1, high: p + 0.2, low: p - 0.05, time: 1700000000000 + i * 60000,
  })));
  const r = strat15s(data);
  assert.equal(r.direction, 'SELL');
  assert.ok(r.tags.includes('BULL_STREAK_4'));
  assert.equal(r.qualified, true);
  // Now a breakout-acceptance close on top of the streak must kill the fade.
  const brk = data.slice(0, -1).concat([{ open: p, close: p + 0.9, high: p + 1, low: p - 0.05, time: 1700000000000 + 59 * 60000 }]);
  const rb = strat15s(brk);
  assert.ok(rb.tags.includes('BREAKOUT_INVALIDATES_FADE'));
  assert.equal(rb.qualified, false);
});

test('15s: breakout close invalidates the fade (never fires SELL into bull breakout)', () => {
  const data = candles(60, (c, i) => i >= 56 ? { ...c, open: c.close - 0.4, close: c.close + 0.4 } : c);
  const last = data.at(-1);
  data[data.length - 1] = { ...last, close: last.high + 0.9, open: last.open };
  const r = strat15s(data);
  assert.ok(r.tags.includes('BREAKOUT_INVALIDATES_FADE'));
  assert.equal(r.qualified, false);
});

test('2m: trend with EMA20 pullback rejection qualifies; without pullback it is gated', () => {
  const rising = candles(120, (c, i) => ({ ...c, close: 100 + i * 0.25, open: 100 + i * 0.25 - 0.2, high: 100 + i * 0.25 + 0.05, low: 100 + i * 0.25 - 0.3 }));
  const withPullback = rising.slice(0, 118).concat([117, 118, 119].map(i => ({
    open: 127.0, close: 127.3, high: 127.5, low: 126.9, time: 1700000000000 + i * 60000,
  })));
  assert.equal(strat2m(withPullback).qualified, true);
  assert.equal(strat2m(rising).qualified, false);
});

test('5m: sweep of prior low that closes back inside fades to BUY', () => {
  const data = candles(140);
  const last = data.at(-1);
  data[data.length - 1] = { ...last, low: last.close - 2.5, close: last.close + 0.3 };
  const r = strat5m(data);
  assert.equal(r.direction, 'BUY');
  assert.ok(r.tags.includes('SELL_SIDE_SWEEP'));
  assert.equal(r.qualified, true);
});

test('chop regime suppresses qualification across strategies', () => {
  // Four overlapping doji-like candles inside a tiny box.
  const data = candles(60, (c, i) => i >= 56 ? { open: 100, close: 100.02, high: 100.06, low: 99.96 } : c);
  const res = analyzeOtcMicro(data);
  for (const key of ['10', '15', '30', '60']) {
    assert.equal(res[key].filters.chop, true, `chop not detected at ${key}`);
  }
});
