const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;

function labelStructure(s=''){s=String(s).toUpperCase();return s.includes('BULL')?1:s.includes('BEAR')?-1:0;}
function labelDirectional(s=''){s=String(s).toUpperCase();return s.includes('BULL')||s.includes('SELL-SIDE')||s.includes('FAILED BEAR')?1:s.includes('BEAR')||s.includes('BUY-SIDE')||s.includes('FAILED BULL')?-1:0;}

export function classifyRegime(features={}){
  const eff=Number(features.efficiency||0),mom=Number(features.momentum||0),trend=Number(features.trend||0);
  const rsi=Number(features.rsi||50),liq=String(features.liquidity||'NONE'),pat=String(features.pattern||'NONE'),br=String(features.breakout||'NONE'),sr=String(features.sr||'CLEAR');
  const sweep=liq!=='NONE',rejection=pat.includes('REJECTION'),failedBreak=br.includes('FAILED'),extreme=(rsi>=68||rsi<=32),atLevel=sr==='AT SUPPORT'||sr==='AT RESISTANCE';
  const reversalEvidence=(sweep?2:0)+(rejection?2:0)+(failedBreak?2:0)+(extreme?1:0)+(atLevel?1:0);
  const directionalAgreement=Math.abs(mom)+Math.abs(trend);
  if(reversalEvidence>=3)return{regime:'REVERSAL',strength:clamp(reversalEvidence/7,0,1),reason:'liquidity/rejection/exhaustion evidence'};
  if(eff>=.42&&directionalAgreement>=.65)return{regime:'TREND_CONTINUATION',strength:clamp((eff+directionalAgreement/2)/1.3,0,1),reason:'directional efficiency and momentum alignment'};
  return{regime:'CHOP_RANGE',strength:clamp(1-eff,0,1),reason:'low directional efficiency or mixed structure'};
}

export function trendContinuationEngine(features={}){
  const mom=Number(features.momentum||0),trend=Number(features.trend||0),seq=Number(features.sequence||0),tl=Number(features.trendline||0);
  const st=labelStructure(features.structure),fvg=labelDirectional(features.fvg),br=labelDirectional(features.breakout);
  const m5=Number(features.m5Context||0),m15=Number(features.m15Context||0),h1=Number(features.h1Context||0);
  const score=clamp(mom*.25+trend*.22+seq*.12+st*.12+fvg*.08+br*.08+tl*.04+m5*.05+m15*.025+h1*.015,-1,1);
  return{engine:'TREND_CONTINUATION',score,direction:score>=0?'BUY':'SELL',confidence:clamp(50+Math.abs(score)*24,50,74)};
}

export function reversalEngine(features={}){
  const liq=labelDirectional(features.liquidity),pat=labelDirectional(features.pattern),br=labelDirectional(features.breakout),sr=String(features.sr||'CLEAR');
  const rsi=Number(features.rsi||50),mom=Number(features.momentum||0),trend=Number(features.trend||0);
  let mean=0;if(rsi>=70)mean=-1;else if(rsi<=30)mean=1;else mean=clamp((50-rsi)/25,-1,1);
  let srScore=0;if(sr==='AT SUPPORT')srScore=1;else if(sr==='AT RESISTANCE')srScore=-1;
  const score=clamp(liq*.27+pat*.23+br*.20+srScore*.14+mean*.12-mom*.025-trend*.025,-1,1);
  return{engine:'REVERSAL',score,direction:score>=0?'BUY':'SELL',confidence:clamp(50+Math.abs(score)*22,50,72)};
}

export function chopRangeEngine(features={}){
  const rsi=Number(features.rsi||50),sr=String(features.sr||'CLEAR'),cp=Number(features.candlePressure||0),mom=Number(features.momentum||0);
  let mean=clamp((50-rsi)/28,-1,1),srScore=0;if(sr==='AT SUPPORT')srScore=1;else if(sr==='AT RESISTANCE')srScore=-1;
  const score=clamp(mean*.42+srScore*.28-cp*.16-mom*.14,-1,1);
  return{engine:'CHOP_RANGE',score,direction:score>=0?'BUY':'SELL',confidence:clamp(50+Math.abs(score)*18,50,68)};
}

export function evaluateSeparateEngines(features={}){
  const classification=classifyRegime(features),trend=trendContinuationEngine(features),reversal=reversalEngine(features),chop=chopRangeEngine(features);
  const selected=classification.regime==='TREND_CONTINUATION'?trend:classification.regime==='REVERSAL'?reversal:chop;
  return{classification,selected,candidates:{trend,reversal,chop}};
}
