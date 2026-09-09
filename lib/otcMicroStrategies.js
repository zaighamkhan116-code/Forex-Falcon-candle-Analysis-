// OTC micro-horizon strategies: 10s, 15s, 30s, 1m, 2m, 5m.
// Built for Quotex OTC feeds where prices are engine-generated: the only stable
// edge sources are microstructure behavior (mean reversion, wick rejection,
// streak exhaustion) and hard filters (chop, extension). No strategy here is
// predictive of a synthetic server; each is a conditional-reversion or
// conditional-continuation bet with explicit invalidation.
//
// Inputs: completed M1 candles (collector JSONL ticks can be resampled to M1)
// and optionally a recent tick array [{price, timestamp_ms}] for sub-minute
// context. Output: one decision per horizon with direction, confidence,
// qualified flag and the logic tags that produced it.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sign = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
};
const emaSeries = (a, p) => {
  if (!a.length) return [];
  const k = 2 / (p + 1);
  const out = [a[0]];
  for (let i = 1; i < a.length; i++) out.push(a[i] * k + out[i - 1] * (1 - k));
  return out;
};
const ema = (a, p) => emaSeries(a, p).at(-1) ?? null;

function metrics(c) {
  const rng = v => Math.max(v.high - v.low, 1e-12);
  const body = v => Math.abs(v.close - v.open) / rng(v);
  const upper = v => (v.high - Math.max(v.open, v.close)) / rng(v);
  const lower = v => (Math.min(v.open, v.close) - v.low) / rng(v);
  const dir = v => sign(v.close - v.open);
  return { rng, body, upper, lower, dir };
}

function candleMetrics(c) {
  const m = metrics(c);
  const s = c.slice(-12);
  const ranges = s.map(m.rng);
  const avgRange = mean(ranges.slice(-8));
  return { ...m, avgRange };
}

// Shared OTC regime filters. Returns penalties (0-10) and tags.
function regimeFilters(c) {
  const { rng, body, upper, lower, dir, avgRange } = candleMetrics(c);
  const s = c.slice(-5);
  const last = s.at(-1);
  const prior = s.slice(0, -1);
  const priorHigh = Math.max(...prior.map(v => v.high));
  const priorLow = Math.min(...prior.map(v => v.low));
  const tol = Math.max(avgRange * 0.28, Math.abs(last.close) * 1e-7);

  // Overlapping micro-range + small bodies = chop: fade bets die here.
  const overlapHigh = Math.min(...s.slice(-4).map(v => v.high));
  const overlapLow = Math.max(...s.slice(-4).map(v => v.low));
  const overlap = Math.max(0, overlapHigh - overlapLow) / avgRange;
  const avgBody = mean(s.slice(-4).map(body));
  const chop = overlap >= 0.2 && avgBody <= 0.38;

  // 3+ same-color candles with net extension = extended: reversion risk.
  const dirs = s.slice(-4).map(dir);
  const bulls = dirs.filter(x => x > 0).length;
  const bears = dirs.filter(x => x < 0).length;
  const net = (last.close - s.at(-4).open) / avgRange;
  const bullExtended = bulls >= 3 && net >= 1.35;
  const bearExtended = bears >= 3 && net <= -1.35;

  // Repeated touches of the same high/low zone = rejection zone.
  let upperTouches = 0, lowerTouches = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      if (Math.abs(s[i].high - s[j].high) <= tol) { upperTouches++; break; }
      if (Math.abs(s[i].low - s[j].low) <= tol) { lowerTouches++; break; }
    }
  }

  // Breakout acceptance cancels extension penalties.
  const lastBody = body(last);
  const bullAcceptance = last.close > priorHigh && lastBody >= 0.45;
  const bearAcceptance = last.close < priorLow && lastBody >= 0.45;

  let chopPenalty = chop ? 7 : 0;
  let extensionPenalty = 0;
  if (bullExtended && !bullAcceptance) extensionPenalty = 6;
  if (bearExtended && !bearAcceptance) extensionPenalty = 6;

  return {
    chop, chopPenalty,
    bullExtended, bearExtended, extensionPenalty,
    upperTouches, lowerTouches,
    bullAcceptance, bearAcceptance,
    priorHigh, priorLow,
    lastUpper: upper(last), lastLower: lower(last), lastBody,
    lastDir: dir(last),
  };
}

