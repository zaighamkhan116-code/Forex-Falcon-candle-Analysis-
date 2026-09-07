const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const upper=v=>String(v||'').toUpperCase();
const num=(...values)=>{for(const v of values){const n=Number(v);if(Number.isFinite(n))return n}return 0};

function pktContext(signal){
  const t=num(signal?.signalBoundary,signal?.boundary,signal?.predictedAt,signal?.generatedAt,Date.now());
  const d=new Date(t),hour=(d.getUTCHours()+5)%24,minute=d.getUTCMinutes(),bucket=`${String(hour).padStart(2,'0')}:00-${String(hour).padStart(2,'0')}:59`;
  let session='OFF_HOURS';
  if(hour>=9&&hour<12)session='ASIAN_LATE';
  else if(hour===12)session='LONDON_PREOPEN';
  else if(hour===13)session='LONDON_OPEN';
  else if(hour>=14&&hour<17)session='LONDON_EARLY_MID';
  else if(hour>=17&&hour<20)session='LONDON_NY_OVERLAP';
  else if(hour>=20&&hour<23)session='NEW_YORK';
  return{hour,minute,bucket,session};
}

function metrics(signal,direction){
  const f=signal?.features||{},sign=direction==='BUY'?1:-1;
  const vsa=num(f.vsaScore,f.vsaFlowScore)*sign;
  const sequence=num(f.sequencePressure)*sign;
  const progress=num(f.progressScore)*sign;
  const evidence=num(signal?.directionalEvidenceScore,signal?.evidenceScore,f.directionalEvidenceScore,f.evidenceScore)*sign;
  const consensus=upper(f.groupConsensusDirection),dominance=clamp(num(f.groupDominance),0,1);
  const hostileWick=direction==='BUY'?Math.max(num(f.lastUpperWickRatio),num(f.upperWickRatioVsa)):Math.max(num(f.lastLowerWickRatio),num(f.lowerWickRatioVsa));
  const supportiveWick=direction==='BUY'?Math.max(num(f.lastLowerWickRatio),num(f.lowerWickRatioVsa)):Math.max(num(f.lastUpperWickRatio),num(f.upperWickRatioVsa));
  const bodyRatio=num(f.candleBodyRatio,f.bodyRatio);
  const rangeAtr=num(f.rangeAtr);
  const bodyAtr=num(f.bodyAtr);
  const efficiency=num(f.efficiency,f.directionalEfficiency);
  const quality=num(f.moveQualityScore,5);
  const vwapDistance=Math.abs(num(f.vwapDistanceAtr));
  const adverse=(direction==='BUY'&&upper(f.dynamicZoneSide)==='RESISTANCE')||(direction==='SELL'&&upper(f.dynamicZoneSide)==='SUPPORT');
  const extended=(direction==='BUY'&&f.bullExtended===true)||(direction==='SELL'&&f.bearExtended===true)||f.extendedMove===true;
  const transition=f.transitionRiskActive===true;
  const unresolved=['APPROACHING','MITIGATING'].includes(upper(f.activeFvgState||f.fvgState));
  const resolvedFvg=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(upper(f.activeFvgState||f.fvgState));
  const mtfOppose=num(f.mtfOppositionCount);
  const mtfAgree=num(f.mtfAgreementCount);
  const failed=f.failureToProgress===true||progress<=0;
  const poorVsa=f.vsaPoorResult===true||vsa<=-.18;
  const strongVsa=vsa>=.18;
  const weakBody=(bodyRatio>0&&bodyRatio<.35)||(bodyAtr>0&&bodyAtr<.22);
  const strongBody=bodyRatio>=.52||bodyAtr>=.42;
  const hostile=hostileWick>=.38;
  const weakMove=quality<4.8||efficiency<.22;
  const compressed=f.emaCompression===true||f.bbContraction===true||upper(f.volatilityState)==='CONTRACTING';
  const late=f.lateCounterTrendRisk===true||f.lateContinuationRisk===true;
  const healthyReaction=(strongVsa||vsa>=.08)&&(sequence>=.08||progress>=2||evidence>=.15)&&(strongBody||quality>=5.8)&&hostileWick<.42;
  const weakReaction=(poorVsa||weakBody||hostile)&&(sequence<=0||progress<=0||evidence<.08);
  const matureDisplacement=(extended||vwapDistance>=1.8||rangeAtr>=1.25)&&(hostile||poorVsa||failed||transition);
  const cleanTrend=(mtfAgree>=2&&mtfOppose<2&&consensus===direction&&dominance>=.42&&!failed&&!transition);
  const compoundConflict=[failed,mtfOppose>=2,adverse,weakMove,compressed,late,transition].filter(Boolean).length;
  return{f,sign,vsa,sequence,progress,evidence,consensus,dominance,hostileWick,supportiveWick,bodyRatio,rangeAtr,bodyAtr,efficiency,quality,vwapDistance,adverse,extended,transition,unresolved,resolvedFvg,mtfOppose,mtfAgree,failed,poorVsa,strongVsa,weakBody,strongBody,hostile,weakMove,compressed,late,compoundConflict,healthyReaction,weakReaction,matureDisplacement,cleanTrend};
}

