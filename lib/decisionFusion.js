const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const zoneMemory=new Map();
const key=(pair,h)=>`${String(pair||'').toUpperCase()}:${Number(h)||1}`;

function candleMetrics(c){
  if(!Array.isArray(c)||c.length<5)return null;
  const s=c.slice(-12),x=s.at(-1),rng=v=>Math.max(Number(v.high)-Number(v.low),1e-12),body=v=>Math.abs(Number(v.close)-Number(v.open))/rng(v),upper=v=>(Number(v.high)-Math.max(Number(v.open),Number(v.close)))/rng(v),lower=v=>(Math.min(Number(v.open),Number(v.close))-Number(v.low))/rng(v);
  const ranges=s.map(rng),avgRange=mean(ranges.slice(-8)),medianRange=[...ranges.slice(-10)].sort((a,b)=>a-b)[Math.floor(Math.min(9,ranges.length-1)/2)]||avgRange;
  return{x,rng,body,upper,lower,avgRange,medianRange,currentRange:rng(x),currentBody:body(x),currentUpper:upper(x),currentLower:lower(x)};
}

function phaseState(pair,horizon,c,direction){
  pair=String(pair||'').toUpperCase();
  if(!Array.isArray(c)||c.length<4)return{phase:'INSUFFICIENT_SEQUENCE',phaseScore:0,exhaustionPenalty:0,zonePenalty:0,chopPenalty:0,breakoutAccepted:false,repeatedUpper:false,repeatedLower:false,chop:false,bullExtended:false,bearExtended:false,lastBodyRatio:null,lastUpperWickRatio:null,lastLowerWickRatio:null};
  const s=c.slice(-5),last=s.at(-1),prev=s.slice(0,-1),rng=x=>Math.max(Number(x.high)-Number(x.low),1e-12),body=x=>Math.abs(Number(x.close)-Number(x.open))/rng(x),upper=x=>(Number(x.high)-Math.max(Number(x.open),Number(x.close)))/rng(x),lower=x=>(Math.min(Number(x.open),Number(x.close))-Number(x.low))/rng(x),dir=x=>sign(Number(x.close)-Number(x.open));
  const avgRange=s.reduce((a,x)=>a+rng(x),0)/s.length,tol=Math.max(avgRange*.28,Math.abs(Number(last.close))*1e-7),dirs=s.slice(-4).map(dir),bulls=dirs.filter(x=>x>0).length,bears=dirs.filter(x=>x<0).length,net=(Number(last.close)-Number(s.at(-4).open))/avgRange;
  const priorHigh=Math.max(...prev.map(x=>Number(x.high))),priorLow=Math.min(...prev.map(x=>Number(x.low))),lastBody=body(last),lastUpper=upper(last),lastLower=lower(last);
  const bullAcceptance=Number(last.close)>priorHigh&&lastBody>=.45,bearAcceptance=Number(last.close)<priorLow&&lastBody>=.45,breakoutAccepted=bullAcceptance||bearAcceptance;
  let upperTouches=0,lowerTouches=0;for(let i=0;i<s.length;i++){for(let j=i+1;j<s.length;j++){if(Math.abs(Number(s[i].high)-Number(s[j].high))<=tol){upperTouches++;break}if(Math.abs(Number(s[i].low)-Number(s[j].low))<=tol){lowerTouches++;break}}}
  const repeatedUpper=upperTouches>=2,repeatedLower=lowerTouches>=2,overlapHigh=Math.min(...s.slice(-4).map(x=>Number(x.high))),overlapLow=Math.max(...s.slice(-4).map(x=>Number(x.low))),overlap=Math.max(0,overlapHigh-overlapLow)/avgRange,avgBody=s.slice(-4).reduce((a,x)=>a+body(x),0)/4,chop=overlap>=.20&&avgBody<=.38,bullExtended=bulls>=3&&net>=1.35,bearExtended=bears>=3&&net<=-1.35;
  let exhaustionPenalty=0,zonePenalty=0,chopPenalty=0,phase='CONTINUATION',phaseScore=5;
  const sameExtension=(direction==='BUY'&&bullExtended)||(direction==='SELL'&&bearExtended),oppositeWick=direction==='BUY'?lastUpper:lastLower,isGBP=pair==='GBPUSD',isEUR=pair==='EURUSD';
  if(sameExtension&&!breakoutAccepted){exhaustionPenalty=isEUR?4:5;phase='EXTENDED';phaseScore=6;if(oppositeWick>=.32){exhaustionPenalty+=isEUR?5:6;phase='PULLBACK_RISK';phaseScore=8}if(oppositeWick>=.48){exhaustionPenalty+=2;phase='EXHAUSTION_REJECTION';phaseScore=9}}
  if(direction==='BUY'&&repeatedUpper&&!bullAcceptance){zonePenalty=isGBP?8:6;phase='UPPER_ZONE_REJECTION';phaseScore=Math.max(phaseScore,8);if(lastUpper>=.35)zonePenalty+=3}
  if(direction==='SELL'&&repeatedLower&&!bearAcceptance){zonePenalty=isGBP?8:6;phase='LOWER_ZONE_REJECTION';phaseScore=Math.max(phaseScore,8);if(lastLower>=.35)zonePenalty+=3}
  if(chop&&!breakoutAccepted){chopPenalty=isGBP?7:4;phase='MICRO_RANGE_CHOP';phaseScore=Math.max(phaseScore,7)}
  if(direction==='BUY'&&bullAcceptance){phase='BULL_BREAKOUT_ACCEPTED';phaseScore=8;exhaustionPenalty=Math.max(0,exhaustionPenalty-5);zonePenalty=0;chopPenalty=0}
  if(direction==='SELL'&&bearAcceptance){phase='BEAR_BREAKOUT_ACCEPTED';phaseScore=8;exhaustionPenalty=Math.max(0,exhaustionPenalty-5);zonePenalty=0;chopPenalty=0}
  const scale={1:1,2:.90,3:.80,5:.65,15:.45}[Number(horizon)]||.8;
  return{phase,phaseScore,exhaustionPenalty:Number((exhaustionPenalty*scale).toFixed(1)),zonePenalty:Number((zonePenalty*scale).toFixed(1)),chopPenalty:Number((chopPenalty*scale).toFixed(1)),breakoutAccepted,repeatedUpper,repeatedLower,chop,bullExtended,bearExtended,lastBodyRatio:Number(lastBody.toFixed(3)),lastUpperWickRatio:Number(lastUpper.toFixed(3)),lastLowerWickRatio:Number(lastLower.toFixed(3))};
}

