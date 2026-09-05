import {assessTrackCalibration,trackDirectionBias} from './trackCalibration.js';

const MIN_CONFIDENCE=57;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const upper=v=>String(v||'').toUpperCase();

function evidenceRaw(signal){
  const f=signal?.features||{};
  return clamp(Number(signal?.directionalEvidenceScore??signal?.evidenceScore??f.directionalEvidenceScore??f.evidenceScore??0),-1,1);
}

function directionScore(signal,direction,rawEvidence=0){
  const f=signal?.features||{},buy=direction==='BUY',sign=buy?1:-1,evidence=Number(rawEvidence||0)*sign,
    progress=Number(f.progressScore||0)*sign,
    group=buy?Number(f.groupBullStrength||0):Number(f.groupBearStrength||0),
    opposing=buy?Number(f.groupBearStrength||0):Number(f.groupBullStrength||0),
    zone=upper(f.dynamicZoneSide||'CLEAR'),
    adverse=(buy&&zone==='RESISTANCE')||(!buy&&zone==='SUPPORT'),
    extended=(buy&&f.bullExtended===true)||(!buy&&f.bearExtended===true),
    rejection=buy?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0),
    consensusDirection=upper(f.groupConsensusDirection),dominance=clamp(Number(f.groupDominance||0),0,1);
  let score=evidence*4+progress*.55+(group-opposing)*3;
  if(consensusDirection===direction)score+=dominance*3;
  else if(consensusDirection&&dominance>=.35)score-=dominance*2;
  if(adverse)score-=2.4;
  if(extended)score-=1.2;
  if(rejection>=.30)score-=1.4;
  if(f.failureToProgress===true&&progress<=0)score-=2.2;
  if(Number(f.mtfOppositionCount||0)>=2&&consensusDirection&&consensusDirection!==direction)score-=1.8;
  if(['APPROACHING','MITIGATING'].includes(upper(f.activeFvgState)))score-=.6;
  score+=trackDirectionBias(signal,direction);
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
  const track=assessTrackCalibration(signal,opposite);
  if(track.reactionQuality==='HEALTHY')items.push('TRACK_REACTION_QUALITY');
  return[...new Set(items)];
}

export function rerankDirection(signal){
  const pair=upper(signal?.pair),horizon=Number(signal?.horizon||signal?.features?.horizon||1),track=`${pair}:${horizon}`,
    original=upper(signal?.direction||'BUY'),opposite=original==='BUY'?'SELL':'BUY',raw=evidenceRaw(signal),
    originalScore=directionScore(signal,original,raw),oppositeScore=directionScore(signal,opposite,raw),margin=oppositeScore-originalScore,
    originalTrack=assessTrackCalibration(signal,original),oppositeTrack=assessTrackCalibration(signal,opposite);
  let minimumMargin=horizon===1?2.25:horizon===2?2.0:1.75;
  // Only lower the flip hurdle when the current direction has demonstrated weak reaction
  // and the opposite direction has healthier pre-boundary evidence. Never flip on a track tag alone.
  if(originalTrack.reactionQuality==='WEAK'&&oppositeTrack.reactionQuality==='HEALTHY')minimumMargin=Math.max(1.6,minimumMargin-.35);
  const confirmations=rerankConfirmations(signal,opposite),confirmationMinimum=2,
    eligible=Boolean(pair)&&Number.isFinite(horizon)&&horizon>0,
    reranked=eligible&&margin>=minimumMargin&&confirmations.length>=confirmationMinimum;
  return{direction:reranked?opposite:original,originalDirection:original,originalScore,oppositeScore,margin:Number(margin.toFixed(3)),reranked,eligible,minimumMargin,confirmationMinimum,confirmationCount:confirmations.length,confirmations,track,originalTrackBias:originalTrack.directionBias,oppositeTrackBias:oppositeTrack.directionBias};
}

function directionAlignedEvidence(signal,rank){const sign=rank.direction==='BUY'?1:-1;return clamp(evidenceRaw(signal)*sign,-1,1)}

