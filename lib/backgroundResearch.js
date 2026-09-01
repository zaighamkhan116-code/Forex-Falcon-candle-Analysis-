import {getStagedSnapshot,getSettlementPrice,marketSymbol} from './marketData.js';
import {analyze} from './analysis.js';
import {getForexTickConfirmation,applyForexTickConfirmation,getForexLivePrice} from './forexTicks.js';
import {microstructureSupported,getMicrostructureSnapshot,applyMicrostructure} from './microstructure.js';

const pairs=['EURUSD','EURJPY','GBPUSD','AUDJPY','AUDUSD','USDJPY','NZDCHF','USDPKR','USDINR','BTCUSD','XAUUSD'];
const allowedHorizons=new Set([1,2,3,5,15]);
const states=new Map(),timers=new Map(),preferredHorizon=new Map(),activePairs=new Set(['EURUSD']);
const SCAN_MS=500,MIN_CONFIDENCE=60,PRE_BOUNDARY_MS=5000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const key=(pair,h)=>`${pair}:${h}`;

function S(pair,horizon=1){
  pair=String(pair).toUpperCase();horizon=Number(horizon)||1;
  const k=key(pair,horizon);
  if(!states.has(k))states.set(k,{pair,horizon,pending:[],resolved:[],lastRunAt:null,lastError:null,running:false,targetBoundary:null,candidate:null,displaySignal:null,scans:0,qualifiedScans:0,primedAt:null,cycleStartedAt:null,lastLockedBoundary:null});
  return states.get(k);
}

function streaks(rows){let w=0,l=0,mw=0,ml=0;for(const x of rows){if(x.result==='WIN'){w++;l=0;mw=Math.max(mw,w)}else if(x.result==='LOSS'){l++;w=0;ml=Math.max(ml,l)}}return{maxWinStreak:mw,maxLossStreak:ml}}
function oneStats(s){
  const r=s.resolved.filter(x=>x.qualified===true&&Number(x.confidence)>=MIN_CONFIDENCE),w=r.filter(x=>x.result==='WIN').length,l=r.filter(x=>x.result==='LOSS').length,t=r.filter(x=>x.result==='TIE').length;
  return{pair:s.pair,horizon:s.horizon,mode:'INDEPENDENT_TIMEFRAME_BOUNDARY_CYCLE',scanEveryMs:SCAN_MS,minimumConfidence:MIN_CONFIDENCE,scans:s.scans,qualifiedScans:s.qualifiedScans,currentCandidate:s.candidate,displaySignal:s.displaySignal,sample:r.length,pending:s.pending.filter(x=>x.qualified).length,wins:w,losses:l,ties:t,accuracy:w+l?w/(w+l):null,...streaks(r),last:r.at(-1)||null,recent:r.slice(-20).reverse(),lastRunAt:s.lastRunAt,lastError:s.lastError,running:s.running,primedAt:s.primedAt,targetBoundary:s.targetBoundary,cycleStartedAt:s.cycleStartedAt,lastLockedBoundary:s.lastLockedBoundary};
}
function pairStats(pair){pair=String(pair).toUpperCase();const h=preferredHorizon.get(pair)||1,primary=oneStats(S(pair,h)),horizons={};for(const hh of allowedHorizons){const s=states.get(key(pair,hh));if(s)horizons[hh]=oneStats(s)}return{...primary,horizons,allTimeframesActive:activePairs.has(pair)}}

async function enrich(result,pair,h){if(microstructureSupported(pair)){try{return applyMicrostructure(result,await getMicrostructureSnapshot(pair))}catch{return result}}const tick=getForexTickConfirmation(pair);return tick?applyForexTickConfirmation(result,tick,h):result}
async function precisePrice(pair){const live=getForexLivePrice(pair,5000);if(live)return live;const x=await getSettlementPrice(pair);return{...x,source:'CANDLE_FALLBACK'}}

