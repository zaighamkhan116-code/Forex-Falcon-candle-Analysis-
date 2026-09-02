const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const contexts=new Map(),lossHistory=new Map();
const key=(pair,horizon)=>`${pair}:${horizon}`;
const dirSign=d=>d==='BUY'?1:-1;
const against=(v,d,threshold=.12)=>dirSign(d)*Number(v||0)<-threshold;
const BASE_THRESHOLD=57;

export function diagnoseLoss(signal,currentAnalysis=null){
  const f=signal.features||{},reasons=[];let severity=0;
  if(signal.regime==='CHOPPY'){reasons.push('CHOPPY_REGIME');severity+=2;}
  if(f.snapshotEvolution==='REVERSING'){reasons.push('INTRACANDLE_REVERSAL');severity+=3;}else if(f.snapshotEvolution==='MIXED'){reasons.push('INTRACANDLE_DISAGREEMENT');severity+=1;}
  if(signal.direction==='BUY'&&(f.sr==='AT RESISTANCE'||f.dynamicZoneSide==='RESISTANCE')){reasons.push('BUY_INTO_RESISTANCE');severity+=2;}
  if(signal.direction==='SELL'&&(f.sr==='AT SUPPORT'||f.dynamicZoneSide==='SUPPORT')){reasons.push('SELL_INTO_SUPPORT');severity+=2;}
  if(against(f.m15Context,signal.direction)||against(f.h1Context,signal.direction)){reasons.push('HIGHER_TIMEFRAME_CONFLICT');severity+=2;}
  if(signal.direction==='BUY'&&(f.liquidity==='BUY-SIDE SWEEP'||f.breakout==='FAILED BULL BREAK'||f.failureToProgress===true)){reasons.push('BEARISH_REVERSAL_CONTEXT');severity+=2;}
  if(signal.direction==='SELL'&&(f.liquidity==='SELL-SIDE SWEEP'||f.breakout==='FAILED BEAR BREAK'||f.failureToProgress===true)){reasons.push('BULLISH_REVERSAL_CONTEXT');severity+=2;}
  if(Number(signal.probability??signal.confidence)>=70){reasons.push('OVERCONFIDENT_LOSS');severity+=1;}
  if(Number(f.moveQualityScore||10)<5){reasons.push('LOW_MOVE_QUALITY');severity+=2;}
  const currentDir=currentAnalysis?.direction;if(currentDir&&currentDir!==signal.direction){reasons.push('POST_LOSS_DIRECTION_FLIP');severity+=1;}
  if(!reasons.length)reasons.push('NORMAL_VARIANCE');

  const suggestedBias=currentDir&&currentDir!==signal.direction?currentDir:null,k=key(signal.pair,signal.horizon),now=Date.now(),history=(lossHistory.get(k)||[]).filter(x=>now-x.createdAt<30*60*1000),signature=reasons.filter(x=>x!=='OVERCONFIDENT_LOSS'&&x!=='NORMAL_VARIANCE').sort().join('|');
  const review={signalId:signal.id,pair:signal.pair,horizon:signal.horizon,lostDirection:signal.direction,reasons,severity:clamp(severity,0,10),suggestedBias,signature,createdAt:now};
  signal.lossReview=review;history.push(review);lossHistory.set(k,history.slice(-12));
  const similar=signature?history.filter(x=>x.signature===signature).length:0,cluster=history.filter(x=>x.lostDirection===signal.direction).length;
  const activate=(similar>=2)||(cluster>=2)||(review.severity>=7&&reasons.includes('OVERCONFIDENT_LOSS'));
  if(activate)contexts.set(k,{review:{...review,activationEvidence:{similarLosses:similar,directionalLossCluster:cluster}},remaining:4,initial:4});
  return{...review,adaptiveContextActivated:activate,similarLosses:similar,directionalLossCluster:cluster};
}

