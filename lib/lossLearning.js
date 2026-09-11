const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const contexts=new Map(),lossHistory=new Map();
const key=(pair,horizon)=>`${pair}:${horizon}`;
const dirSign=d=>d==='BUY'?1:-1;
const against=(v,d,threshold=.12)=>dirSign(d)*Number(v||0)<-threshold;
const BASE_THRESHOLD=57;
const opposite=d=>String(d||'').toUpperCase()==='BUY'?'SELL':'BUY';

function directionalOpposition(f,direction){
  if(!['BUY','SELL'].includes(direction))return[];
  const expected=dirSign(direction),votes=[];
  const add=(name,value,threshold=.08)=>{const n=Number(value);if(Number.isFinite(n)&&expected*n<-threshold)votes.push(name)};
  add('TREND',f.trend);
  add('SEQUENCE',f.sequencePressure??f.sequence);
  add('MOMENTUM',f.momentum);
  add('ADVANCED_MOMENTUM',f.advancedMomentumScore,.12);
  const mtf=[f.m5Context,f.m15Context,f.h1Context].map(Number).filter(Number.isFinite);
  if(mtf.length)add('MULTI_TIMEFRAME',mtf.reduce((a,b)=>a+b,0),.12);
  const structure=String(f.structure||'').toUpperCase();
  if((direction==='BUY'&&structure.includes('BEAR'))||(direction==='SELL'&&structure.includes('BULL')))votes.push('STRUCTURE');
  const tickDirection=String(f.forexTickDirection||'').toUpperCase(),tickReliability=Number(f.tickFeedReliabilityScore??Number(f.forexTickFeedReliability||0)*10);
  if(tickReliability>=5&&((direction==='BUY'&&tickDirection==='SELL')||(direction==='SELL'&&tickDirection==='BUY')))votes.push('TICK');
  return [...new Set(votes)];
}

