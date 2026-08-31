import {getStagedSnapshot,getSettlementPrice,marketSymbol} from './marketData.js';
import {analyze} from './analysis.js';
import {getForexTickConfirmation,applyForexTickConfirmation} from './forexTicks.js';
import {microstructureSupported,getMicrostructureSnapshot,applyMicrostructure} from './microstructure.js';

const pairs=['EURUSD','EURJPY','GBPUSD','CADCHF','USDJPY','NZDCHF','BTCUSD'];
const allowedHorizons=new Set([1,2,3,5,15]);
const state=new Map();
const timers=new Map();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function S(pair){if(!state.has(pair))state.set(pair,{pair,horizon:1,pending:[],resolved:[],lastRunAt:null,lastError:null,running:false});return state.get(pair);}
function streaks(rows){let w=0,l=0,mw=0,ml=0;for(const x of rows){if(x.result==='WIN'){w++;l=0;mw=Math.max(mw,w)}else if(x.result==='LOSS'){l++;w=0;ml=Math.max(ml,l)}}return{maxWinStreak:mw,maxLossStreak:ml};}
function stats(pair){const s=S(pair),r=s.resolved,w=r.filter(x=>x.result==='WIN').length,l=r.filter(x=>x.result==='LOSS').length,t=r.filter(x=>x.result==='TIE').length;const bands={};for(const [name,a,b] of [['50-55',50,55],['55-60',55,60],['60-65',60,65],['65+',65,101]]){const q=r.filter(x=>x.confidence>=a&&x.confidence<b),qw=q.filter(x=>x.result==='WIN').length,ql=q.filter(x=>x.result==='LOSS').length;bands[name]={sample:q.length,wins:qw,losses:ql,accuracy:qw+ql?qw/(qw+ql):null};}return{pair,horizon:s.horizon,sample:r.length,pending:s.pending.length,wins:w,losses:l,ties:t,accuracy:w+l?w/(w+l):null,...streaks(r),confidenceBands:bands,last:r.at(-1)||null,lastRunAt:s.lastRunAt,lastError:s.lastError,running:s.running};}
async function enrich(result,pair){if(microstructureSupported(pair)){try{return applyMicrostructure(result,await getMicrostructureSnapshot(pair))}catch{return result}}const tick=getForexTickConfirmation(pair);return tick?applyForexTickConfirmation(result,tick):result;}
async function settle(pair){const s=S(pair);if(!s.pending.length)return;let x;try{x=await getSettlementPrice(pair)}catch(e){s.lastError=`settlement: ${e.message}`;return}const now=Date.now(),keep=[];for(const p of s.pending){if(now<p.expiry){keep.push(p);continue}const d=x.price-p.entry,result=d===0?'TIE':(p.direction==='BUY'?d>0:d<0)?'WIN':'LOSS';s.resolved.push({...p,exit:x.price,result,resolvedAt:now,settlementRule:'ANY_FAVORABLE_DIFFERENCE_WINS'});}s.pending=keep;s.resolved=s.resolved.slice(-5000);}
async function predict(pair){const s=S(pair),h=s.horizon;try{await settle(pair);const bundle=await getStagedSnapshot(pair);let r=analyze(bundle,h,pair);r=await enrich(r,pair);const now=Date.now(),span=h*60000,boundary=Math.ceil((now+1000)/span)*span,wait=Math.max(0,boundary-Date.now()+25);if(wait)await new Promise(x=>setTimeout(x,wait));const entry=await getSettlementPrice(pair);s.pending.push({id:`${pair}-${h}-${boundary}`,pair,symbol:marketSymbol(pair),horizon:h,predictedAt:now,signalBoundary:boundary,entry:entry.price,entryLockedAt:Date.now(),expiry:boundary+h*60000,direction:r.direction,confidence:Number(clamp(Number(r.confidence)||50,50,100).toFixed(1)),regime:r.regime,engine:r.engine||'TECHNICAL',features:r.features||{},result:'PENDING',quotexRule:true});s.lastRunAt=Date.now();s.lastError=null;}catch(e){s.lastError=e.message;}}
function schedule(pair){const s=S(pair);s.running=true;const now=Date.now(),span=s.horizon*60000,next=Math.ceil(now/span)*span-30000,delay=Math.max(1000,next-now);const t=setTimeout(async()=>{if(!s.running)return;await predict(pair);schedule(pair);},delay);timers.set(pair,t);}
export function setBackgroundHorizon(pair,horizon){pair=String(pair).toUpperCase();horizon=Number(horizon);if(!pairs.includes(pair))throw new Error('Unsupported background research pair');if(!allowedHorizons.has(horizon))throw new Error('Unsupported horizon');const s=S(pair);s.horizon=horizon;const t=timers.get(pair);if(t)clearTimeout(t);timers.delete(pair);if(s.running)schedule(pair);return stats(pair);}
export function getBackgroundHorizon(pair){return S(String(pair).toUpperCase()).horizon;}
export function startBackgroundResearch(){for(const p of pairs){if(!S(p).running)schedule(p)}}
export function stopBackgroundResearch(){for(const [p,t] of timers){clearTimeout(t);S(p).running=false}timers.clear();}
export function getBackgroundResearch(pair){return stats(String(pair).toUpperCase());}
export function getAllBackgroundResearch(){return pairs.map(stats);}