export function applyLossContext(result,pair,horizon){
  const k=key(pair,horizon),ctx=contexts.get(k);if(!ctx||ctx.remaining<=0)return{result:{...result,qualified:result?.qualified!==false&&Number(result.confidence||50)>=BASE_THRESHOLD,minimumConfidence:BASE_THRESHOLD},context:null,minimumConfidence:BASE_THRESHOLD};
  const review=ctx.review,decay=ctx.remaining/ctx.initial;let conf=Number(result.confidence||50),minimum=BASE_THRESHOLD;const same=result.direction===review.lostDirection,severity=review.severity||0,f=result?.features||{},dir=String(result?.direction||'').toUpperCase(),progress=Number(f.progressScore||0)*(dir==='BUY'?1:-1),quality=Number(f.moveQualityScore||0),votes=Number(f.groupConsensusVotes||0),opposing=Number(f.groupOpposingVotes||0),dominance=Number(f.groupDominance||0),state=String(f.activeFvgState||'NONE').toUpperCase(),freshFvg=['REJECTED','ACCEPTED_THROUGH','FULLY_MITIGATED'].includes(state),freshBreakout=f.breakoutAccepted===true&&progress>=5&&quality>=6,freshSweep=f.transitionLiquiditySweepReclaim===true||String(f.liquidity||'').toUpperCase().includes('SWEEP'),renewedConsensus=votes>=3&&opposing===0&&dominance>=.55&&quality>=6,freshProgress=f.failureToProgress!==true&&progress>=5&&quality>=5.8,freshEvidence=freshBreakout||freshSweep||freshFvg||renewedConsensus||freshProgress;
  if(review.reasons.includes('CHOPPY_REGIME'))minimum+=1;
  if(review.reasons.includes('HIGHER_TIMEFRAME_CONFLICT'))minimum+=1;
  if(review.reasons.includes('INTRACANDLE_REVERSAL'))minimum+=1;
  if(review.reasons.includes('BUY_INTO_RESISTANCE')||review.reasons.includes('SELL_INTO_SUPPORT'))minimum+=1;
  if(review.reasons.includes('LOW_MOVE_QUALITY'))minimum+=1;
  if(same)conf-=clamp((2+severity*.55)*decay,1.5,8);else if(review.suggestedBias===result.direction&&freshEvidence)conf+=clamp((.5+severity*.10)*decay,0,1.5);
  conf=clamp(conf,50,85);minimum=clamp(minimum,BASE_THRESHOLD,62);
  const repeatedDirectionGuard=same&&!freshEvidence;
  const baseQualified=result?.qualified!==false&&conf>=minimum;
  const qualified=baseQualified&&!repeatedDirectionGuard;
  const context={...review,remainingCycles:ctx.remaining,decay:Number(decay.toFixed(2)),sameDirectionPenalty:same,repeatedDirectionGuard,freshEvidence};ctx.remaining-=1;if(ctx.remaining<=0)contexts.delete(k);else contexts.set(k,ctx);
  const vetoReasons=[...(Array.isArray(result?.vetoReasons)?result.vetoReasons:[])];if(repeatedDirectionGuard&&!vetoReasons.includes('REPEATED_DIRECTION_FRESH_EVIDENCE_GATE'))vetoReasons.push('REPEATED_DIRECTION_FRESH_EVIDENCE_GATE');
  return{result:{...result,confidence:Number(conf.toFixed(1)),qualified,tradeQualified:qualified,minimumConfidence:BASE_THRESHOLD,vetoReasons,adaptiveContext:context,features:{...f,repeatedDirectionGuard,repeatedDirectionFreshEvidence:freshEvidence,repeatedDirectionGuardVersion:'V1'}},context,minimumConfidence:BASE_THRESHOLD};
}

export function getLossContext(pair,horizon){const ctx=contexts.get(key(pair,horizon));return ctx?{...ctx.review,remainingCycles:ctx.remaining}:null;}
