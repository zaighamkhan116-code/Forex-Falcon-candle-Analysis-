import {OtcIndependentEngine} from './otc_independent_engine.js';
import {bollingerContext,buildSignalAttribution} from './otc_attribution.js';

const sign=n=>n>0?1:n<0?-1:0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

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
const running={startedAt:Date.now(),overall:blank(),direction:{BUY:blank(),SELL:blank()},strategies:{},pairs:{},expiries:{},lossReasons:{}};
function apply(bucket,outcome){bucket.total++;if(outcome==='WIN'){bucket.wins++;bucket.resolved++;bucket.currentLossStreak=0}else if(outcome==='LOSS'){bucket.losses++;bucket.resolved++;bucket.currentLossStreak++;bucket.maxConsecutiveLoss=Math.max(bucket.maxConsecutiveLoss,bucket.currentLossStreak)}else if(outcome==='DRAW'){bucket.draws++;bucket.currentLossStreak=0}bucket.winRate=bucket.resolved?Math.round(bucket.wins/bucket.resolved*10000)/100:null}
function scoreSettlement(s){const d=auditDirection(s.direction),strategy=auditStrategy(s),pair=s.pair||'UNKNOWN',expiry=`${s.expirySeconds}s`;apply(running.overall,s.outcome);running.direction[d]??=blank();apply(running.direction[d],s.outcome);running.strategies[strategy]??=blank();apply(running.strategies[strategy],s.outcome);running.pairs[pair]??=blank();apply(running.pairs[pair],s.outcome);running.expiries[expiry]??=blank();apply(running.expiries[expiry],s.outcome);if(s.outcome==='LOSS'){const reason=s.lossReason||s.attribution?.lossReason||'UNCLASSIFIED';running.lossReasons[reason]=(running.lossReasons[reason]||0)+1}}
function rankedStrategies(){return Object.entries(running.strategies).map(([strategy,s])=>({strategy,...s})).sort((a,b)=>(b.winRate??-1)-(a.winRate??-1)||b.resolved-a.resolved)}
function scorecard(){const ranked=rankedStrategies();return{event:'otc-audit-running',startedAt:running.startedAt,generatedAt:Date.now(),overall:running.overall,direction:running.direction,expiries:running.expiries,pairs:running.pairs,lossReasons:running.lossReasons,best:ranked.filter(x=>x.resolved>=5).slice(0,8),worst:[...ranked].filter(x=>x.resolved>=5).sort((a,b)=>(a.winRate??101)-(b.winRate??101)||b.resolved-a.resolved).slice(0,8),allStrategies:ranked}}

function tickWindow(recentTicks,nowMs,seconds){
  const rows=(recentTicks||[]).filter(t=>Number(t?.timestamp_ms??t?.timestamp)>=nowMs-seconds*1000&&Number(t?.timestamp_ms??t?.timestamp)<=nowMs&&Number.isFinite(Number(t?.price))).sort((a,b)=>Number(a.timestamp_ms??a.timestamp)-Number(b.timestamp_ms??b.timestamp));
  if(rows.length<2)return{seconds,count:rows.length,delta:0,velocityPpm:0,direction:0,persistence:0,changes:0};
  const first=Number(rows[0].price),last=Number(rows.at(-1).price),delta=last-first,steps=[];
  for(let i=1;i<rows.length;i++)steps.push(sign(Number(rows[i].price)-Number(rows[i-1].price)));
  const nonzero=steps.filter(Boolean),direction=sign(delta),aligned=direction?nonzero.filter(x=>x===direction).length:0;
  return{seconds,count:rows.length,delta,velocityPpm:first?delta/first*1e6:0,direction,persistence:nonzero.length?aligned/nonzero.length:0,changes:nonzero.length};
}

