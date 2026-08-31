import * as signalR from '@microsoft/signalr';

const FOREX_SYMBOLS=['EURUSD','EURJPY','GBPUSD','CADCHF','USDJPY','NZDCHF','USDPKR','USDINR'];
const buffers=new Map();
let connection=null,started=false,lastError=null,lastConnectedAt=null,lastTickAt=null,reconnects=0;
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

function pushTick(t){
  const symbol=String(t?.symbol||'').toUpperCase();
  if(!FOREX_SYMBOLS.includes(symbol))return;
  const bid=Number(t.bid),ask=Number(t.ask),mid=Number(t.mid??((bid+ask)/2));
  const ts=Date.parse(t.timestamp)||Date.now();
  if(![bid,ask,mid].every(Number.isFinite))return;
  const row={symbol,bid,ask,mid,spread:Number.isFinite(Number(t.spread))?Number(t.spread):Math.max(ask-bid,0),ts};
  const b=buffers.get(symbol)||[];b.push(row);buffers.set(symbol,b.slice(-2500));lastTickAt=Date.now();
}

export async function startForexTickStream(){
  if(started)return;
  started=true;
  connection=new signalR.HubConnectionBuilder()
    .withUrl('https://biquote.io/hubs/tick')
    .withAutomaticReconnect([0,2000,5000,10000,30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();
  connection.on('ReceiveTick',pushTick);
  connection.onreconnecting(e=>{lastError=e?.message||'reconnecting';reconnects+=1;});
  connection.onreconnected(async()=>{lastConnectedAt=Date.now();lastError=null;try{await connection.invoke('Subscribe',FOREX_SYMBOLS);}catch(e){lastError=e.message;}});
  connection.onclose(e=>{lastError=e?.message||'closed';started=false;});
  try{
    await connection.start();
    lastConnectedAt=Date.now();lastError=null;
    await connection.invoke('Subscribe',FOREX_SYMBOLS);
  }catch(e){lastError=e.message;started=false;setTimeout(()=>startForexTickStream().catch(()=>{}),10000);}
}

function windowTicks(symbol,ms){
  const b=buffers.get(symbol)||[],cut=Date.now()-ms;
  return b.filter(x=>x.ts>=cut);
}
function segmentReturn(rows,startAgo,endAgo){
  const now=Date.now(),a=rows.filter(x=>x.ts>=now-startAgo&&x.ts<now-endAgo);if(a.length<2)return 0;
  return (a.at(-1).mid-a[0].mid)/(a[0].mid||1);
}

export function getForexTickConfirmation(pair){
  const symbol=String(pair||'').toUpperCase();
  if(!FOREX_SYMBOLS.includes(symbol))return null;
  const rows=windowTicks(symbol,30000);
  if(rows.length<3)return{available:false,symbol,tickCount:rows.length,ageMs:rows.length?Date.now()-rows.at(-1).ts:null};
  const first=rows[0],last=rows.at(-1),dp=[];
  for(let i=1;i<rows.length;i++)dp.push(rows[i].mid-rows[i-1].mid);
  const up=dp.filter(x=>x>0).length,down=dp.filter(x=>x<0).length;
  const tickImbalance=(up-down)/(up+down+1e-12);
  const net=(last.mid-first.mid)/(first.mid||1);
  const path=dp.reduce((a,x)=>a+Math.abs(x),0)/(first.mid||1);
  const efficiency=Math.abs(net)/(path+1e-12);
  const r10=segmentReturn(rows,10000,0),r20prev=segmentReturn(rows,20000,10000),r30prev=segmentReturn(rows,30000,20000);
  const acceleration=r10-r20prev;
  const spreads=rows.map(x=>x.spread),spreadNow=last.spread,spreadMean=mean(spreads);
  const spreadChange=(spreadNow-spreadMean)/(Math.abs(spreadMean)+1e-12);
  const tickRate=rows.length/30;
  const netScaled=clamp(net/(Math.max(path,1e-8))*efficiency*2);
  const pressure=clamp(tickImbalance*.34+netScaled*.34+clamp(acceleration*100000)*.20-clamp(spreadChange)*.12);
  const direction=pressure>=0?'BUY':'SELL';
  const quality=clamp(Math.abs(pressure)*.65+efficiency*.20+Math.min(1,tickRate/5)*.15,0,1);
  return{available:true,source:'BIQUOTE_SIGNALR',symbol,timestamp:Date.now(),lastTickAt:last.ts,ageMs:Date.now()-last.ts,bid:last.bid,ask:last.ask,mid:last.mid,spread:last.spread,tickCount:rows.length,tickRate:Number(tickRate.toFixed(2)),tickImbalance:Number(tickImbalance.toFixed(3)),net30s:Number(net.toFixed(8)),efficiency:Number(efficiency.toFixed(3)),ret10s:Number(r10.toFixed(8)),retPrev10s:Number(r20prev.toFixed(8)),retPrev20s:Number(r30prev.toFixed(8)),acceleration:Number(acceleration.toFixed(8)),spreadChange:Number(spreadChange.toFixed(3)),pressure:Number(pressure.toFixed(3)),direction,quality:Number(quality.toFixed(3))};
}

export function applyForexTickConfirmation(result,tick){
  if(!tick?.available)return{...result,features:{...(result.features||{}),forexTickStatus:'WARMING_OR_UNAVAILABLE'}};
  const techDir=result.direction==='BUY'?1:-1,tickDir=tick.direction==='BUY'?1:-1;
  const techStrength=clamp((Number(result.confidence||50)-50)/30,0,1),tickStrength=clamp(Math.abs(tick.pressure),0,1);
  const evidence=clamp(techDir*techStrength*.72+tickDir*tickStrength*.28);
  const direction=evidence>=0?'BUY':'SELL',agreement=techDir===tickDir;
  let confidence=50+Math.abs(evidence)*20+(agreement&&tick.quality>.35?1.5:0)-(!agreement&&tickStrength>.4?2.5:0);
  confidence=clamp(confidence,50,70);
  return{...result,direction,confidence:Number(confidence.toFixed(1)),engine:`${result.engine||'TECHNICAL'}+LIVE_TICKS`,probabilityType:'technical-live-tick-hybrid',forexTicks:tick,features:{...(result.features||{}),forexTickPressure:tick.pressure,forexTickDirection:tick.direction,forexTickQuality:tick.quality,tickImbalance:tick.tickImbalance,tickRate:tick.tickRate,tickEfficiency:tick.efficiency,tickAcceleration:tick.acceleration,spreadChange:tick.spreadChange,forexTickAgreement:agreement}};
}

export function getForexTickStatus(){
  const symbols={};for(const s of FOREX_SYMBOLS){const b=buffers.get(s)||[];symbols[s]={buffered:b.length,lastTickAt:b.at(-1)?.ts||null,ageMs:b.length?Date.now()-b.at(-1).ts:null};}
  return{started,connectionState:connection?.state||'Disconnected',lastConnectedAt,lastTickAt,lastError,reconnects,symbols};
}
