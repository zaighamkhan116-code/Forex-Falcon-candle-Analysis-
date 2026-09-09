import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { OtcIndependentEngine } from './otc_independent_engine.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = String(process.env.QUOTEX_BRIDGE_TOKEN || '');
const ROOT = process.env.QUOTEX_OTC_DATA_DIR || '/data/quotex-otc';
const MAX_AGE_MS = Math.max(1000, Number(process.env.QUOTEX_BRIDGE_MAX_AGE_MS || 10000));
const shadow = new OtcIndependentEngine({ root: ROOT });
await shadow.restore();
const pairQueues=new Map();
const serializePair=(pair,fn)=>{const work=(pairQueues.get(pair)||Promise.resolve()).catch(()=>{}).then(fn);pairQueues.set(pair,work);return work.finally(()=>{if(pairQueues.get(pair)===work)pairQueues.delete(pair);});};

app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Falcon-Bridge-Token');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const state = { connected:false,lastTickAt:null,lastPrice:null,lastPair:null,tickCount:0,duplicateCount:0,lastSource:null,lastClientTs:null,startedAt:Date.now(),lastError:null };
const marketState = { updatedAt:null, activePair:null, pairs:[] };

function authorized(req) {if (!TOKEN) return false;const supplied=String(req.get('X-Falcon-Bridge-Token')||'');return supplied.length===TOKEN.length&&supplied===TOKEN;}
function normalizePair(v) { return String(v || '').toUpperCase().replace(/\(OTC\)/g, '').replace(/[^A-Z]/g, '').slice(0,12); }
function validPair(p) { return /^[A-Z]{3,12}$/.test(p); }
function pct(v){const n=Number(v);return Number.isFinite(n)&&n>0&&n<=100?Math.round(n*10)/10:null;}
function dayFile(pair, ts) { return path.join(ROOT, `${pair}-OTC-${new Date(ts).toISOString().slice(0, 10)}.jsonl`); }
async function persistTick(tick) { await fs.mkdir(ROOT,{recursive:true}); await fs.appendFile(dayFile(tick.pair,tick.timestamp_ms),JSON.stringify(tick)+'\n','utf8'); }

app.get('/health', (_req,res) => {
  const ageMs=state.lastTickAt==null?null:Date.now()-state.lastTickAt;
  res.json({ ok:true,service:'falcon-quotex-browser-bridge',signalVersion:'OTC_INDEPENDENT_V7',strategyProfile:'INDEPENDENT_ANALYSES_STRENGTH_ARBITRATION',persistenceError:shadow.persistenceError,mode:'READ_ONLY_SHADOW',tradingEnabled:false,tokenConfigured:Boolean(TOKEN),connected:state.connected&&ageMs!==null&&ageMs<=MAX_AGE_MS,ageMs,...state,marketState,shadow:shadow.snapshot(),serverTime:Date.now() });
});
app.get('/api/quotex/otc/shadow',(req,res)=>{const pair=normalizePair(req.query?.pair||'');res.json({ok:true,mode:'SHADOW',tradingEnabled:false,data:pair?shadow.snapshot(pair):shadow.snapshot(),serverTime:Date.now()});});
app.get('/api/quotex/otc/micro',(req,res)=>{const pair=normalizePair(req.query?.pair||state.lastPair||'');if(!pair)return res.status(400).json({error:'pair is required until first OTC tick is received'});const snap=shadow.snapshot(pair);res.json({ok:true,pair,timeframeSeconds:1,currentCandle:snap.currentCandle,candleCount:snap.candleCount,structureContext:snap.structureContext,serverTime:Date.now()});});
app.get('/api/quotex/otc/market-state',(_req,res)=>res.json({ok:true,...marketState,serverTime:Date.now()}));