function microDiagnostics(state,nowMs,expiry,direction){
  const windows=[1,3,5,10,15,30].map(s=>tickWindow(state?.recentTicks,nowMs,s));
  const by=Object.fromEntries(windows.map(x=>[x.seconds,x]));
  const expected=auditDirection(direction)==='BUY'?1:-1;
  const usable=(expiry<=15?[by[1],by[3],by[5],by[10]]:[by[3],by[5],by[10],by[15],by[30]]).filter(x=>x.count>=2);
  const aligned=usable.filter(x=>x.direction===expected).length,opposed=usable.filter(x=>x.direction===-expected).length;
  const weighted=(by[1].direction*.30+by[3].direction*.25+by[5].direction*.20+by[10].direction*.15+by[15].direction*.06+by[30].direction*.04);
  const recentOpposition=(by[1].count>=2&&by[1].direction===-expected)||(by[3].count>=2&&by[3].direction===-expected&&by[5].direction===-expected);
  const acceleration=Math.abs(by[1].velocityPpm)>Math.abs(by[5].velocityPpm)*1.25&&sign(by[1].velocityPpm)===sign(by[3].velocityPpm);
  return{
    version:'OTC_MICRO_DIAGNOSTICS_V2',entrySecond:new Date(nowMs).getUTCSeconds(),expectedDirection:expected>0?'BUY':'SELL',
    windows:Object.fromEntries(windows.map(x=>[`${x.seconds}s`,{count:x.count,velocityPpm:Math.round(x.velocityPpm*100)/100,direction:x.direction,persistence:Math.round(x.persistence*1000)/1000,changes:x.changes}])),
    alignedWindows:aligned,opposedWindows:opposed,weightedDirection:Math.round(weighted*1000)/1000,recentOpposition,acceleration,
    microAgreement:usable.length?Math.round(aligned/usable.length*1000)/1000:null
  };
}

function calibrateShortExpiryPrediction(p,diag){
  const expiry=Number(p?.expirySeconds),strategy=auditStrategy(p),regime=auditRegime(p);
  if(![15,30].includes(expiry)||!diag)return;
  const original=Number(p.confidence||50);let delta=0;const notes=[];
  if(diag.recentOpposition){delta-=5;notes.push('LATE_MICRO_OPPOSITION')}
  if(diag.opposedWindows>=3){delta-=4;notes.push('MULTI_WINDOW_OPPOSITION')}
  if(diag.alignedWindows>=3&&diag.microAgreement>=.7){delta+=2;notes.push('MULTI_WINDOW_ALIGNMENT')}
  if(expiry===15&&strategy==='15S_OPEN_SPACE_MOMENTUM'){
    delta-=4;notes.push('15S_GENERIC_MOMENTUM_CALIBRATION')
  }
  if(expiry===30&&strategy==='30S_DIRECTIONAL_TREND'){
    delta-=5;notes.push('30S_TREND_FORWARD_CALIBRATION')
    if(diag.microAgreement>=.75&&!diag.recentOpposition){delta+=3;notes.push('30S_TREND_MICRO_CONFIRMED')}
  }
  if(regime==='RANGE'&&strategy.includes('DIRECTIONAL_TREND')){delta-=3;notes.push('TREND_SIGNAL_IN_RANGE')}
  p.rawConfidence=original;
  p.confidence=Math.round(clamp(original+delta,52,84)*10)/10;
  p.microDiagnostics=diag;
  p.microCalibration={version:'OTC_15_30_CAL_V1',delta,notes,frequencyPreserved:true};
}

function classifyLoss(s){
  const a=s?.attribution||{},d=s?.microDiagnostics||a?.microDiagnostics||{},strategy=auditStrategy(s),regime=auditRegime(s),dir=auditDirection(s.direction),reasons=[];
  if(d.recentOpposition)reasons.push('LATE_MICRO_REVERSAL');
  if(Number(d.opposedWindows)>=3)reasons.push('MULTI_WINDOW_MOMENTUM_CONFLICT');
  if(strategy==='30S_DIRECTIONAL_TREND'&&(regime==='RANGE'||regime==='TRANSITION'))reasons.push('TREND_FOLLOW_IN_WEAK_REGIME');
  if(strategy==='15S_OPEN_SPACE_MOMENTUM'&&Number(d.microAgreement)<.5)reasons.push('15S_WEAK_MICRO_AGREEMENT');
  if(a.levelState==='FALSE_BREAK')reasons.push('STRUCTURE_FALSE_BREAK_WHIPSAW');
  if(a.emaAlignment==='AGAINST_EMA')reasons.push('EMA_CONTEXT_OPPOSITION');
  if(dir==='BUY'&&Number(a.bbBandPos)>=.82)reasons.push('BUY_NEAR_UPPER_BAND_EXHAUSTION');
  if(dir==='SELL'&&Number(a.bbBandPos)<=.18)reasons.push('SELL_NEAR_LOWER_BAND_EXHAUSTION');
  if(!reasons.length&&regime==='RANGE')reasons.push('RANGE_NOISE');
  if(!reasons.length&&regime==='TRANSITION')reasons.push('REGIME_TRANSITION');
  if(!reasons.length)reasons.push('UNCLASSIFIED_DIRECTIONAL_FAILURE');
  return{primary:reasons[0],all:[...new Set(reasons)]};
}

