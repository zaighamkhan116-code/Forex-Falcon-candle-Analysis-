import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { OtcAttributedEngine } from './otc_attributed_engine.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TOKEN = String(process.env.QUOTEX_BRIDGE_TOKEN || '');
const ROOT = process.env.QUOTEX_OTC_DATA_DIR || '/data/quotex-otc';
const MAX_AGE_MS = Math.max(1000, Number(process.env.QUOTEX_BRIDGE_MAX_AGE_MS || 10000));
const shadow = new OtcAttributedEngine({ root: ROOT });
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
function parseAuditTime(value,fallback){if(value==null||value==='')return fallback;const numeric=Number(value);if(Number.isFinite(numeric)&&numeric>0)return numeric;const parsed=Date.parse(String(value));return Number.isFinite(parsed)?parsed:fallback;}
function auditDirection(r){return r.direction==='UP'?'BUY':r.direction==='DOWN'?'SELL':String(r.direction||'UNKNOWN').toUpperCase();}
function strategyName(r){return r.primaryAnalysis?.name||r.entryPattern||r.engine||'UNKNOWN';}
function resultStats(rows){const out={total:rows.length,wins:0,losses:0,draws:0,resolved:0,winRate:null,maxConsecutiveLoss:0};let streak=0;for(const r of [...rows].sort((a,b)=>(a.settlementTimestampMs||a.entryTimestampMs||0)-(b.settlementTimestampMs||b.entryTimestampMs||0))){if(r.outcome==='WIN'){out.wins++;out.resolved++;streak=0;}else if(r.outcome==='LOSS'){out.losses++;out.resolved++;streak++;out.maxConsecutiveLoss=Math.max(out.maxConsecutiveLoss,streak);}else if(r.outcome==='DRAW'){out.draws++;streak=0;}}if(out.resolved)out.winRate=Math.round(out.wins/out.resolved*10000)/100;return out;}
function auditSnapshot(options={}){
  const fromMs=Number.isFinite(Number(options.fromMs))?Number(options.fromMs):null,toMs=Number.isFinite(Number(options.toMs))?Number(options.toMs):null;
  const allRows=[...shadow.pairs.values()].flatMap(s=>(s.recentSettlements||[]).map(r=>({...r,pair:r.pair||s.pair}))).sort((a,b)=>(b.settlementTimestampMs||0)-(a.settlementTimestampMs||0));
  const rows=allRows.filter(r=>{const ts=Number(r.settlementTimestampMs||r.entryTimestampMs||0);return(!fromMs||ts>=fromMs)&&(!toMs||ts<=toMs);});
  const groups=new Map();
  const add=(dimension,key,r)=>{const full=`${dimension}:${key}`;if(!groups.has(full))groups.set(full,{dimension,key,total:0,wins:0,losses:0,draws:0,lagSum:0,lagN:0,maxConsecutiveLoss:0});const g=groups.get(full);g.total++;if(r.outcome==='WIN')g.wins++;else if(r.outcome==='LOSS')g.losses++;else g.draws++;const lag=Number(r.clientLagMs);if(Number.isFinite(lag)){g.lagSum+=lag;g.lagN++;}};
  for(const r of rows){const direction=auditDirection(r),strategy=strategyName(r),regime=r.features?.structureRegime||r.structureContext?.structure?.regime||r.attribution?.regime||'UNKNOWN';add('PAIR',r.pair,r);add('EXPIRY',`${r.expirySeconds}s`,r);add('DIRECTION',direction,r);add('ENGINE',r.engine||'UNKNOWN',r);add('STRATEGY',strategy,r);add('PAIR_EXPIRY',`${r.pair}:${r.expirySeconds}s`,r);add('PAIR_EXPIRY_DIRECTION',`${r.pair}:${r.expirySeconds}s:${direction}`,r);add('STRATEGY_DIRECTION',`${strategy}:${direction}`,r);add('REGIME',regime,r);add('STRATEGY_REGIME',`${strategy}:${regime}`,r);add('VALIDATION',r.validation||'UNKNOWN',r);if(r.attribution){add('LOCATION',r.attribution.location||'UNKNOWN',r);add('EMA',r.attribution.emaAlignment||'UNKNOWN',r);add('BB',r.attribution.bbState||'UNKNOWN',r);add('SETUP_REGIME',`${r.attribution.setup||'UNKNOWN'}:${r.attribution.regime||'UNKNOWN'}`,r);}}
  for(const g of groups.values()){const dimensionRows=rows.filter(r=>{const d=auditDirection(r),s=strategyName(r),reg=r.features?.structureRegime||r.structureContext?.structure?.regime||r.attribution?.regime||'UNKNOWN';if(g.dimension==='DIRECTION')return d===g.key;if(g.dimension==='STRATEGY')return s===g.key;if(g.dimension==='STRATEGY_DIRECTION')return `${s}:${d}`===g.key;if(g.dimension==='PAIR_EXPIRY_DIRECTION')return `${r.pair}:${r.expirySeconds}s:${d}`===g.key;if(g.dimension==='REGIME')return reg===g.key;if(g.dimension==='STRATEGY_REGIME')return `${s}:${reg}`===g.key;return false;});if(dimensionRows.length)g.maxConsecutiveLoss=resultStats(dimensionRows).maxConsecutiveLoss;}
  const summary=[...groups.values()].map(g=>({...g,resolved:g.wins+g.losses,winRate:(g.wins+g.losses)?Math.round(g.wins/(g.wins+g.losses)*10000)/100:null,avgClientLagMs:g.lagN?Math.round(g.lagSum/g.lagN):null})).sort((a,b)=>(a.winRate??101)-(b.winRate??101)||b.total-a.total);
  const byDirection=Object.fromEntries(['BUY','SELL'].map(d=>[d,resultStats(rows.filter(r=>auditDirection(r)===d))]));
  const strategyRows=[...new Set(rows.map(strategyName))].map(strategy=>({strategy,...resultStats(rows.filter(r=>strategyName(r)===strategy))}));
  const rankedStrategies=strategyRows.filter(x=>x.resolved>0).sort((a,b)=>b.winRate-a.winRate||b.resolved-a.resolved);
  const reliable=rankedStrategies.filter(x=>x.resolved>=5),lowSample=rankedStrategies.filter(x=>x.resolved<5);
  const losses=rows.filter(r=>r.outcome==='LOSS').slice(0,500).map(r=>({id:r.id,pair:r.pair,expirySeconds:r.expirySeconds,direction:auditDirection(r),engine:r.engine||null,strategy:strategyName(r),entryPrice:r.entryPrice,settlementPrice:r.settlementPrice,priceDelta:r.priceDelta,entryTimestampMs:r.entryTimestampMs,settlementTimestampMs:r.settlementTimestampMs,settlementDelayMs:r.settlementDelayMs,clientLagMs:r.clientLagMs??null,trigger:r.primaryAnalysis?.name||r.entryPattern||'UNKNOWN',triggerStrength:r.primaryAnalysis?.strength??null,validation:r.validation||null,agreementCount:r.agreementCount??null,opposingAnalyses:(r.opposingAnalyses||[]).map(x=>({name:x.name,direction:x.direction,strength:x.strength})),regime:r.features?.structureRegime||r.structureContext?.structure?.regime||r.attribution?.regime||null,attribution:r.attribution||null}));
  return{generatedAt:Date.now(),window:{fromMs,toMs,fromIso:fromMs?new Date(fromMs).toISOString():null,toIso:toMs?new Date(toMs).toISOString():null},availableSettledSample:allRows.length,settledSample:rows.length,overall:resultStats(rows),byDirection,strategies:{bestReliable:reliable.slice(0,10),worstReliable:[...reliable].sort((a,b)=>a.winRate-b.winRate||b.resolved-a.resolved).slice(0,10),all:rankedStrategies,lowSample},summary,losses};
}