function aggregateM1(candles,minutes){
  const span=minutes*60000,now=Date.now(),out=[];
  for(const x of candles||[]){
    const t=Math.floor(Number(x.time)/span)*span;
    if(t+span>now-250)continue;
    let b=out.at(-1);
    if(!b||b.time!==t){b={time:t,open:x.open,high:x.high,low:x.low,close:x.close,volume:Number(x.volume||0)};out.push(b)}
    else{b.high=Math.max(b.high,x.high);b.low=Math.min(b.low,x.low);b.close=x.close;b.volume+=Number(x.volume||0)}
  }
  return out;
}

export function timeframeBundle(bundle,horizon){
  const h=Number(horizon)||1;
  if(h===1)return{...bundle,analysisTimeframe:'1M'};
  if(h===2){const base=aggregateM1(bundle.m1,2);return{...bundle,m1:base,m5:base,m15:bundle.m15,h1:bundle.h1,analysisTimeframe:'2M'}}
  if(h===3){const base=aggregateM1(bundle.m1,3);return{...bundle,m1:base,m5:base,m15:bundle.m15,h1:bundle.h1,analysisTimeframe:'3M'}}
  if(h===5)return{...bundle,m1:bundle.m5,m5:bundle.m5,m15:bundle.m15,h1:bundle.h1,analysisTimeframe:'5M'};
  if(h===15)return{...bundle,m1:bundle.m15,m5:bundle.m15,m15:bundle.m15,h1:bundle.h1,analysisTimeframe:'15M'};
  return{...bundle,analysisTimeframe:`${h}M`};
}

function nextBoundary(h,now=Date.now()){
  const span=Number(h)*60000;
  return Math.ceil((now+250)/span)*span;
}

async function settle(s){
  if(!s.pending.length)return;
  const now=Date.now();if(!s.pending.some(p=>now>=p.expiry))return;
  let x;try{x=await precisePrice(s.pair)}catch(e){s.lastError=`settlement: ${e.message}`;return}
  const keep=[];
  for(const p of s.pending){
    if(now<p.expiry){keep.push(p);continue}
    const d=x.price-p.entry,result=d===0?'TIE':(p.direction==='BUY'?d>0:d<0)?'WIN':'LOSS';
    s.resolved.push({...p,exit:x.price,exitSource:x.source,exitBid:x.bid??null,exitAsk:x.ask??null,priceDifference:d,result,resolvedAt:now,settlementRule:'ANY_FAVORABLE_DIFFERENCE_WINS'});
  }
  s.pending=keep;s.resolved=s.resolved.slice(-5000);
}

function timeframeConfidence(raw,enriched,h){const tech=Number(raw?.confidence||50),live=Number(enriched?.confidence||tech),tw={1:.40,2:.50,3:.60,5:.72,15:.84}[Number(h)]||.60;return clamp(tech*tw+live*(1-tw),50,100)}

async function analyzeFresh(s,boundary){
  s.scans++;
  try{
    const rawBundle=await getStagedSnapshot(s.pair),bundle=timeframeBundle(rawBundle,s.horizon),raw=analyze(bundle,s.horizon,s.pair),enriched=await enrich(raw,s.pair,s.horizon);
    const confidence=Number(timeframeConfidence(raw,enriched,s.horizon).toFixed(1)),qualified=confidence>=MIN_CONFIDENCE;
    if(qualified)s.qualifiedScans++;
    const sig={pair:s.pair,horizon:s.horizon,analysisTimeframe:bundle.analysisTimeframe||`${s.horizon}M`,boundary,cycleStartedAt:boundary-s.horizon*60000,direction:enriched.direction||raw.direction,confidence,technicalConfidence:Number(raw.confidence||50),liveConfirmationConfidence:Number(enriched.confidence||raw.confidence||50),qualified,generatedAt:Date.now(),regime:enriched.regime||raw.regime,engine:`${enriched.engine||raw.engine||'TECHNICAL'}_${bundle.analysisTimeframe||`${s.horizon}M`}`,features:{...(enriched.features||raw.features||{}),analysisTimeframe:bundle.analysisTimeframe||`${s.horizon}M`},forexTicks:enriched.forexTicks||null};
    s.candidate=sig;s.displaySignal=sig;s.lastRunAt=Date.now();s.lastError=null;s.primedAt=s.primedAt||s.lastRunAt;s.cycleStartedAt=sig.cycleStartedAt;
    return sig;
  }catch(e){s.lastError=e.message;return null}
}

