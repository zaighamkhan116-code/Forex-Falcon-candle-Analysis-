(() => {
  'use strict';

  const cfg = {
    bridgeUrl: localStorage.getItem('FALCON_QUOTEX_BRIDGE_URL') || '',
    bridgeToken: localStorage.getItem('FALCON_QUOTEX_BRIDGE_TOKEN') || '',
    pollMs: Math.max(50, Number(localStorage.getItem('FALCON_QUOTEX_BRIDGE_POLL_MS') || 100)),
  };
  if (!cfg.bridgeUrl || !cfg.bridgeToken) { console.warn('[Falcon Bridge] Missing bridge URL/token.'); return; }
  const base = cfg.bridgeUrl.replace(/\/$/, '');
  const normalizePair = text => String(text || '').toUpperCase().replace(/\(OTC\)/g, '').replace(/[^A-Z]/g, '');
  const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight; };
  const parsePrice = value => { const s=String(value||'').trim().replace(/\s/g,'').replace(/,/g,''); if(!/^[-+]?\d+(?:\.\d{3,})$/.test(s))return null; const n=Number(s); return Number.isFinite(n)&&n>0?n:null; };

  function activePair() {
    const candidates=[document.querySelector('#tab-active'),...document.querySelectorAll('[class*="asset"], [class*="symbol"], [class*="pair"]')].filter(visible);
    for(const el of candidates){const text=String(el.textContent||'').replace(/\s+/g,' ').trim();if(!/\(OTC\)/i.test(text))continue;const p=normalizePair(text);if(p.length>=6)return p.slice(0,6)}
    return null;
  }
  function currentPrice() {
    const selectors=['[data-price]','[data-current-price]','[class*="current-price"]','[class*="currentPrice"]','[class*="chart-price"]','[class*="chartPrice"]','[class*="price-current"]','[class*="priceCurrent"]','[class*="price__value"]','[class*="price-value"]'];
    for(const selector of selectors)for(const el of document.querySelectorAll(selector)){if(!visible(el))continue;for(const value of [el.getAttribute('data-price'),el.getAttribute('data-current-price'),el.textContent]){const price=parsePrice(value);if(price!==null)return price}}
    const numeric=[];for(const el of document.querySelectorAll('span,div')){if(!visible(el)||el.children.length)continue;const price=parsePrice(el.textContent);if(price===null)continue;const r=el.getBoundingClientRect();if(r.left<innerWidth*.25||r.left>innerWidth*.9||r.top<80||r.top>innerHeight*.9)continue;numeric.push({price,x:r.x})}numeric.sort((a,b)=>Math.abs(a.x-innerWidth*.72)-Math.abs(b.x-innerWidth*.72));return numeric[0]?.price??null;
  }
  function otcMarketList() {
    const out=new Map();
    const nodes=[...document.querySelectorAll('div,li,button,a')].filter(visible);
    for(const el of nodes){
      if(el.children.length>12)continue;
      const text=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if(!/\(OTC\)/i.test(text)||text.length>180)continue;
      const m=text.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})\s*\(OTC\)/i)||text.match(/([A-Z]{6})\s*\(OTC\)/i);
      let p='';if(m?.length===3)p=(m[1]+m[2]).toUpperCase();else if(m?.[1])p=m[1].toUpperCase();if(p.length!==6)continue;
      const pct=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map(x=>Number(x[1])).filter(n=>n>=0&&n<=100);
      const payout=pct.length?pct[pct.length-1]:null;
      const prev=out.get(p);if(!prev||(!Number.isFinite(prev.payoutPercent)&&Number.isFinite(payout)))out.set(p,{pair:p,displayName:`${p.slice(0,3)}/${p.slice(3)} (OTC)`,payoutPercent:payout,available:true});
    }
    return [...out.values()];
  }
  async function post(path,payload){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Falcon-Bridge-Token':cfg.bridgeToken},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`bridge HTTP ${r.status}`);return r.json()}
  let lastPair=null,lastPrice=null,sent=0,failures=0,lastMarketHash='',lastMarketSent=0;
  async function sendTick(pair,price){return post('/api/quotex/otc/tick',{pair,market:'OTC',price,timestamp_ms:Date.now()})}
  async function sendMarketState(force=false){const pairs=otcMarketList();const active=activePair();const hash=JSON.stringify({active,pairs});if(!force&&hash===lastMarketHash&&Date.now()-lastMarketSent<10000)return;await post('/api/quotex/otc/market-state',{activePair:active,pairs,timestamp_ms:Date.now()});lastMarketHash=hash;lastMarketSent=Date.now()}
  async function loop(){try{const p=activePair(),price=currentPrice();if(p&&Number.isFinite(price)){if(p!==lastPair||price!==lastPrice){await sendTick(p,price);lastPair=p;lastPrice=price;sent++;if(sent<=5||sent%100===0)console.log('[Falcon Bridge] tick',{pair:p,price,sent})}else{await sendTick(p,price)}}if(Date.now()-lastMarketSent>2000)await sendMarketState()}catch(e){failures++;if(failures<=5||failures%20===0)console.warn('[Falcon Bridge] send failed',e.message)}finally{setTimeout(loop,cfg.pollMs)}}
  console.log('[Falcon Bridge] read-only OTC feed + payout bridge started. No trading actions are performed.');
  sendMarketState(true).catch(()=>{});loop();
})();