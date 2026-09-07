import { chromium } from 'playwright-core';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENABLED = String(process.env.QUOTEX_MOBILE_ENABLED || '').toLowerCase() === 'true';
const LIVE = String(process.env.QUOTEX_LIVE_EXECUTION || '').toLowerCase() === 'true';
const BASE_URL = process.env.FALCON_BASE_URL || 'http://127.0.0.1:3000';
const QX_URL = process.env.QUOTEX_URL || 'https://qxbroker.com/en/sign-in/modal/';
const EMAIL = process.env.QUOTEX_EMAIL || '';
const PASSWORD = process.env.QUOTEX_PASSWORD || '';
const PROFILE = process.env.QUOTEX_PROFILE_DIR || '/data/quotex-profile';
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const POLL_MS = Number(process.env.QUOTEX_SIGNAL_POLL_MS || 500);
const TARGET_OFFSET_MS = Number(process.env.QUOTEX_TARGET_OFFSET_MS || 300);
const HARD_CUTOFF_MS = Number(process.env.QUOTEX_HARD_CUTOFF_MS || 3000);
const MIN_PAYOUT = Number(process.env.QUOTEX_MIN_PAYOUT || 80);
const DEFAULT_STAKE = Number(process.env.QUOTEX_STAKE || 1);
const ALLOW_OTC = String(process.env.QUOTEX_ALLOW_OTC || '').toLowerCase() === 'true';

const state = {
  enabled: ENABLED,
  live: LIVE,
  connected: false,
  loggedIn: false,
  lastError: null,
  lastSignalId: null,
  lastTrade: null,
  balance: null,
  openTrades: 0,
  settledTrades: 0,
  startedAt: Date.now()
};

const claimedTradeIds = new Set();
const openTrades = new Map();
let executionQueue = Promise.resolve();

function log(event, extra={}) {
  console.log(JSON.stringify({ service:'quotex-mobile', event, at:Date.now(), ...extra }));
}

async function fetchSignals() {
  const r = await fetch(`${BASE_URL}/api/execution/signals`, { cache:'no-store' });
  if (!r.ok) throw new Error(`Falcon signal feed ${r.status}`);
  return r.json();
}

async function ensureLogin(page) {
  await page.goto(QX_URL, { waitUntil:'domcontentloaded', timeout:45000 });
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
  const button = page.getByRole('button', { name:/sign in|login/i }).first();
  if (!(await button.count())) throw new Error('Quotex sign-in button not detected');
  await button.click();
  await page.waitForTimeout(2500);
  if (await page.locator('#tab-active').count()) {
    state.loggedIn = true;
    log('login-ok');
    return;
  }
  throw new Error('Login not completed. Quotex may require verification/CAPTCHA; live execution remains off.');
}

async function snapshot(page) {
  return page.evaluate(() => {
    const txt = el => String(el?.textContent || '').replace(/\s+/g,' ').trim();
    const pairKey = s => String(s||'').toUpperCase().replace(/\(OTC\)/g,'').replace(/[^A-Z]/g,'');
    const currentPair = pairKey(txt(document.querySelector('#tab-active [class*="WRocw"],#tab-active')));
    const selectors=['[class*="balance__value"]','[class*="balanceValue"]','[class*="balance-value"]','.profile__balance','[data-id="balance"]','.balance span'];
    let balance=null;
    for (const sel of selectors) {
      const el=document.querySelector(sel); if(!el) continue;
      const n=Number(txt(el).replace(/[^0-9.,-]/g,'').replace(/,/g,''));
      if(Number.isFinite(n)){ balance=n; break; }
    }
    const history=[...document.querySelectorAll('.vEqGz')].map(row=>{
      const text=txt(row), id=text.match(/ID:\s*([a-f0-9-]{16,})/i)?.[1];
      const resultEl=row.querySelector('.lCITV'), returnedText=txt(resultEl), returned=returnedText?Number(returnedText.replace(/[^0-9.-]/g,'')):null;
      const lower=text.toLowerCase();
      const semanticResult=/\b(win|won|profit|successful)\b/.test(lower)?'WIN':/\b(loss|lost|lose)\b/.test(lower)?'LOSS':/\b(draw|tie)\b/.test(lower)?'DRAW':null;
      return {id,returned:Number.isFinite(returned)?returned:null,returnedText,text,semanticResult};
    }).filter(x=>x.id);
    return { currentPair, balance, history:history.slice(0,20), page:location.href };
  });
}

