import * as signalR from '@microsoft/signalr';

const FOREX_SYMBOLS=['EURUSD','EURJPY','GBPUSD','AUDJPY','AUDUSD','USDJPY','NZDCHF','GBPCAD','AUDCHF','AUDNZD'];
const buffers=new Map();
let connection=null,started=false,lastError=null,lastConnectedAt=null,lastTickAt=null,reconnects=0;
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2};
const sign=v=>v>0?1:v<0?-1:0;

function pushTick(t){
  const symbol=String(t?.symbol||'').toUpperCase();
  if(!FOREX_SYMBOLS.includes(symbol))return;
  const bid=Number(t.bid),ask=Number(t.ask),mid=Number(t.mid??((bid+ask)/2)),ts=Date.parse(t.timestamp)||Date.now();
  if(![bid,ask,mid].every(Number.isFinite))return;
  const row={symbol,bid,ask,mid,spread:Number.isFinite(Number(t.spread))?Number(t.spread):Math.max(ask-bid,0),ts},b=buffers.get(symbol)||[];
  b.push(row);buffers.set(symbol,b.slice(-5000));lastTickAt=Date.now();
}

export async function startForexTickStream(){
  if(started)return;started=true;
  connection=new signalR.HubConnectionBuilder().withUrl('https://biquote.io/hubs/tick').withAutomaticReconnect([0,2000,5000,10000,30000]).configureLogging(signalR.LogLevel.Warning).build();
  connection.on('ReceiveTick',pushTick);
  connection.onreconnecting(e=>{lastError=e?.message||'reconnecting';reconnects+=1});
  connection.onreconnected(async()=>{lastConnectedAt=Date.now();lastError=null;try{await connection.invoke('Subscribe',FOREX_SYMBOLS)}catch(e){lastError=e.message}});
  connection.onclose(e=>{lastError=e?.message||'closed';started=false;setTimeout(()=>startForexTickStream().catch(()=>{}),10000)});
  try{await connection.start();lastConnectedAt=Date.now();lastError=null;await connection.invoke('Subscribe',FOREX_SYMBOLS)}catch(e){lastError=e.message;started=false;setTimeout(()=>startForexTickStream().catch(()=>{}),10000)}
}

export function getForexLivePrice(pair,maxAgeMs=5000){
  const symbol=String(pair||'').toUpperCase();if(!FOREX_SYMBOLS.includes(symbol))return null;
  const row=(buffers.get(symbol)||[]).at(-1);if(!row)return null;
  const ageMs=Date.now()-row.ts;if(ageMs>maxAgeMs)return null;
  return{price:row.mid,bid:row.bid,ask:row.ask,mid:row.mid,spread:row.spread,time:row.ts,ageMs,source:'BIQUOTE_SIGNALR_TICK'};
}

function rowsIn(symbol,ms){const b=buffers.get(symbol)||[],cut=Date.now()-ms;return b.filter(x=>x.ts>=cut)}
function metrics(rows){
  if(rows.length<3)return null;
  const first=rows[0],last=rows.at(-1),moves=[];
  for(let i=1;i<rows.length;i++)moves.push(rows[i].mid-rows[i-1].mid);
  const up=moves.filter(x=>x>0).length,down=moves.filter(x=>x<0).length,imb=(up-down)/(up+down+1e-12),net=(last.mid-first.mid)/(first.mid||1),path=moves.reduce((a,x)=>a+Math.abs(x),0)/(first.mid||1),eff=Math.abs(net)/(path+1e-12),directional=clamp(sign(net)*eff*.7+imb*.3);
  return{net,path,eff,imb,directional,ticks:rows.length,first,last};
}
function segment(symbol,ms){return metrics(rowsIn(symbol,ms))}

