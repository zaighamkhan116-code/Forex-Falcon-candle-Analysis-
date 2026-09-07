(() => {
  'use strict';

  const cfg = {
    bridgeUrl: localStorage.getItem('FALCON_QUOTEX_BRIDGE_URL') || '',
    bridgeToken: localStorage.getItem('FALCON_QUOTEX_BRIDGE_TOKEN') || '',
    pollMs: Math.max(80, Number(localStorage.getItem('FALCON_QUOTEX_BRIDGE_POLL_MS') || 120)),
  };
  if (!cfg.bridgeUrl || !cfg.bridgeToken) { console.warn('[Falcon Bridge] Missing bridge URL/token.'); return; }
  const base = cfg.bridgeUrl.replace(/\/$/, '');

  const TARGETS=new Set(['CADCHF','USDPKR','USDBRL','USDINR','USDARS','UKBRENT','GOLD','USCRUDE','BTC','ETHEREUM']);
  const ALIASES=[
    [/CAD\s*\/\s*CHF|CADCHF/i,'CADCHF'],[/USD\s*\/\s*PKR|USDPKR/i,'USDPKR'],[/USD\s*\/\s*BRL|USDBRL/i,'USDBRL'],[/USD\s*\/\s*INR|USDINR/i,'USDINR'],[/USD\s*\/\s*ARS|USDARS/i,'USDARS'],
    [/UK\s*BRENT|UKBRENT/i,'UKBRENT'],[/\bGOLD\b/i,'GOLD'],[/US\s*CRUDE|USCRUDE/i,'USCRUDE'],[/\bBITCOIN\b|\bBTC\b/i,'BTC'],[/\bETHEREUM\b|\bETH\b/i,'ETHEREUM']
  ];
  const display={CADCHF:'CAD/CHF (OTC)',USDPKR:'USD/PKR (OTC)',USDBRL:'USD/BRL (OTC)',USDINR:'USD/INR (OTC)',USDARS:'USD/ARS (OTC)',UKBRENT:'UK Brent (OTC)',GOLD:'Gold (OTC)',USCRUDE:'US Crude (OTC)',BTC:'BTC (OTC)',ETHEREUM:'Ethereum (OTC)'};
  const textOf=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight};
  const canonicalPair=text=>{const s=String(text||'').replace(/\s+/g,' ').trim();for(const [re,key] of ALIASES)if(re.test(s))return TARGETS.has(key)?key:null;return null};
  const parsePrice=value=>{const s=String(value||'').trim().replace(/\s/g,'').replace(/,/g,'');if(!/^\d+(?:\.\d{2,8})$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null};
  const pct=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=100?n:null};
  function labelledPercent(text,label){const esc=label.replace('+','\\+');for(const re of [new RegExp(`${esc}[^0-9]{0,18}(\\d{1,3}(?:\\.\\d+)?)\\s*%`,'i'),new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*%[^A-Z0-9]{0,18}${esc}`,'i')]){const n=pct(text.match(re)?.[1]);if(n!==null)return n}return null}

  function activePair(){
    const primary=[
      '#tab-active','[id*="tab-active"]','[class*="tab-active"]','[class*="active-asset"]','[class*="asset-active"]','[class*="selected-asset"]','[class*="asset-selected"]','[class*="activeAsset"]','[class*="selectedAsset"]'
    ];
    for(const sel of primary){for(const el of document.querySelectorAll(sel)){if(!visible(el))continue;const t=textOf(el);if(t.length>100||!/OTC/i.test(t))continue;const p=canonicalPair(t);if(p)return p}}
    const selected=[...document.querySelectorAll('[aria-selected="true"],[data-active="true"],[data-selected="true"],[class*=" active"],[class*=" selected"]')].filter(visible);
    for(const el of selected){const t=textOf(el);if(t.length>100||!/OTC/i.test(t))continue;const p=canonicalPair(t);if(p)return p}
    return null;
  }

  function priceCandidates(){
    const selectors=['[data-current-price]','[data-price]','[class*="current-price"]','[class*="currentPrice"]','[class*="chart-price"]','[class*="chartPrice"]','[class*="price-current"]','[class*="priceCurrent"]','[class*="price__value"]','[class*="price-value"]'];
    const out=[];
    for(const selector of selectors){for(const el of document.querySelectorAll(selector)){if(!visible(el))continue;const r=el.getBoundingClientRect();if(r.top<70||r.bottom>innerHeight*.95)continue;for(const value of [el.getAttribute('data-current-price'),el.getAttribute('data-price'),textOf(el)]){const price=parsePrice(value);if(price===null)continue;const cls=String(el.className||'');let score=0;if(/current|chart|live/i.test(cls))score+=6;if(el.hasAttribute('data-current-price'))score+=7;if(el.hasAttribute('data-price'))score+=4;if(r.left>innerWidth*.35&&r.left<innerWidth*.92)score+=4;if(r.top>innerHeight*.12&&r.top<innerHeight*.82)score+=3;out.push({price,score,el})}}}
    out.sort((a,b)=>b.score-a.score);
    return out;
  }

  let priceLock=null,priceLockSeen=0,lastPair=null,lastPrice=null,lastPriceChangeAt=0;
  function currentPrice(pair){
    const candidates=priceCandidates();if(!candidates.length){priceLock=null;priceLockSeen=0;return null}
    if(lastPair!==pair){priceLock=null;priceLockSeen=0;lastPrice=null;lastPriceChangeAt=0}
    if(priceLock&&visible(priceLock)){
      for(const value of [priceLock.getAttribute?.('data-current-price'),priceLock.getAttribute?.('data-price'),textOf(priceLock)]){const n=parsePrice(value);if(n!==null)return n}
    }
    const best=candidates[0];priceLock=best.el;priceLockSeen++;return best.price;
  }

  function otcMarketList(){
    const out=new Map();
    for(const el of [...document.querySelectorAll('div,li,button,a,tr')].filter(visible)){
      if(el.children.length>16)continue;const text=textOf(el);if(!/OTC/i.test(text)||text.length>260)continue;const p=canonicalPair(text);if(!p)continue;
      const allPct=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map(x=>pct(x[1])).filter(n=>n!==null);
      const p1=labelledPercent(text,'PROFIT 1M+')??labelledPercent(text,'1M+')??labelledPercent(text,'PROFIT 1+')??allPct[0]??null;
      const p5=labelledPercent(text,'PROFIT 5M+')??labelledPercent(text,'5M+')??labelledPercent(text,'PROFIT 5+')??(allPct.length>1?allPct[1]:null);
      const row={pair:p,displayName:display[p],payoutPercent:p1,profit1mPercent:p1,profit5mPercent:p5,available:true};
      const prev=out.get(p);if(!prev||((prev.profit1mPercent==null&&p1!=null)||(prev.profit5mPercent==null&&p5!=null)))out.set(p,row)
    }
    return [...out.values()];
  }

  async function post(path,payload){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Falcon-Bridge-Token':cfg.bridgeToken},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`bridge HTTP ${r.status}`);return r.json()}
  let sent=0,failures=0,lastMarketHash='',lastMarketSent=0,lastTickSent=0;
  async function sendTick(pair,price){return post('/api/quotex/otc/tick',{pair,market:'OTC',price,timestamp_ms:Date.now()})}
  async function sendMarketState(force=false){const pairs=otcMarketList();const active=activePair();const hash=JSON.stringify({active,pairs});if(!force&&hash===lastMarketHash&&Date.now()-lastMarketSent<10000)return;await post('/api/quotex/otc/market-state',{activePair:active,pairs,timestamp_ms:Date.now()});lastMarketHash=hash;lastMarketSent=Date.now()}

  async function loop(){
    try{
      const p=activePair();
      if(p){
        const price=currentPrice(p);
        if(Number.isFinite(price)){
          const now=Date.now();
          if(p!==lastPair){lastPair=p;lastPrice=null;lastPriceChangeAt=now;priceLock=null}
          if(price!==lastPrice){lastPriceChangeAt=now;lastPrice=price}
          const staleFor=now-lastPriceChangeAt;
          if(staleFor<8000&&now-lastTickSent>=120){await sendTick(p,price);lastTickSent=now;sent++;if(sent<=8||sent%100===0)console.log('[Falcon Bridge] verified tick',{pair:p,price,sent,staleFor})}
          else if(staleFor>=8000&&sent%50===0)console.warn('[Falcon Bridge] price stale; ticks paused',{pair:p,price,staleFor});
        }
      }
      if(Date.now()-lastMarketSent>2000)await sendMarketState();
    }catch(e){failures++;if(failures<=5||failures%20===0)console.warn('[Falcon Bridge] send failed',e.message)}finally{setTimeout(loop,cfg.pollMs)}
  }

  console.log('[Falcon Bridge] strict active-pair/live-price OTC feed started. Unsupported or ambiguous asset names are blocked. No trading actions are performed.');
  sendMarketState(true).catch(()=>{});loop();
})();