async function choosePair(page, pair) {
  return page.evaluate(async ({pair,allowOtc}) => {
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const txt=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
    const pairKey=s=>String(s||'').toUpperCase().replace(/\(OTC\)/g,'').replace(/[^A-Z]/g,'');
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight};
    const setInput=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur()};
    const click=el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));el.click()};
    pair=pairKey(pair);
    const current=pairKey(txt(document.querySelector('#tab-active [class*="WRocw"],#tab-active')));
    if(current===pair)return true;
    if(!document.querySelector('input[placeholder="Search"]')) click(document.querySelector('button.CAZSg')||[...document.querySelectorAll('button')].find(b=>b.querySelector('svg.icon-plus')));
    const end=Date.now()+2500; while(!document.querySelector('input[placeholder="Search"]')){if(Date.now()>end)throw new Error('Asset picker did not open');await sleep(25)}
    setInput(document.querySelector('input[placeholder="Search"]'),pair.slice(0,3)+'/'+pair.slice(3)); await sleep(100);
    const rows=[...document.querySelectorAll('.R2Rgm,.vPvlJ')].filter(visible).filter(r=>pairKey(txt(r))===pair);
    const row=rows.find(r=>!/\(OTC\)/.test(txt(r)))||(allowOtc?rows.find(r=>/\(OTC\)/.test(txt(r))):null);
    if(!row)throw new Error('Requested asset unavailable'); click(row);
    const end2=Date.now()+3500; while(pairKey(txt(document.querySelector('#tab-active [class*="WRocw"],#tab-active')))!==pair){if(Date.now()>end2)throw new Error('Pair switch failed');await sleep(25)}
    return true;
  }, { pair, allowOtc:ALLOW_OTC });
}

async function prepareControls(page, stake, minutes) {
  await page.evaluate(({stake,minutes}) => {
    const txt=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
    const setInput=(input,value)=>{if(!input)throw new Error('Quotex input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur()};
    const time=document.querySelector('input.input-control__input[placeholder="00:00:30"]');
    const seconds=Math.max(1,Number(minutes))*60;
    const value=String(Math.floor(seconds/3600)).padStart(2,'0')+':'+String(Math.floor(seconds%3600/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    const amount=[...document.querySelectorAll('input.input-control__input:not([disabled])')].find(i=>/investment/i.test(txt(i.parentElement?.parentElement))||/\$/.test(String(i.value)));
    setInput(time,value); setInput(amount,Number(stake).toFixed(2));
  }, { stake, minutes });
}

async function clickDirection(page, direction) {
  return page.evaluate(direction => {
    const txt=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight};
    const wanted=direction==='BUY'?/^up$/i:/^down$/i;
    const el=[...document.querySelectorAll('button')].find(b=>visible(b)&&wanted.test(txt(b)));
    if(!el)throw new Error('Direction button missing');
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));
    el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true}));
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0})); el.click(); return true;
  }, direction);
}

function inferSettlement(row, trade, beforeBalance, afterBalance) {
  const balanceDelta=Number.isFinite(beforeBalance)&&Number.isFinite(afterBalance)?Number((afterBalance-beforeBalance).toFixed(2)):null;
  let status=row.semanticResult||null, profit=null, source=null;
  if (/^[+-]/.test(String(row.returnedText||'').trim()) && Number.isFinite(row.returned)) {
    profit=Number(row.returned.toFixed(2)); source='HISTORY_SIGNED_VALUE';
    status=profit>0?'WIN':profit<0?'LOSS':'DRAW';
  } else if (status && Number.isFinite(row.returned)) {
    profit=status==='LOSS'?-Math.abs(trade.stake):status==='DRAW'?0:null; source='HISTORY_SEMANTIC';
  } else if (openTrades.size<=1 && balanceDelta!==null) {
    profit=balanceDelta; source='BALANCE_DELTA_SINGLE_OPEN_TRADE';
    status=profit>0?'WIN':profit<0?'LOSS':'DRAW';
  } else if (Number.isFinite(row.returned)) {
    // Quotex commonly renders total return for a settled position. Keep this as a fallback only.
    if(row.returned===0){profit=-Math.abs(trade.stake);status='LOSS'}
    else if(row.returned>=trade.stake){profit=Number((row.returned-trade.stake).toFixed(2));status=profit>0?'WIN':'DRAW'}
    source='HISTORY_RETURN_FALLBACK';
  }
  return {status:status||'SETTLED_UNCLASSIFIED',profit,balanceDelta,profitSource:source};
}

