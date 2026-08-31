const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const contexts=new Map();
const key=(pair,horizon)=>`${pair}:${horizon}`;
const dirSign=d=>d==='BUY'?1:-1;
const against=(v,d,threshold=.12)=>dirSign(d)*Number(v||0)<-threshold;

export function diagnoseLoss(signal,currentAnalysis=null){
  const f=signal.features||{};
  const reasons=[];
  let severity=0;
  if(signal.regime==='CHOPPY'){reasons.push('CHOPPY_REGIME');severity+=2;}
  if(f.snapshotEvolution==='REVERSING'){reasons.push('INTRACANDLE_REVERSAL');severity+=3;}
  else if(f.snapshotEvolution==='MIXED'){reasons.push('INTRACANDLE_DISAGREEMENT');severity+=1;}
  if(signal.direction==='BUY'&&f.sr==='AT RESISTANCE'){reasons.push('BUY_INTO_RESISTANCE');severity+=2;}
  if(signal.direction==='SELL'&&f.sr==='AT SUPPORT'){reasons.push('SELL_INTO_SUPPORT');severity+=2;}
  if(against(f.m15Context,signal.direction)||against(f.h1Context,signal.direction)){reasons.push('HIGHER_TIMEFRAME_CONFLICT');severity+=2;}
  if(signal.direction==='BUY'&&(f.liquidity==='BUY-SIDE SWEEP'||f.breakout==='FAILED BULL BREAK')){reasons.push('BEARISH_REVERSAL_CONTEXT');severity+=2;}
  if(signal.direction==='SELL'&&(f.liquidity==='SELL-SIDE SWEEP'||f.breakout==='FAILED BEAR BREAK')){reasons.push('BULLISH_REVERSAL_CONTEXT');severity+=2;}
  if(Number(signal.probability)>=70){reasons.push('OVERCONFIDENT_LOSS');severity+=1;}
  const currentDir=currentAnalysis?.direction;
  if(currentDir&&currentDir!==signal.direction){reasons.push('POST_LOSS_DIRECTION_FLIP');severity+=1;}
  if(!reasons.length)reasons.push('NORMAL_VARIANCE');

  const suggestedBias=currentDir&&currentDir!==signal.direction?currentDir:null;
  const review={
    signalId:signal.id,
    pair:signal.pair,
    horizon:signal.horizon,
    lostDirection:signal.direction,
    reasons,
    severity:clamp(severity,0,10),
    suggestedBias,
    createdAt:Date.now()
  };
  signal.lossReview=review;
  contexts.set(key(signal.pair,signal.horizon),{
    review,
    remaining:3,
    initial:3
  });
  return review;
}

export function applyLossContext(result,pair,horizon){
  const k=key(pair,horizon),ctx=contexts.get(k);
  if(!ctx||ctx.remaining<=0)return{result,context:null,minimumConfidence:60};
  const review=ctx.review,decay=ctx.remaining/ctx.initial;
  let conf=Number(result.confidence||50);
  let minimum=60;
  const same=result.direction===review.lostDirection;
  const severity=review.severity||0;

  if(review.reasons.includes('CHOPPY_REGIME'))minimum+=3;
  if(review.reasons.includes('HIGHER_TIMEFRAME_CONFLICT'))minimum+=2;
  if(review.reasons.includes('INTRACANDLE_REVERSAL'))minimum+=3;
  if(review.reasons.includes('BUY_INTO_RESISTANCE')||review.reasons.includes('SELL_INTO_SUPPORT'))minimum+=2;

  if(same)conf-=clamp((2+severity*.55)*decay,1,8);
  else if(review.suggestedBias===result.direction)conf+=clamp((1+severity*.2)*decay,0,3);

  conf=clamp(conf,50,85);
  minimum=clamp(minimum,60,68);
  const context={...review,remainingCycles:ctx.remaining,decay:Number(decay.toFixed(2)),sameDirectionPenalty:same};
  ctx.remaining-=1;
  if(ctx.remaining<=0)contexts.delete(k);else contexts.set(k,ctx);

  return{result:{...result,confidence:Number(conf.toFixed(1)),qualified:conf>=minimum,adaptiveContext:context},context,minimumConfidence:minimum};
}

export function getLossContext(pair,horizon){
  const ctx=contexts.get(key(pair,horizon));
  return ctx?{...ctx.review,remainingCycles:ctx.remaining}:null;
}