async function lockCandidateAtBoundary(s,boundary){
  if(s.lastLockedBoundary===boundary)return;
  const sig=s.candidate;
  s.lastLockedBoundary=boundary;
  if(sig?.qualified){
    try{
      const entry=await precisePrice(s.pair),expiry=boundary+s.horizon*60000;
      s.pending.push({id:`${s.pair}-${s.horizon}-${boundary}`,pair:s.pair,symbol:marketSymbol(s.pair),horizon:s.horizon,analysisTimeframe:sig.analysisTimeframe,predictedAt:sig.generatedAt,signalBoundary:boundary,entry:entry.price,entrySource:entry.source,entryBid:entry.bid??null,entryAsk:entry.ask??null,entryLockedAt:Date.now(),expiry,direction:sig.direction,confidence:sig.confidence,qualified:true,minimumConfidence:MIN_CONFIDENCE,regime:sig.regime,engine:sig.engine,features:sig.features,result:'PENDING',quotexRule:true,validationMode:'BOUNDARY_ALIGNED_QUALIFIED'});
    }catch(e){s.lastError=`entry: ${e.message}`}
  }
  s.candidate=null;
  s.targetBoundary=nextBoundary(s.horizon,boundary+250);
}

async function scanState(s){
  if(!s.running)return;
  await settle(s);
  const now=Date.now();
  if(!s.targetBoundary||now>s.targetBoundary+s.horizon*60000)s.targetBoundary=nextBoundary(s.horizon,now);
  const boundary=s.targetBoundary;
  if(!s.candidate&&now>=boundary-PRE_BOUNDARY_MS&&now<boundary)await analyzeFresh(s,boundary);
  if(now>=boundary&&s.lastLockedBoundary!==boundary)await lockCandidateAtBoundary(s,boundary);
  const wait=Math.max(100,Math.min(SCAN_MS,(s.targetBoundary||nextBoundary(s.horizon))-Date.now()));
  timers.set(key(s.pair,s.horizon),setTimeout(()=>scanState(s),wait));
}

function startState(pair,horizon){
  const s=S(pair,horizon),k=key(pair,horizon);
  if(!s.running)s.running=true;
  if(!s.targetBoundary)s.targetBoundary=nextBoundary(horizon);
  if(!timers.has(k))timers.set(k,setTimeout(()=>scanState(s),50));
  return s;
}

function startPairAllHorizons(pair){
  pair=String(pair).toUpperCase();activePairs.add(pair);
  const out=[];for(const h of allowedHorizons)out.push(startState(pair,h));
  return out;
}

export async function primeAllPairs(){
  const ss=[];
  for(const p of pairs){
    const h=preferredHorizon.get(p)||1;preferredHorizon.set(p,h);
    if(activePairs.has(p))ss.push(...startPairAllHorizons(p));else ss.push(startState(p,h));
  }
  return pairs.map(pairStats);
}

export function setBackgroundHorizon(pair,horizon){
  pair=String(pair).toUpperCase();horizon=Number(horizon);
  if(!pairs.includes(pair))throw new Error('Unsupported background research pair');
  if(!allowedHorizons.has(horizon))throw new Error('Unsupported horizon');
  preferredHorizon.set(pair,horizon);
  startPairAllHorizons(pair);
  return oneStats(S(pair,horizon));
}

export function getBackgroundHorizon(pair){return preferredHorizon.get(String(pair).toUpperCase())||1}
export function startBackgroundResearch(){for(const p of pairs){const h=preferredHorizon.get(p)||1;preferredHorizon.set(p,h);if(activePairs.has(p))startPairAllHorizons(p);else startState(p,h)}}
export function stopBackgroundResearch(){for(const [k,t] of timers){clearTimeout(t);const s=states.get(k);if(s)s.running=false}timers.clear()}
export function getBackgroundResearch(pair,horizon=null){pair=String(pair).toUpperCase();if(horizon!=null)return oneStats(S(pair,Number(horizon)));return pairStats(pair)}
export function getAllBackgroundResearch(){return pairs.map(pairStats)}
