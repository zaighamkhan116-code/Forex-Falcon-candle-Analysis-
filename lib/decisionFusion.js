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

// V2.7 continuation-reset guard: when a move is already extended/stalling or pressing an
// adverse zone, same-direction continuation must show genuinely fresh closed-candle evidence.
// This is market-state based (not previous trade-result based) and therefore keeps forward
// validation clean while reducing repeated entries after the original continuation edge expires.
export function assessContinuationReset(features={},risk={},direction='',horizon=1){
  const f=features||{},dir=String(direction||'').toUpperCase();
  const adverseZone=(dir==='BUY'&&f.dynamicZoneSide==='RESISTANCE')||(dir==='SELL'&&f.dynamicZoneSide==='SUPPORT');
  const extended=(dir==='BUY'&&f.bullExtended===true)||(dir==='SELL'&&f.bearExtended===true);
  const stalled=f.failureToProgress===true||f.microRangeChop===true||risk.compression===true||risk.failedProgress===true;
  const unresolvedFvg=['APPROACHING','MITIGATING'].includes(String(f.activeFvgState||'NONE').toUpperCase());
  const mtfOppose=Number(f.mtfOppositionCount||0),eff=Number(f.efficiency||0),moveQuality=Number(f.moveQualityScore||5);
  const rejection=(dir==='BUY'?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0))>=.30||Number(risk.rejectionRatio||0)>=.32;
  const resetNeeded=(extended||stalled||adverseZone||unresolvedFvg)&&(stalled||adverseZone||mtfOppose>=2||rejection||moveQuality<5.8||eff<.24);
  const freshBreakout=f.breakoutAccepted===true&&moveQuality>=6.3&&f.failureToProgress!==true&&risk.compression!==true;
  const freshSweep=String(f.liquidity||'NONE').toUpperCase()!=='NONE'&&risk.sweep===true;
  const fvgResolved=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(String(f.activeFvgState||'NONE').toUpperCase());
  const renewedConsensus=Number(f.groupConsensusVotes||0)>=3&&Number(f.groupOpposingVotes||0)===0&&Number(f.groupDominance||0)>=.58&&moveQuality>=6.0;
  const renewedProgress=!stalled&&eff>=.30&&moveQuality>=6.2;
  const freshEvidence=freshBreakout||freshSweep||fvgResolved||renewedConsensus||renewedProgress;
  const active=resetNeeded&&!freshEvidence;
  const scale={1:1,2:.9,3:.8,5:.65,15:.45}[Number(horizon)]||.8;
  let penalty=0;
  if(active){penalty=2.5+(stalled?2:0)+(adverseZone?2:0)+(mtfOppose>=2?1.5:0)+(unresolvedFvg?1:0)+(rejection?1:0);penalty=clamp(penalty*scale,0,8.5)}
  const tags=[];
  if(resetNeeded)tags.push('CONTINUATION_RESET_REQUIRED');
  if(stalled)tags.push('NO_FRESH_PROGRESS');
  if(adverseZone)tags.push('ADVERSE_DYNAMIC_ZONE');
  if(mtfOppose>=2)tags.push('MTF_OPPOSITION');
  if(unresolvedFvg)tags.push('UNRESOLVED_FVG');
  if(rejection)tags.push('REJECTION_PRESSURE');
  if(freshBreakout)tags.push('FRESH_BREAKOUT');
  if(freshSweep)tags.push('FRESH_SWEEP_RECLAIM');
  if(fvgResolved)tags.push('FVG_STATE_RESOLVED');
  if(renewedConsensus)tags.push('RENEWED_CONSENSUS');
  if(renewedProgress)tags.push('RENEWED_PROGRESS');
  return{active,gate:!active,penalty:Number(penalty.toFixed(1)),tags,resetNeeded,freshEvidence,freshBreakout,freshSweep,fvgResolved,renewedConsensus,renewedProgress,adverseZone,extended,stalled,unresolvedFvg,mtfOppose};
}

