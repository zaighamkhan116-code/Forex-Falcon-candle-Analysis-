const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;

// Confirmation V2 deliberately scores evidence FAMILIES rather than counting every
// correlated indicator as an independent vote. This prevents EMA/Bollinger signals
// from artificially inflating confidence while still rewarding broad confluence.
export function confirmationModelV2({features={},direction,horizon=1}){
  const d=direction==='BUY'?1:-1;
  const families=[];
  const add=(name,raw,weight)=>families.push({name,raw:clamp(raw,-1,1),weight});

  // 1) Fast trend / MA family
  const stack=features.emaStack==='BULL'?1:features.emaStack==='BEAR'?-1:0;
  const slopes=[features.emaSlope5,features.emaSlope8,features.emaSlope13,features.emaSlope20].filter(Number.isFinite);
  const slopeVote=slopes.length?slopes.reduce((a,v)=>a+sign(v),0)/slopes.length:0;
  add('FAST_MA',stack*.62+slopeVote*.38,1.00);

  // 2) Bollinger volatility/location family
  let bb=0;
  if(features.bbState==='BULL_EXPANSION'||features.bbState==='LOWER_REJECTION'||features.bbState==='MID_RECLAIM')bb=1;
  if(features.bbState==='BEAR_EXPANSION'||features.bbState==='UPPER_REJECTION'||features.bbState==='MID_REJECT')bb=-1;
  if(Number.isFinite(features.bbExpansion)&&features.bbExpansion>0&&Number.isFinite(features.bbZ))bb=clamp(bb+sign(features.bbZ)*.20,-1,1);
  add('BOLLINGER',bb,.85);

  // 3) Structure / breakout family
  let structure=String(features.structure||'').includes('BULL')?1:String(features.structure||'').includes('BEAR')?-1:0;
  let breakout=String(features.breakout||'').includes('BULL')?1:String(features.breakout||'').includes('BEAR')?-1:0;
  if(String(features.breakout||'').includes('FAILED BULL'))breakout=-1;
  if(String(features.breakout||'').includes('FAILED BEAR'))breakout=1;
  add('STRUCTURE',structure*.62+breakout*.38,1.05);

  // 4) Momentum / sequence family
  const mom=Number.isFinite(features.momentum)?features.momentum:0;
  const seq=Number.isFinite(features.sequence)?features.sequence:0;
  add('MOMENTUM',mom*.72+seq*.28,1.00);

  // 5) Liquidity / candle-pattern family
  let liq=features.liquidity==='SELL-SIDE SWEEP'?1:features.liquidity==='BUY-SIDE SWEEP'?-1:0;
  let pat=String(features.pattern||'').includes('BULL')?1:String(features.pattern||'').includes('BEAR')?-1:0;
  add('PRICE_ACTION',liq*.58+pat*.42,.90);

  // 6) Higher-timeframe family
  const mtf=[features.m5Context,features.m15Context,features.h1Context].filter(Number.isFinite);
  add('MTF',mtf.length?mtf.reduce((a,v)=>a+v,0)/mtf.length:0,1.10);

  // 7) Live tick/microstructure family when available
  let tick=0,tickWeight=0;
  if(Number.isFinite(features.forexTickPressure)){
    tick=features.forexTickPressure;
    if(features.forexTickAgreement===true)tick=clamp(tick*1.15,-1,1);
    if(features.fastTickWindowsAgree===true)tick=clamp(tick*1.12,-1,1);
    tickWeight=.95;
  }
  if(tickWeight)add('LIVE_TICKS',tick,tickWeight);

  // 8) Location/regime quality family. Penalize pushing directly into S/R in chop.
  let location=0;
  if(features.sr==='AT SUPPORT')location=.55;
  if(features.sr==='AT RESISTANCE')location=-.55;
  const eff=Number.isFinite(features.efficiency)?features.efficiency:0;
  const regimeScale=eff<.22?.72:eff>.42?1.08:1;
  add('LOCATION',location,.70);

  let aligned=0,opposed=0,weighted=0,total=0;
  for(const f of families){const directional=f.raw*d;weighted+=directional*f.weight;total+=f.weight;if(directional>=.22)aligned++;else if(directional<=-.22)opposed++;}
  const breadth=families.length?aligned/families.length:0;
  const conflict=families.length?opposed/families.length:0;
  let score=total?weighted/total:0;
  score*=regimeScale;
  // Reward broad independent-family agreement; penalize cross-family conflict.
  score+=breadth>=.67?.16:breadth>=.50?.08:0;
  score-=conflict>=.50?.18:conflict>=.34?.09:0;
  score=clamp(score,-1,1);

  // Influence remains horizon-aware. This is a model contribution, NOT probability points.
  const influence=({1:.24,2:.23,3:.21,5:.18,15:.14}[horizon]??.18);
  return{
    directionalScore:Number(score.toFixed(4)),
    influence,
    contribution:Number((score*influence).toFixed(4)),
    alignedFamilies:aligned,
    opposedFamilies:opposed,
    familyCount:families.length,
    breadth:Number(breadth.toFixed(3)),
    conflict:Number(conflict.toFixed(3)),
    regimeScale,
    families:families.map(f=>({name:f.name,score:Number(f.raw.toFixed(3)),weight:f.weight}))
  };
}