async function monitorSettlement(page, trade, beforeHistory, beforeBalance) {
  await sleep(Math.max(0,Number(trade.expiry)-Date.now()+700));
  for(let i=0;i<240;i++){
    const after=await snapshot(page);
    if(Number.isFinite(after.balance))state.balance=after.balance;
    const row=after.history.find(x=>!beforeHistory.some(y=>y.id===x.id)&&!claimedTradeIds.has(x.id));
    if(row){
      claimedTradeIds.add(row.id);
      const settled=inferSettlement(row,trade,beforeBalance,after.balance);
      trade.tradeId=row.id;trade.returned=row.returned;trade.returnedText=row.returnedText;trade.postBalance=after.balance;
      trade.profit=settled.profit;trade.balanceDelta=settled.balanceDelta;trade.profitSource=settled.profitSource;
      trade.status=settled.status;trade.settledAt=Date.now();
      openTrades.delete(trade.signalId);state.openTrades=openTrades.size;state.settledTrades++;state.lastTrade=trade;
      log('trade-settled',trade);return;
    }
    await sleep(100);
  }
  trade.status='SETTLEMENT_UNCONFIRMED';openTrades.delete(trade.signalId);state.openTrades=openTrades.size;state.lastTrade=trade;log('settlement-unconfirmed',trade);
}

async function executeSignal(page, signal) {
  const now=Date.now(), boundary=Number(signal.signalBoundary), cutoff=boundary+HARD_CUTOFF_MS;
  if (!Number.isFinite(boundary) || now>cutoff) return false;
  state.lastSignalId=signal.id;
  if (!LIVE) { log('observe-signal', { id:signal.id,pair:signal.pair,direction:signal.direction,horizon:signal.horizon,confidence:signal.confidence }); return true; }
  const before=await snapshot(page);if(Number.isFinite(before.balance))state.balance=before.balance;
  await choosePair(page, signal.pair);
  await prepareControls(page, DEFAULT_STAKE, Number(signal.horizon));
  const executeAt=boundary+TARGET_OFFSET_MS;
  if(executeAt>Date.now())await sleep(executeAt-Date.now());
  if(Date.now()>cutoff)throw new Error('Signal missed hard execution cutoff');
  await clickDirection(page, signal.direction);
  const trade={signalId:signal.id,pair:signal.pair,direction:signal.direction,horizon:Number(signal.horizon),stake:DEFAULT_STAKE,openedAt:Date.now(),preBalance:before.balance,expiry:Number(signal.expiry),status:'OPEN'};
  openTrades.set(trade.signalId,trade);state.openTrades=openTrades.size;state.lastTrade=trade;log('trade-opened',trade);
  monitorSettlement(page,trade,before.history,before.balance).catch(e=>{trade.status='SETTLEMENT_ERROR';trade.settlementError=e.message;openTrades.delete(trade.signalId);state.openTrades=openTrades.size;state.lastError=e.message;state.lastTrade=trade;log('settlement-error',{signalId:trade.signalId,error:e.message})});
  return true;
}

function queueExecution(page, signal) {
  const task=executionQueue.then(()=>executeSignal(page,signal));
  executionQueue=task.catch(e=>{state.lastError=e.message;log('execution-error',{signalId:signal.id,error:e.message})});
  return task;
}

async function main(){
  if(!ENABLED){log('disabled',{hint:'Set QUOTEX_MOBILE_ENABLED=true in Railway to start the browser worker.'});return;}
  const context=await chromium.launchPersistentContext(PROFILE,{headless:true,executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],viewport:{width:1440,height:1000}});
  const page=context.pages()[0]||await context.newPage();state.connected=true;
  try{await ensureLogin(page);log('session-ready',{live:LIVE,url:page.url()});}catch(e){state.lastError=e.message;log('login-blocked',{error:e.message});await context.close();return;}
  const seen=new Set();
  while(true){
    try{
      const feed=await fetchSignals();
      for(const signal of feed.signals||[]){
        if(seen.has(signal.id))continue;
        if(Number(signal.confidence)<Number(feed.minimumConfidence||0))continue;
        if(signal.tradeQualified!==true)continue;
        seen.add(signal.id);
        queueExecution(page,signal).catch(()=>{});
      }
      if(seen.size>5000){const keep=[...seen].slice(-2500);seen.clear();keep.forEach(x=>seen.add(x))}
      state.lastError=null;
    }catch(e){state.lastError=e.message;log('worker-error',{error:e.message});}
    await sleep(POLL_MS);
  }
}

main().catch(err=>{state.lastError=err.message;log('fatal',{error:err.stack||err.message});process.exitCode=1});
