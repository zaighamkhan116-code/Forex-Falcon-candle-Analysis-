import { chromium } from 'playwright-core';
import fs from 'fs/promises';
import path from 'path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENABLED = String(process.env.QUOTEX_OTC_COLLECTOR_ENABLED || '').toLowerCase() === 'true';
const EMAIL = process.env.QUOTEX_EMAIL || '';
const PASSWORD = process.env.QUOTEX_PASSWORD || '';
const PROFILE = process.env.QUOTEX_PROFILE_DIR || '/data/quotex-profile';
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const QX_URL = process.env.QUOTEX_URL || 'https://qxbroker.com/en/sign-in/modal/';
const SYMBOL = String(process.env.QUOTEX_OTC_SYMBOL || 'EURUSD').toUpperCase().replace(/[^A-Z]/g, '');
const POLL_MS = Math.max(25, Number(process.env.QUOTEX_OTC_POLL_MS || 50));
const ROOT = process.env.QUOTEX_OTC_DATA_DIR || '/data/quotex-otc';
const DIAGNOSTIC_EVERY_MS = Math.max(5000, Number(process.env.QUOTEX_OTC_DIAGNOSTIC_MS || 30000));

const state = {
  enabled: ENABLED,
  connected: false,
  loggedIn: false,
  pair: null,
  otc: false,
  lastPrice: null,
  lastTickAt: null,
  tickCount: 0,
  duplicateCount: 0,
  readFailures: 0,
  startedAt: Date.now(),
  lastError: null,
  lastSelector: null,
};

function log(event, extra = {}) {
  console.log(JSON.stringify({ service: 'quotex-otc-collector', event, at: Date.now(), ...extra }));
}

async function ensureLogin(page) {
  await page.goto(QX_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
  if (await page.locator('#tab-active').count()) {
    state.loggedIn = true;
    return;
  }
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const password = page.locator('input[type="password"]').first();
  if (!(await email.count()) || !(await password.count())) throw new Error('Quotex login form not detected');
  if (!EMAIL || !PASSWORD) throw new Error('QUOTEX_EMAIL / QUOTEX_PASSWORD Railway secrets are required for first login');
  await email.fill(EMAIL);
  await password.fill(PASSWORD);
  const remember = page.locator('input[type="checkbox"]').first();
  if (await remember.count()) { try { await remember.check(); } catch {} }
  const button = page.getByRole('button', { name: /sign in|login/i }).first();
  if (!(await button.count())) throw new Error('Quotex sign-in button not detected');
  await button.click();
  await page.waitForTimeout(2500);
  if (await page.locator('#tab-active').count()) {
    state.loggedIn = true;
    log('login-ok');
    return;
  }
  throw new Error('Login not completed. Quotex may require verification/CAPTCHA. Collector remains read-only and stopped.');
}

async function chooseOtcPair(page, pair) {
  return page.evaluate(async ({ pair }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const txt = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
    const pairKey = s => String(s || '').toUpperCase().replace(/\(OTC\)/g, '').replace(/[^A-Z]/g, '');
    const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const setInput = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value)); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) })); input.dispatchEvent(new Event('change', { bubbles: true })); };
    const click = el => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); el.click(); };
    pair = pairKey(pair);
    const active = document.querySelector('#tab-active');
    if (active && pairKey(txt(active)) === pair && /\(OTC\)/i.test(txt(active))) return { pair, otc: true };
    if (!document.querySelector('input[placeholder="Search"]')) click(document.querySelector('button.CAZSg') || [...document.querySelectorAll('button')].find(b => b.querySelector('svg.icon-plus')));
    const end = Date.now() + 3000;
    while (!document.querySelector('input[placeholder="Search"]')) { if (Date.now() > end) throw new Error('Asset picker did not open'); await sleep(25); }
    const search = document.querySelector('input[placeholder="Search"]');
    setInput(search, pair.slice(0, 3) + '/' + pair.slice(3));
    await sleep(150);
    const rows = [...document.querySelectorAll('.R2Rgm,.vPvlJ')].filter(visible).filter(r => pairKey(txt(r)) === pair);
    const row = rows.find(r => /\(OTC\)/i.test(txt(r)));
    if (!row) throw new Error(`OTC asset ${pair} unavailable`);
    click(row);
    const end2 = Date.now() + 4000;
    while (true) {
      const now = document.querySelector('#tab-active');
      if (now && pairKey(txt(now)) === pair && /\(OTC\)/i.test(txt(now))) return { pair, otc: true };
      if (Date.now() > end2) throw new Error('OTC pair switch failed');
      await sleep(25);
    }
  }, { pair });
}

