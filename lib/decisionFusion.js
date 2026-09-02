import {fuseDecision as fuseCore} from './decisionFusionCore.js';
import {detectTransitionRisk} from './transitionRisk.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// FUSION V2.5: universal transition + late counter-trend continuation guard.
// Pair/timeframe histories and calibration remain independent. This shared safeguard only
// invalidates stale continuation when closed-candle evidence shows extension/stall while
// higher-timeframe structure and/or an opposing dynamic zone disagree with the trade.
export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const core=fuseCore(result,bundle,pair,horizon,minimumConfidence);
  const risk=detectTransitionRisk(bundle?.m1||[],core.direction,horizon);
  const f={...(core.features||{})};
  const pre=Number(core.confidence||50);
  const direction=String(core.direction||'').toUpperCase();
  const mtfOppose=Number(f.mtfOppositionCount||0);
  const mtfAgree=Number(f.mtfAgreementCount||0);
  const adverseZone=(direction==='BUY'&&f.dynamicZoneSide==='RESISTANCE')||(direction==='SELL'&&f.dynamicZoneSide==='SUPPORT');
  const extended=(direction==='BUY'&&f.bullExtended===true)||(direction==='SELL'&&f.bearExtended===true);
  const stalled=f.failureToProgress===true||f.microRangeChop===true||risk.compression===true||risk.failedProgress===true;
  const rejection=(direction==='BUY'?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0))>=.30||Number(risk.rejectionRatio||0)>=.32;
  const weakMove=Number(f.moveQualityScore||5)<5.6;
  const strongOpposingContext=mtfOppose>=2||adverseZone;
  const lateCounterTrendRisk=strongOpposingContext&&(extended||stalled||rejection||weakMove);
  const horizonScale={1:1,2:.9,3:.8,5:.65,15:.45}[Number(horizon)]||.8;
  let latePenalty=0;
  if(lateCounterTrendRisk){
    latePenalty+=mtfOppose>=2?3.0:0;
    latePenalty+=adverseZone?Math.min(3.5,Math.max(1.5,Number(f.dynamicZoneStrength||0)*.35)):0;
    latePenalty+=extended?1.5:0;
    latePenalty+=stalled?2.0:0;
    latePenalty+=rejection?1.5:0;
    latePenalty+=weakMove?1.0:0;
    latePenalty=clamp(latePenalty*horizonScale,0,9);
  }
  const transitionPenalty=Number(risk.penalty||0);
  const combinedPenalty=clamp(Math.max(transitionPenalty,latePenalty)+Math.min(2.5,Math.min(transitionPenalty,latePenalty)*.35),0,11);
  const confidence=clamp(pre-combinedPenalty,50,85);
  const strongFreshContinuation=f.breakoutAccepted===true&&Number(f.moveQualityScore||0)>=6.2&&f.failureToProgress!==true&&risk.compression!==true&&(
    mtfOppose<2||Number(f.groupConsensusVotes||0)>=3&&Number(f.groupOpposingVotes||0)===0&&Number(f.groupDominance||0)>=.55
  );
  const transitionGate=!risk.active||strongFreshContinuation;
  const lateContinuationGate=!lateCounterTrendRisk||strongFreshContinuation||(
    !adverseZone&&mtfOppose<2&&mtfAgree>=2&&Number(f.moveQualityScore||0)>=6.5
  );
  const qualified=core.qualified===true&&confidence>=minimumConfidence&&transitionGate&&lateContinuationGate;
  const features={...f,
    transitionRiskActive:risk.active,
    transitionRiskScore:risk.score,
    transitionRiskPenalty:risk.penalty,
    transitionRiskTags:risk.tags.join('|')||'NONE',
    transitionFailureToProgress:risk.failedProgress,
    transitionOppositeRecovery:risk.recovery,
    transitionLiquiditySweepReclaim:risk.sweep,
    transitionCompression:risk.compression,
    transitionRejectionRatio:risk.rejectionRatio,
    lateCounterTrendRisk,
    lateCounterTrendPenalty:Number(latePenalty.toFixed(1)),
    lateCounterTrendMtfOpposition:mtfOppose,
    lateCounterTrendAdverseZone:adverseZone,
    lateCounterTrendExtended:extended,
    lateCounterTrendStalled:stalled,
    lateCounterTrendRejection:rejection,
    lateCounterTrendWeakMove:weakMove,
    combinedInvalidationPenalty:Number(combinedPenalty.toFixed(1)),
    transitionGate,
    lateContinuationGate,
    transitionFreshContinuationOverride:strongFreshContinuation,
    preTransitionConfidence:Number(pre.toFixed(1)),
    postTransitionConfidence:Number(confidence.toFixed(1)),
    universalTransitionGuard:true,
    universalLateCounterTrendGuard:true
  };
  return{...core,confidence:Number(confidence.toFixed(1)),qualified,engine:`${String(core.engine||'TECHNICAL').replace('+TRANSITION_V2_4','').replace('+TRANSITION_V2_5','')}+TRANSITION_V2_5`,features};
}
