const sign=n=>n>0?1:n<0?-1:0;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

const add=(out,name,direction,strength,reason,meta={})=>{
  if(!direction)return;
  out.push({name,direction:direction>0?1:-1,strength,reason,meta});
};

function tickBurstStall(recentTicks,nowMs){
  const t=(recentTicks||[]).filter(x=>x.timestamp_ms>=nowMs-6000);
  if(t.length<8)return null;
  const older=t.filter(x=>x.timestamp_ms<nowMs-1800),fresh=t.filter(x=>x.timestamp_ms>=nowMs-1800);
  if(older.length<4||fresh.length<3)return null;
  const burstDir=sign(older.at(-1).price-older[0].price);if(!burstDir)return null;
  const burstRate=older.length/Math.max(.5,(older.at(-1).timestamp_ms-older[0].timestamp_ms)/1000);
  const freshRate=fresh.length/Math.max(.5,(fresh.at(-1).timestamp_ms-fresh[0].timestamp_ms)/1000);
  let alternating=0,changes=0,last=0;
  for(let i=1;i<fresh.length;i++){const d=sign(fresh[i].price-fresh[i-1].price);if(!d)continue;changes++;if(last&&d!==last)alternating++;last=d;}
  const returnDir=sign(fresh.at(-1).price-fresh[0].price);
  if(burstRate>=freshRate*1.35&&changes>=2&&alternating>=1&&returnDir!==burstDir)
    return{direction:-burstDir,burstRate,freshRate,alternating,changes};
  return null;
}

function partialCandle(features,context,nowMs){
  const p=context?.partial1m;if(!p)return null;
  const elapsed=Math.max(1,(nowMs-p.sec)/1000),range=p.high-p.low,typ=Math.max(context.avgRange||0,1e-9),body=p.close-p.open,travel=Math.abs(body)/typ;
  if(elapsed<8)return null;
  const upper=p.high-Math.max(p.open,p.close),lower=Math.min(p.open,p.close)-p.low,oppWick=body>0?upper:lower;
  if(elapsed<=40&&travel>=.70&&oppWick<range*.22&&sign(features?.m5)===sign(body))return{type:'CONTINUATION',direction:sign(body),travel,elapsed};
  if(elapsed<=40&&travel>=.55&&oppWick>=range*.32)return{type:'FADE',direction:-sign(body),travel,elapsed};
  return null;
}

function microDoubleTap(recentTicks,nowMs,avgRange){
  const t=(recentTicks||[]).filter(x=>x.timestamp_ms>=nowMs-30000);if(t.length<10)return null;
  const prices=t.map(x=>x.price),tol=Math.max((avgRange||0)*.10,Math.abs(prices.at(-1))*1e-7,1e-9);
  const third=Math.max(3,Math.floor(prices.length/3));
  const early=prices.slice(0,third),late=prices.slice(-third);
  const lo1=Math.min(...early),lo2=Math.min(...late),hi1=Math.max(...early),hi2=Math.max(...late),px=prices.at(-1);
  if(Math.abs(lo1-lo2)<=tol&&px>Math.max(lo1,lo2)+tol*.7)return{direction:1,type:'BOTTOM',level:(lo1+lo2)/2};
  if(Math.abs(hi1-hi2)<=tol&&px<Math.min(hi1,hi2)-tol*.7)return{direction:-1,type:'TOP',level:(hi1+hi2)/2};
  return null;
}

function roundLevelReaction(recentTicks,nowMs,avgRange){
  const t=(recentTicks||[]).filter(x=>x.timestamp_ms>=nowMs-4000);if(t.length<4)return null;
  const px=t.at(-1).price,span=Math.max(avgRange||0,Math.abs(px)*1e-6,1e-9),mag=Math.pow(10,Math.floor(Math.log10(Math.abs(px)||1))-2),step=Math.max(mag,span*.5),level=Math.round(px/step)*step,dist=Math.abs(px-level);
  if(dist>Math.max(span*.18,step*.12))return null;
  const approach=sign(t[Math.max(0,t.length-4)].price-level),nowSide=sign(px-level);
  if(approach&&nowSide&&approach!==nowSide)return{direction:nowSide,level,step};
  return null;
}

function sequenceExhaustion(context){
  const bars=context?.barsRecent||[];if(bars.length<5)return null;
  const last5=bars.slice(-5),dirs=last5.map(c=>sign(c.close-c.open)),dir=dirs.at(-1);if(!dir)return null;
  let run=0;for(let i=dirs.length-1;i>=0&&dirs[i]===dir;i--)run++;
  const c=last5.at(-1),range=Math.max(c.high-c.low,1e-9),upper=c.high-Math.max(c.open,c.close),lower=Math.min(c.open,c.close)-c.low,opp=dir>0?upper:lower;
  if(run>=4&&opp/range>=.28)return{direction:-dir,run,wickRatio:opp/range};
  return null;
}

