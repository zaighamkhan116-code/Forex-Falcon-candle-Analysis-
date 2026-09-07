import fs from 'fs/promises';
import path from 'path';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const sign = n => n > 0 ? 1 : n < 0 ? -1 : 0;
const EXPIRIES = [10, 15, 30, 60, 300];

function safePair(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12);
}

export class OtcShadowEngine {
  constructor({ root = '/data/quotex-otc', maxCandles = 1200 } = {}) {
    this.root = root;
    this.maxCandles = maxCandles;
    this.pairs = new Map();
    this.stats = { ticksSeen: 0, candlesClosed: 0, predictions: 0, settlements: 0, wins: 0, losses: 0, draws: 0 };
  }

  pairState(pair) {
    const key = safePair(pair);
    if (!this.pairs.has(key)) {
      const blank = Object.fromEntries(EXPIRIES.map(x => [x, null]));
      const results = Object.fromEntries(EXPIRIES.map(x => [x, { wins: 0, losses: 0, draws: 0, total: 0 }]));
      this.pairs.set(key, {
        pair: key,
        current: null,
        candles: [],
        recentTicks: [],
        pending: [],
        latestPrediction: { ...blank },
        latestSettlement: { ...blank },
        lastBoundary: { ...blank },
        recentSignals: [],
        recentSettlements: [],
        results,
      });
    }
    return this.pairs.get(key);
  }

  async append(kind, pair, ts, row) {
    await fs.mkdir(this.root, { recursive: true });
    const day = new Date(ts).toISOString().slice(0, 10);
    const file = path.join(this.root, `${safePair(pair)}-OTC-${kind}-${day}.jsonl`);
    await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
  }

  closeThrough(state, targetSec) {
    if (!state.current) return [];
    const closed = [];
    while (state.current.sec < targetSec) {
      closed.push(state.current);
      state.candles.push(state.current);
      this.stats.candlesClosed++;
      if (state.candles.length > this.maxCandles) state.candles.shift();
      const nextSec = state.current.sec + 1000;
      const px = state.current.close;
      state.current = { sec: nextSec, open: px, high: px, low: px, close: px, tickCount: 0, upTicks: 0, downTicks: 0, synthetic: true };
    }
    return closed;
  }

  updateCandle(state, tick) {
    const sec = Math.floor(tick.timestamp_ms / 1000) * 1000;
    if (!state.current) {
      state.current = { sec, open: tick.price, high: tick.price, low: tick.price, close: tick.price, tickCount: 1, upTicks: 0, downTicks: 0, synthetic: false };
      return [];
    }
    const previousClose = state.current.close;
    const closed = this.closeThrough(state, sec);
    if (state.current.sec !== sec) return closed;
    if (state.current.tickCount === 0) {
      state.current.open = previousClose;
      state.current.high = tick.price;
      state.current.low = tick.price;
      state.current.close = tick.price;
      state.current.synthetic = false;
    } else {
      state.current.high = Math.max(state.current.high, tick.price);
      state.current.low = Math.min(state.current.low, tick.price);
      if (tick.price > state.current.close) state.current.upTicks++;
      else if (tick.price < state.current.close) state.current.downTicks++;
      state.current.close = tick.price;
    }
    state.current.tickCount++;
    return closed;
  }

  recentReturns(state, seconds) {
    const all = [...state.candles, state.current].filter(Boolean);
    if (all.length < 2) return 0;
    const end = all.at(-1).close;
    const cutoff = (state.current?.sec || Date.now()) - seconds * 1000;
    let start = all[0].open;
    for (const c of all) { if (c.sec >= cutoff) { start = c.open; break; } }
    return start ? (end - start) / start : 0;
  }