// --- 10s: WICK REJECTION FADE -----------------------------------------------
// OTC engines revert intrabar spikes. When the live price prints a long wick
// against the prior micro-trend and closes back inside the range, the spike is
// almost always re-absorbed within seconds. Bet against the wick.
function strat10s(c) {
  if (c.length < 40) return skip('10S_WICK_FADE', 'need >=40 M1 candles');
  const m = candleMetrics(c);
  const last = c.at(-1);
  const f = regimeFilters(c);
  const tags = ['10S_WICK_FADE'];
  let score = 0;

  if (f.lastLower >= 0.55 && f.lastLower > f.lastUpper * 1.4 && last.close > (last.high + last.low) / 2) {
    score += 2.2; tags.push('LOWER_WICK_REJECTION');
  }
  if (f.lastUpper >= 0.55 && f.lastUpper > f.lastLower * 1.4 && last.close < (last.high + last.low) / 2) {
    score -= 2.2; tags.push('UPPER_WICK_REJECTION');
  }
  // A wick into a repeated zone is stronger evidence.
  if (f.lastLower >= 0.4 && f.lowerTouches >= 2) { score += 1.0; tags.push('LOWER_ZONE_WICK'); }
  if (f.lastUpper >= 0.4 && f.upperTouches >= 2) { score -= 1.0; tags.push('UPPER_ZONE_WICK'); }
  // Momentum drift confirms the rejection direction.
  const mom = clamp((last.close - c.at(-4).close) / (m.avgRange * 2), -1, 1);
  score += mom * 0.6;

  score -= f.chopPenalty * 0.25;
  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 14, 50, 88);
  const qualified = confidence >= 64 && !f.chop;
  return { strategy: '10S_WICK_FADE', horizonSeconds: 10, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop } };
}

// --- 15s: STREAK FADE (OTC MEAN REVERSION) ----------------------------------
// OTC series rarely sustain 4+ same-color candles: the generator's pullback
// probability rises with streak length. Fade the streak at the 4th candle,
// but never against a confirmed breakout close.
function strat15s(c) {
  if (c.length < 40) return skip('15S_STREAK_FADE', 'need >=40 M1 candles');
  const { dir, body, avgRange } = candleMetrics(c);
  const last4 = c.slice(-4).map(dir);
  const bulls = last4.filter(x => x > 0).length;
  const bears = last4.filter(x => x < 0).length;
  const f = regimeFilters(c);
  const tags = ['15S_STREAK_FADE'];
  let score = 0;

  if (bulls === 4) { score -= 1.8; tags.push('BULL_STREAK_4'); }
  if (bears === 4) { score += 1.8; tags.push('BEAR_STREAK_4'); }
  const bodies = c.slice(-4).map(body);
  if (bodies.every(b => b >= 0.6)) { tags.push('BODIES_FADING'); score = score * 1.15; }
  // Invalidation: last candle accepted beyond the prior range -> streak is a breakout.
  if (f.bullAcceptance) { score += 3.0; tags.push('BREAKOUT_INVALIDATES_FADE'); }
  if (f.bearAcceptance) { score -= 3.0; tags.push('BREAKOUT_INVALIDATES_FADE'); }

  score -= f.chopPenalty * 0.2;
  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 13, 50, 86);
  const qualified = confidence >= 64 && !f.chop && !f.bullAcceptance && !f.bearAcceptance;
  return { strategy: '15S_STREAK_FADE', horizonSeconds: 15, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop } };
}

