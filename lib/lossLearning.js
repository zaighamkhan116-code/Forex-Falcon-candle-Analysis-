const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const contexts=new Map(),lossHistory=new Map();
const key=(pair,horizon)=>`${pair}:${horizon}`;
const dirSign=d=>d==='BUY'?1:-1;
const against=(v,d,threshold=.12)=>dirSign(d)*Number(v||0)<-threshold;
const BASE_THRESHOLD=57;
const opposite=d=>String(d||'').toUpperCase()==='BUY'?'SELL':'BUY';

function applyForwardLossStreakCalibration(result,pair,horizon){
  const f=result?.features||{},p=String(pair||'').toUpperCase(),h=Number(horizon),dir=String(result?.direction||'').toUpperCase();
  const maturityRisk=f.breakoutMaturityGate===false&&(f.breakoutMaturityRiskActive===true||f.failureToProgress===true||f.fragileAcceptedBreakout===true);
  const continuationResetRisk=f.continuationResetGate===false&&f.continuationResetActive===true;
  const chopRisk=f.oneMinuteChopGuard===false&&(String(result?.regime||'').toUpperCase()==='CHOPPY'||f.microRangeChop===true||f.transitionCompression===true);
  const opposing=Number(f.groupOpposingVotes||0),dominance=Number(f.groupDominance||0),mtfOppose=Number(f.mtfOppositionCount||0),compoundConflict=opposing>=2&&dominance<.45&&(mtfOppose>=2||f.failureToProgress===true||f.transitionRiskActive===true);
  const highContradiction=f.highConfidenceContradictionGate===false&&Number(f.highConfidenceContradictionCount||0)>=3&&(f.failureToProgress===true||f.transitionRiskActive===true);
  const originalScore=Number(f.originalDirectionScore),oppositeScore=Number(f.oppositeDirectionScore),storedConflicts=Array.isArray(f.frequencyConflicts)?f.frequencyConflicts:[],confirmationOpposed=Number(f.confirmationV2Opposed||0);
  const gbp2NegativeEdge=Number.isFinite(originalScore)&&Number.isFinite(oppositeScore)&&originalScore<0&&oppositeScore>=originalScore+.75&&(storedConflicts.length>=2||confirmationOpposed>=3);
  const structuralTags=Array.isArray(f.frequencyStructuralTags)?f.frequencyStructuralTags.map(x=>String(x).toUpperCase()):[],penaltyTags=String(f.scoreRedistributionPenaltyTags||'').toUpperCase(),fvgState=String(f.activeFvgState||'NONE').toUpperCase(),sr=String(f.sr||'').toUpperCase();
  const weakProgress=structuralTags.includes('WEAKPROGRESS')||penaltyTags.includes('NEGATIVE_PROGRESS')||penaltyTags.includes('FAILURE_TO_PROGRESS')||f.failureToProgress===true||f.progressFailureRisk===true;
  const unresolvedFvg=['APPROACHING','MITIGATING'].includes(fvgState)||penaltyTags.includes('UNRESOLVED_FVG');
  const adverseSr=(dir==='BUY'&&sr.includes('RESISTANCE'))||(dir==='SELL'&&sr.includes('SUPPORT'));
  const breakoutProgressConflictCount=[weakProgress,unresolvedFvg,confirmationOpposed>=3,mtfOppose>=2,adverseSr,Number(f.moveQualityScore||6)<5.6].filter(Boolean).length;
  const eurjpy5BreakoutProgressConflict=f.breakoutAccepted===true&&f.continuationFreshEvidence===true&&weakProgress&&breakoutProgressConflictCount>=2;

  // V3.3 forward-validation arms. These preserve cadence and only rerank direction
  // after repeat exact-batch evidence shows the current direction is stale under compound conflict.
  const staleContinuation=f.continuationFreshEvidence===false||f.continuationResetRequired===true||f.continuationResetGate===false;
  const runtimeConflictCount=[storedConflicts.length>=2,confirmationOpposed>=3,mtfOppose>=2,unresolvedFvg,adverseSr,f.transitionRisk===true||f.transitionRiskActive===true].filter(Boolean).length;
  const scoreNotSupportingOriginal=Number.isFinite(originalScore)&&Number.isFinite(oppositeScore)&&oppositeScore>=originalScore-.25;
  const audusd1ProgressFailureConflict=f.progressFailureRisk===true&&staleContinuation&&runtimeConflictCount>=1&&scoreNotSupportingOriginal;
  const transitionGateFailed=f.transitionGate===false||f.transitionRiskActive===true;
  const gbpusd3TransitionConflict=transitionGateFailed&&staleContinuation&&runtimeConflictCount>=2&&scoreNotSupportingOriginal;

  let trigger=null,evidence=null;
  if(p==='USDJPY'&&h===2&&maturityRisk){trigger='USDJPY_2M_MATURE_BREAKOUT_RERANK';evidence='10L_1W_BREAKOUT_MATURITY_GATE'}
  else if(p==='AUDUSD'&&h===1&&maturityRisk){trigger='AUDUSD_1M_MATURE_BREAKOUT_RERANK';evidence='9L_5W_BREAKOUT_MATURITY_GATE'}
  else if(p==='AUDUSD'&&h===1&&audusd1ProgressFailureConflict){trigger='AUDUSD_1M_PROGRESS_FAILURE_CONFLICT_RERANK';evidence='B14_41.18_L4_B15_40.00_L4_B16_47.37_L3_REPEAT_PROGRESS_FAILURE'}
  else if(p==='EURUSD'&&h===2&&continuationResetRisk){trigger='EURUSD_2M_FAILED_CONTINUATION_RERANK';evidence='19L_7W_CONTINUATION_RESET_GATE'}
  else if(p==='GBPUSD'&&h===1&&chopRisk){trigger='GBPUSD_1M_CHOP_RERANK';evidence='13L_7W_ONE_MINUTE_CHOP_GUARD'}
  else if(p==='GBPUSD'&&h===2&&gbp2NegativeEdge){trigger='GBPUSD_2M_NEGATIVE_EDGE_CONFLICT_RERANK';evidence='B8_31.58pct_B9_27.78pct_REPEAT_DEGRADATION'}
  else if(p==='GBPUSD'&&h===3&&gbpusd3TransitionConflict){trigger='GBPUSD_3M_TRANSITION_CONFLICT_RERANK';evidence='B10_36.84_L5_B11_30.00_L5_TRANSITION_CONTINUATION_CONFLICT'}
  else if(p==='EURJPY'&&h===2&&compoundConflict){trigger='EURJPY_2M_COMPOUND_CONFLICT_RERANK';evidence='7L_0W_CONSENSUS_CONFLICT_CUMULATIVE'}
  else if(p==='EURJPY'&&h===5&&eurjpy5BreakoutProgressConflict){trigger='EURJPY_5M_BREAKOUT_PROGRESS_CONFLICT_RERANK';evidence='21L_8W_BREAKOUT_PROGRESS_CUMULATIVE_B7_31.58pct_L10'}
  else if(p==='EURUSD'&&h===1&&highContradiction){trigger='EURUSD_1M_HIGH_CONTRADICTION_RERANK';evidence='6L_1W_HIGH_CONFIDENCE_CONTRADICTION_CUMULATIVE'}
  if(!trigger||!['BUY','SELL'].includes(dir))return{result:{...result,features:{...f,lossStreakCalibrationVersion:'V3_3_FORWARD_VALIDATION',lossStreakRerankApplied:false}},calibration:null};
  const newDirection=opposite(dir),newEvidence=Number.isFinite(Number(result?.evidenceScore))?-Number(result.evidenceScore):result?.evidenceScore;
  const calibration={version:'V3_3_FORWARD_VALIDATION',status:'FORWARD_VALIDATION',trigger,evidence,originalDirection:dir,rerankedDirection:newDirection,frequencyImpact:'NONE',globalThresholdChanged:false};
  return{result:{...result,direction:newDirection,evidenceScore:newEvidence,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,features:{...f,lossStreakCalibrationVersion:'V3_3_FORWARD_VALIDATION',lossStreakRerankApplied:true,lossStreakRerankTrigger:trigger,lossStreakRerankEvidence:evidence,lossStreakOriginalDirection:dir,lossStreakRerankedDirection:newDirection,lossStreakFrequencyImpact:'NONE',lossStreakConflictCount:breakoutProgressConflictCount,lossStreakRuntimeConflictCount:runtimeConflictCount}},calibration};
}

