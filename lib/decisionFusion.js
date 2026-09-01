const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const zoneMemory=new Map();
const key=(pair,h)=>`${String(pair||'').toUpperCase()}:${Number(h)||1}`;

function candleMetrics(c){
  if(!Array.isArray(c)||c.length<5)return null;
  const s=c.slice(-12),x=s.at(-1),rng=v=>Math.max(Number(v.high)-Number(v.low),1e-12),body=v=>Math.abs(Number(v.close)-Number(v.open))/rng(v),upper=v=>(Number(v.high)-Math.max(Number(v.open),Number(v.close)))/rng(v),lower=v=>(Math.min(Number(v.open),Number(v.close))-Number(v.low))/rng(v);
  const ranges=s.map(rng),bodies=s.map(body),avgRange=mean(ranges.slice(-8)),medianRange=[...ranges.slice(-10)].sort((a,b)=>a-b)[Math.floor(Math.min(9,ranges.length-1)/2)]||avgRange;
  return{x,rng,body,upper,lower,avgRange,medianRange,currentRange:rng(x),currentBody:body(x),currentUpper:upper(x),currentLower:lower(x)};
}

function moveQuality(features,c){
  const m=candleMetrics(c);if(!m)return{score:5,label:'UNKNOWN'};
  const eff=clamp(Number(features.efficiency||0),0,1),rangeRatio=clamp(m.currentRange/Math.max(m.medianRange,1e-12),0,2),body=m.currentBody,tickRel=Number(features.tickReliabilityScore||0)/10;
  let q=2.2+eff*3+clamp(rangeRatio-0.55,0,1.15)*1.7+body*1.6;
  if(tickRel>0)q+=tickRel*1.2;
  if(features.microRangeChop===true)q-=2;
  if(String(features.nextCandlePhase||'').includes('EXHAUSTION'))q-=1.5;
  q=clamp(q,1,10);
  return{score:Number(q.toFixed(1)),label:q>=7?'EXPANSION':q>=5?'TRADEABLE':'WEAK'};
}

function progressState(c){
  if(!Array.isArray(c)||c.length<5)return{score:0,label:'UNKNOWN',failure:false};
  const s=c.slice(-5),rng=v=>Math.max(Number(v.high)-Number(v.low),1e-12),body=v=>Math.abs(Number(v.close)-Number(v.open))/rng(v),upper=v=>(Number(v.high)-Math.max(Number(v.open),Number(v.close)))/rng(v),lower=v=>(Math.min(Number(v.open),Number(v.close))-Number(v.low))/rng(v),dir=v=>sign(Number(v.close)-Number(v.open));
  const last4=s.slice(-4),dirs=last4.map(dir),bulls=dirs.filter(v=>v>0).length,bears=dirs.filter(v=>v<0).length,b=last4.map(body),u=last4.map(upper),l=last4.map(lower),hiAdv=[1,2,3].map(i=>Number(last4[i].high)-Number(last4[i-1].high)),loAdv=[1,2,3].map(i=>Number(last4[i].low)-Number(last4[i-1].low));
  let score=0,label='MIXED',failure=false;
  if(bulls>=3){
    score=4+(hiAdv.filter(v=>v>0).length)+(b.at(-1)>b[0]?1:0)-(u.at(-1)>u[0]+.12?2:0);
    if(hiAdv.at(-1)<=0||b.at(-1)<b[0]*.7||u.at(-1)>.38){score-=4;failure=true;label='BULL_FAILURE_TO_PROGRESS'}else label='BULL_PROGRESS';
  }else if(bears>=3){
    score=-(4+(loAdv.filter(v=>v<0).length)+(b.at(-1)>b[0]?1:0)-(l.at(-1)>l[0]+.12?2:0));
    if(loAdv.at(-1)>=0||b.at(-1)<b[0]*.7||l.at(-1)>.38){score+=4;failure=true;label='BEAR_FAILURE_TO_PROGRESS'}else label='BEAR_PROGRESS';
  }
  return{score:Number(clamp(score,-10,10).toFixed(1)),label,failure};
}

function zoneContext(pair,horizon,c,atrValue){
  if(!Array.isArray(c)||c.length<12)return{side:'CLEAR',strength:1,rejections:0,level:null};
  const s=c.slice(-45),x=s.at(-1),atr=Math.max(Number(atrValue)||0,Math.abs(Number(x.close))*1e-6),tol=atr*.28;
  const highs=s.slice(0,-1).filter(v=>Math.abs(Number(v.high)-Number(x.close))<=tol),lows=s.slice(0,-1).filter(v=>Math.abs(Number(v.low)-Number(x.close))<=tol);
  let side='CLEAR',rejections=0,level=null;
  if(highs.length>=2&&highs.length>=lows.length){side='RESISTANCE';rejections=highs.length;level=mean(highs.map(v=>Number(v.high)))}
  else if(lows.length>=2){side='SUPPORT';rejections=lows.length;level=mean(lows.map(v=>Number(v.low)))}
  let strength=clamp(1+rejections*1.6,1,10);
  const k=key(pair,horizon),prev=zoneMemory.get(k);
  if(prev&&prev.side===side&&side!=='CLEAR'&&Math.abs(Number(prev.level)-Number(level))<=tol)strength=clamp(Math.max(strength,Number(prev.strength||1)+.4),1,10);
  const out={side,strength:Number(strength.toFixed(1)),rejections,level};zoneMemory.set(k,out);return out;
}