app.get('/health', (_req,res) => {
  const ageMs=state.lastTickAt==null?null:Date.now()-state.lastTickAt;
  res.json({ ok:true,service:'falcon-quotex-browser-bridge',signalVersion:'OTC_REGIME_V11_ATTRIBUTION_V1',strategyProfile:'REGIME_AWARE_INDEPENDENT_ANALYSES_WITH_ATTRIBUTION',persistenceError:shadow.persistenceError,mode:'READ_ONLY_SHADOW',tradingEnabled:false,tokenConfigured:Boolean(TOKEN),connected:state.connected&&ageMs!==null&&ageMs<=MAX_AGE_MS,ageMs,...state,marketState,shadow:shadow.snapshot(),serverTime:Date.now() });
});
app.get('/api/quotex/otc/signals',(_req,res)=>{const signals=[...shadow.pairs.values()].flatMap(p=>Object.values(p.latestPrediction).filter(Boolean)).map(p=>({id:p.id,pair:p.pair,marketType:p.marketType,expirySeconds:p.expirySeconds,direction:p.direction,confidence:p.confidence,entryTimestampMs:p.entryTimestampMs,targetTimestampMs:p.targetTimestampMs,status:p.status,signalClass:p.signalClass,frequencyFloor:p.frequencyFloor,engine:p.engine||null,strategy:strategyName(p),validation:p.validation||null,regime:p.features?.structureRegime||p.attribution?.regime||null,attribution:p.attribution||null}));res.json({ok:true,signals,serverTime:Date.now(),signalVersion:'OTC_REGIME_V11_ATTRIBUTION_V1'});});
app.get('/api/quotex/otc/shadow',(req,res)=>{const pair=normalizePair(req.query?.pair||'');res.json({ok:true,mode:'SHADOW',tradingEnabled:false,data:pair?shadow.snapshot(pair):shadow.snapshot(),serverTime:Date.now()});});
app.get('/api/quotex/otc/audit',(req,res)=>{const now=Date.now(),fromMs=parseAuditTime(req.query?.from,null),toMs=parseAuditTime(req.query?.to,now);res.json({ok:true,mode:'READ_ONLY_SHADOW',...auditSnapshot({fromMs,toMs})});});
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

app.listen(PORT,()=>{const startupAudit=auditSnapshot();console.log(JSON.stringify({event:'bridge-ready',port:PORT,mode:'READ_ONLY_SHADOW',tradingEnabled:false,signalVersion:'OTC_REGIME_V11_ATTRIBUTION_V1',shadowEngines:[10,15,30,60,120,180,300].map(x=>`OTC_${x}S_REGIME_V11`),tokenConfigured:Boolean(TOKEN),dataDir:ROOT,restoredSettlements:startupAudit.settledSample,restoredDirection:startupAudit.byDirection,restoredBestStrategies:startupAudit.strategies.bestReliable.slice(0,5),restoredWorstStrategies:startupAudit.strategies.worstReliable.slice(0,5)}));});