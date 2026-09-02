const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;

// Universal detector only: pair/timeframe calibration remains independent upstream.
// Uses closed candles only; no future candle or settlement information.
export function detectTransitionRisk(candles,direction,horizon=1){
  if(!Array.isArray(candles)||candles.length<6)return{active:false,score:0,penalty:0,tags:['INSUFFICIENT_SEQUENCE']};
  const s=candles.slice(-6),d=String(direction||'').toUpperCase(),rng=x=>Math.max(Number(x.high)-Number(x.low),1e-12),body=x=>Math.abs(Number(x.close)-Number(x.open))/rng(x),upper=x=>(Number(x.high)-Math.max(Number(x.open),Number(x.close)))/rng(x),lower=x=>(Math.min(Number(x.open),Number(x.close))-Number(x.low))/rng(x),dir=x=>sign(Number(x.close)-Number(x.open));
  const recent=s.slice(-4),avgRange=recent.reduce((a,x)=>a+rng(x),0)/recent.length,prior=s.slice(0,-1),last=s.at(-1),prev=s.at(-2),priorHigh=Math.max(...prior.map(x=>Number(x.high))),priorLow=Math.min(...prior.map(x=>Number(x.low)));
  const bearish=d==='SELL',same=recent.filter(x=>dir(x)===(bearish?-1:1)).length,opposite=recent.filter(x=>dir(x)===(bearish?1:-1)).length;
  const rejection=bearish?lower(last):upper(last),failedProgress=bearish?Number(last.low)>=Number(prev.low):Number(last.high)<=Number(prev.high),recovery=bearish?Number(last.close)>Number(prev.close):Number(last.close)<Number(prev.close),sweep=bearish?(Number(last.low)<priorLow&&Number(last.close)>priorLow):(Number(last.high)>priorHigh&&Number(last.close)<priorHigh);
  const overlapHigh=Math.min(...recent.map(x=>Number(x.high))),overlapLow=Math.max(...recent.map(x=>Number(x.low))),overlap=Math.max(0,overlapHigh-overlapLow)/Math.max(avgRange,1e-12),compression=overlap>=.18&&recent.reduce((a,x)=>a+body(x),0)/recent.length<=.42;
  let score=0;const tags=[];
  if(same>=3){score+=1;tags.push('PRIOR_EXTENSION');}
  if(rejection>=.32){score+=2;tags.push('OPPOSITE_WICK_REJECTION');}
  if(rejection>=.48)score+=1;
  if(failedProgress){score+=2;tags.push('FAILURE_TO_PROGRESS');}
  if(recovery){score+=1;tags.push('OPPOSITE_RECOVERY');}
  if(opposite>=2){score+=1;tags.push('OPPOSITE_SEQUENCE');}
  if(sweep){score+=2;tags.push('LIQUIDITY_SWEEP_RECLAIM');}
  if(compression){score+=2;tags.push('POST_MOVE_COMPRESSION');}
  score=clamp(score,0,10);
  const scale={1:1,2:.9,3:.8,5:.65,15:.45}[Number(horizon)]||.8;
  const penalty=Number((clamp(Math.max(0,score-2)*1.35,0,9)*scale).toFixed(1));
  return{active:score>=5,score,penalty,tags,failedProgress,recovery,sweep,compression,rejectionRatio:Number(rejection.toFixed(3))};
}
