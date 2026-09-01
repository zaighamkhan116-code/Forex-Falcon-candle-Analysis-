const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;

// Confirmation V2 scores independent evidence families. Candle anatomy/location and
// short micro-sequence behavior are expressed as 1-10 quality scores.
export function confirmationModelV2({features={},direction,horizon=1}){
  const d=direction==='BUY'?1:-1;
  const families=[];
  const add=(name,raw,weight)=>families.push({name,raw:clamp(raw,-1,1),weight});

  const stack=features.emaStack==='BULL'?1:features.emaStack==='BEAR'?-1:0;
  const slopes=[features.emaSlope5,features.emaSlope8,features.emaSlope13,features.emaSlope20].filter(Number.isFinite);
  const slopeVote=slopes.length?slopes.reduce((a,v)=>a+sign(v),0)/slopes.length:0;
  add('FAST_MA',stack*.62+slopeVote*.38,1.00);

  let bb=0;
  if(features.bbState==='BULL_EXPANSION'||features.bbState==='LOWER_REJECTION'||features.bbState==='MID_RECLAIM')bb=1;
  if(features.bbState==='BEAR_EXPANSION'||features.bbState==='UPPER_REJECTION'||features.bbState==='MID_REJECT')bb=-1;
  if(Number.isFinite(features.bbExpansion)&&features.bbExpansion>0&&Number.isFinite(features.bbZ))bb=clamp(bb+sign(features.bbZ)*.20,-1,1);
  add('BOLLINGER',bb,.85);

  let structure=String(features.structure||'').includes('BULL')?1:String(features.structure||'').includes('BEAR')?-1:0;
  let breakout=String(features.breakout||'').includes('BULL')?1:String(features.breakout||'').includes('BEAR')?-1:0;
  if(String(features.breakout||'').includes('FAILED BULL'))breakout=-1;
  if(String(features.breakout||'').includes('FAILED BEAR'))breakout=1;
  add('STRUCTURE',structure*.62+breakout*.38,1.05);

  const mom=Number.isFinite(features.momentum)?features.momentum:0;
  const seq=Number.isFinite(features.sequence)?features.sequence:0;
  add('MOMENTUM',mom*.72+seq*.28,1.00);

  let liq=features.liquidity==='SELL-SIDE SWEEP'?1:features.liquidity==='BUY-SIDE SWEEP'?-1:0;
  let pat=String(features.pattern||'').includes('BULL')?1:String(features.pattern||'').includes('BEAR')?-1:0;
  add('PRICE_ACTION',liq*.58+pat*.42,.90);

  const lower=Number.isFinite(features.lastLowerWickRatio)?features.lastLowerWickRatio:0;
  const upper=Number.isFinite(features.lastUpperWickRatio)?features.lastUpperWickRatio:0;
  const body=Number.isFinite(features.lastBodyRatio)?features.lastBodyRatio:0;
  const closePos=Number.isFinite(features.lastClosePosition)?features.lastClosePosition:.5;
  const atSupport=features.sr==='AT SUPPORT',atResistance=features.sr==='AT RESISTANCE';
  const bullLoc=atSupport||features.liquidity==='SELL-SIDE SWEEP'||features.bbState==='LOWER_REJECTION'||features.trendlineLocation==='SUPPORT';
  const bearLoc=atResistance||features.liquidity==='BUY-SIDE SWEEP'||features.bbState==='UPPER_REJECTION'||features.trendlineLocation==='RESISTANCE';
  let anatomyRaw=0,anatomyPoints=1,anatomyLabel='NEUTRAL';
  if(lower>=.30&&lower>upper*1.25&&bullLoc){
    anatomyPoints=4+(lower>=.45?2:0)+(closePos>=.60?1:0)+(body>=.25?1:0)+(features.liquidity==='SELL-SIDE SWEEP'?1:0)+((features.bbState==='LOWER_REJECTION'||features.trendlineLocation==='SUPPORT')?1:0);
    anatomyPoints=clamp(anatomyPoints,1,10);anatomyRaw=anatomyPoints/10;anatomyLabel='BULL_REJECTION';
  }else if(upper>=.30&&upper>lower*1.25&&bearLoc){
    anatomyPoints=4+(upper>=.45?2:0)+(closePos<=.40?1:0)+(body>=.25?1:0)+(features.liquidity==='BUY-SIDE SWEEP'?1:0)+((features.bbState==='UPPER_REJECTION'||features.trendlineLocation==='RESISTANCE')?1:0);
    anatomyPoints=clamp(anatomyPoints,1,10);anatomyRaw=-anatomyPoints/10;anatomyLabel='BEAR_REJECTION';
  }else if(body>=.55){
    const bodyDir=Number.isFinite(features.lastBodyDirection)?sign(features.lastBodyDirection):0;
    anatomyPoints=bodyDir?clamp(3+Math.round(body*4),1,7):1;anatomyRaw=bodyDir*(anatomyPoints/10);anatomyLabel=bodyDir>0?'BULL_BODY':bodyDir<0?'BEAR_BODY':'NEUTRAL';
  }else{
    const bullReject=features.pattern==='BULL REJECTION';
    const bearReject=features.pattern==='BEAR REJECTION';
    if(bullReject&&bullLoc){
      anatomyPoints=5+(atSupport?1:0)+(features.liquidity==='SELL-SIDE SWEEP'?2:0)+(features.bbState==='LOWER_REJECTION'?1:0);
      anatomyPoints=clamp(anatomyPoints,1,9);anatomyRaw=anatomyPoints/10;anatomyLabel='BULL_REJECTION';
    }else if(bearReject&&bearLoc){
      anatomyPoints=5+(atResistance?1:0)+(features.liquidity==='BUY-SIDE SWEEP'?2:0)+(features.bbState==='UPPER_REJECTION'?1:0);
      anatomyPoints=clamp(anatomyPoints,1,9);anatomyRaw=-anatomyPoints/10;anatomyLabel='BEAR_REJECTION';
    }else if(bullReject||bearReject){
      anatomyPoints=3;anatomyRaw=(bullReject?1:-1)*.3;anatomyLabel=bullReject?'BULL_REJECTION_UNLOCATED':'BEAR_REJECTION_UNLOCATED';
    }
  }
  add('CANDLE_LOCATION',anatomyRaw,1.05);

  // 3-4 candle micro-range / continuation model. The current live engine already
  // stores short sequence pressure; combine it with location and rejection state.
  // Repeated rejection at the same side of a range favors reversal away from that
  // boundary, while persistent same-direction bodies favor continuation if the
  // boundary is holding rather than rejecting price.
  let microRaw=0,microPoints=1,microLabel='NEUTRAL';
  const absSeq=Math.abs(seq);
  const sameDirectionPressure=absSeq>=.18;
  const strongPressure=absSeq>=.32;
  const upperReject=bearLoc&&(features.pattern==='BEAR REJECTION'||features.bbState==='UPPER_REJECTION'||features.liquidity==='BUY-SIDE SWEEP');
  const lowerReject=bullLoc&&(features.pattern==='BULL REJECTION'||features.bbState==='LOWER_REJECTION'||features.liquidity==='SELL-SIDE SWEEP');
  if(upperReject){
    microPoints=5+(atResistance?1:0)+(features.liquidity==='BUY-SIDE SWEEP'?2:0)+(features.bbState==='UPPER_REJECTION'?1:0)+(absSeq<.20?1:0);
    microPoints=clamp(microPoints,1,10);microRaw=-microPoints/10;microLabel='UPPER_ZONE_REJECTION';
  }else if(lowerReject){
    microPoints=5+(atSupport?1:0)+(features.liquidity==='SELL-SIDE SWEEP'?2:0)+(features.bbState==='LOWER_REJECTION'?1:0)+(absSeq<.20?1:0);
    microPoints=clamp(microPoints,1,10);microRaw=microPoints/10;microLabel='LOWER_ZONE_REJECTION';
  }else if(sameDirectionPressure){
    microPoints=4+(strongPressure?2:0)+(features.sr==='CLEAR'?1:0)+(Math.abs(mom)>=.25?1:0)+(stack==sign(seq)?1:0);
    microPoints=clamp(microPoints,1,9);microRaw=sign(seq)*microPoints/10;microLabel=seq>0?'BULL_SEQUENCE_CONTINUATION':'BEAR_SEQUENCE_CONTINUATION';
  }else if((anatomyLabel==='BULL_REJECTION'||anatomyLabel==='BEAR_REJECTION')&&absSeq<.12){
    microPoints=4;microRaw=anatomyRaw*.65;microLabel='RANGE_EDGE_REVERSAL';
  }
  add('MICRO_SEQUENCE',microRaw,1.00);

  const mtf=[features.m5Context,features.m15Context,features.h1Context].filter(Number.isFinite);
  add('MTF',mtf.length?mtf.reduce((a,v)=>a+v,0)/mtf.length:0,1.10);

  let tick=0,tickWeight=0;
  if(Number.isFinite(features.forexTickPressure)){tick=features.forexTickPressure;if(features.forexTickAgreement===true)tick=clamp(tick*1.15,-1,1);if(features.fastTickWindowsAgree===true)tick=clamp(tick*1.12,-1,1);tickWeight=.95;}
  if(tickWeight)add('LIVE_TICKS',tick,tickWeight);

  let location=0;if(features.sr==='AT SUPPORT')location=.55;if(features.sr==='AT RESISTANCE')location=-.55;
  const eff=Number.isFinite(features.efficiency)?features.efficiency:0;
  const regimeScale=eff<.22?.72:eff>.42?1.08:1;
  add('LOCATION',location,.70);

  let aligned=0,opposed=0,weighted=0,total=0;
  for(const f of families){const directional=f.raw*d;weighted+=directional*f.weight;total+=f.weight;if(directional>=.22)aligned++;else if(directional<=-.22)opposed++;}
  const breadth=families.length?aligned/families.length:0,conflict=families.length?opposed/families.length:0;
  let score=total?weighted/total:0;score*=regimeScale;score+=breadth>=.67?.16:breadth>=.50?.08:0;score-=conflict>=.50?.18:conflict>=.34?.09:0;score=clamp(score,-1,1);
  const influence=({1:.24,2:.23,3:.21,5:.18,15:.14}[horizon]??.18);
  return{directionalScore:Number(score.toFixed(4)),influence,contribution:Number((score*influence).toFixed(4)),alignedFamilies:aligned,opposedFamilies:opposed,familyCount:families.length,breadth:Number(breadth.toFixed(3)),conflict:Number(conflict.toFixed(3)),regimeScale,candleLocationScore:anatomyPoints,candleLocationBias:anatomyLabel,microSequenceScore:microPoints,microSequenceBias:microLabel,families:families.map(f=>({name:f.name,score:Number(f.raw.toFixed(3)),weight:f.weight}))};
}