// Independent rule engines. Strength is an ordinal authority class, NOT an additive score.
// 5 = decisive structural event, 4 = strong, 3 = normal, 2 = weak context.
export function runIndependentAnalyses({context,features,wickMemory,expiry,recentTicks=[],nowMs=Date.now()}){
  const out=[];
  if(!context?.available)return out;
  const inter=context.interaction||{}, ema=context.ema30||{}, structure=context.structure||{};

  if(inter.touched&&inter.direction){
    if(inter.state==='FALSE_BREAK') add(out,'FRACTAL_FALSE_BREAK',inter.direction,5,'penetrated structural zone and reclaimed it',{level:inter.level,regime:structure.regime});
    else if(expiry<=15) add(out,'FRACTAL_FIRST_TOUCH',inter.direction,structure.regime==='RANGE'?5:structure.regime==='TRANSITION'?4:3,'first touch/body touch of confirmed zone',{level:inter.level,regime:structure.regime});
    else if(expiry<=60) add(out,'LEVEL_REJECTION',inter.direction,4,'structural zone touch/rejection',{level:inter.level,regime:structure.regime});
  }
  if(inter.state==='ACCEPTED_BREAK'&&inter.direction&&expiry>=30)add(out,'BREAK_ACCEPTANCE',inter.direction,5,'completed body accepted beyond structural zone',{level:inter.level});
  if(context.spikeSnap?.active&&(expiry===30||expiry===60))add(out,'SPIKE_SNAP',context.spikeSnap.direction,5,'oversized candle with rejection anatomy',{rangeMultiple:context.spikeSnap.rangeMultiple});
  if(ema.pattern==='EMA30_SNAPBACK'&&(expiry===30||expiry===60))add(out,'EMA30_SNAPBACK',ema.direction,4,'price stretched from EMA30 and rejected',{distBodies:ema.distBodies});
  if(ema.pattern==='EMA30_BREAK_ACCEPT_CONTINUATION'&&expiry===60)add(out,'EMA30_BREAK_CONTINUATION',ema.direction,4,'1m body crossed and accepted EMA30',{slope:ema.slope});
  if(context.doubleTap?.active&&(expiry===60||expiry===120))add(out,'DOUBLE_TAP_REVERSAL',context.doubleTap.direction,5,'second structural extreme held/rejected',{level:context.doubleTap.level,type:context.doubleTap.type});
  if(expiry<=15&&wickMemory?.active&&wickMemory.direction){const strong=wickMemory.reaction==='BREAK_RETEST_HOLD'||wickMemory.reaction==='REJECTION';add(out,`WICK_${wickMemory.reaction}`,wickMemory.direction,strong?4:2,'historical wick-memory reaction',{level:wickMemory.level});}

  // Ultra-short independent analysts. These do not sum into a score.
  if(expiry<=15){
    const stall=tickBurstStall(recentTicks,nowMs);if(stall)add(out,'TICK_BURST_STALL',stall.direction,4,'fast directional tick burst slowed and began alternating',stall);
    const round=roundLevelReaction(recentTicks,nowMs,context.avgRange);if(round)add(out,'ROUND_LEVEL_REACTION',round.direction,3,'price crossed a nearby round/half-style level and snapped back',round);
  }
  if(expiry<=30){
    const pc=partialCandle(features,context,nowMs);if(pc)add(out,pc.type==='CONTINUATION'?'PARTIAL_CANDLE_CONTINUATION':'PARTIAL_CANDLE_FADE',pc.direction,pc.type==='CONTINUATION'?4:3,pc.type==='CONTINUATION'?'forming 1m candle expanded early with little opposing wick':'forming 1m candle expanded then showed opposing rejection',pc);
    const dt=microDoubleTap(recentTicks,nowMs,context.avgRange);if(dt)add(out,'MICRO_DOUBLE_TAP',dt.direction,4,'two micro extremes formed inside the recent 30s window and second attack rejected',dt);
    const seq=sequenceExhaustion(context);if(seq)add(out,'SEQUENCE_EXHAUSTION',seq.direction,3,'4+ same-direction 1m candles followed by opposing wick',seq);
    const votes=expiry===10?[sign(features.m3),sign(features.m5),sign(features.pressure3),sign(features.accel)]:expiry===15?[sign(features.m3),sign(features.m5),sign(features.m10),sign(features.pressure5)]:[sign(features.m5),sign(features.m10),sign(features.m20),sign(features.pressure10)];
    const nz=votes.filter(Boolean),sum=nz.reduce((a,b)=>a+b,0);if(nz.length>=3&&Math.abs(sum)>=3)add(out,'MICRO_MOMENTUM',sign(sum),3,'independent short-horizon momentum agreement',{votes:nz.length});
  }
  if(expiry>=120&&structure.bias){const pullback=(structure.bias>0&&features.m20<0)||(structure.bias<0&&features.m20>0);add(out,pullback?'STRUCTURE_PULLBACK':'STRUCTURE_TREND',structure.bias,pullback?4:3,pullback?'trend pullback without structural reversal':'HH/HL or LH/LL trend continuation',{regime:structure.regime});}
  return out;
}

export function arbitrateIndependentAnalyses(analyses){
  if(!analyses.length)return{emit:false,reason:'NO_RULE_TRIGGER',analyses:[]};
  const strongest=Math.max(...analyses.map(a=>a.strength)),top=analyses.filter(a=>a.strength===strongest),topDirs=[...new Set(top.map(a=>a.direction))];
  if(topDirs.length>1)return{emit:false,reason:'EQUAL_STRENGTH_CONFLICT',strongest,analyses};
  const direction=topDirs[0],agreeing=analyses.filter(a=>a.direction===direction).sort((a,b)=>b.strength-a.strength),opposing=analyses.filter(a=>a.direction!==direction).sort((a,b)=>b.strength-a.strength);
  return{emit:true,direction,strongest,validation:agreeing.length>=2?'STRONG_VALIDATION':'VALIDATED',agreementCount:agreeing.length,agreeing,opposing,analyses,primary:agreeing[0]};
}