function tickReliability(result){
  const t=result?.forexTicks||{},f=result?.features||{};
  if(!t?.available)return{score:0,label:'UNAVAILABLE'};
  const count=clamp(Number(t.tickCount||0)/60,0,1),fresh=clamp(1-Number(t.ageMs||9999)/5000,0,1),spread=clamp(1-Math.abs(Number(t.spreadChange||0))/1.5,0,1),persist=clamp(Number(t.persistence||0),0,1),quality=clamp(Number(t.quality||0),0,1);
  const score=clamp((count*.18+fresh*.22+spread*.16+persist*.22+quality*.22)*10,1,10);
  return{score:Number(score.toFixed(1)),label:score>=7?'RELIABLE':score>=5?'USABLE':'WEAK'};
}

function groupedConsensus(result){
  const f=result?.features||{},rows=Array.isArray(f.confirmationV2Families)?f.confirmationV2Families:[];
  const by=Object.fromEntries(rows.map(x=>[x.name,Number(x.score||0)]));
  const avg=names=>{const a=names.map(n=>by[n]).filter(Number.isFinite);return a.length?mean(a):0};
  const groups={
    TREND:avg(['FAST_MA','MOMENTUM','MTF']),
    LOCATION:avg(['LOCATION','FVG_CONTEXT','BOLLINGER']),
    PRICE_ACTION:avg(['CANDLE_LOCATION','MICRO_SEQUENCE','PRICE_ACTION','STRUCTURE']),
    MICROSTRUCTURE:avg(['LIVE_TICKS'])
  };
  let bull=0,bear=0,bv=0,sv=0;for(const v of Object.values(groups)){if(v>=.18){bull+=v;bv++}else if(v<=-.18){bear+=-v;sv++}}
  const direction=bull>=bear?'BUY':'SELL',dominance=Math.abs(bull-bear),votes=direction==='BUY'?bv:sv,opposing=direction==='BUY'?sv:bv;
  return{groups,direction,bull:Number(bull.toFixed(3)),bear:Number(bear.toFixed(3)),dominance:Number(dominance.toFixed(3)),votes,opposing};
}

export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const c=bundle?.m1||[],features={...(result?.features||{})},dir0=String(result?.direction||'BUY').toUpperCase(),conf0=Number(result?.confidence||50),progress=progressState(c),tick=tickReliability(result),zone=zoneContext(pair,horizon,c,features.atr),mq=moveQuality({...features,tickReliabilityScore:tick.score},c),cons=groupedConsensus(result);
  let direction=dir0,confidence=conf0;
  const dirSign=direction==='BUY'?1:-1,progressAligned=progress.score*dirSign;
  if(progressAligned>=6)confidence+=3;else if(progressAligned<=-3)confidence-=5;
  if(mq.score>=7)confidence+=2;else if(mq.score<5)confidence-=4;
  if(zone.side==='RESISTANCE'&&direction==='BUY')confidence-=Math.min(6,zone.strength*.65);
  if(zone.side==='SUPPORT'&&direction==='SELL')confidence-=Math.min(6,zone.strength*.65);
  if(tick.score>0&&tick.score<5)confidence-=1.5;
  if(tick.score>=7&&features.forexTickAgreement===true)confidence+=2;
  if(cons.direction!==direction&&cons.votes>=2&&cons.dominance>=.35&&confidence<70){direction=cons.direction;confidence=Math.max(minimumConfidence,confidence-2+Math.min(8,cons.dominance*10));}
  else if(cons.direction===direction&&cons.votes>=3&&cons.opposing===0)confidence+=Math.min(6,2+cons.dominance*5);
  confidence=clamp(confidence,50,85);
  const qualityGate=mq.score>=4.5 || (zone.strength>=7&&((zone.side==='SUPPORT'&&direction==='BUY')||(zone.side==='RESISTANCE'&&direction==='SELL')));
  const qualified=confidence>=minimumConfidence&&qualityGate;
  return{...result,direction,confidence:Number(confidence.toFixed(1)),qualified,minimumConfidence,engine:`${result?.engine||'TECHNICAL'}+FUSION_V1`,features:{...features,moveQualityScore:mq.score,moveQualityState:mq.label,progressScore:progress.score,progressState:progress.label,failureToProgress:progress.failure,dynamicZoneSide:zone.side,dynamicZoneStrength:zone.strength,dynamicZoneRejections:zone.rejections,dynamicZoneLevel:zone.level,tickReliabilityScore:tick.score,tickReliabilityState:tick.label,groupConsensusDirection:cons.direction,groupConsensusVotes:cons.votes,groupOpposingVotes:cons.opposing,groupBullStrength:cons.bull,groupBearStrength:cons.bear,groupDominance:cons.dominance,groupScores:cons.groups,preFusionConfidence:Number(conf0.toFixed(1)),postFusionConfidence:Number(confidence.toFixed(1)),fusionQualityGate:qualityGate}};
}