function moveQuality(features,c){
  const m=candleMetrics(c);if(!m)return{score:5,label:'UNKNOWN'};
  const eff=clamp(Number(features.efficiency||0),0,1),rangeRatio=clamp(m.currentRange/Math.max(m.medianRange,1e-12),0,2),body=m.currentBody,tickRel=Number(features.tickReliabilityScore||0)/10;
  let q=2.2+eff*3+clamp(rangeRatio-0.55,0,1.15)*1.7+body*1.6;if(tickRel>0)q+= tickRel*1.2;if(features.microRangeChop===true)q-=2;if(String(features.nextCandlePhase||'').includes('EXHAUSTION'))q-=1.5;q=clamp(q,1,10);return{score:Number(q.toFixed(1)),label:q>=7?'EXPANSION':q>=5?'TRADEABLE':'WEAK'};
}

function progressState(c){
  if(!Array.isArray(c)||c.length<5)return{score:0,label:'UNKNOWN',failure:false};
  const s=c.slice(-5),rng=v=>Math.max(Number(v.high)-Number(v.low),1e-12),body=v=>Math.abs(Number(v.close)-Number(v.open))/rng(v),upper=v=>(Number(v.high)-Math.max(Number(v.open),Number(v.close)))/rng(v),lower=v=>(Math.min(Number(v.open),Number(v.close))-Number(v.low))/rng(v),dir=v=>sign(Number(v.close)-Number(v.open));
  const last4=s.slice(-4),dirs=last4.map(dir),bulls=dirs.filter(v=>v>0).length,bears=dirs.filter(v=>v<0).length,b=last4.map(body),u=last4.map(upper),l=last4.map(lower),hiAdv=[1,2,3].map(i=>Number(last4[i].high)-Number(last4[i-1].high)),loAdv=[1,2,3].map(i=>Number(last4[i].low)-Number(last4[i-1].low));
  let score=0,label='MIXED',failure=false;if(bulls>=3){score=4+hiAdv.filter(v=>v>0).length+(b.at(-1)>b[0]?1:0)-(u.at(-1)>u[0]+.12?2:0);if(hiAdv.at(-1)<=0||b.at(-1)<b[0]*.7||u.at(-1)>.38){score-=4;failure=true;label='BULL_FAILURE_TO_PROGRESS'}else label='BULL_PROGRESS'}else if(bears>=3){score=-(4+loAdv.filter(v=>v<0).length+(b.at(-1)>b[0]?1:0)-(l.at(-1)>l[0]+.12?2:0));if(loAdv.at(-1)>=0||b.at(-1)<b[0]*.7||l.at(-1)>.38){score+=4;failure=true;label='BEAR_FAILURE_TO_PROGRESS'}else label='BEAR_PROGRESS'}return{score:Number(clamp(score,-10,10).toFixed(1)),label,failure};
}