function transitionDirectionAssessment(result,pair,horizon,direction){
  const f=result?.features||{},dir=String(direction||'').toUpperCase();
  if(!['BUY','SELL'].includes(dir))return{active:false,families:[],familyCount:0,weightedScore:0,streakNudge:false,freshReversalFamilies:[]};
  const structuralTags=Array.isArray(f.frequencyStructuralTags)?f.frequencyStructuralTags.map(x=>String(x).toUpperCase()):[];
  const penaltyTags=String(f.scoreRedistributionPenaltyTags||'').toUpperCase();
  const stale=f.continuationFreshEvidence===false||f.continuationResetRequired===true||f.continuationResetGate===false;
  const weakProgress=f.failureToProgress===true||f.progressFailureRisk===true||structuralTags.includes('WEAKPROGRESS')||penaltyTags.includes('FAILURE_TO_PROGRESS')||penaltyTags.includes('NEGATIVE_PROGRESS');
  const families=[];
  if(stale&&weakProgress)families.push('PROGRESS');

  const sr=String(f.sr||f.dynamicZoneSide||'').toUpperCase(),liq=String(f.liquidity||'').toUpperCase(),pattern=String(f.pattern||'').toUpperCase(),breakout=String(f.breakout||'').toUpperCase();
  const adverseLocation=(dir==='BUY'&&(sr.includes('RESISTANCE')||liq==='BUY-SIDE SWEEP'))||(dir==='SELL'&&(sr.includes('SUPPORT')||liq==='SELL-SIDE SWEEP'));
  const hostilePattern=(dir==='BUY'&&(pattern.includes('BEAR')||breakout.includes('FAILED BULL')))||(dir==='SELL'&&(pattern.includes('BULL')||breakout.includes('FAILED BEAR')));
  const rejection=penaltyTags.includes('REJECTION_PRESSURE')||adverseLocation||hostilePattern;
  if(rejection)families.push('LOCATION_REJECTION');

  const fvgType=String(f.activeFvgType||f.fvg||'NONE').toUpperCase(),fvgState=String(f.activeFvgState||'NONE').toUpperCase(),fvgBias=Number(f.activeFvgBias);
  const unresolvedFvg=['APPROACHING','MITIGATING'].includes(fvgState)||penaltyTags.includes('UNRESOLVED_FVG');
  const hostileFvgType=(dir==='BUY'&&fvgType.includes('BEAR'))||(dir==='SELL'&&fvgType.includes('BULL'));
  const hostileFvgBias=Number.isFinite(fvgBias)&&dirSign(dir)*fvgBias<-.18;
  if(unresolvedFvg&&(hostileFvgType||hostileFvgBias))families.push('FVG');

  const mtf=[f.m5Context,f.m15Context,f.h1Context].map(Number).filter(Number.isFinite),mtfAgainst=mtf.filter(v=>dirSign(dir)*v<-.12).length;
  if(Number(f.mtfOppositionCount||0)>=2||mtfAgainst>=2)families.push('MTF');

  const qualityFlags=[
    Number.isFinite(Number(f.efficiency))&&Number(f.efficiency)<.22,
    Number.isFinite(Number(f.moveQualityScore))&&Number(f.moveQualityScore)<5.5,
    Number.isFinite(Number(f.adx))&&Number(f.adx)<18,
    f.transitionCompression===true||f.microRangeChop===true||String(result?.regime||'').toUpperCase()==='CHOPPY'||penaltyTags.includes('EMA_COMPRESSION')||penaltyTags.includes('BB_CONTRACTION')
  ].filter(Boolean).length;
  if(qualityFlags>=2)families.push('COMPRESSION_QUALITY');

  const directOpposition=directionalOpposition(f,dir),freshOpposition=directOpposition.filter(x=>['SEQUENCE','MOMENTUM','ADVANCED_MOMENTUM','STRUCTURE'].includes(x));
  if(freshOpposition.length>=2)families.push('PRICE_ACTION_MOMENTUM');

  const tickDirection=String(f.forexTickDirection||'').toUpperCase(),tickReliability=Number(f.tickFeedReliabilityScore??Number(f.forexTickFeedReliability||0)*10),tickQuality=Number(f.tickDirectionQualityScore??Number(f.forexTickDirectionQuality||0)*10);
  const reliableOpposingTick=tickReliability>=7&&tickQuality>=4.5&&((dir==='BUY'&&tickDirection==='SELL')||(dir==='SELL'&&tickDirection==='BUY'));
  if(reliableOpposingTick)families.push('TICKS');

  const unique=[...new Set(families)],freshReversalFamilies=unique.filter(x=>['LOCATION_REJECTION','FVG','PRICE_ACTION_MOMENTUM','TICKS'].includes(x));
  const weights={PROGRESS:1.1,LOCATION_REJECTION:1.15,FVG:1,MTF:1,COMPRESSION_QUALITY:.8,PRICE_ACTION_MOMENTUM:1.15,TICKS:1.2};
  const weightedScore=unique.reduce((sum,x)=>sum+(weights[x]||1),0);
  const history=(lossHistory.get(key(pair,horizon))||[]).slice(-3),sameDirectionLosses=history.filter(x=>x.lostDirection===dir).length,streakNudge=sameDirectionLosses>=2;
  const strongFreshContinuation=f.continuationFreshEvidence===true&&f.breakoutAccepted===true&&f.failureToProgress!==true&&Number(f.moveQualityScore||0)>=6.5&&Number(f.confirmationV2Opposed||0)<=1;
  const baseTrigger=stale&&unique.length>=4&&freshReversalFamilies.length>=1&&weightedScore>=3.8;
  const streakTrigger=stale&&streakNudge&&unique.length>=3&&freshReversalFamilies.length>=2&&weightedScore>=3;
  return{active:!strongFreshContinuation&&(baseTrigger||streakTrigger),families:unique,familyCount:unique.length,weightedScore:Number(weightedScore.toFixed(2)),streakNudge,freshReversalFamilies,sameDirectionLosses,strongFreshContinuation};
}