  featureSnapshot(state, nowMs) {
    const all = [...state.candles, state.current].filter(Boolean);
    const last = all.slice(-30);
    const ranges = last.map(c => c.high - c.low);
    const avgRange = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
    const returns = { m3: this.recentReturns(state, 3), m5: this.recentReturns(state, 5), m10: this.recentReturns(state, 10), m20: this.recentReturns(state, 20), m60: this.recentReturns(state, 60), m120: this.recentReturns(state, 120) };
    const ticks = state.recentTicks.filter(t => t.timestamp_ms >= nowMs - 10000);
    let ups = 0, downs = 0;
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].price > ticks[i - 1].price) ups++;
      else if (ticks[i].price < ticks[i - 1].price) downs++;
    }
    const pressure = (ups + downs) ? (ups - downs) / (ups + downs) : 0;
    const lastClose = all.at(-1)?.close || 0;
    const rangeNorm = lastClose ? avgRange / lastClose : 0;
    return { ...returns, pressure, rangeNorm, ups, downs, avgRange };
  }

  weights(expirySeconds) {
    if (expirySeconds === 10) return { m3:.34,m5:.30,m10:.18,m20:.04,m60:.02,m120:0,pressure:.12 };
    if (expirySeconds === 15) return { m3:.30,m5:.28,m10:.20,m20:.07,m60:.02,m120:0,pressure:.13 };
    if (expirySeconds === 30) return { m3:.10,m5:.18,m10:.28,m20:.25,m60:.06,m120:0,pressure:.13 };
    if (expirySeconds === 60) return { m3:.04,m5:.08,m10:.18,m20:.27,m60:.30,m120:.04,pressure:.09 };
    return { m3:.01,m5:.03,m10:.08,m20:.16,m60:.28,m120:.36,pressure:.08 };
  }

  score(features, expirySeconds) {
    const w = this.weights(expirySeconds);
    const vol = Math.max(features.rangeNorm, 1e-7);
    const norm = x => clamp(x / (vol * 4), -1, 1);
    return norm(features.m3)*w.m3 + norm(features.m5)*w.m5 + norm(features.m10)*w.m10 + norm(features.m20)*w.m20 + norm(features.m60)*w.m60 + norm(features.m120)*w.m120 + clamp(features.pressure,-1,1)*w.pressure;
  }

  async maybePredict(state, tick, expirySeconds) {
    const boundary = Math.floor(tick.timestamp_ms / (expirySeconds * 1000));
    if (state.lastBoundary[expirySeconds] === boundary) return null;
    state.lastBoundary[expirySeconds] = boundary;
    const minHistory = expirySeconds >= 300 ? 120 : expirySeconds >= 60 ? 60 : 30;
    if (state.candles.length < minHistory) return null;
    const features = this.featureSnapshot(state, tick.timestamp_ms);
    const rawScore = this.score(features, expirySeconds);
    if (Math.abs(rawScore) < 0.08) return null;
    const direction = rawScore > 0 ? 'UP' : 'DOWN';
    const confidence = Math.round(clamp(50 + Math.abs(rawScore) * 35, 50, 85) * 10) / 10;
    const id = `${state.pair}-${expirySeconds}-${tick.timestamp_ms}`;
    const prediction = { id, engine:`OTC_${expirySeconds}S_SHADOW_V1`, mode:'SHADOW', tradingEnabled:false, pair:state.pair, marketType:'OTC', expirySeconds, direction, confidence, score:Math.round(rawScore*10000)/10000, entryTimestampMs:tick.timestamp_ms, entryPrice:tick.price, targetTimestampMs:tick.timestamp_ms + expirySeconds*1000, features, status:'PENDING' };
    state.pending.push(prediction);
    state.latestPrediction[expirySeconds] = prediction;
    state.recentSignals.unshift(prediction);
    state.recentSignals = state.recentSignals.slice(0, 100);
    this.stats.predictions++;
    await this.append(`shadow-${expirySeconds}s-signals`, state.pair, tick.timestamp_ms, prediction);
    console.log(JSON.stringify({ event:'shadow-prediction', ...prediction }));
    return prediction;
  }

  async settlePending(state, tick) {
    const due = state.pending.filter(p => tick.timestamp_ms >= p.targetTimestampMs);
    if (!due.length) return [];
    state.pending = state.pending.filter(p => tick.timestamp_ms < p.targetTimestampMs);
    const settled = [];
    for (const p of due) {
      const delta = tick.price - p.entryPrice;
      const actual = sign(delta), predicted = p.direction === 'UP' ? 1 : -1;
      const outcome = actual === 0 ? 'DRAW' : actual === predicted ? 'WIN' : 'LOSS';
      const row = { ...p, status:'SETTLED', settlementTimestampMs:tick.timestamp_ms, settlementPrice:tick.price, settlementDelayMs:tick.timestamp_ms-p.targetTimestampMs, outcome, priceDelta:delta };
      const r = state.results[p.expirySeconds];
      r.total++;
      if (outcome === 'WIN') { r.wins++; this.stats.wins++; }
      else if (outcome === 'LOSS') { r.losses++; this.stats.losses++; }
      else { r.draws++; this.stats.draws++; }
      this.stats.settlements++;
      state.latestSettlement[p.expirySeconds] = row;
      state.recentSettlements.unshift(row);
      state.recentSettlements = state.recentSettlements.slice(0, 100);
      await this.append(`shadow-${p.expirySeconds}s-results`, state.pair, tick.timestamp_ms, row);
      console.log(JSON.stringify({ event:'shadow-settlement', id:row.id, pair:row.pair, expirySeconds:row.expirySeconds, direction:row.direction, outcome, entryPrice:row.entryPrice, settlementPrice:row.settlementPrice, settlementDelayMs:row.settlementDelayMs }));
      settled.push(row);
    }
    return settled;
  }

  async onTick(tick) {
    this.stats.ticksSeen++;
    const state = this.pairState(tick.pair);
    state.recentTicks.push({ timestamp_ms:tick.timestamp_ms, price:tick.price });
    const cutoff = tick.timestamp_ms - 360000;
    while (state.recentTicks.length && state.recentTicks[0].timestamp_ms < cutoff) state.recentTicks.shift();
    const closed = this.updateCandle(state, tick);
    for (const candle of closed) {
      await this.append('micro-1s', state.pair, candle.sec, { pair:state.pair, marketType:'OTC', timeframeSeconds:1, timestamp_ms:candle.sec, timestamp_iso:new Date(candle.sec).toISOString(), open:candle.open, high:candle.high, low:candle.low, close:candle.close, tickCount:candle.tickCount, upTicks:candle.upTicks, downTicks:candle.downTicks, synthetic:Boolean(candle.synthetic), source:'QUOTEX_BROWSER_BRIDGE' });
    }
    const settlements = await this.settlePending(state, tick);
    const predictions = [];
    for (const expiry of EXPIRIES) { const p = await this.maybePredict(state, tick, expiry); if (p) predictions.push(p); }
    return { predictions, settlements };
  }

  snapshot(pair = null) {
    const serialize = state => ({
      pair:state.pair,
      currentCandle:state.current,
      candleCount:state.candles.length,
      pendingCount:state.pending.length,
      latestPrediction:state.latestPrediction,
      latestSettlement:state.latestSettlement,
      recentSignals:state.recentSignals.slice(0,50),
      recentSettlements:state.recentSettlements.slice(0,50),
      results:Object.fromEntries(Object.entries(state.results).map(([k,v])=>[k,{...v,winRate:(v.wins+v.losses)?Math.round(v.wins/(v.wins+v.losses)*10000)/100:null}]))
    });
    if (pair) return serialize(this.pairState(pair));
    return { mode:'SHADOW', tradingEnabled:false, engines:EXPIRIES.map(x=>`OTC_${x}S_SHADOW_V1`), expiries:EXPIRIES, stats:this.stats, pairs:[...this.pairs.values()].map(serialize) };
  }
}
