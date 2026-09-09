import {OtcShadowEngine} from './otc_shadow_engine.js';
import {buildOtcStructureContext} from './otc_structure_context.js';
import {runIndependentAnalyses,arbitrateIndependentAnalyses} from './otc_independent_analysis.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const EXPIRIES=[10,15,30,60,120,180,300];
const MAX_CLIENT_LAG_MS={10:1250,15:1500,30:1800,60:2500,120:3500,180:4000,300:5000};

export class OtcIndependentEngine extends OtcShadowEngine{
  constructor(opts={}){super(opts);this.stats.independentPredictions=0;this.stats.strongValidations=0;}

  async maybePredict(state,tick,expiry){
    const boundary=Math.floor(tick.timestamp_ms/(expiry*1000));
    if(state.lastBoundary[expiry]===boundary)return null;
    const minHistory=expiry<=15?10:expiry===30?15:expiry===60?60:expiry;
    if(state.candles.length<minHistory)return null;
    if(this.persistenceError)return null;
    const lag=Number(tick.client_lag_ms||0),lagLimit=MAX_CLIENT_LAG_MS[expiry]||5000;
    if(lag>lagLimit)return null;

    const features=this.featureSnapshot(state,tick.timestamp_ms);
    const context=buildOtcStructureContext({candles:state.candles,current:state.current,recentTicks:state.recentTicks,nowMs:tick.timestamp_ms});
    state.structureContext=context;
    const wickMemory=expiry<=15?this.wickMemory(state,tick.timestamp_ms):null;
    const analyses=runIndependentAnalyses({context,features,wickMemory,expiry});
    const decision=arbitrateIndependentAnalyses(analyses);
    state.qualityStatus??={};
    state.qualityStatus[expiry]={passed:decision.emit,mode:'INDEPENDENT_RULE_ARBITRATION',lagMs:lag,lagLimitMs:lagLimit,decision,wickMemory};
    if(!decision.emit)return null;

    state.lastBoundary[expiry]=boundary;
    const direction=decision.direction>0?'UP':'DOWN';
    // Confidence is descriptive, not a probability or additive strategy score.
    const confidence=decision.validation==='STRONG_VALIDATION'?(decision.strongest>=5?86:82):(decision.strongest>=5?78:decision.strongest===4?72:66);
    const id=`${state.pair}-${expiry}-${tick.timestamp_ms}`;
    const prediction={
      id,engine:`OTC_${expiry}S_INDEPENDENT_V7`,generatedAtMs:Date.now(),
      confidenceKind:'RULE_STRENGTH_LABEL_NOT_PROBABILITY',mode:'SHADOW',tradingEnabled:false,
      pair:state.pair,marketType:'OTC',expirySeconds:expiry,direction,confidence,
      entryTimestampMs:tick.receivedAtMs??tick.timestamp_ms,sourceTickTimestampMs:tick.timestamp_ms,
      entryPrice:tick.price,targetTimestampMs:(tick.receivedAtMs??tick.timestamp_ms)+expiry*1000,
      entryPattern:decision.primary.name,validation:decision.validation,agreementCount:decision.agreementCount,
      primaryAnalysis:decision.primary,agreeingAnalyses:decision.agreeing,opposingAnalyses:decision.opposing,
      independentAnalyses:decision.analyses,structureContext:this.compactContext(context),
      features:{...features,wickMemory,structureRegime:context?.structure?.regime},status:'PENDING',
      frequencyFloor:false,signalClass:decision.validation==='STRONG_VALIDATION'?'MULTI_ANALYSIS_AGREEMENT':'INDEPENDENT_RULE_TRIGGER'
    };
    state.pending.push(prediction);this.simulation.add(prediction);state.latestPrediction[expiry]=prediction;
    state.recentSignals.unshift(prediction);state.recentSignals=state.recentSignals.slice(0,140);
    this.stats.predictions++;this.stats.qualifiedPredictions++;this.stats.independentPredictions++;
    if(decision.validation==='STRONG_VALIDATION')this.stats.strongValidations++;
    await this.append(`shadow-${expiry}s-signals`,state.pair,tick.timestamp_ms,prediction);
    return prediction;
  }
}

export {EXPIRIES};
