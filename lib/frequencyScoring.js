const MIN_CONFIDENCE=57;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const upper=v=>String(v||'').toUpperCase();

function evidenceRaw(signal){
  const f=signal?.features||{};
  return clamp(Number(signal?.directionalEvidenceScore??signal?.evidenceScore??f.directionalEvidenceScore??f.evidenceScore??0),-1,1);
}

function directionScore(f,direction,rawEvidence=0){
  const buy=direction==='BUY',sign=buy?1:-1;
  const evidence=Number(rawEvidence||0)*sign;
  const progress=Number(f.progressScore||0)*sign;
  const group=buy?Number(f.groupBullStrength||0):Number(f.groupBearStrength||0);
  const opposing=buy?Number(f.groupBearStrength||0):Number(f.groupBullStrength||0);
  const zone=upper(f.dynamicZoneSide||'CLEAR');
  const adverse=(buy&&zone==='RESISTANCE')||(!buy&&zone==='SUPPORT');
  const extended=(buy&&f.bullExtended===true)||(!buy&&f.bearExtended===true);
  const rejection=buy?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0);
  const consensusDirection=upper(f.groupConsensusDirection);
  const dominance=clamp(Number(f.groupDominance||0),0,1);
  let score=evidence*4+progress*.55+(group-opposing)*3;
  if(consensusDirection===direction)score+=dominance*3;
  else if(consensusDirection&&dominance>=.35)score-=dominance*2;
  if(adverse)score-=2.4;
  if(extended)score-=1.2;
  if(rejection>=.30)score-=1.4;
  if(f.failureToProgress===true&&progress<=0)score-=2.2;
  if(Number(f.mtfOppositionCount||0)>=2&&consensusDirection&&consensusDirection!==direction)score-=1.8;
  if(['APPROACHING','MITIGATING'].includes(upper(f.activeFvgState)))score-=.6;
  return Number(score.toFixed(3));
}

function rerankConfirmations(signal,opposite){
  const f=signal?.features||{},sign=opposite==='BUY'?1:-1,raw=evidenceRaw(signal),items=[];
  if(raw*sign>=.22)items.push('DIRECTIONAL_EVIDENCE');
  if(Number(f.progressScore||0)*sign>=3)items.push('PROGRESS');
  if(upper(f.groupConsensusDirection)===opposite&&Number(f.groupDominance||0)>=.35&&Number(f.groupConsensusVotes??2)>=2)items.push('GROUP_CONSENSUS');
  const zone=upper(f.dynamicZoneSide||'CLEAR');
  if((opposite==='BUY'&&zone==='SUPPORT')||(opposite==='SELL'&&zone==='RESISTANCE'))items.push('LOCATION');
  const rejection=opposite==='BUY'?Number(f.lastLowerWickRatio||0):Number(f.lastUpperWickRatio||0);
  if(rejection>=.34)items.push('REJECTION');
  return [...new Set(items)];
}

export function rerankDirection(signal){
  const pair=upper(signal?.pair),horizon=Number(signal?.horizon||signal?.features?.horizon||1),track=`${pair}:${horizon}`;
  const original=upper(signal?.direction||'BUY'),opposite=original==='BUY'?'SELL':'BUY',f=signal?.features||{},raw=evidenceRaw(signal);
  const originalScore=directionScore(f,original,raw),oppositeScore=directionScore(f,opposite,raw),margin=oppositeScore-originalScore;
  const minimumMargin=horizon===1?2.25:horizon===2?2.0:1.75;
  const confirmations=rerankConfirmations(signal,opposite),confirmationMinimum=2;
  const eligible=Boolean(pair)&&Number.isFinite(horizon)&&horizon>0;
  const reranked=eligible&&margin>=minimumMargin&&confirmations.length>=confirmationMinimum;
  return{direction:reranked?opposite:original,originalDirection:original,originalScore,oppositeScore,margin:Number(margin.toFixed(3)),reranked,eligible,minimumMargin,confirmationMinimum,confirmationCount:confirmations.length,confirmations,track};
}

function directionAlignedEvidence(signal,rank){
  const sign=rank.direction==='BUY'?1:-1;
  return clamp(evidenceRaw(signal)*sign,-1,1);
}

