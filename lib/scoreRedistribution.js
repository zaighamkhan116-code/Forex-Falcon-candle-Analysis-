const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function assessScoreRedistribution(features={},risk={},direction='',horizon=1){
  const f=features||{};
  const dir=String(direction||'').toUpperCase();
  const state=String(f.activeFvgState||'NONE').toUpperCase();
  const adverseZone=(dir==='BUY'&&f.dynamicZoneSide==='RESISTANCE')||(dir==='SELL'&&f.dynamicZoneSide==='SUPPORT');
  const extended=(dir==='BUY'&&f.bullExtended===true)||(dir==='SELL'&&f.bearExtended===true);
  const stalled=f.failureToProgress===true||f.microRangeChop===true||risk.compression===true||risk.failedProgress===true;
  const unresolvedFvg=state==='APPROACHING'||state==='MITIGATING';
  const mtfOppose=Number(f.mtfOppositionCount||0);
  const mtfAgree=Number(f.mtfAgreementCount||0);
  const moveQuality=Number(f.moveQualityScore||5);
  const efficiency=Number(f.efficiency||0);
  const progress=Number(f.progressScore||0)*(dir==='BUY'?1:-1);
  const votes=Number(f.groupConsensusVotes||0);
  const opposing=Number(f.groupOpposingVotes||0);
  const dominance=Number(f.groupDominance||0);
  const rejection=(dir==='BUY'?Number(f.lastUpperWickRatio||0):Number(f.lastLowerWickRatio||0))>=.30||Number(risk.rejectionRatio||0)>=.32;
  const emaCompression=Number(f.emaCompression||0);
  const bbExpansion=Number(f.bbExpansion||0);
  const maBb=Number(f.maBbConfirmation||0)*(dir==='BUY'?1:-1);
  const vwapDistance=Number(f.vwapDistanceAtr||0),vwapSlope=Number(f.vwapSlopeAtr||0),vwapAligned=(dir==='BUY'&&vwapDistance>=0&&vwapSlope>0)||(dir==='SELL'&&vwapDistance<=0&&vwapSlope<0),vwapAgainst=(dir==='BUY'&&vwapDistance<0&&vwapSlope<0)||(dir==='SELL'&&vwapDistance>0&&vwapSlope>0);
  const vsa=Number(f.vsaScore||0)*(dir==='BUY'?1:-1),vsaState=String(f.vsaState||'NONE'),rangeAtr=Number(f.rangeAtr||0),bodyAtr=Number(f.bodyAtr||0),relVolume=Number(f.relativeVolume||0),vwapExtended=f.vwapExtended===true;

  let penalty=0,bonus=0;
  const penaltyTags=[],bonusTags=[];

  if(stalled){penalty+=2.0;penaltyTags.push('FAILURE_TO_PROGRESS')}
  if(adverseZone){penalty+=1.8;penaltyTags.push('ADVERSE_ZONE')}
  if(mtfOppose>=2){penalty+=1.5;penaltyTags.push('MTF_CONFLICT')}
  if(unresolvedFvg){penalty+=1.0;penaltyTags.push('UNRESOLVED_FVG')}
  if(extended){penalty+=1.0;penaltyTags.push('EXTENDED_MOVE')}
  if(rejection){penalty+=1.0;penaltyTags.push('REJECTION_PRESSURE')}
  if(moveQuality<5.5){penalty+=.8;penaltyTags.push('WEAK_MOVE_QUALITY')}
  if(efficiency<.18){penalty+=.8;penaltyTags.push('LOW_EFFICIENCY')}
  if(progress<0){penalty+=1.0;penaltyTags.push('NEGATIVE_PROGRESS')}
  if(opposing>=2){penalty+=.8;penaltyTags.push('OPPOSING_EVIDENCE')}
  if(emaCompression>0&&emaCompression<.00008){penalty+=.4;penaltyTags.push('EMA_COMPRESSION')}
  if(bbExpansion<-.05){penalty+=.4;penaltyTags.push('BB_CONTRACTION')}

  // ATR/VWAP/VSA penalties target late, effort-without-result continuation without adding hard vetoes.
  if(vwapExtended&&((dir==='BUY'&&vwapDistance>0)||(dir==='SELL'&&vwapDistance<0))){penalty+=1.0;penaltyTags.push('VWAP_ATR_EXTENSION')}
  if(vwapAgainst){penalty+=.6;penaltyTags.push('VWAP_SLOPE_CONFLICT')}
  if(vsa<=-.35){penalty+=1.1;penaltyTags.push('VSA_OPPOSES_DIRECTION')}
  if(f.vsaHighEffort===true&&f.vsaPoorResult===true){penalty+=1.0;penaltyTags.push('VSA_HIGH_EFFORT_LOW_RESULT')}
  if(rangeAtr>=1.6&&bodyAtr<.55){penalty+=.5;penaltyTags.push('WIDE_RANGE_WEAK_BODY')}

  const freshBreakout=f.breakoutAccepted===true&&!stalled&&!rejection&&moveQuality>=5.8&&progress>=4;
  const freshSweep=String(f.liquidity||'NONE').toUpperCase()!=='NONE'&&risk.sweep===true;
  const fvgResolved=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(state);
  const renewedProgress=!stalled&&progress>=5&&efficiency>=.28;
  const renewedConsensus=votes>=3&&opposing===0&&dominance>=.55;
  const cleanMtf=mtfAgree>=2&&mtfOppose===0;
  const maBbAligned=maBb>=.25&&bbExpansion>=0;
  const tickAccel=Number(f.tickAcceleration||0)*(dir==='BUY'?1:-1);
  const vsaAligned=vsa>=.35&&!stalled;
  const healthyVwapContinuation=vwapAligned&&!vwapExtended&&rangeAtr>=.75&&bodyAtr>=.35;
  const vwapReclaimReaction=(dir==='BUY'&&vwapDistance>=0&&vwapSlope>=0&&Number(f.closeLocation||0)>=.6)||(dir==='SELL'&&vwapDistance<=0&&vwapSlope<=0&&Number(f.closeLocation||1)<=.4);

  if(freshBreakout){bonus+=2.2;bonusTags.push('FRESH_BREAKOUT')}
  if(freshSweep){bonus+=1.8;bonusTags.push('FRESH_SWEEP_RECLAIM')}
  if(fvgResolved){bonus+=1.5;bonusTags.push('FVG_RESOLVED')}
  if(renewedProgress){bonus+=1.8;bonusTags.push('RENEWED_PROGRESS')}
  if(renewedConsensus){bonus+=1.4;bonusTags.push('RENEWED_CONSENSUS')}
  if(cleanMtf){bonus+=1.0;bonusTags.push('CLEAN_MTF_ALIGNMENT')}
  if(maBbAligned){bonus+=.8;bonusTags.push('MA_BB_ALIGNMENT')}
  if(tickAccel>=.18&&!stalled){bonus+=.6;bonusTags.push('TICK_ACCELERATION')}
  if(vsaAligned){bonus+=1.0;bonusTags.push('VSA_EFFORT_RESULT_ALIGNMENT')}
  if(healthyVwapContinuation){bonus+=.8;bonusTags.push('VWAP_HEALTHY_CONTINUATION')}
  if(vwapReclaimReaction&&vsa>=.15){bonus+=.7;bonusTags.push('VWAP_RECLAIM_REACTION')}
  if(relVolume>=1.2&&vsaAligned){bonus+=.4;bonusTags.push('VOLUME_CONFIRMED_FLOW')}

  const scale={1:1,2:.92,3:.84,5:.72,15:.55}[Number(horizon)]||.84;
  penalty=clamp(penalty*scale,0,8.5);
  bonus=clamp(bonus*scale,0,6.5);
  const net=clamp(bonus-penalty,-6,4);
  return{
    adjustment:Number(net.toFixed(1)),penalty:Number(penalty.toFixed(1)),bonus:Number(bonus.toFixed(1)),
    penaltyTags:penaltyTags.join('|')||'NONE',bonusTags:bonusTags.join('|')||'NONE',
    stalePressure:penalty>=3,freshPressure:bonus>=2,freshBreakout,freshSweep,fvgResolved,renewedProgress,renewedConsensus,cleanMtf,maBbAligned,
    atrVwapVsaUsed:true,vwapAligned,vwapAgainst,vwapExtended,vsaAligned,vsaState,rangeAtr:Number(rangeAtr.toFixed(3)),bodyAtr:Number(bodyAtr.toFixed(3)),relativeVolume:Number.isFinite(relVolume)&&relVolume>0?Number(relVolume.toFixed(3)):null
  };
}