export class OtcAttributedEngine extends OtcIndependentEngine{
  async onTick(tick){
    const event=await super.onTick(tick);
    const state=this.pairState(tick.pair);
    const context=state.structureContext||null;
    const bars=aggregate1m(state,tick.timestamp_ms);
    const bb=bollingerContext(bars,state.current?.close??tick.price,20,2);
    const predictionByExpiry=new Map((event.predictions||[]).map(p=>[Number(p.expirySeconds),p]));
    const d15=predictionByExpiry.get(15)?.direction,d30=predictionByExpiry.get(30)?.direction;
    const dualAgreement=d15&&d30?(d15===d30?'AGREE':'DISAGREE'):'UNAVAILABLE';
    for(const p of event.predictions||[]){
      const decision={primary:p.primaryAnalysis||null,validation:p.validation||null,agreementCount:p.agreementCount??null,strongest:p.primaryAnalysis?.strength??null};
      p.attribution=buildSignalAttribution({pair:p.pair||tick.pair,expiry:p.expirySeconds,direction:p.direction,decision,context,bb});
      p.attribution.bbPeriod=20;p.attribution.bbDeviation=2;
      if([15,30].includes(Number(p.expirySeconds))){
        const diag=microDiagnostics(state,tick.timestamp_ms,Number(p.expirySeconds),p.direction);
        diag.dualHorizonAgreement=dualAgreement;
        p.attribution.microDiagnostics=diag;
        calibrateShortExpiryPrediction(p,diag);
        p.attribution.microCalibration=p.microCalibration;
      }
      console.log(JSON.stringify({event:'otc-prediction-attributed',id:p.id,pair:p.pair||tick.pair,expirySeconds:p.expirySeconds,direction:auditDirection(p.direction),rawDirection:p.direction,confidence:p.confidence??null,rawConfidence:p.rawConfidence??null,engine:p.engine||null,strategy:auditStrategy(p),validation:p.validation||null,agreementCount:p.agreementCount??null,signalClass:p.signalClass||null,frequencyFloor:Boolean(p.frequencyFloor),regime:auditRegime(p),entryTimestampMs:p.entryTimestampMs,entryPrice:p.entryPrice,microDiagnostics:p.microDiagnostics||null,microCalibration:p.microCalibration||null,attribution:p.attribution||null}));
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
      if([15,30].includes(Number(s.expirySeconds))&&!s.attribution.microDiagnostics){s.attribution.microDiagnostics=microDiagnostics(state,Number(s.settlementTimestampMs||tick.timestamp_ms),Number(s.expirySeconds),s.direction)}
      s.microDiagnostics=s.microDiagnostics||s.attribution?.microDiagnostics||null;
      if(s.outcome==='LOSS'){
        const reason=classifyLoss(s);s.lossReason=reason.primary;s.lossReasons=reason.all;s.attribution.lossReason=reason.primary;s.attribution.lossReasons=reason.all;
      }
      scoreSettlement(s);
      console.log(JSON.stringify({event:'otc-settlement-attributed',id:s.id,pair:s.pair||tick.pair,expirySeconds:s.expirySeconds,direction:auditDirection(s.direction),rawDirection:s.direction,outcome:s.outcome,confidence:s.confidence??null,engine:s.engine||null,strategy:auditStrategy(s),validation:s.validation||null,agreementCount:s.agreementCount??null,signalClass:s.signalClass||null,frequencyFloor:Boolean(s.frequencyFloor),regime:auditRegime(s),entryTimestampMs:s.entryTimestampMs,settlementTimestampMs:s.settlementTimestampMs,entryPrice:s.entryPrice,settlementPrice:s.settlementPrice,priceDelta:s.priceDelta??null,lossReason:s.lossReason||null,lossReasons:s.lossReasons||[],microDiagnostics:s.microDiagnostics||null,attribution:s.attribution||null}));
      if(running.overall.total<=5||running.overall.total%10===0)console.log(JSON.stringify(scorecard()));
    }
    return event;
  }
}
