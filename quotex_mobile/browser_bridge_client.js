(() => {
  'use strict';

  const cfg = {
    bridgeUrl: localStorage.getItem('FALCON_QUOTEX_BRIDGE_URL') || '',
    bridgeToken: localStorage.getItem('FALCON_QUOTEX_BRIDGE_TOKEN') || '',
    pollMs: Math.max(50, Number(localStorage.getItem('FALCON_QUOTEX_BRIDGE_POLL_MS') || 100)),
  };
  if (!cfg.bridgeUrl || !cfg.bridgeToken) { console.warn('[Falcon Bridge] Missing bridge URL/token.'); return; }
  const base = cfg.bridgeUrl.replace(/\/$/, '');
  const ALIASES=[
    [/CAD\s*\/\s*CHF|CADCHF/i,'CADCHF'],[/USD\s*\/\s*PKR|USDPKR/i,'USDPKR'],[/USD\s*\/\s*BRL|USDBRL/i,'USDBRL'],[/USD\s*\/\s*INR|USDINR/i,'USDINR'],[/USD\s*\/\s*ARS|USDARS/i,'USDARS'],
    [/UK\s*BRENT|UKBRENT/i,'UKBRENT'],[/\bGOLD\b/i,'GOLD'],[/US\s*CRUDE|USCRUDE/i,'USCRUDE'],[/\bBITCOIN\b|\bBTC\b/i,'BTC'],[/\bETHEREUM\b|\bETH\b/i,'ETHEREUM']
  ];
  const display={CADCHF:'CAD/CHF (OTC)',USDPKR:'USD/PKR (OTC)',USDBRL:'USD/BRL (OTC)',USDINR:'USD/INR (OTC)',USDARS:'USD/ARS (OTC)',UKBRENT:'UK Brent (OTC)',GOLD:'Gold (OTC)',USCRUDE:'US Crude (OTC)',BTC:'BTC (OTC)',ETHEREUM:'Ethereum (OTC)'};
  const canonicalPair = text => { const s=String(text||'').replace(/\s+/g,' ').trim(); for(const [re,key] of ALIASES)if(re.test(s))return key; const fx=s.match(/([A-Z]{3})\s*\/\s*([A-Z]{3})\s*\(OTC\)/i)||s.match(/([A-Z]{6})\s*\(OTC\)/i); if(fx?.length===3)return(fx[1]+fx[2]).toUpperCase(); if(fx?.[1])return fx[1].toUpperCase(); return null; };
  const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight; };
  const parsePrice = value => { const s=String(value||'').trim().replace(/\s/g,'').replace(/,/g,''); if(!/^[-+]?\d+(?:\.\d{3,})$/.test(s))return null; const n=Number(s); return Number.isFinite(n)&&n>0?n:null; };
  const pct = value => { const n=Number(value); return Number.isFinite(n)&&n>=0&&n<=100?n:null; };
  function labelledPercent(text,label){const esc=label.replace('+','\\+');const patterns=[new RegExp(`${esc}[^0-9]{0,18}(\\d{1,3}(?:\\.\\d+)?)\\s*%`,'i'),new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*%[^A-Z0-9]{0,18}${esc}`,'i')];for(const re of patterns){const m=text.match(re);const n=pct(m?.[1]);if(n!==null)return n}return null}

  function activePair() {
    const candidates=[document.querySelector('#tab-active'),...document.querySelectorAll('[class*="asset"], [class*="symbol"], [class*="pair"]')].filter(visible);
    for(const el of candidates){const text=String(el.textContent||'').replace(/\s+/g,' ').trim();if(!/\(OTC\)/i.test(text))continue;const p=canonicalPair(text);if(p)return p}
    return null;
  }
  function currentPrice() {
    const selectors=['[data-price]','[data-current-price]','[class*="current-price"]','[class*="currentPrice"]','[class*="chart-price"]','[class*="chartPrice"]','[class*="price-current"]','[class*="priceCurrent"]','[class*="price__value"]','[class*="price-value"]'];
    for(const selector of selectors)for(const el of document.querySelectorAll(selector)){if(!visible(el))continue;for(const value of [el.getAttribute('data-price'),el.getAttribute('data-current-price'),el.textContent]){const price=parsePrice(value);if(price!==null)return price}}
    const numeric=[];for(const el of document.querySelectorAll('span,div')){if(!visible(el)||el.children.length)continue;const price=parsePrice(el.textContent);if(price===null)continue;const r=el.getBoundingClientRect();if(r.left<innerWidth*.25||r.left>innerWidth*.9||r.top<80||r.top>innerHeight*.9)continue;numeric.push({price,x:r.x})}numeric.sort((a,b)=>Math.abs(a.x-innerWidth*.72)-Math.abs(b.x-innerWidth*.72));return numeric[0]?.price??null;
  }
  function otcMarketList() {
    const out=new Map();
    const nodes=[...document.querySelectorAll('div,li,button,a,tr')].filter(visible);
    for(const el of nodes){
      if(el.children.length>16)continue;
      const text=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if(!/\(OTC\)/i.test(text)||text.length>260)continue;
      const p=canonicalPair(text);if(!p)continue;
      const allPct=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map(x=>pct(x[1])).filter(n=>n!==null);
      const p1=labelledPercent(text,'PROFIT 1M+')??labelledPercent(text,'1M+')??labelledPercent(text,'PROFIT 1+')??allPct[0]??null;
      const p5=labelledPercent(text,'PROFIT 5M+')??labelledPercent(text,'5M+')??labelledPercent(text,'PROFIT 5+')??(allPct.length>1?allPct[1]:null);
      const row={pair:p,displayName:display[p]||`${p} (OTC)`,payoutPercent:p1,profit1mPercent:p1,profit5mPercent:p5,available:true};
      const prev=out.get(p);if(!prev||((prev.profit1mPercent==null&&p1!=null)||(prev.profit5mPercent==null&&p5!=null)))out.set(p,row);
    }
    return [...out.values()];
  }
  async function post(path,payload){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Falcon-Bridge-Token':cfg.bridgeToken},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`bridge HTTP ${r.status}`);return r.json()}
  let lastPair=null,lastPrice=null,sent=0,failures=0,lastMarketHash='',lastMarketSent=0;
  async function sendTick(pair,price){return post('/api/quotex/otc/tick',{pair,market:'OTC',price,timestamp_ms:Date.now()})}
  async function sendMarketState(force=false){const pairs=otcMarketList();const active=activePair();const hash=JSON.stringify({active,pairs});if(!force&&hash===lastMarketHash&&Date.now()-lastMarketSent<10000)return;await post('/api/quotex/otc/market-state',{activePair:active,pairs,timestamp_ms:Date.now()});lastMarketHash=hash;lastMarketSent=Date.now()}
  async function loop(){try{const p=activePair(),price=currentPrice();if(p&&Number.isFinite(price)){if(p!==lastPair||price!==lastPrice){await sendTick(p,price);lastPair=p;lastPrice=price;sent++;if(sent<=5||sent%100===0)console.log('[Falcon Bridge] tick',{pair:p,price,sent})}else{await sendTick(p,price)}}if(Date.now()-lastMarketSent>2000)await sendMarketState()}catch(e){failures++;if(failures<=5||failures%20===0)console.warn('[Falcon Bridge] send failed',e.message)}finally{setTimeout(loop,cfg.pollMs)}}
  console.log('[Falcon Bridge] read-only OTC feed + separate 1m/5m profit bridge started. No trading actions are performed.');
  sendMarketState(true).catch(()=>{});loop();
})();