function adaptiveRateBaseline(symbol){
  const now=Date.now(),history=(buffers.get(symbol)||[]).filter(x=>x.ts>=now-330000&&x.ts<now-30000);
  if(history.length<12)return null;
  const buckets=new Map();
  for(const x of history){const k=Math.floor(x.ts/30000);buckets.set(k,(buckets.get(k)||0)+1)}
  const rates=[...buckets.values()].map(n=>n/30).filter(v=>v>0);
  return rates.length?median(rates):null;
}

function continuityScore(rows,baselineRate){
  if(rows.length<4)return 0.25;
  const gaps=[];for(let i=1;i<rows.length;i++)gaps.push(Math.max(0,rows[i].ts-rows[i-1].ts));
  const med=median(gaps),sorted=[...gaps].sort((a,b)=>a-b),p90=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.9))]||med;
  const expectedGap=1000/Math.max(baselineRate||rows.length/60,.15);
  const medScore=clamp(1-(med-expectedGap*1.5)/(expectedGap*5),0,1),tailScore=clamp(1-(p90-expectedGap*3)/(expectedGap*10),0,1);
  return clamp(medScore*.55+tailScore*.45,0,1);
}

function spreadHealth(symbol,currentSpread){
  const now=Date.now(),history=(buffers.get(symbol)||[]).filter(x=>x.ts>=now-330000&&x.ts<now-30000&&Number.isFinite(x.spread)&&x.spread>=0),base=median(history.map(x=>x.spread));
  if(!(base>0))return{score:0.7,baseline:null,ratio:null};
  const ratio=currentSpread/(base+1e-12),score=clamp(1-Math.max(0,ratio-1)*.55,0,1);
  return{score,baseline:base,ratio};
}

export function getForexTickConfirmation(pair){
  const symbol=String(pair||'').toUpperCase();if(!FOREX_SYMBOLS.includes(symbol))return null;
  const r30=rowsIn(symbol,30000),r60=rowsIn(symbol,60000),m30=metrics(r30),m60=metrics(r60);
  if(!m30)return{available:false,symbol,tickCount:r30.length,ageMs:r30.length?Date.now()-r30.at(-1).ts:null};
  const m5=segment(symbol,5000),m10=segment(symbol,10000),m20=segment(symbol,20000),last=m30.last,spreads=r30.map(x=>x.spread),spreadMean=mean(spreads),spreadChange=(last.spread-spreadMean)/(Math.abs(spreadMean)+1e-12),tickRate=r30.length/30,d5=m5?.directional||0,d10=m10?.directional||0,d20=m20?.directional||0,d30=m30.directional||0,d60=m60?.directional||d30;
  const acceleration=clamp((d5-d20)*.65+(d10-d30)*.35),reversal=sign(d5)!==0&&sign(d20)!==0&&sign(d5)!==sign(d20)&&Math.abs(d5)>.25&&Math.abs(d20)>.25,persistence=[d5,d10,d20,d30,d60].filter(v=>sign(v)===sign(d5)&&sign(v)!==0).length/5,spreadPenalty=Math.max(0,clamp(spreadChange,0,1)),pressure=clamp(d5*.30+d10*.25+d20*.18+d30*.13+d60*.08+acceleration*.12-spreadPenalty*sign(d5)*.06),direction=pressure>=0?'BUY':'SELL';
  const baselineRate=adaptiveRateBaseline(symbol),effectiveBaseline=Math.max(baselineRate||tickRate||.15,.15),densityScore=clamp(tickRate/(effectiveBaseline*.75),0,1),ageMs=Date.now()-last.ts,freshnessScore=clamp(1-ageMs/6000,0,1),continuity=continuityScore(r60,effectiveBaseline),spread=spreadHealth(symbol,last.spread),feedReliability=clamp(freshnessScore*.30+densityScore*.25+continuity*.25+spread.score*.20,0,1);
  const windows=[d5,d10,d20,d30,d60],nonZero=windows.filter(v=>sign(v)!==0),windowAgreement=nonZero.length?nonZero.filter(v=>sign(v)===sign(pressure)).length/nonZero.length:0,directionalQuality=clamp(Math.abs(pressure)*.40+persistence*.25+(m30.eff||0)*.15+windowAgreement*.10+(reversal?0:.10),0,1);
  return{available:true,source:'BIQUOTE_SIGNALR',symbol,timestamp:Date.now(),lastTickAt:last.ts,ageMs,bid:last.bid,ask:last.ask,mid:last.mid,spread:last.spread,tickCount:r30.length,tickCount60s:r60.length,tickRate:Number(tickRate.toFixed(2)),adaptiveTickRateBaseline:Number(effectiveBaseline.toFixed(2)),tickDensityScore:Number(densityScore.toFixed(3)),continuityScore:Number(continuity.toFixed(3)),freshnessScore:Number(freshnessScore.toFixed(3)),spreadBaseline:spread.baseline==null?null:Number(spread.baseline.toFixed(8)),spreadRatio:spread.ratio==null?null:Number(spread.ratio.toFixed(3)),spreadHealthScore:Number(spread.score.toFixed(3)),feedReliability:Number(feedReliability.toFixed(3)),directionQuality:Number(directionalQuality.toFixed(3)),tickImbalance:Number(m30.imb.toFixed(3)),net30s:Number(m30.net.toFixed(8)),efficiency:Number(m30.eff.toFixed(3)),pressure5s:Number(d5.toFixed(3)),pressure10s:Number(d10.toFixed(3)),pressure20s:Number(d20.toFixed(3)),pressure30s:Number(d30.toFixed(3)),pressure60s:Number(d60.toFixed(3)),acceleration:Number(acceleration.toFixed(3)),persistence:Number(persistence.toFixed(2)),windowAgreement:Number(windowAgreement.toFixed(2)),reversal,spreadChange:Number(spreadChange.toFixed(3)),pressure:Number(pressure.toFixed(3)),direction,quality:Number(directionalQuality.toFixed(3))};
}

