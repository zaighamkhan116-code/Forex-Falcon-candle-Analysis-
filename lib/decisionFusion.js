import {fuseDecision as fuseCore} from './decisionFusionCore.js';
import {detectTransitionRisk} from './transitionRisk.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function assessBreakoutMaturity(features={},direction='',horizon=1){
  const f=features||{},state=String(f.activeFvgState||'NONE').toUpperCase();
  const unresolvedFvg=state==='APPROACHING'||state==='MITIGATING';
  const accepted=f.breakoutAccepted===true;
  const extended=(String(direction).toUpperCase()==='BUY'&&f.bullExtended===true)||(String(direction).toUpperCase()==='SELL'&&f.bearExtended===true);
  const votes=Number(f.groupConsensusVotes||0),opposing=Number(f.groupOpposingVotes||0),dominance=Number(f.groupDominance||0);
  const weakConsensus=votes<3||opposing>0||dominance<.55;
  const failed=f.failureToProgress===true;
  const approachingRisk=state==='APPROACHING';
  const fragileAcceptedBreakout=accepted&&unresolvedFvg&&(extended||weakConsensus||failed);
  const active=approachingRisk||fragileAcceptedBreakout;
  const scale={1:1,2:.9,3:.8,5:.65,15:.45}[Number(horizon)]||.8;
  const penalty=active?Number(((approachingRisk?4.5:3.5)*scale).toFixed(1)):0;
  const tags=[];
  if(approachingRisk)tags.push('FVG_APPROACHING_UNCONFIRMED');
  if(fragileAcceptedBreakout)tags.push('FRAGILE_BREAKOUT_IN_UNRESOLVED_FVG');
  if(extended)tags.push('EXTENDED_MOVE');
  if(weakConsensus)tags.push('INSUFFICIENT_BREAKOUT_CONSENSUS');
  if(failed)tags.push('FAILURE_TO_PROGRESS');
  return{active,gate:!active,penalty,tags,unresolvedFvg,fragileAcceptedBreakout,approachingRisk,votes,opposing,dominance};
}

// FUSION V2.6: universal transition, late counter-trend and breakout-maturity guards.
// Pair/timeframe histories and calibration remain independent. This shared safeguard only
// invalidates stale continuation when closed-candle evidence shows extension/stall while
// higher-timeframe structure and/or an opposing dynamic zone disagree with the trade.
export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const core=fuseCore(result,bundle,pair,horizon,minimumConfidence);
  const risk=detectTransitionRisk(bundle?.m1||[],core.direction,horizon);
  const f={...(core.features||{})};
  const maturity=assessBreakoutMaturity(f,core.direction,horizon);
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
  const primaryPenalty=Math.max(transitionPenalty,latePenalty,maturity.penalty);
  const secondaryPenalty=[transitionPenalty,latePenalty,maturity.penalty].sort((a,b)=>b-a)[1]||0;
  const combinedPenalty=clamp(primaryPenalty+Math.min(2.5,secondaryPenalty*.35),0,11);
  const confidence=clamp(pre-combinedPenalty,50,85);
  const strongFreshContinuation=f.breakoutAccepted===true&&Number(f.moveQualityScore||0)>=6.2&&f.failureToProgress!==true&&risk.compression!==true&&(
    mtfOppose<2||Number(f.groupConsensusVotes||0)>=3&&Number(f.groupOpposingVotes||0)===0&&Number(f.groupDominance||0)>=.55
  );
  const transitionGate=!risk.active||strongFreshContinuation;
  const lateContinuationGate=!lateCounterTrendRisk||strongFreshContinuation||(
    !adverseZone&&mtfOppose<2&&mtfAgree>=2&&Number(f.moveQualityScore||0)>=6.5
  );
  const qualified=core.qualified===true&&confidence>=minimumConfidence&&transitionGate&&lateContinuationGate&&maturity.gate;
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
    breakoutMaturityGate:maturity.gate,
    breakoutMaturityRiskActive:maturity.active,
    breakoutMaturityPenalty:maturity.penalty,
    breakoutMaturityTags:maturity.tags.join('|')||'NONE',
    unresolvedFvgAtSignal:maturity.unresolvedFvg,
    fragileAcceptedBreakout:maturity.fragileAcceptedBreakout,
    breakoutMaturityConsensusVotes:maturity.votes,
    breakoutMaturityOpposingVotes:maturity.opposing,
    breakoutMaturityDominance:maturity.dominance,
    transitionFreshContinuationOverride:strongFreshContinuation,
    preTransitionConfidence:Number(pre.toFixed(1)),
    postTransitionConfidence:Number(confidence.toFixed(1)),
    universalTransitionGuard:true,
    universalLateCounterTrendGuard:true,
    universalBreakoutMaturityGuard:true
  };
  return{...core,confidence:Number(confidence.toFixed(1)),qualified,engine:`${String(core.engine||'TECHNICAL').replace('+TRANSITION_V2_4','').replace('+TRANSITION_V2_5','').replace('+TRANSITION_V2_6','')}+TRANSITION_V2_6`,features};
}