app.post('/api/quotex/otc/market-state',(req,res)=>{
  if(!authorized(req))return res.status(401).json({error:'Unauthorized bridge client'});
  const incoming=Array.isArray(req.body?.pairs)?req.body.pairs:[];const previous=new Map((marketState.pairs||[]).map(x=>[normalizePair(x.pair),x]));const pairs=[];const seen=new Set();
  for(const row of incoming){const p=normalizePair(row?.pair||row?.symbol||row?.name);if(!validPair(p)||seen.has(p))continue;const prev=previous.get(p)||{};const payout=pct(row?.payoutPercent??row?.payout??row?.roi);const profit1m=pct(row?.profit1mPercent??row?.payout1mPercent??row?.profit1Percent??row?.payout1Percent);const profit5m=pct(row?.profit5mPercent??row?.payout5mPercent??row?.profit5Percent??row?.payout5Percent);pairs.push({pair:p,displayName:String(row?.displayName||prev.displayName||`${p} (OTC)`).slice(0,80),payoutPercent:payout??prev.payoutPercent??null,profit1mPercent:profit1m??prev.profit1mPercent??null,profit5mPercent:profit5m??prev.profit5mPercent??null,available:row?.available!==false});seen.add(p);}
  for(const [p,prev] of previous){if(!seen.has(p)&&validPair(p)){pairs.push(prev);seen.add(p)}}
  marketState.updatedAt=Date.now();marketState.activePair=normalizePair(req.body?.activePair||state.lastPair||'')||null;marketState.pairs=pairs.slice(0,200);res.json({ok:true,count:marketState.pairs.length,serverTime:Date.now()});
});

app.post('/api/quotex/otc/tick', async (req,res)=>{
  if(!authorized(req))return res.status(401).json({error:'Unauthorized bridge client'});
  try{
    const pair=normalizePair(req.body?.pair),market=String(req.body?.market||'').toUpperCase(),price=Number(req.body?.price),clientTs=Number(req.body?.timestamp_ms||req.body?.timestamp||Date.now());
    if(!validPair(pair)||market!=='OTC'||!Number.isFinite(price)||price<=0)return res.status(400).json({error:'Invalid OTC tick payload'});
    const now=Date.now();if(Math.abs(now-clientTs)>60000)return res.status(400).json({error:'Stale or invalid client timestamp'});
    const tick={pair,market:'OTC',timestamp_ms:clientTs,timestamp_iso:new Date(clientTs).toISOString(),receivedAtMs:now,client_timestamp_ms:clientTs,client_lag_ms:now-clientTs,price,source:'QUOTEX_BROWSER_BRIDGE'};
    if(state.lastPair===pair&&state.lastPrice===price){state.duplicateCount++;state.connected=true;state.lastTickAt=now;state.lastClientTs=clientTs;const shadowEvent=await serializePair(pair,()=>shadow.onTick(tick));return res.json({ok:true,duplicate:true,serverTime:Date.now(),shadow:{predictions:shadowEvent.predictions,settlements:shadowEvent.settlements.map(s=>({id:s.id,expirySeconds:s.expirySeconds,outcome:s.outcome}))}});}
    shadow.queueWrite(()=>persistTick(tick));const shadowEvent=await serializePair(pair,()=>shadow.onTick(tick));state.connected=true;state.lastTickAt=now;state.lastPrice=price;state.lastPair=pair;state.tickCount++;state.lastSource=tick.source;state.lastClientTs=clientTs;
    if(state.tickCount<=5||state.tickCount%100===0)console.log(JSON.stringify({event:'bridge-tick',...tick,tickCount:state.tickCount}));
    res.json({ok:true,duplicate:false,serverTime:Date.now(),tickCount:state.tickCount,shadow:{predictions:shadowEvent.predictions,settlements:shadowEvent.settlements.map(s=>({id:s.id,expirySeconds:s.expirySeconds,outcome:s.outcome}))}});
  }catch(e){state.lastError=e.message;console.error(JSON.stringify({event:'bridge-error',error:e.message}));res.status(500).json({error:'Bridge tick persistence or shadow processing failed'});}
});

app.listen(PORT,()=>console.log(JSON.stringify({event:'bridge-ready',port:PORT,mode:'READ_ONLY_SHADOW',tradingEnabled:false,signalVersion:'OTC_INDEPENDENT_V7',shadowEngines:[10,15,30,60,120,180,300].map(x=>`OTC_${x}S_INDEPENDENT_V7`),tokenConfigured:Boolean(TOKEN),dataDir:ROOT})));