function zoneContext(pair,horizon,c,atrValue){
  if(!Array.isArray(c)||c.length<12)return{side:'CLEAR',strength:1,rejections:0,level:null};
  const s=c.slice(-45),x=s.at(-1),atr=Math.max(Number(atrValue)||0,Math.abs(Number(x.close))*1e-6),tol=atr*.28,highs=s.slice(0,-1).filter(v=>Math.abs(Number(v.high)-Number(x.close))<=tol),lows=s.slice(0,-1).filter(v=>Math.abs(Number(v.low)-Number(x.close))<=tol);let side='CLEAR',rejections=0,level=null;if(highs.length>=2&&highs.length>=lows.length){side='RESISTANCE';rejections=highs.length;level=mean(highs.map(v=>Number(v.high)))}else if(lows.length>=2){side='SUPPORT';rejections=lows.length;level=mean(lows.map(v=>Number(v.low)))}let strength=clamp(1+rejections*1.6,1,10);const k=key(pair,horizon),prev=zoneMemory.get(k);if(prev&&prev.side===side&&side!=='CLEAR'&&Math.abs(Number(prev.level)-Number(level))<=tol)strength=clamp(Math.max(strength,Number(prev.strength||1)+.4),1,10);const out={side,strength:Number(strength.toFixed(1)),rejections,level};zoneMemory.set(k,out);return out;
}

function tickReliability(result){
  const t=result?.forexTicks||{};if(!t?.available)return{score:0,label:'UNAVAILABLE'};const count=clamp(Number(t.tickCount||0)/60,0,1),fresh=clamp(1-Number(t.ageMs||9999)/5000,0,1),spread=clamp(1-Math.abs(Number(t.spreadChange||0))/1.5,0,1),persist=clamp(Number(t.persistence||0),0,1),quality=clamp(Number(t.quality||0),0,1),score=clamp((count*.18+fresh*.22+spread*.16+persist*.22+quality*.22)*10,1,10);return{score:Number(score.toFixed(1)),label:score>=7?'RELIABLE':score>=5?'USABLE':'WEAK'};
}

function groupedConsensus(result){
  const f=result?.features||{},rows=Array.isArray(f.confirmationV2Families)?f.confirmationV2Families:[],by=Object.fromEntries(rows.map(x=>[x.name,Number(x.score||0)])),avg=names=>{const a=names.map(n=>by[n]).filter(Number.isFinite);return a.length?mean(a):0},groups={TREND:avg(['FAST_MA','MOMENTUM','MTF']),LOCATION:avg(['LOCATION','FVG_CONTEXT','BOLLINGER']),PRICE_ACTION:avg(['CANDLE_LOCATION','MICRO_SEQUENCE','PRICE_ACTION','STRUCTURE']),MICROSTRUCTURE:avg(['LIVE_TICKS'])};let bull=0,bear=0,bv=0,sv=0;for(const v of Object.values(groups)){if(v>=.18){bull+=v;bv++}else if(v<=-.18){bear+=-v;sv++}}const direction=bull>=bear?'BUY':'SELL',dominance=Math.abs(bull-bear),votes=direction==='BUY'?bv:sv,opposing=direction==='BUY'?sv:bv;return{groups,direction,bull:Number(bull.toFixed(3)),bear:Number(bear.toFixed(3)),dominance:Number(dominance.toFixed(3)),votes,opposing};
}

