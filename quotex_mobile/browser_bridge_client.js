(() => {
  'use strict';

  const cfg = {
    bridgeUrl: localStorage.getItem('FALCON_QUOTEX_BRIDGE_URL') || '',
    bridgeToken: localStorage.getItem('FALCON_QUOTEX_BRIDGE_TOKEN') || '',
    pollMs: Math.max(50, Number(localStorage.getItem('FALCON_QUOTEX_BRIDGE_POLL_MS') || 100)),
  };

  if (!cfg.bridgeUrl || !cfg.bridgeToken) {
    console.warn('[Falcon Bridge] Set FALCON_QUOTEX_BRIDGE_URL and FALCON_QUOTEX_BRIDGE_TOKEN in localStorage first.');
    return;
  }

  const normalizePair = text => String(text || '')
    .toUpperCase()
    .replace(/\(OTC\)/g, '')
    .replace(/[^A-Z]/g, '');

  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };

  const parsePrice = value => {
    const s = String(value || '').trim().replace(/\s/g, '').replace(/,/g, '');
    if (!/^[-+]?\d+(?:\.\d{3,})$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function activePair() {
    const candidates = [
      document.querySelector('#tab-active'),
      ...document.querySelectorAll('[class*="asset"], [class*="symbol"], [class*="pair"]')
    ].filter(visible);
    for (const el of candidates) {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/\(OTC\)/i.test(text)) continue;
      const pair = normalizePair(text);
      if (pair.length >= 6) return pair.slice(0, 6);
    }
    return null;
  }

  function currentPrice() {
    const selectors = [
      '[data-price]', '[data-current-price]', '[class*="current-price"]', '[class*="currentPrice"]',
      '[class*="chart-price"]', '[class*="chartPrice"]', '[class*="price-current"]', '[class*="priceCurrent"]',
      '[class*="price__value"]', '[class*="price-value"]'
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const values = [el.getAttribute('data-price'), el.getAttribute('data-current-price'), el.textContent];
        for (const value of values) {
          const price = parsePrice(value);
          if (price !== null) return price;
        }
      }
    }
    const numeric = [];
    for (const el of document.querySelectorAll('span,div')) {
      if (!visible(el) || el.children.length) continue;
      const price = parsePrice(el.textContent);
      if (price === null) continue;
      const r = el.getBoundingClientRect();
      if (r.left < innerWidth * 0.25 || r.left > innerWidth * 0.9 || r.top < 80 || r.top > innerHeight * 0.9) continue;
      numeric.push({ price, x: r.x });
    }
    numeric.sort((a, b) => Math.abs(a.x - innerWidth * 0.72) - Math.abs(b.x - innerWidth * 0.72));
    return numeric[0]?.price ?? null;
  }

  let lastPair = null;
  let lastPrice = null;
  let sent = 0;
  let failures = 0;

  async function sendTick(pair, price) {
    const response = await fetch(cfg.bridgeUrl.replace(/\/$/, '') + '/api/quotex/otc/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Falcon-Bridge-Token': cfg.bridgeToken,
      },
      body: JSON.stringify({ pair, market: 'OTC', price, timestamp_ms: Date.now() }),
    });
    if (!response.ok) throw new Error(`bridge HTTP ${response.status}`);
    return response.json();
  }

  async function loop() {
    try {
      const pair = activePair();
      const price = currentPrice();
      if (pair && Number.isFinite(price)) {
        if (pair !== lastPair || price !== lastPrice) {
          await sendTick(pair, price);
          lastPair = pair;
          lastPrice = price;
          sent++;
          if (sent <= 5 || sent % 100 === 0) console.log('[Falcon Bridge] tick', { pair, price, sent });
        }
      }
    } catch (e) {
      failures++;
      if (failures <= 5 || failures % 20 === 0) console.warn('[Falcon Bridge] send failed', e.message);
    } finally {
      setTimeout(loop, cfg.pollMs);
    }
  }

  console.log('[Falcon Bridge] read-only OTC feed bridge started. No trading actions are performed.');
  loop();
})();