export function applyForwardTrackCalibration(result,pair,horizon){
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

  const staleContinuation=f.continuationFreshEvidence===false||f.continuationResetRequired===true||f.continuationResetGate===false;
  const runtimeConflictCount=[storedConflicts.length>=2,confirmationOpposed>=3,mtfOppose>=2,unresolvedFvg,adverseSr,f.transitionRisk===true||f.transitionRiskActive===true].filter(Boolean).length;
  const scoreNotSupportingOriginal=Number.isFinite(originalScore)&&Number.isFinite(oppositeScore)&&oppositeScore>=originalScore-.25;
  const audusd1ProgressFailureConflict=f.progressFailureRisk===true&&staleContinuation&&runtimeConflictCount>=1&&scoreNotSupportingOriginal;
  const transitionGateFailed=f.transitionGate===false||f.transitionRiskActive===true;
  const gbpusd3TransitionConflict=transitionGateFailed&&staleContinuation&&runtimeConflictCount>=2&&scoreNotSupportingOriginal;
  const opposedFamilies=directionalOpposition(f,dir),opposedFamilyCount=opposedFamilies.length;
  const compression=(Number(f.emaCompression)>0&&Number(f.emaCompression)<.00008)||Number(f.efficiency)<.22||f.transitionCompression===true||String(f.bbState||'').toUpperCase().includes('SQUEEZE');
  const choppy=String(result?.regime||'').toUpperCase()==='CHOPPY'||f.microRangeChop===true||compression;
  const failedProgress=weakProgress||f.failureToProgress===true||f.progressFailureRisk===true||Number(f.moveQualityScore||6)<5.5;
  const breakoutRisk=f.breakoutAccepted===true||f.extendedMove===true||String(f.breakout||'').toUpperCase().includes('BREAK');
  const lateContinuationRisk=f.lateContinuationGate===false||f.lateCounterTrendRisk===true;
  const eurusd1LateContinuationConflict=lateContinuationRisk&&staleContinuation&&failedProgress&&opposedFamilyCount>=2&&runtimeConflictCount>=1&&scoreNotSupportingOriginal;
  const eurjpy1Compound=choppy&&compression&&failedProgress&&opposedFamilyCount>=2&&scoreNotSupportingOriginal;
  const eurjpy2Severe=choppy&&failedProgress&&opposedFamilyCount>=2&&runtimeConflictCount>=1&&scoreNotSupportingOriginal;
  const gbpusd1ProgressOpposition=failedProgress&&opposedFamilies.some(x=>['SEQUENCE','MOMENTUM','ADVANCED_MOMENTUM'].includes(x))&&opposedFamilyCount>=2&&scoreNotSupportingOriginal;
  const eurusd5StaleTransition=staleContinuation&&transitionGateFailed&&failedProgress&&opposedFamilyCount>=2&&scoreNotSupportingOriginal;
  const usdjpy5FalseBreakout=compression&&breakoutRisk&&failedProgress&&opposedFamilyCount>=2&&scoreNotSupportingOriginal;
  const audusd2MomentumStructure=choppy&&failedProgress&&opposedFamilies.includes('ADVANCED_MOMENTUM')&&opposedFamilies.some(x=>['STRUCTURE','MULTI_TIMEFRAME','SEQUENCE'].includes(x))&&scoreNotSupportingOriginal;
  let candidateTrigger=null,candidateEvidence=null;
  if(p==='EURJPY'&&h===1&&eurjpy1Compound){candidateTrigger='EURJPY_1M_COMPRESSION_PROGRESS_OPPOSITION_RERANK';candidateEvidence='LATEST_L6_L7_L10_COMPRESSION_PROGRESS_DIRECTION_CONFLICT'}
  else if(p==='EURJPY'&&h===2&&eurjpy2Severe){candidateTrigger='EURJPY_2M_SEVERE_COMPOUND_OPPOSITION_RERANK';candidateEvidence='LATEST_L7_L10_CHOP_PROGRESS_MULTI_FAMILY_CONFLICT'}
  else if(p==='GBPUSD'&&h===1&&gbpusd1ProgressOpposition){candidateTrigger='GBPUSD_1M_PROGRESS_MOMENTUM_OPPOSITION_RERANK';candidateEvidence='LATEST_PROGRESS_SEQUENCE_MOMENTUM_CONFLICT'}
  else if(p==='EURUSD'&&h===5&&eurusd5StaleTransition){candidateTrigger='EURUSD_5M_STALE_TRANSITION_OPPOSITION_RERANK';candidateEvidence='LATEST_STALE_PROGRESS_TRANSITION_CONFLICT'}
  else if(p==='USDJPY'&&h===5&&usdjpy5FalseBreakout){candidateTrigger='USDJPY_5M_COMPRESSION_FALSE_BREAKOUT_RERANK';candidateEvidence='LATEST_COMPRESSION_BREAKOUT_ADVERSE_DIRECTION_CONFLICT'}
  else if(p==='AUDUSD'&&h===2&&audusd2MomentumStructure){candidateTrigger='AUDUSD_2M_MOMENTUM_STRUCTURE_OPPOSITION_RERANK';candidateEvidence='LATEST_ADVANCED_MOMENTUM_STRUCTURE_MTF_CONFLICT'}

  const transition=transitionDirectionAssessment(result,p,h,dir);
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
  else if(p==='EURUSD'&&h===1&&eurusd1LateContinuationConflict){trigger='EURUSD_1M_LATE_CONTINUATION_PROGRESS_RERANK';evidence='B51_B56_REPEAT_DEGRADATION_LATE_CONTINUATION_PROGRESS_CONFLICT'}
  else if(p==='EURUSD'&&h===1&&highContradiction){trigger='EURUSD_1M_HIGH_CONTRADICTION_RERANK';evidence='6L_1W_HIGH_CONFIDENCE_CONTRADICTION_CUMULATIVE'}
  else if(transition.active){trigger='CROSS_TRACK_TRANSITION_DIRECTION_RERANK';evidence=`FAMILIES_${transition.families.join('+')}`}

  const transitionTelemetry={
    transitionDirectionRerankVersion:'V3_6_CROSS_TRACK_TRANSITION',
    transitionDirectionRerankActive:transition.active,
    transitionDirectionFamilies:transition.families,
    transitionDirectionFamilyCount:transition.familyCount,
    transitionDirectionWeightedScore:transition.weightedScore,
    transitionDirectionStreakNudge:transition.streakNudge,
    transitionDirectionSameDirectionLosses:transition.sameDirectionLosses||0,
    transitionDirectionFreshReversalFamilies:transition.freshReversalFamilies,
    transitionDirectionFrequencyImpact:'NONE',
    transitionDirectionShadowInfluence:'NONE'
  };
  const candidateTelemetry={lossStreakCandidateVersion:'V3_5_TARGETED_COMPOUND_SHADOW',lossStreakCandidateActive:Boolean(candidateTrigger),lossStreakCandidateTrigger:candidateTrigger,lossStreakCandidateEvidence:candidateEvidence,lossStreakCandidateDirection:candidateTrigger&&['BUY','SELL'].includes(dir)?opposite(dir):null,lossStreakCandidateFrequencyImpact:'NONE',lossStreakOpposedFamilies:opposedFamilies,lossStreakOpposedFamilyCount:opposedFamilyCount,...transitionTelemetry};
  if(!trigger||!['BUY','SELL'].includes(dir))return{result:{...result,features:{...f,...candidateTelemetry,lossStreakCalibrationVersion:'V3_5_TARGETED_COMPOUND_SHADOW',lossStreakRerankApplied:false}},calibration:null};
  const newDirection=opposite(dir),newEvidence=Number.isFinite(Number(result?.evidenceScore))?-Number(result.evidenceScore):result?.evidenceScore,generic=trigger==='CROSS_TRACK_TRANSITION_DIRECTION_RERANK';
  const confidence=generic?clamp(Number(result?.confidence??BASE_THRESHOLD),BASE_THRESHOLD,66):result?.confidence;
  const version=trigger==='EURUSD_1M_LATE_CONTINUATION_PROGRESS_RERANK'?'V3_7_EURUSD1_LATE_CONTINUATION_FORWARD':generic?'V3_6_CROSS_TRACK_TRANSITION_RERANK':'V3_5_TARGETED_COMPOUND_RERANK';
  const calibration={version,status:'FORWARD_VALIDATION',trigger,evidence,originalDirection:dir,rerankedDirection:newDirection,frequencyImpact:'NONE',globalThresholdChanged:false,shadowInfluence:'NONE'};
  return{result:{...result,direction:newDirection,confidence,evidenceScore:newEvidence,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,features:{...f,...candidateTelemetry,lossStreakCalibrationVersion:version,lossStreakRerankApplied:true,lossStreakRerankTrigger:trigger,lossStreakRerankEvidence:evidence,lossStreakOriginalDirection:dir,lossStreakRerankedDirection:newDirection,lossStreakFrequencyImpact:'NONE',lossStreakConflictCount:breakoutProgressConflictCount,lossStreakRuntimeConflictCount:runtimeConflictCount,transitionDirectionOriginalDirection:generic?dir:null,transitionDirectionRerankedDirection:generic?newDirection:null}},calibration};
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
  const calibrated=applyForwardTrackCalibration(result,pair,horizon),baseResult=calibrated.result,k=key(pair,horizon),ctx=contexts.get(k),f=baseResult?.features||{};
  if(!ctx||ctx.remaining<=0)return{result:{...baseResult,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,features:{...f,lossLearningFrequencyPreserved:true,lossLearningVersion:'V3_3_FORWARD_VALIDATION'}},context:calibrated.calibration,minimumConfidence:BASE_THRESHOLD};
  const review=ctx.review,decay=ctx.remaining/ctx.initial,same=baseResult.direction===review.lostDirection,severity=review.severity||0,dir=String(baseResult?.direction||'').toUpperCase(),progress=Number(f.progressScore||0)*(dir==='BUY'?1:-1),quality=Number(f.moveQualityScore||0),votes=Number(f.groupConsensusVotes||0),opposingVotes=Number(f.groupOpposingVotes||0),dominance=Number(f.groupDominance||0),state=String(f.activeFvgState||'NONE').toUpperCase(),freshFvg=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(state)&&f.failureToProgress!==true&&progress>=3&&quality>=5.5,freshBreakout=f.breakoutAccepted===true&&f.failureToProgress!==true&&progress>=5&&quality>=6,freshSweep=f.transitionLiquiditySweepReclaim===true||String(f.liquidity||'').toUpperCase().includes('SWEEP'),renewedConsensus=votes>=3&&opposingVotes===0&&dominance>=.55&&quality>=6&&f.failureToProgress!==true,freshProgress=f.failureToProgress!==true&&progress>=5&&quality>=5.8,freshEvidence=freshBreakout||freshSweep||freshFvg||renewedConsensus||freshProgress,repeatedDirectionRisk=same&&!freshEvidence;
  const diagnosticPenalty=same?clamp((2+severity*.55)*decay,1.5,8):0,diagnosticCredit=review.suggestedBias===baseResult.direction&&freshEvidence?clamp((.5+severity*.10)*decay,0,1.5):0,context={...review,remainingCycles:ctx.remaining,decay:Number(decay.toFixed(2)),sameDirectionRisk:same,repeatedDirectionRisk,freshEvidence,diagnosticPenalty:Number(diagnosticPenalty.toFixed(2)),diagnosticCredit:Number(diagnosticCredit.toFixed(2)),frequencyImpact:'NONE',forwardCalibration:calibrated.calibration};
  ctx.remaining-=1;if(ctx.remaining<=0)contexts.delete(k);else contexts.set(k,ctx);
  const scoreOnlyWarnings=[...(Array.isArray(baseResult?.vetoReasons)?baseResult.vetoReasons:[])];if(repeatedDirectionRisk&&!scoreOnlyWarnings.includes('REPEATED_DIRECTION_STALE_EVIDENCE_RISK'))scoreOnlyWarnings.push('REPEATED_DIRECTION_STALE_EVIDENCE_RISK');
  return{result:{...baseResult,qualified:true,tradeQualified:true,minimumConfidence:BASE_THRESHOLD,vetoReasons:scoreOnlyWarnings,adaptiveContext:context,features:{...f,repeatedDirectionGuard:false,repeatedDirectionVeto:false,repeatedDirectionRisk,repeatedDirectionFreshEvidence:freshEvidence,repeatedDirectionGuardVersion:'V3_4_CONFIRMED_FRESH_EVIDENCE',lossLearningFrequencyPreserved:true,lossLearningDiagnosticPenalty:Number(diagnosticPenalty.toFixed(2)),lossLearningDiagnosticCredit:Number(diagnosticCredit.toFixed(2))}},context,minimumConfidence:BASE_THRESHOLD}
}

export function getLossContext(pair,horizon){const ctx=contexts.get(key(pair,horizon));return ctx?{...ctx.review,remainingCycles:ctx.remaining}:null}