// FUSION V2.7: transition, late counter-trend, breakout-maturity and continuation-reset guards.
export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const core=fuseCore(result,bundle,pair,horizon,minimumConfidence);
  const risk=detectTransitionRisk(bundle?.m1||[],core.direction,horizon);
  const f={...(core.features||{})};
  const maturity=assessBreakoutMaturity(f,core.direction,horizon);
  const reset=assessContinuationReset(f,risk,core.direction,horizon);
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
  const penalties=[transitionPenalty,latePenalty,maturity.penalty,reset.penalty].sort((a,b)=>b-a);
  const combinedPenalty=clamp((penalties[0]||0)+Math.min(2.5,(penalties[1]||0)*.35),0,11);
  const confidence=clamp(pre-combinedPenalty,50,85);
  const strongFreshContinuation=f.breakoutAccepted===true&&Number(f.moveQualityScore||0)>=6.2&&f.failureToProgress!==true&&risk.compression!==true&&(
    mtfOppose<2||Number(f.groupConsensusVotes||0)>=3&&Number(f.groupOpposingVotes||0)===0&&Number(f.groupDominance||0)>=.55
  );
  const transitionGate=!risk.active||strongFreshContinuation;
  const lateContinuationGate=!lateCounterTrendRisk||strongFreshContinuation||(!adverseZone&&mtfOppose<2&&mtfAgree>=2&&Number(f.moveQualityScore||0)>=6.5);
  const continuationResetGate=reset.gate||strongFreshContinuation;
  const qualified=core.qualified===true&&confidence>=minimumConfidence&&transitionGate&&lateContinuationGate&&maturity.gate&&continuationResetGate;
  const features={...f,
    transitionRiskActive:risk.active,transitionRiskScore:risk.score,transitionRiskPenalty:risk.penalty,transitionRiskTags:risk.tags.join('|')||'NONE',transitionFailureToProgress:risk.failedProgress,transitionOppositeRecovery:risk.recovery,transitionLiquiditySweepReclaim:risk.sweep,transitionCompression:risk.compression,transitionRejectionRatio:risk.rejectionRatio,
    lateCounterTrendRisk,lateCounterTrendPenalty:Number(latePenalty.toFixed(1)),lateCounterTrendMtfOpposition:mtfOppose,lateCounterTrendAdverseZone:adverseZone,lateCounterTrendExtended:extended,lateCounterTrendStalled:stalled,lateCounterTrendRejection:rejection,lateCounterTrendWeakMove:weakMove,
    combinedInvalidationPenalty:Number(combinedPenalty.toFixed(1)),transitionGate,lateContinuationGate,
    breakoutMaturityGate:maturity.gate,breakoutMaturityRiskActive:maturity.active,breakoutMaturityPenalty:maturity.penalty,breakoutMaturityTags:maturity.tags.join('|')||'NONE',unresolvedFvgAtSignal:maturity.unresolvedFvg,fragileAcceptedBreakout:maturity.fragileAcceptedBreakout,breakoutMaturityConsensusVotes:maturity.votes,breakoutMaturityOpposingVotes:maturity.opposing,breakoutMaturityDominance:maturity.dominance,
    continuationResetGate,continuationResetActive:reset.active,continuationResetPenalty:reset.penalty,continuationResetTags:reset.tags.join('|')||'NONE',continuationResetRequired:reset.resetNeeded,continuationFreshEvidence:reset.freshEvidence,continuationFreshBreakout:reset.freshBreakout,continuationFreshSweep:reset.freshSweep,continuationFvgResolved:reset.fvgResolved,continuationRenewedConsensus:reset.renewedConsensus,continuationRenewedProgress:reset.renewedProgress,
    transitionFreshContinuationOverride:strongFreshContinuation,preTransitionConfidence:Number(pre.toFixed(1)),postTransitionConfidence:Number(confidence.toFixed(1)),universalTransitionGuard:true,universalLateCounterTrendGuard:true,universalBreakoutMaturityGuard:true,universalContinuationResetGuard:true
  };
  return{...core,confidence:Number(confidence.toFixed(1)),qualified,engine:`${String(core.engine||'TECHNICAL').replace('+TRANSITION_V2_4','').replace('+TRANSITION_V2_5','').replace('+TRANSITION_V2_6','').replace('+TRANSITION_V2_7','')}+TRANSITION_V2_7`,features};
}