export function fuseDecision(result,bundle,pair,horizon=1,minimumConfidence=62){
  const c=bundle?.m1||[],baseFeatures={...(result?.features||{})},dir0=String(result?.direction||'BUY').toUpperCase(),conf0=Number(result?.confidence||50),phase=phaseState(pair,horizon,c,dir0);
  const phasePenaltyRaw=phase.exhaustionPenalty+phase.zonePenalty+phase.chopPenalty;
  const phasePenalty=clamp(Math.max(phase.exhaustionPenalty,phase.zonePenalty,phase.chopPenalty)+Math.min(3,(phasePenaltyRaw-Math.max(phase.exhaustionPenalty,phase.zonePenalty,phase.chopPenalty))*.25),0,10);
  let direction=dir0,confidence=conf0-phasePenalty;
  let features={...baseFeatures,nextCandlePhase:phase.phase,nextCandlePhaseScore:phase.phaseScore,prePhaseConfidence:Number(conf0.toFixed(1)),phaseAdjustedConfidence:Number(confidence.toFixed(1)),exhaustionPenalty:phase.exhaustionPenalty,zoneRejectionPenalty:phase.zonePenalty,microRangePenalty:phase.chopPenalty,mergedPhasePenalty:Number(phasePenalty.toFixed(1)),breakoutAccepted:phase.breakoutAccepted,repeatedUpperZone:phase.repeatedUpper,repeatedLowerZone:phase.repeatedLower,microRangeChop:phase.chop,bullExtended:phase.bullExtended,bearExtended:phase.bearExtended,lastBodyRatio:phase.lastBodyRatio,lastUpperWickRatio:phase.lastUpperWickRatio,lastLowerWickRatio:phase.lastLowerWickRatio};
  const progress=progressState(c),tick=tickReliability({...result,features}),zone=zoneContext(pair,horizon,c,features.atr),mq=moveQuality({...features,tickReliabilityScore:tick.score},c),cons=groupedConsensus({...result,features});
  const dirSign0=direction==='BUY'?1:-1,progressAligned=progress.score*dirSign0;
  let qualityAdjustment=0,locationAdjustment=0,tickAdjustment=0,consensusAdjustment=0;
  if(progressAligned>=6)qualityAdjustment+=2.5;else if(progressAligned<=-3)qualityAdjustment-=Math.min(3.5,1.5+Math.abs(progressAligned)*.35);
  if(mq.score>=7)qualityAdjustment+=1.8;else if(mq.score<5)qualityAdjustment-=Math.min(2.5,(5-mq.score)*1.2);
  const adverseZone=(zone.side==='RESISTANCE'&&direction==='BUY')||(zone.side==='SUPPORT'&&direction==='SELL');
  if(adverseZone)locationAdjustment-=Math.min(4.5,zone.strength*.5);
  if(tick.score>0&&tick.score<5)tickAdjustment-=1;else if(tick.score>=7&&features.forexTickAgreement===true)tickAdjustment+=1.8;
  if(cons.direction!==direction&&cons.votes>=2&&cons.dominance>=.35&&confidence<70){direction=cons.direction;consensusAdjustment+=Math.min(6,1.5+cons.dominance*6)}
  else if(cons.direction===direction&&cons.votes>=2){consensusAdjustment+=Math.min(5,cons.votes*.8+cons.dominance*4)-(cons.opposing>0?1:0)}
  const correlatedNegative=Math.abs(Math.min(0,qualityAdjustment))+Math.abs(Math.min(0,locationAdjustment))+Math.abs(Math.min(0,tickAdjustment));
  const independentPositive=Math.max(0,qualityAdjustment)+Math.max(0,tickAdjustment)+Math.max(0,consensusAdjustment);
  const cappedNegative=Math.min(7,correlatedNegative);
  const offset=Math.min(cappedNegative*.65,independentPositive);
  const totalAdjustment=clamp(-phasePenalty-cappedNegative+offset+independentPositive, -12, 12);
  confidence=clamp(conf0+totalAdjustment,50,85);
  const qualityGate=mq.score>=4.3||(zone.strength>=7&&((zone.side==='SUPPORT'&&direction==='BUY')||(zone.side==='RESISTANCE'&&direction==='SELL')))||(cons.direction===direction&&cons.votes>=3&&cons.opposing<=1);
  const qualified=confidence>=minimumConfidence;
  features={...features,moveQualityScore:mq.score,moveQualityState:mq.label,progressScore:progress.score,progressState:progress.label,failureToProgress:progress.failure,dynamicZoneSide:zone.side,dynamicZoneStrength:zone.strength,dynamicZoneRejections:zone.rejections,dynamicZoneLevel:zone.level,tickReliabilityScore:tick.score,tickReliabilityState:tick.label,groupConsensusDirection:cons.direction,groupConsensusVotes:cons.votes,groupOpposingVotes:cons.opposing,groupBullStrength:cons.bull,groupBearStrength:cons.bear,groupDominance:cons.dominance,groupScores:cons.groups,qualityAdjustment:Number(qualityAdjustment.toFixed(1)),locationAdjustment:Number(locationAdjustment.toFixed(1)),tickAdjustment:Number(tickAdjustment.toFixed(1)),consensusAdjustment:Number(consensusAdjustment.toFixed(1)),cappedNegativeAdjustment:Number(cappedNegative.toFixed(1)),positiveOffset:Number(offset.toFixed(1)),totalFusionAdjustment:Number(totalAdjustment.toFixed(1)),preFusionConfidence:Number(conf0.toFixed(1)),postFusionConfidence:Number(confidence.toFixed(1)),fusionQualityGate:qualityGate,qualityGateDiagnosticOnly:true,sharedDecisionPath:true,confidenceCompressionFix:true};
  return{...result,direction,confidence:Number(confidence.toFixed(1)),qualified,minimumConfidence,engine:`${result?.engine||'TECHNICAL'}+FUSION_V2_2`,features};
}