// --- 30s: MICRO PULLBACK CONTINUATION ---------------------------------------
// When EMAs are stacked and price pulls back to the fast EMA and rejects, the
// next half-minute most often continues the stack direction.
function strat30s(c) {
  if (c.length < 60) return skip('30S_MICRO_PULLBACK', 'need >=60 M1 candles');
  const closes = c.map(x => x.close);
  const e5 = ema(closes, 5), e8 = ema(closes, 8), e20 = ema(closes, 20);
  const s5 = emaSeries(closes, 5);
  const slope = s5.length > 4 ? s5.at(-1) / s5.at(-4) - 1 : 0;
  const last = c.at(-1);
  const { body, upper, lower } = candleMetrics(c);
  const f = regimeFilters(c);
  const tags = ['30S_MICRO_PULLBACK'];
  let score = 0;

  const bullStack = e5 > e8 && e8 > e20, bearStack = e5 < e8 && e8 < e20;
  if (bullStack) { score += 1.2; tags.push('BULL_EMA_STACK'); }
  if (bearStack) { score -= 1.2; tags.push('BEAR_EMA_STACK'); }
  // Pullback condition: price tag of e8 from the stack side with rejection close.
  const nearE8 = Math.abs(last.close - e8) <= Math.max(e8 * 3e-5, f.priorHigh * 0);
  if (bullStack && last.low <= e8 && last.close > e8) { score += 1.4; tags.push('BULL_PULLBACK_REJECT'); }
  if (bearStack && last.high >= e8 && last.close < e8) { score -= 1.4; tags.push('BEAR_PULLBACK_REJECT'); }
  score += sign(slope) * 0.5;
  if (body(last) >= 0.5) score += sign(last.close - last.open) * 0.6;

  score -= f.chopPenalty * 0.3;
  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 12, 50, 85);
  const qualified = confidence >= 65 && !f.chop;
  return { strategy: '30S_MICRO_PULLBACK', horizonSeconds: 30, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop } };
}

// --- 1m: REJECTION CONTINUATION ---------------------------------------------
// Core 1-minute logic: trend sign from EMA8/EMA20 plus candle pressure from
// wick asymmetry, blocked in chop and at repeated opposite zones.
function strat1m(c) {
  if (c.length < 60) return skip('1M_REJECTION_CONTINUATION', 'need >=60 M1 candles');
  const closes = c.map(x => x.close);
  const e8 = ema(closes, 8), e20 = ema(closes, 20), e50 = ema(closes, 50);
  const { body, upper, lower } = candleMetrics(c);
  const last = c.at(-1);
  const f = regimeFilters(c);
  const tags = ['1M_REJECTION_CONTINUATION'];
  let score = 0;

  score += sign(last.close - e20) * 0.8;
  score += sign(e8 - e20) * 0.7;
  score += sign(e20 - e50) * 0.5;
  // Wick pressure: dominant wick against the trend kills continuation.
  score += (body(last) * sign(last.close - last.open) + (lower(last) - upper(last)) * 0.4) * 0.8;
  if (f.upperTouches >= 2 && score > 0) { score -= 1.2; tags.push('UPPER_ZONE_REJECTION'); }
  if (f.lowerTouches >= 2 && score < 0) { score += 1.2; tags.push('LOWER_ZONE_REJECTION'); }

  score -= f.chopPenalty * 0.2;
  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 11, 50, 85);
  const qualified = confidence >= 65 && !f.chop;
  return { strategy: '1M_REJECTION_CONTINUATION', horizonSeconds: 60, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop } };
}

// --- 2m: TREND PULLBACK (EMA20/50) -------------------------------------------
// Two-minute horizon: only trade with the EMA20/50 slope when price returns
// to the EMA20 band from the trend side. No pullback = no trade.
function strat2m(c) {
  if (c.length < 100) return skip('2M_TREND_PULLBACK', 'need >=100 M1 candles');
  const closes = c.map(x => x.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const s20 = emaSeries(closes, 20);
  const slope = s20.length > 6 ? s20.at(-1) / s20.at(-6) - 1 : 0;
  const last = c.at(-1), prev = c.at(-2);
  const { upper, lower } = candleMetrics(c);
  const f = regimeFilters(c);
  const tags = ['2M_TREND_PULLBACK'];
  let score = 0, gated = true;

  if (e20 > e50 && slope > 0) {
    score = 1.0;
    if (last.low <= e20 && last.close > e20) { score += 1.6; gated = false; tags.push('PULLBACK_TO_EMA20_REJECTED'); }
    if (prev.low <= e20 && prev.close > e20) { score += 1.0; gated = false; tags.push('PRIOR_CANDLE_PULLBACK'); }
    tags.push('BULL_TREND');
  } else if (e20 < e50 && slope < 0) {
    score = -1.0;
    if (last.high >= e20 && last.close < e20) { score -= 1.6; gated = false; tags.push('PULLBACK_TO_EMA20_REJECTED'); }
    if (prev.high >= e20 && prev.close < e20) { score -= 1.0; gated = false; tags.push('PRIOR_CANDLE_PULLBACK'); }
    tags.push('BEAR_TREND');
  }

  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 11, 50, 85);
  const qualified = !gated && confidence >= 66 && !f.chop && Math.abs(slope) > 1e-6;
  return { strategy: '2M_TREND_PULLBACK', horizonSeconds: 120, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop, gated } };
}

