const MIN_CONFIDENCE=57;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TARGET_TRACKS=new Set(['EURUSD:1','EURUSD:2','GBPUSD:2','EURJPY:1','EURJPY:2']);

function directionScore(f,direction){
  const buy=direction==='BUY',sign=buy?1:-1;
  const evidence=Number(f.directionalEvidenceScore??f.evidenceScore??0)*sign;
  const progress=Number(f.progressScore||0)*sign;
  const group=buy?Number(f.groupBullStrength||0):Number(f.groupBearStrength||0);
  const opposing=buy?Number(f.groupBearStrength||0):Number(f.groupBullStrength||0);
  const zone=String(f.dynamicZoneSide||'CLEAR').toUpperCase();
  const adverse=(buy&&zone==='RESISTANCE')||(!buy&&zone==='SUPPORT');
  const extended=(buy&&f.bullExtended===true)||(!buy&&f.bearExtended===true);
  const rejection=buy?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0);
  const consensusDirection=String(f.groupConsensusDirection||'').toUpperCase();
  let score=evidence*4+progress*.55+(group-opposing)*3;
  if(consensusDirection===direction)score+=Number(f.groupDominance||0)*3;
  if(adverse)score-=2.4;
  if(extended)score-=1.2;
  if(rejection>=.30)score-=1.4;
  if(f.failureToProgress===true&&progress<=0)score-=2.2;
  if(Number(f.mtfOppositionCount||0)>=2&&consensusDirection&&consensusDirection!==direction)score-=1.8;
  if(['APPROACHING','MITIGATING'].includes(String(f.activeFvgState||'').toUpperCase()))score-=.6;
  return Number(score.toFixed(3));
}

export function rerankDirection(signal){
  const pair=String(signal?.pair||'').toUpperCase(),horizon=Number(signal?.horizon||signal?.features?.horizon||1),track=`${pair}:${horizon}`;
  const original=String(signal?.direction||'BUY').toUpperCase(),opposite=original==='BUY'?'SELL':'BUY',f=signal?.features||{};
  const originalScore=directionScore(f,original),oppositeScore=directionScore(f,opposite),margin=oppositeScore-originalScore;
  const eligible=TARGET_TRACKS.has(track),minimumMargin=horizon===1?2.25:2.0,reranked=eligible&&margin>=minimumMargin;
  return{direction:reranked?opposite:original,originalDirection:original,originalScore,oppositeScore,margin:Number(margin.toFixed(3)),reranked,eligible,minimumMargin,track};
}

// Every boundary still emits exactly one signal. Diagnostics affect direction and
// confidence ranking, never eligibility, cadence, or the 20-result batch count.
export function tuneFrequencyScore(signal){
  const f=signal?.features||{},modelConfidence=Number(signal?.confidence||50),rank=rerankDirection(signal);
  const evidence=Math.min(1,Math.abs(Number(signal?.evidenceScore??f.evidenceScore??0)));
  const quality=clamp(Number(f.moveQualityScore||5)/10,0,1),consensus=clamp(Number(f.groupDominance||0),0,1),tick=clamp(Number(f.tickReliabilityScore||0)/10,0,1);
  const warnings=Array.isArray(signal?.vetoReasons)?signal.vetoReasons:[];
  const strength=.40*evidence+.30*quality+.20*consensus+.10*tick;
  const rerankConviction=rank.reranked?clamp(rank.margin/8,0,1):0;
  // Compress confidence when the original model and diagnostic reranker disagree.
  const raw=57+21*strength+rerankConviction*3-Math.min(5,warnings.length*.8);
  const score=clamp(rank.reranked?Math.min(raw,72):raw,MIN_CONFIDENCE,82);
  return{...signal,direction:rank.direction,confidence:Number(score.toFixed(1)),qualified:true,tradeQualified:true,minimumConfidence:MIN_CONFIDENCE,vetoReasons:[],engine:`${signal?.engine||'FUSION_V2_11'}+DIRECTION_RERANK_V1+FREQUENCY_SCORE_V2`,features:{...f,modelConfidence:Number(modelConfidence.toFixed(1)),modelQualified:signal?.qualified===true&&signal?.tradeQualified!==false,scoreOnlyWarnings:warnings,frequencyStrength:Number(strength.toFixed(4)),frequencyScoreVersion:'V2',frequencyPreserved:true,quotaPreserved:true,directionRerankVersion:'V1',directionRerankEligible:rank.eligible,directionReranked:rank.reranked,originalDirection:rank.originalDirection,originalDirectionScore:rank.originalScore,oppositeDirectionScore:rank.oppositeScore,directionRerankMargin:rank.margin,directionRerankMinimumMargin:rank.minimumMargin,directionRerankTrack:rank.track}};
}