function scoreFromEvidence(a){a=Math.abs(a);if(a<.15)return 50+a/.15*5;if(a<.30)return 55+(a-.15)/.15*5;if(a<.48)return 60+(a-.30)/.18*6;if(a<.66)return 66+(a-.48)/.18*6;if(a<.82)return 72+(a-.66)/.16*4;return 76+Math.min(3,(a-.82)/.18*3)}
function signedContext(v,dir){v=Number(v);return Number.isFinite(v)?clamp(v*dir,-1,1):0}

export function applyForexTickConfirmation(result,tick,horizon=1){
  if(!tick?.available)return{...result,features:{...(result.features||{}),forexTickStatus:'WARMING_OR_UNAVAILABLE'}};
  const h=Number(horizon)||1,weights={1:[.58,.42],2:[.64,.36],3:[.69,.31],5:[.76,.24],15:[.84,.16]}[h]||[.69,.31],techDir=result.direction==='BUY'?1:-1,tickDir=tick.direction==='BUY'?1:-1,baseConf=Number(result.confidence||50),techStrength=clamp((baseConf-50)/32,0,1),feedReliability=clamp(Number(tick.feedReliability??.5),0,1),directionQuality=clamp(Number(tick.directionQuality??tick.quality??0),0,1),tickStrength=clamp(Math.abs(tick.pressure)*(.70+.30*directionQuality)*(.45+.55*feedReliability),0,1),f=result.features||{};
  let evidence=techDir*techStrength*weights[0]+tickDir*tickStrength*weights[1];
  const mtfVals=[signedContext(f.m5Context,techDir),signedContext(f.m15Context,techDir),signedContext(f.h1Context,techDir)],mtfAgree=mtfVals.filter(v=>v>.10).length,mtfOppose=mtfVals.filter(v=>v<-.10).length,agreement=techDir===tickDir,fastAgree=sign(tick.pressure5s)===tickDir&&sign(tick.pressure10s)===tickDir,allWindowsAgree=[tick.pressure5s,tick.pressure10s,tick.pressure20s,tick.pressure30s,tick.pressure60s].filter(Number.isFinite).every(v=>sign(v)===tickDir);
  if(agreement)evidence+=tickDir*(directionQuality*.045+tick.persistence*.030)*feedReliability;
  if(allWindowsAgree)evidence+=tickDir*.05*feedReliability;else if(fastAgree)evidence+=tickDir*.022*feedReliability;
  if(mtfAgree>=2)evidence+=techDir*(h<=3?.045:.065);if(mtfOppose>=2)evidence-=techDir*(h<=3?.055:.075);
  if(tick.reversal)evidence*=.72;if(!agreement&&Math.abs(tick.pressure)>.50&&directionQuality>.42&&feedReliability>=.55)evidence+=tickDir*.10;
  if(feedReliability<.35)evidence=techDir*(Math.abs(evidence)*.72);else if(feedReliability<.55)evidence*=.90;
  evidence=clamp(evidence,-1,1);
  const direction=evidence>=0?'BUY':'SELL';let confidence=scoreFromEvidence(evidence),qualityScore=clamp(Math.abs(evidence)*.52+directionQuality*.16+feedReliability*.14+tick.persistence*.08+(allWindowsAgree?.06:0)+(mtfAgree>=2?.06:0)-(tick.reversal?.12:0)-(mtfOppose>=2?.08:0),0,1);
  if(direction!==(techDir>0?'BUY':'SELL')&&Math.abs(evidence)<.34)confidence=Math.min(confidence,59.4);confidence=clamp(confidence,50,h===1?79:77);
  return{...result,direction,confidence:Number(confidence.toFixed(1)),qualityScore:Number((qualityScore*100).toFixed(1)),evidenceScore:Number(evidence.toFixed(4)),engine:`${result.engine||'TECHNICAL'}+LIVE_TICKS_V4`,probabilityType:'evidence-score-v4-forward-calibration-pending',forexTicks:tick,features:{...f,forexTickPressure:tick.pressure,forexTickDirection:tick.direction,forexTickQuality:directionQuality,forexTickFeedReliability:feedReliability,forexTickDirectionQuality:directionQuality,tickFeedReliabilityScore:Number((feedReliability*10).toFixed(1)),tickDirectionQualityScore:Number((directionQuality*10).toFixed(1)),tickPressure5s:tick.pressure5s,tickPressure10s:tick.pressure10s,tickPressure20s:tick.pressure20s,tickPressure30s:tick.pressure30s,tickPressure60s:tick.pressure60s,tickPersistence:tick.persistence,tickReversal:tick.reversal,tickImbalance:tick.tickImbalance,tickRate:tick.tickRate,tickAdaptiveRateBaseline:tick.adaptiveTickRateBaseline,tickDensityScore:tick.tickDensityScore,tickContinuityScore:tick.continuityScore,tickFreshnessScore:tick.freshnessScore,tickSpreadHealthScore:tick.spreadHealthScore,tickEfficiency:tick.efficiency,tickAcceleration:tick.acceleration,spreadChange:tick.spreadChange,forexTickAgreement:agreement,forexTickWeight:weights[1],allTickWindowsAgree:allWindowsAgree,fastTickWindowsAgree:fastAgree,mtfAgreementCount:mtfAgree,mtfOppositionCount:mtfOppose,evidenceScore:Number(evidence.toFixed(4)),qualityScore:Number((qualityScore*100).toFixed(1))}};
}

export function getForexTickStatus(){const symbols={};for(const s of FOREX_SYMBOLS){const b=buffers.get(s)||[];symbols[s]={buffered:b.length,lastTickAt:b.at(-1)?.ts||null,ageMs:b.length?Date.now()-b.at(-1).ts:null}}return{started,connectionState:connection?.state||'Disconnected',lastConnectedAt,lastTickAt,lastError,reconnects,symbols}}