async function readQuote(page) {
  return page.evaluate(() => {
    const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const parse = value => {
      const s = String(value || '').trim().replace(/\s/g, '').replace(/,/g, '');
      if (!/^[-+]?\d+(?:\.\d{3,})$/.test(s)) return null;
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const selectors = [
      '[data-price]', '[data-current-price]', '[class*="current-price"]', '[class*="currentPrice"]',
      '[class*="chart-price"]', '[class*="chartPrice"]', '[class*="price-current"]', '[class*="priceCurrent"]',
      '[class*="price__value"]', '[class*="price-value"]'
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const candidates = [el.getAttribute('data-price'), el.getAttribute('data-current-price'), el.textContent];
        for (const candidate of candidates) {
          const price = parse(candidate);
          if (price !== null) return { price, selector, text: String(candidate).trim().slice(0, 40) };
        }
      }
    }
    const numeric = [];
    for (const el of document.querySelectorAll('span,div')) {
      if (!visible(el) || el.children.length) continue;
      const price = parse(el.textContent);
      if (price === null) continue;
      const r = el.getBoundingClientRect();
      if (r.left < innerWidth * 0.25 || r.left > innerWidth * 0.9 || r.top < 80 || r.top > innerHeight * 0.9) continue;
      numeric.push({ price, selector: 'VISIBLE_NUMERIC_FALLBACK', text: String(el.textContent).trim().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y) });
    }
    numeric.sort((a, b) => Math.abs(a.x - innerWidth * 0.72) - Math.abs(b.x - innerWidth * 0.72));
    return numeric[0] || null;
  });
}

async function diagnosticCandidates(page) {
  return page.evaluate(() => {
    const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const out = [];
    for (const el of document.querySelectorAll('span,div')) {
      if (!visible(el) || el.children.length) continue;
      const t = String(el.textContent || '').trim();
      if (!/^\d+(?:[.,]\d{3,})$/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < innerWidth * 0.2 || r.left > innerWidth * 0.95 || r.top < 60 || r.top > innerHeight * 0.95) continue;
      out.push({ text: t.slice(0, 40), className: String(el.className || '').slice(0, 120), x: Math.round(r.x), y: Math.round(r.y) });
      if (out.length >= 12) break;
    }
    return out;
  });
}

function dayFile(ts) {
  return path.join(ROOT, `${SYMBOL}-OTC-${new Date(ts).toISOString().slice(0, 10)}.jsonl`);
}

async function persistTick(tick) {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.appendFile(dayFile(tick.timestamp_ms), JSON.stringify(tick) + '\n', 'utf8');
}

async function main() {
  if (!ENABLED) {
    log('disabled', { hint: 'Set QUOTEX_OTC_COLLECTOR_ENABLED=true. Live execution is not used by this collector.' });
    return;
  }
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    viewport: { width: 1440, height: 1000 },
  });
  const page = context.pages()[0] || await context.newPage();
  state.connected = true;
  try {
    await ensureLogin(page);
    const selected = await chooseOtcPair(page, SYMBOL);
    state.pair = selected.pair;
    state.otc = selected.otc === true;
    log('collector-ready', { pair: state.pair, otc: state.otc, pollMs: POLL_MS, dataDir: ROOT, liveExecution: false });
  } catch (e) {
    state.lastError = e.message;
    log('startup-error', { error: e.message });
    await context.close();
    return;
  }

  let lastDiagnosticAt = 0;
  while (true) {
    try {
      const q = await readQuote(page);
      const now = Date.now();
      if (!q || !Number.isFinite(Number(q.price))) {
        state.readFailures++;
        if (now - lastDiagnosticAt >= DIAGNOSTIC_EVERY_MS) {
          lastDiagnosticAt = now;
          const candidates = await diagnosticCandidates(page);
          log('quote-not-found', { pair: state.pair, readFailures: state.readFailures, candidates });
        }
        await sleep(POLL_MS);
        continue;
      }
      const price = Number(q.price);
      state.lastSelector = q.selector;
      if (state.lastPrice === price) {
        state.duplicateCount++;
        await sleep(POLL_MS);
        continue;
      }
      const tick = {
        pair: state.pair,
        market: 'OTC',
        timestamp_ms: now,
        timestamp_iso: new Date(now).toISOString(),
        price,
        source: 'QUOTEX_DOM',
        selector: q.selector,
      };
      await persistTick(tick);
      state.lastPrice = price;
      state.lastTickAt = now;
      state.tickCount++;
      if (state.tickCount <= 5 || state.tickCount % 100 === 0) log('tick', { ...tick, tickCount: state.tickCount });
    } catch (e) {
      state.lastError = e.message;
      state.readFailures++;
      log('collector-error', { error: e.message, readFailures: state.readFailures });
      await sleep(Math.max(500, POLL_MS));
    }
  }
}

process.on('SIGTERM', () => log('shutdown', { signal: 'SIGTERM', state }));
process.on('SIGINT', () => log('shutdown', { signal: 'SIGINT', state }));
main().catch(e => { state.lastError = e.message; log('fatal', { error: e.message }); process.exitCode = 1; });
