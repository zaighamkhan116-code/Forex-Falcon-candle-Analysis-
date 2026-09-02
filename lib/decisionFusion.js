import {fuseDecision as fuseCore} from './decisionFusionCore.js';
import {detectTransitionRisk} from './transitionRisk.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// FUSION V2.4: universal transition guard for all core FX pairs/timeframes.
// Pair/timeframe histories and calibration remain independent; this only adds a shared
// closed-candle invalidation detector so stale continuation confidence decays sooner.
export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const core=fuseCore(result,bundle,pair,horizon,minimumConfidence);
  const risk=detectTransitionRisk(bundle?.m1||[],core.direction,horizon);
  const pre=Number(core.confidence||50);
  const confidence=clamp(pre-Number(risk.penalty||0),50,85);
  const f={...(core.features||{})};
  const strongFreshContinuation=f.breakoutAccepted===true||(
    f.failureToProgress!==true&&
    f.groupConsensusDirection===core.direction&&
    Number(f.groupConsensusVotes||0)>=3&&
    Number(f.groupOpposingVotes||0)===0&&
    Number(f.groupDominance||0)>=.45&&
    Number(f.moveQualityScore||0)>=6
  );
  const transitionGate=!risk.active||strongFreshContinuation;
  const qualified=core.qualified===true&&confidence>=minimumConfidence&&transitionGate;
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
    transitionGate,
    transitionFreshContinuationOverride:strongFreshContinuation,
    preTransitionConfidence:Number(pre.toFixed(1)),
    postTransitionConfidence:Number(confidence.toFixed(1)),
    universalTransitionGuard:true
  };
  return{...core,confidence:Number(confidence.toFixed(1)),qualified,engine:`${String(core.engine||'TECHNICAL').replace('+TRANSITION_V2_4','')}+TRANSITION_V2_4`,features};
}