function conflictState(signal,rank,quality){
  const f=signal?.features||{},direction=rank.direction,flags=[];
  const alignedEvidence=directionAlignedEvidence(signal,rank);
  const consensusDirection=upper(f.groupConsensusDirection),dominance=clamp(Number(f.groupDominance||0),0,1);
  const zone=upper(f.dynamicZoneSide||'CLEAR');
  const adverse=(direction==='BUY'&&zone==='RESISTANCE')||(direction==='SELL'&&zone==='SUPPORT');
  const unresolvedFvg=['APPROACHING','MITIGATING'].includes(upper(f.activeFvgState));
  const rejection=direction==='BUY'?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0);
  if(alignedEvidence<-.05)flags.push('EVIDENCE_CONFLICT');
  if(consensusDirection&&consensusDirection!==direction&&dominance>=.25)flags.push('CONSENSUS_CONFLICT');
  if(Number(f.mtfOppositionCount||0)>=2)flags.push('MTF_CONFLICT');
  if(adverse)flags.push('ADVERSE_LOCATION');
  if(unresolvedFvg)flags.push('UNRESOLVED_FVG');
  if(f.failureToProgress===true)flags.push('FAILURE_TO_PROGRESS');
  if(rejection>=.32)flags.push('REJECTION_PRESSURE');
  if(quality<.48)flags.push('WEAK_MOVE_QUALITY');
  return{flags:[...new Set(flags)],alignedEvidence,rejection,adverse,unresolvedFvg};
}

// Every boundary still emits exactly one signal. Direction and confidence may be
// recalibrated, but this layer never blocks cadence or reduces the 20-result quota.
export function tuneFrequencyScore(signal){
  const f=signal?.features||{},modelConfidence=Number(signal?.confidence||50),rank=rerankDirection(signal);
  const alignedEvidence=directionAlignedEvidence(signal,rank);
  const evidenceSupport=clamp((alignedEvidence+1)/2,0,1);
  const quality=clamp(Number(f.moveQualityScore||5)/10,0,1);
  const consensusDirection=upper(f.groupConsensusDirection);
  const consensusBase=clamp(Number(f.groupDominance||0),0,1);
  const consensus=consensusDirection?consensusBase*(consensusDirection===rank.direction?1:-1):0;
  const consensusSupport=clamp((consensus+1)/2,0,1);
  const tickDirection=upper(f.forexTickDirection);
  const tickReliability=clamp(Number(f.tickReliabilityScore||0)/10,0,1);
  const tickSupport=tickDirection?tickReliability*(tickDirection===rank.direction?1:-1):0;
  const tickScore=clamp((tickSupport+1)/2,0,1);
  const warnings=Array.isArray(signal?.vetoReasons)?signal.vetoReasons.filter(Boolean):[];
  const selectedScore=rank.direction===rank.originalDirection?rank.originalScore:rank.oppositeScore;
  const otherScore=rank.direction===rank.originalDirection?rank.oppositeScore:rank.originalScore;
  const directionEdge=clamp((selectedScore-otherScore+4)/12,0,1);
  const conflicts=conflictState(signal,rank,quality);
  const strength=.35*evidenceSupport+.20*quality+.20*consensusSupport+.10*tickScore+.15*directionEdge;
  const rerankConviction=rank.reranked?clamp(rank.margin/8,0,1):0;
  const conflictPenalty=Math.min(8,conflicts.flags.length*1.05+(alignedEvidence<0?Math.abs(alignedEvidence)*2:0));
  const warningPenalty=Math.min(4,warnings.length*.6);
  const raw=57+20*strength+rerankConviction*2-conflictPenalty-warningPenalty;
  const calibratedConfidence=clamp(raw,45,82);
  const score=clamp(rank.reranked?Math.min(raw,72):raw,MIN_CONFIDENCE,82);
  return{...signal,direction:rank.direction,confidence:Number(score.toFixed(1)),qualified:true,tradeQualified:true,minimumConfidence:MIN_CONFIDENCE,vetoReasons:warnings,engine:`${signal?.engine||'FUSION_V2_11'}+DIRECTION_RERANK_V3+FREQUENCY_SCORE_V4`,features:{...f,modelConfidence:Number(modelConfidence.toFixed(1)),modelQualified:signal?.qualified===true&&signal?.tradeQualified!==false,scoreOnlyWarnings:warnings,frequencyStrength:Number(strength.toFixed(4)),frequencyScoreVersion:'V4',frequencyPreserved:true,quotaPreserved:true,frequencyRawScore:Number(raw.toFixed(2)),frequencyCalibratedConfidence:Number(calibratedConfidence.toFixed(1)),frequencyConflictCount:conflicts.flags.length,frequencyConflicts:conflicts.flags,frequencyConflictPenalty:Number(conflictPenalty.toFixed(2)),directionEdge:Number(directionEdge.toFixed(4)),directionAlignedEvidence:Number(alignedEvidence.toFixed(4)),directionRerankVersion:'V3',directionRerankEligible:rank.eligible,directionReranked:rank.reranked,directionRerankConfirmationCount:rank.confirmationCount,directionRerankConfirmations:rank.confirmations,originalDirection:rank.originalDirection,originalDirectionScore:rank.originalScore,oppositeDirectionScore:rank.oppositeScore,directionRerankMargin:rank.margin,directionRerankMinimumMargin:rank.minimumMargin,directionRerankTrack:rank.track}};
}