// --- 5m: SWEEP-AND-RECLAIM (S/R FADE) ----------------------------------------
// Five-minute horizon: OTC range-trades hard. A liquidity sweep of the last
// 45 candles' extreme that closes back inside is the highest-quality fade.
function strat5m(c) {
  if (c.length < 120) return skip('5M_SWEEP_RECLAIM', 'need >=120 M1 candles');
  const s = c.slice(-46, -1);
  const last = c.at(-1);
  const priorHigh = Math.max(...s.map(v => v.high));
  const priorLow = Math.min(...s.map(v => v.low));
  const { avgRange } = candleMetrics(c);
  const f = regimeFilters(c);
  const tags = ['5M_SWEEP_RECLAIM'];
  let score = 0, swept = false;

  if (last.low < priorLow && last.close > priorLow) { score += 2.4; swept = true; tags.push('SELL_SIDE_SWEEP'); }
  if (last.high > priorHigh && last.close < priorHigh) { score -= 2.4; swept = true; tags.push('BUY_SIDE_SWEEP'); }
  // Wick size weights the sweep quality.
  if (swept) {
    if (f.lastLower >= 0.45 && score > 0) { score += 0.8; tags.push('LONG_LOWER_WICK'); }
    if (f.lastUpper >= 0.45 && score < 0) { score -= 0.8; tags.push('LONG_UPPER_WICK'); }
  } else {
    tags.push('NO_SWEEP_WAIT');
  }
  // Mid-range: no location edge, skip.
  const mid = (priorHigh + priorLow) / 2;
  const inMiddle = Math.abs(last.close - mid) < avgRange * 0.3 && !swept;

  const direction = score >= 0 ? 'BUY' : 'SELL';
  const confidence = clamp(50 + Math.abs(score) * 11, 50, 87);
  const qualified = swept && confidence >= 68 && !f.chop && !inMiddle;
  return { strategy: '5M_SWEEP_RECLAIM', horizonSeconds: 300, direction, confidence: round(confidence), qualified, tags, filters: { chop: f.chop, swept, inMiddle } };
}

function skip(strategy, reason) {
  return { strategy, direction: null, confidence: 0, qualified: false, tags: [strategy, 'SKIPPED'], reason };
}

function round(v) { return Number(v.toFixed(1)); }

const STRATEGIES = {
  10: { name: '10S_WICK_FADE', horizonSeconds: 10, minCandles: 40, logic: 'Fade the dominant wick when it prints >=55% of range against the close; skip in chop.' },
  15: { name: '15S_STREAK_FADE', horizonSeconds: 15, minCandles: 40, logic: 'Fade 4-candle same-color streaks; invalidated by a breakout-acceptance close.' },
  30: { name: '30S_MICRO_PULLBACK', horizonSeconds: 30, minCandles: 60, logic: 'Continue an EMA5>8>20 stack when price rejects a pullback to the fast EMA.' },
  60: { name: '1M_REJECTION_CONTINUATION', horizonSeconds: 60, minCandles: 60, logic: 'EMA8/20/50 trend sign weighted with body/wick pressure; blocked by repeated opposite zones.' },
  120: { name: '2M_TREND_PULLBACK', horizonSeconds: 120, minCandles: 100, logic: 'Only trade EMA20/50 trend direction on a pullback to EMA20 that rejects; gated without pullback.' },
  300: { name: '5M_SWEEP_RECLAIM', horizonSeconds: 300, minCandles: 120, logic: 'Fade a sweep of the 45-candle extreme that closes back inside the range.' },
};

// Analyze every supported horizon. Returns an object keyed by seconds.
export function analyzeOtcMicro(candles) {
  const out = {};
  for (const [key, fn] of Object.entries({ 10: strat10s, 15: strat15s, 30: strat30s, 60: strat1m, 120: strat2m, 300: strat5m })) {
    out[key] = fn(candles);
  }
  return out;
}

export { STRATEGIES, strat10s, strat15s, strat30s, strat1m, strat2m, strat5m };