export function diagnoseLoss(signal,currentAnalysis=null){
  const f=signal.features||{},reasons=[];let severity=0;
  if(signal.regime==='CHOPPY'){reasons.push('CHOPPY_REGIME');severity+=2}
  if(f.snapshotEvolution==='REVERSING'){reasons.push('INTRACANDLE_REVERSAL');severity+=3}else if(f.snapshotEvolution==='MIXED'){reasons.push('INTRACANDLE_DISAGREEMENT');severity+=1}
  if(signal.direction==='BUY'&&(f.sr==='AT RESISTANCE'||f.dynamicZoneSide==='RESISTANCE')){reasons.push('BUY_INTO_RESISTANCE');severity+=2}
  if(signal.direction==='SELL'&&(f.sr==='AT SUPPORT'||f.dynamicZoneSide==='SUPPORT')){reasons.push('SELL_INTO_SUPPORT');severity+=2}
  if(against(f.m15Context,signal.direction)||against(f.h1Context,signal.direction)){reasons.push('HIGHER_TIMEFRAME_CONFLICT');severity+=2}
  if(signal.direction==='BUY'&&(f.liquidity==='BUY-SIDE SWEEP'||f.breakout==='FAILED BULL BREAK'||f.failureToProgress===true)){reasons.push('BEARISH_REVERSAL_CONTEXT');severity+=2}
  if(signal.direction==='SELL'&&(f.liquidity==='SELL-SIDE SWEEP'||f.breakout==='FAILED BEAR BREAK'||f.failureToProgress===true)){reasons.push('BULLISH_REVERSAL_CONTEXT');severity+=2}
  if(Number(signal.probability??signal.confidence)>=70){reasons.push('OVERCONFIDENT_LOSS');severity+=1}
  if(Number(f.moveQualityScore||10)<5){reasons.push('LOW_MOVE_QUALITY');severity+=2}
  const currentDir=currentAnalysis?.direction;if(currentDir&&currentDir!==signal.direction){reasons.push('POST_LOSS_DIRECTION_FLIP');severity+=1}
  if(!reasons.length)reasons.push('NORMAL_VARIANCE');
  const suggestedBias=currentDir&&currentDir!==signal.direction?currentDir:null,k=key(signal.pair,signal.horizon),now=Date.now(),history=(lossHistory.get(k)||[]).filter(x=>now-x.createdAt<30*60*1000),signature=reasons.filter(x=>x!=='OVERCONFIDENT_LOSS'&&x!=='NORMAL_VARIANCE').sort().join('|');
  const review={signalId:signal.id,pair:signal.pair,horizon:signal.horizon,lostDirection:signal.direction,reasons,severity:clamp(severity,0,10),suggestedBias,signature,createdAt:now};signal.lossReview=review;history.push(review);lossHistory.set(k,history.slice(-12));
  const similar=signature?history.filter(x=>x.signature===signature).length:0,cluster=history.filter(x=>x.lostDirection===signal.direction).length,activate=similar>=2||cluster>=2||(review.severity>=7&&reasons.includes('OVERCONFIDENT_LOSS'));
  if(activate)contexts.set(k,{review:{...review,activationEvidence:{similarLosses:similar,directionalLossCluster:cluster}},remaining:4,initial:4});
  return{...review,adaptiveContextActivated:activate,similarLosses:similar,directionalLossCluster:cluster}
}