function applyPairPolicy(pair,horizon,m,ctx){
  let confidenceAdjustment=0,directionBias=0;const tags=[];
  const add=(adj,bias,tag)=>{confidenceAdjustment+=adj;directionBias+=bias;if(tag)tags.push(tag)};

  if(pair==='EURUSD'){
    if([3,5].includes(horizon)&&m.matureDisplacement&&!m.healthyReaction)add(-3.0,-1.2,'EURUSD_MATURE_CONTINUATION_RISK');
    if([3,5].includes(horizon)&&m.healthyReaction&&m.cleanTrend)add(1.5,.6,'EURUSD_HEALTHY_CONTINUATION');
    if([1,2].includes(horizon)&&m.transition&&m.failed&&m.mtfOppose>=2)add(-1.5,-.5,'EURUSD_SHORT_TRANSITION_CONFLICT');
    if(horizon===5&&ctx.session==='LONDON_EARLY_MID'){
      if(m.compoundConflict>=3)add(-2.4,-.8,'EURUSD_5M_LONDON_COMPOUND_CONFLICT');
      else if(m.weakMove&&(m.failed||m.mtfOppose>=2))add(-1.4,-.4,'EURUSD_5M_LONDON_WEAK_PROGRESS');
      if(m.cleanTrend&&m.healthyReaction&&!m.compressed)add(1.0,.35,'EURUSD_5M_LONDON_CLEAN_REACTION');
    }
  }

  if(pair==='GBPUSD'){
    if(horizon===1&&m.weakReaction)add(-4.5,-1.8,'GBPUSD_1M_WEAK_REACTION');
    if(horizon===1&&m.healthyReaction)add(2.0,.8,'GBPUSD_1M_HEALTHY_REACTION');
    if(horizon===2&&m.transition&&m.failed)add(-3.0,-1.0,'GBPUSD_2M_BAD_STATE');
    if(horizon===2&&m.cleanTrend&&m.healthyReaction)add(1.5,.5,'GBPUSD_2M_CLEAN_STATE');
    if([3,5].includes(horizon)&&m.matureDisplacement&&!m.healthyReaction)add(-2.0,-.7,'GBPUSD_MATURE_MOVE_CAUTION');
    if(horizon===5&&ctx.session==='LONDON_EARLY_MID'){
      if(m.cleanTrend&&m.healthyReaction)add(1.2,.4,'GBPUSD_5M_LONDON_PROTECTED_CONTINUATION');
      if(m.compoundConflict>=4)add(-1.0,-.25,'GBPUSD_5M_LONDON_EXTREME_CONFLICT_ONLY');
    }
  }

  if(pair==='EURJPY'){
    if([2,3].includes(horizon)&&m.transition&&m.failed)add(-3.0,-1.0,'EURJPY_TRANSITION_NO_PROGRESS');
    if([2,3].includes(horizon)&&m.cleanTrend&&m.healthyReaction)add(1.8,.6,'EURJPY_STRUCTURAL_CONFIRMATION');
    if(horizon===1&&m.mtfOppose>=2&&m.failed)add(-1.5,-.5,'EURJPY_1M_MTF_CONFLICT');
    if(horizon===5&&m.matureDisplacement&&!m.healthyReaction)add(-1.5,-.5,'EURJPY_5M_EXTENSION_CAUTION');
  }

  if(pair==='USDJPY'){
    if(horizon===5&&m.transition&&m.failed)add(-2.5,-.8,'USDJPY_5M_WEAK_STATE');
    if(horizon===5&&m.compoundConflict>=3)add(-2.0,-.65,'USDJPY_5M_COMPOUND_CONFLICT');
    if(horizon===5&&m.cleanTrend&&m.healthyReaction&&!m.compressed)add(1.0,.3,'USDJPY_5M_CLEAN_PROGRESS');
    if(horizon===3&&m.cleanTrend&&m.healthyReaction)add(1.0,.3,'USDJPY_3M_RECOVERY_PRESERVE');
    if([1,2].includes(horizon)&&m.mtfOppose>=2&&m.failed&&!m.resolvedFvg)add(-1.2,-.4,'USDJPY_SHORT_MTF_CONFLICT');
  }

  if(pair==='AUDUSD'){
    if(m.healthyReaction&&(m.cleanTrend||m.resolvedFvg))add(1.2,.4,'AUDUSD_HEALTHY_REACTION_PRESERVE');
    if(m.weakReaction&&m.mtfOppose>=2&&m.failed)add(-2.0,-.7,'AUDUSD_COMPOUND_REACTION_CONFLICT');
    if(horizon===5&&m.matureDisplacement&&m.healthyReaction)add(.8,.2,'AUDUSD_5M_MATURE_REACTION_ALLOWED');
  }

  if(horizon===15){confidenceAdjustment=clamp(confidenceAdjustment,-1,1);directionBias=clamp(directionBias,-.25,.25);tags.push('15M_SMALL_SAMPLE_CAP')}
  return{confidenceAdjustment:Number(clamp(confidenceAdjustment,-6,4).toFixed(2)),directionBias:Number(clamp(directionBias,-2.5,1.5).toFixed(2)),tags:[...new Set(tags)]};
}

