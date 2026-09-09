const sign=n=>n>0?1:n<0?-1:0;

const add=(out,name,direction,strength,reason,meta={})=>{
  if(!direction)return;
  out.push({name,direction:direction>0?1:-1,strength,reason,meta});
};

// Independent rule engines. Strength is an ordinal class, NOT an additive score:
// 5 = decisive structural event, 4 = strong, 3 = normal, 2 = weak context.
export function runIndependentAnalyses({context,features,wickMemory,expiry}){
  const out=[];
  if(!context?.available)return out;
  const inter=context.interaction||{}, ema=context.ema30||{}, structure=context.structure||{};

  // A1: confirmed fractal / horizontal-zone reaction. Two-way memory.
  if(inter.touched&&inter.direction){
    if(inter.state==='FALSE_BREAK') add(out,'FRACTAL_FALSE_BREAK',inter.direction,5,'penetrated structural zone and reclaimed it',{level:inter.level,regime:structure.regime});
    else if(expiry<=15) add(out,'FRACTAL_FIRST_TOUCH',inter.direction,structure.regime==='RANGE'?5:structure.regime==='TRANSITION'?4:3,'first touch/body touch of confirmed zone',{level:inter.level,regime:structure.regime});
    else if(expiry<=60) add(out,'LEVEL_REJECTION',inter.direction,4,'structural zone touch/rejection',{level:inter.level,regime:structure.regime});
  }

  // A2: accepted structural break. Independent from rejection logic.
  if(inter.state==='ACCEPTED_BREAK'&&inter.direction&&expiry>=30)
    add(out,'BREAK_ACCEPTANCE',inter.direction,5,'completed body accepted beyond structural zone',{level:inter.level});

  // A3: spike-and-snap / exhaustion candle.
  if(context.spikeSnap?.active&&(expiry===30||expiry===60))
    add(out,'SPIKE_SNAP',context.spikeSnap.direction,5,'oversized candle with rejection anatomy',{rangeMultiple:context.spikeSnap.rangeMultiple});

  // A4: EMA30 is its own analyst, never added to another analyst numerically.
  if(ema.pattern==='EMA30_SNAPBACK'&&(expiry===30||expiry===60))
    add(out,'EMA30_SNAPBACK',ema.direction,4,'price stretched from EMA30 and rejected',{distBodies:ema.distBodies});
  if(ema.pattern==='EMA30_BREAK_ACCEPT_CONTINUATION'&&expiry===60)
    add(out,'EMA30_BREAK_CONTINUATION',ema.direction,4,'1m body crossed and accepted EMA30',{slope:ema.slope});

  // A5: double-tap is independent and strongest on 2m, useful on 1m too.
  if(context.doubleTap?.active&&(expiry===60||expiry===120))
    add(out,'DOUBLE_TAP_REVERSAL',context.doubleTap.direction,5,'second structural extreme held/rejected',{level:context.doubleTap.level,type:context.doubleTap.type});

  // A6: historical wick-memory analyst for ultra-short reaction.
  if(expiry<=15&&wickMemory?.active&&wickMemory.direction){
    const strong=wickMemory.reaction==='BREAK_RETEST_HOLD'||wickMemory.reaction==='REJECTION';
    add(out,`WICK_${wickMemory.reaction}`,wickMemory.direction,strong?4:2,'historical wick-memory reaction',{level:wickMemory.level});
  }

  // A7: micro-momentum analyst. It remains independent and can lose to stronger structure.
  if(expiry<=30){
    const votes=expiry===10?[sign(features.m3),sign(features.m5),sign(features.pressure3),sign(features.accel)]:expiry===15?[sign(features.m3),sign(features.m5),sign(features.m10),sign(features.pressure5)]:[sign(features.m5),sign(features.m10),sign(features.m20),sign(features.pressure10)];
    const nz=votes.filter(Boolean),sum=nz.reduce((a,b)=>a+b,0);
    if(nz.length>=3&&Math.abs(sum)>=3)add(out,'MICRO_MOMENTUM',sign(sum),3,'independent short-horizon momentum agreement',{votes:nz.length});
  }

  // A8: higher-expiry market-structure analyst.
  if(expiry>=120&&structure.bias){
    const pullback=(structure.bias>0&&features.m20<0)||(structure.bias<0&&features.m20>0);
    add(out,pullback?'STRUCTURE_PULLBACK':'STRUCTURE_TREND',structure.bias,pullback?4:3,pullback?'trend pullback without structural reversal':'HH/HL or LH/LL trend continuation',{regime:structure.regime});
  }

  return out;
}

export function arbitrateIndependentAnalyses(analyses){
  if(!analyses.length)return{emit:false,reason:'NO_RULE_TRIGGER',analyses:[]};
  const strongest=Math.max(...analyses.map(a=>a.strength));
  const top=analyses.filter(a=>a.strength===strongest);
  const topDirs=[...new Set(top.map(a=>a.direction))];
  if(topDirs.length>1)return{emit:false,reason:'EQUAL_STRENGTH_CONFLICT',strongest,analyses};
  const direction=topDirs[0];
  const agreeing=analyses.filter(a=>a.direction===direction).sort((a,b)=>b.strength-a.strength);
  const opposing=analyses.filter(a=>a.direction!==direction).sort((a,b)=>b.strength-a.strength);
  // A weaker opposite view is recorded but cannot overturn a stronger rule.
  // Two or more independent analysts agreeing upgrades validation wording only.
  return{emit:true,direction,strongest,validation:agreeing.length>=2?'STRONG_VALIDATION':'VALIDATED',agreementCount:agreeing.length,agreeing,opposing,analyses,primary:agreeing[0]};
}