function conflictState(signal,rank,quality){
  const f=signal?.features||{},direction=rank.direction,flags=[],alignedEvidence=directionAlignedEvidence(signal,rank),
    consensusDirection=upper(f.groupConsensusDirection),dominance=clamp(Number(f.groupDominance||0),0,1),zone=upper(f.dynamicZoneSide||'CLEAR'),
    adverse=(direction==='BUY'&&zone==='RESISTANCE')||(direction==='SELL'&&zone==='SUPPORT'),
    unresolvedFvg=['APPROACHING','MITIGATING'].includes(upper(f.activeFvgState)),
    rejection=direction==='BUY'?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0);
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

function freshEvidence(f,direction,alignedEvidence,quality){
  const tags=[],sign=direction==='BUY'?1:-1,progress=Number(f.progressScore||0)*sign,consensusDirection=upper(f.groupConsensusDirection),dominance=Number(f.groupDominance||0),fvg=upper(f.activeFvgState);
  if(alignedEvidence>=.18)tags.push('DIRECTIONAL_EVIDENCE');
  if(progress>=2.5)tags.push('FRESH_PROGRESS');
  if(consensusDirection===direction&&dominance>=.42)tags.push('CONSENSUS');
  if(f.breakoutAccepted===true&&f.failureToProgress!==true)tags.push('BREAKOUT_PROGRESS');
  if(['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(fvg))tags.push('FVG_RESOLVED');
  if(Number(f.vsaScore||0)>=.18||Number(f.vsaFlowScore||0)>=.18)tags.push('VSA_SUPPORT');
  if(Number(f.sequencePressure||0)*sign>=.15)tags.push('SEQUENCE_PRESSURE');
  if(quality>=.58)tags.push('MOVE_QUALITY');
  return[...new Set(tags)];
}

function structuralRisk(f,direction,conflicts){
  const sign=direction==='BUY'?1:-1,progress=Number(f.progressScore||0)*sign,
    late=f.lateCounterTrendRisk===true||f.lateContinuationRisk===true,
    extended=(direction==='BUY'&&f.bullExtended===true)||(direction==='SELL'&&f.bearExtended===true),
    transition=f.transitionRiskActive===true,weakProgress=f.failureToProgress===true||progress<=0,adverse=conflicts.adverse,
    mtf=Number(f.mtfOppositionCount||0)>=2,unresolved=conflicts.unresolvedFvg;
  let score=0;
  if(late)score+=1.2;if(adverse)score+=1.5;if(weakProgress)score+=1.7;if(transition)score+=1.1;if(mtf)score+=1;if(unresolved)score+=.8;if(extended)score+=.7;
  const compound=(adverse&&weakProgress?1.4:0)+(late&&weakProgress?1.1:0)+(mtf&&transition?.8:0)+(extended&&unresolved?.6:0);
  return{score:Number((score+compound).toFixed(2)),late,extended,transition,weakProgress,adverse,mtf,unresolved};
}

// V6 preserves one signal at every boundary. Pair/timeframe learning modifies direction ranking
// and confidence only; it never adds a cadence veto and never raises the global 57% threshold.
export function tuneFrequencyScore(signal){
  const f=signal?.features||{},modelConfidence=Number(signal?.confidence||50),rank=rerankDirection(signal),
    alignedEvidence=directionAlignedEvidence(signal,rank),evidenceSupport=clamp((alignedEvidence+1)/2,0,1),
    quality=clamp(Number(f.moveQualityScore||5)/10,0,1),consensusDirection=upper(f.groupConsensusDirection),
    consensusBase=clamp(Number(f.groupDominance||0),0,1),consensus=consensusDirection?consensusBase*(consensusDirection===rank.direction?1:-1):0,
    consensusSupport=clamp((consensus+1)/2,0,1),tickDirection=upper(f.forexTickDirection),
    tickReliability=clamp(Number(f.tickReliabilityScore||0)/10,0,1),tickSupport=tickDirection?tickReliability*(tickDirection===rank.direction?1:-1):0,
    tickScore=clamp((tickSupport+1)/2,0,1),warnings=Array.isArray(signal?.vetoReasons)?signal.vetoReasons.filter(Boolean):[],
    selectedScore=rank.direction===rank.originalDirection?rank.originalScore:rank.oppositeScore,
    otherScore=rank.direction===rank.originalDirection?rank.oppositeScore:rank.originalScore,
    directionEdge=clamp((selectedScore-otherScore+4)/12,0,1),conflicts=conflictState(signal,rank,quality),
    fresh=freshEvidence(f,rank.direction,alignedEvidence,quality),risk=structuralRisk(f,rank.direction,conflicts),
    trackCalibration=assessTrackCalibration(signal,rank.direction),
    strength=.35*evidenceSupport+.20*quality+.20*consensusSupport+.10*tickScore+.15*directionEdge,
    rerankConviction=rank.reranked?clamp(rank.margin/8,0,1):0,
    conflictPenalty=Math.min(8,conflicts.flags.length*1.05+(alignedEvidence<0?Math.abs(alignedEvidence)*2:0)),
    warningPenalty=Math.min(4,warnings.length*.6),freshCredit=Math.min(4.5,fresh.length*.65),structuralPenalty=Math.min(9,risk.score),
    raw=57+20*strength+rerankConviction*2-conflictPenalty-warningPenalty-structuralPenalty+freshCredit+trackCalibration.confidenceAdjustment,
    calibratedConfidence=clamp(raw,45,82),score=clamp(rank.reranked?Math.min(raw,72):raw,MIN_CONFIDENCE,82);
  return{
    ...signal,direction:rank.direction,confidence:Number(score.toFixed(1)),qualified:true,tradeQualified:true,minimumConfidence:MIN_CONFIDENCE,
    vetoReasons:warnings,engine:`${signal?.engine||'FUSION_V2_11'}+DIRECTION_RERANK_V4+FREQUENCY_SCORE_V6+TRACK_CAL_V6`,
    features:{
      ...f,modelConfidence:Number(modelConfidence.toFixed(1)),modelQualified:signal?.qualified===true&&signal?.tradeQualified!==false,
      scoreOnlyWarnings:warnings,frequencyStrength:Number(strength.toFixed(4)),frequencyScoreVersion:'V6',frequencyPreserved:true,quotaPreserved:true,
      frequencyRawScore:Number(raw.toFixed(2)),frequencyCalibratedConfidence:Number(calibratedConfidence.toFixed(1)),frequencyConflictCount:conflicts.flags.length,
      frequencyConflicts:conflicts.flags,frequencyConflictPenalty:Number(conflictPenalty.toFixed(2)),frequencyStructuralRisk:Number(risk.score.toFixed(2)),
      frequencyStructuralPenalty:Number(structuralPenalty.toFixed(2)),frequencyStructuralTags:Object.entries(risk).filter(([k,v])=>k!=='score'&&v===true).map(([k])=>k.toUpperCase()),
      frequencyFreshEvidenceCount:fresh.length,frequencyFreshEvidence:fresh,frequencyFreshCredit:Number(freshCredit.toFixed(2)),directionEdge:Number(directionEdge.toFixed(4)),
      directionAlignedEvidence:Number(alignedEvidence.toFixed(4)),directionRerankVersion:'V4',directionRerankEligible:rank.eligible,directionReranked:rank.reranked,
      directionRerankConfirmationCount:rank.confirmationCount,directionRerankConfirmations:rank.confirmations,originalDirection:rank.originalDirection,
      originalDirectionScore:rank.originalScore,oppositeDirectionScore:rank.oppositeScore,directionRerankMargin:rank.margin,directionRerankMinimumMargin:rank.minimumMargin,
      directionRerankTrack:rank.track,directionRerankOriginalTrackBias:rank.originalTrackBias,directionRerankOppositeTrackBias:rank.oppositeTrackBias,
      trackCalibrationVersion:trackCalibration.version,trackCalibrationTrack:trackCalibration.track,trackCalibrationAdjustment:trackCalibration.confidenceAdjustment,
      trackCalibrationDirectionBias:trackCalibration.directionBias,trackCalibrationTags:trackCalibration.tags,trackReactionQuality:trackCalibration.reactionQuality,
      trackMatureDisplacement:trackCalibration.matureDisplacement,trackCleanTrend:trackCalibration.cleanTrend,trackFailedProgress:trackCalibration.failedProgress,
      trackAlignedVsa:trackCalibration.alignedVsa,trackAlignedSequence:trackCalibration.alignedSequence,trackAlignedProgress:trackCalibration.alignedProgress,
      trackHostileWick:trackCalibration.hostileWick,trackBodyRatio:trackCalibration.bodyRatio,trackRangeAtr:trackCalibration.rangeAtr,trackVwapDistanceAtr:trackCalibration.vwapDistanceAtr
    }
  };
}