export function assessTrackCalibration(signal,direction=upper(signal?.direction||'BUY')){
  const pair=upper(signal?.pair),horizon=Number(signal?.horizon||signal?.features?.horizon||1),ctx=pktContext(signal),m=metrics(signal,direction),policy=applyPairPolicy(pair,horizon,m,ctx);
  return{
    version:'V7_SESSION_PROFILE_CALIBRATION',pair,horizon,track:`${pair}:${horizon}:${ctx.session}:${ctx.bucket}`,direction,
    session:ctx.session,timeBucket:ctx.bucket,pktHour:ctx.hour,
    ...policy,
    reactionQuality:m.healthyReaction?'HEALTHY':m.weakReaction?'WEAK':'NEUTRAL',
    matureDisplacement:m.matureDisplacement,cleanTrend:m.cleanTrend,failedProgress:m.failed,
    transition:m.transition,mtfOpposition:m.mtfOppose,mtfAgreement:m.mtfAgree,
    compoundConflict:m.compoundConflict,weakMove:m.weakMove,compressed:m.compressed,late:m.late,
    alignedVsa:Number(m.vsa.toFixed(3)),alignedSequence:Number(m.sequence.toFixed(3)),alignedProgress:Number(m.progress.toFixed(3)),
    hostileWick:Number(m.hostileWick.toFixed(3)),bodyRatio:Number(m.bodyRatio.toFixed(3)),rangeAtr:Number(m.rangeAtr.toFixed(3)),vwapDistanceAtr:Number(m.vwapDistance.toFixed(3))
  };
}

export function trackDirectionBias(signal,direction){return assessTrackCalibration(signal,direction).directionBias}