export function applyLossContext(result,pair,horizon){
  const calibrated=applyForwardLossStreakCalibration(result,pair,horizon),baseResult=calibrated.result,k=key(pair,horizon),ctx=contexts.get(k),f=baseResult?.features||{};
  if(!ctx||ctx.remaining<=0)return{result:{...baseResult,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,features:{...f,lossLearningFrequencyPreserved:true,lossLearningVersion:'V3_3_FORWARD_VALIDATION'}},context:calibrated.calibration,minimumConfidence:BASE_THRESHOLD};
  const review=ctx.review,decay=ctx.remaining/ctx.initial,same=baseResult.direction===review.lostDirection,severity=review.severity||0,dir=String(baseResult?.direction||'').toUpperCase(),progress=Number(f.progressScore||0)*(dir==='BUY'?1:-1),quality=Number(f.moveQualityScore||0),votes=Number(f.groupConsensusVotes||0),opposingVotes=Number(f.groupOpposingVotes||0),dominance=Number(f.groupDominance||0),state=String(f.activeFvgState||'NONE').toUpperCase(),freshFvg=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(state)&&f.failureToProgress!==true&&progress>=3&&quality>=5.5,freshBreakout=f.breakoutAccepted===true&&f.failureToProgress!==true&&progress>=5&&quality>=6,freshSweep=f.transitionLiquiditySweepReclaim===true||String(f.liquidity||'').toUpperCase().includes('SWEEP'),renewedConsensus=votes>=3&&opposingVotes===0&&dominance>=.55&&quality>=6&&f.failureToProgress!==true,freshProgress=f.failureToProgress!==true&&progress>=5&&quality>=5.8,freshEvidence=freshBreakout||freshSweep||freshFvg||renewedConsensus||freshProgress,repeatedDirectionRisk=same&&!freshEvidence;
  const diagnosticPenalty=same?clamp((2+severity*.55)*decay,1.5,8):0,diagnosticCredit=review.suggestedBias===baseResult.direction&&freshEvidence?clamp((.5+severity*.10)*decay,0,1.5):0,context={...review,remainingCycles:ctx.remaining,decay:Number(decay.toFixed(2)),sameDirectionRisk:same,repeatedDirectionRisk,freshEvidence,diagnosticPenalty:Number(diagnosticPenalty.toFixed(2)),diagnosticCredit:Number(diagnosticCredit.toFixed(2)),frequencyImpact:'NONE',forwardCalibration:calibrated.calibration};
  ctx.remaining-=1;if(ctx.remaining<=0)contexts.delete(k);else contexts.set(k,ctx);
  const scoreOnlyWarnings=[...(Array.isArray(baseResult?.vetoReasons)?baseResult.vetoReasons:[])];if(repeatedDirectionRisk&&!scoreOnlyWarnings.includes('REPEATED_DIRECTION_STALE_EVIDENCE_RISK'))scoreOnlyWarnings.push('REPEATED_DIRECTION_STALE_EVIDENCE_RISK');
  return{result:{...baseResult,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,vetoReasons:scoreOnlyWarnings,adaptiveContext:context,features:{...f,repeatedDirectionGuard:false,repeatedDirectionVeto:false,repeatedDirectionRisk,repeatedDirectionFreshEvidence:freshEvidence,repeatedDirectionGuardVersion:'V3_4_CONFIRMED_FRESH_EVIDENCE',lossLearningFrequencyPreserved:true,lossLearningDiagnosticPenalty:Number(diagnosticPenalty.toFixed(2)),lossLearningDiagnosticCredit:Number(diagnosticCredit.toFixed(2))}},context,minimumConfidence:BASE_THRESHOLD}
}

export function getLossContext(pair,horizon){const ctx=contexts.get(key(pair,horizon));return ctx?{...ctx.review,remainingCycles:ctx.remaining}:null}
