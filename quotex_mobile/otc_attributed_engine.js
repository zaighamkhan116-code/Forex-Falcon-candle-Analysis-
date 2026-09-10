import {OtcIndependentEngine} from './otc_independent_engine.js';
import {bollingerContext,buildSignalAttribution} from './otc_attribution.js';

function aggregate1m(state,nowMs){
  const cutoff=Math.floor(nowMs/60000)*60000;
  const src=[...(state?.candles||[]),state?.current].filter(Boolean).filter(c=>Number(c.sec)<cutoff);
  const map=new Map();
  for(const c of src){
    const minute=Math.floor(Number(c.sec)/60000)*60000;
    let r=map.get(minute);
    if(!r){r={sec:minute,open:c.open,high:c.high,low:c.low,close:c.close};map.set(minute,r)}
    else{r.high=Math.max(r.high,c.high);r.low=Math.min(r.low,c.low);r.close=c.close}
  }
  return[...map.values()].sort((a,b)=>a.sec-b.sec).slice(-80)
}

function auditDirection(v){return v==='UP'?'BUY':v==='DOWN'?'SELL':String(v||'UNKNOWN').toUpperCase()}
function auditStrategy(v){return v?.primaryAnalysis?.name||v?.entryPattern||v?.engine||'UNKNOWN'}
function auditRegime(v){return v?.features?.structureRegime||v?.structureContext?.structure?.regime||v?.attribution?.regime||'UNKNOWN'}
function blank(){return{total:0,wins:0,losses:0,draws:0,resolved:0,winRate:null,maxConsecutiveLoss:0,currentLossStreak:0}}
const running={startedAt:Date.now(),overall:blank(),direction:{BUY:blank(),SELL:blank()},strategies:{},pairs:{},expiries:{}};
function apply(bucket,outcome){bucket.total++;if(outcome==='WIN'){bucket.wins++;bucket.resolved++;bucket.currentLossStreak=0}else if(outcome==='LOSS'){bucket.losses++;bucket.resolved++;bucket.currentLossStreak++;bucket.maxConsecutiveLoss=Math.max(bucket.maxConsecutiveLoss,bucket.currentLossStreak)}else if(outcome==='DRAW'){bucket.draws++;bucket.currentLossStreak=0}bucket.winRate=bucket.resolved?Math.round(bucket.wins/bucket.resolved*10000)/100:null}
function scoreSettlement(s){const d=auditDirection(s.direction),strategy=auditStrategy(s),pair=s.pair||'UNKNOWN',expiry=`${s.expirySeconds}s`;apply(running.overall,s.outcome);running.direction[d]??=blank();apply(running.direction[d],s.outcome);running.strategies[strategy]??=blank();apply(running.strategies[strategy],s.outcome);running.pairs[pair]??=blank();apply(running.pairs[pair],s.outcome);running.expiries[expiry]??=blank();apply(running.expiries[expiry],s.outcome)}
function rankedStrategies(){return Object.entries(running.strategies).map(([strategy,s])=>({strategy,...s})).sort((a,b)=>(b.winRate??-1)-(a.winRate??-1)||b.resolved-a.resolved)}
function scorecard(){const ranked=rankedStrategies();return{event:'otc-audit-running',startedAt:running.startedAt,generatedAt:Date.now(),overall:running.overall,direction:running.direction,expiries:running.expiries,pairs:running.pairs,best:ranked.filter(x=>x.resolved>=5).slice(0,8),worst:[...ranked].filter(x=>x.resolved>=5).sort((a,b)=>(a.winRate??101)-(b.winRate??101)||b.resolved-a.resolved).slice(0,8),allStrategies:ranked}}

export class OtcAttributedEngine extends OtcIndependentEngine{
  async onTick(tick){
    const event=await super.onTick(tick);
    const state=this.pairState(tick.pair);
    const context=state.structureContext||null;
    const bars=aggregate1m(state,tick.timestamp_ms);
    const bb=bollingerContext(bars,state.current?.close??tick.price,20,2);
    for(const p of event.predictions||[]){
      const decision={primary:p.primaryAnalysis||null,validation:p.validation||null,agreementCount:p.agreementCount??null,strongest:p.primaryAnalysis?.strength??null};
      p.attribution=buildSignalAttribution({pair:p.pair||tick.pair,expiry:p.expirySeconds,direction:p.direction,decision,context,bb});
      p.attribution.bbPeriod=20;p.attribution.bbDeviation=2;
      console.log(JSON.stringify({event:'otc-prediction-attributed',id:p.id,pair:p.pair||tick.pair,expirySeconds:p.expirySeconds,direction:auditDirection(p.direction),rawDirection:p.direction,confidence:p.confidence??null,engine:p.engine||null,strategy:auditStrategy(p),validation:p.validation||null,agreementCount:p.agreementCount??null,signalClass:p.signalClass||null,frequencyFloor:Boolean(p.frequencyFloor),regime:auditRegime(p),entryTimestampMs:p.entryTimestampMs,entryPrice:p.entryPrice,attribution:p.attribution||null}));
    }
    for(const s of event.settlements||[]){
      if(!s.attribution){
        const source=(state.recentSignals||[]).find(x=>x.id===s.id);
        if(source?.attribution)s.attribution=source.attribution;
        else{
          const decision={primary:s.primaryAnalysis||null,validation:s.validation||null,agreementCount:s.agreementCount??null,strongest:s.primaryAnalysis?.strength??null};
          s.attribution=buildSignalAttribution({pair:s.pair||tick.pair,expiry:s.expirySeconds,direction:s.direction,decision,context:s.structureContext||context,bb});
          s.attribution.bbPeriod=20;s.attribution.bbDeviation=2;
        }
      }
      scoreSettlement(s);
      console.log(JSON.stringify({event:'otc-settlement-attributed',id:s.id,pair:s.pair||tick.pair,expirySeconds:s.expirySeconds,direction:auditDirection(s.direction),rawDirection:s.direction,outcome:s.outcome,confidence:s.confidence??null,engine:s.engine||null,strategy:auditStrategy(s),validation:s.validation||null,agreementCount:s.agreementCount??null,signalClass:s.signalClass||null,frequencyFloor:Boolean(s.frequencyFloor),regime:auditRegime(s),entryTimestampMs:s.entryTimestampMs,settlementTimestampMs:s.settlementTimestampMs,entryPrice:s.entryPrice,settlementPrice:s.settlementPrice,priceDelta:s.priceDelta??null,attribution:s.attribution||null}));
      if(running.overall.total<=5||running.overall.total%10===0)console.log(JSON.stringify(scorecard()));
    }
    return event;
  }
}