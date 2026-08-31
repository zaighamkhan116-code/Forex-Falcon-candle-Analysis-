import * as signalR from '@microsoft/signalr';

const FOREX_SYMBOLS=['EURUSD','EURJPY','GBPUSD','CADCHF','USDJPY','NZDCHF','USDPKR','USDINR'];
const buffers=new Map();
let connection=null,started=false,lastError=null,lastConnectedAt=null,lastTickAt=null,reconnects=0;
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sign=v=>v>0?1:v<0?-1:0;

function pushTick(t){
  const symbol=String(t?.symbol||'').toUpperCase();
  if(!FOREX_SYMBOLS.includes(symbol))return;
  const bid=Number(t.bid),ask=Number(t.ask),mid=Number(t.mid??((bid+ask)/2));
  const ts=Date.parse(t.timestamp)||Date.now();
  if(![bid,ask,mid].every(Number.isFinite))return;
  const row={symbol,bid,ask,mid,spread:Number.isFinite(Number(t.spread))?Number(t.spread):Math.max(ask-bid,0),ts};
  const b=buffers.get(symbol)||[];b.push(row);buffers.set(symbol,b.slice(-5000));lastTickAt=Date.now();
}

export async function startForexTickStream(){
  if(started)return;
  started=true;
  connection=new signalR.HubConnectionBuilder().withUrl('https://biquote.io/hubs/tick').withAutomaticReconnect([0,2000,5000,10000,30000]).configureLogging(signalR.LogLevel.Warning).build();
  connection.on('ReceiveTick',pushTick);
  connection.onreconnecting(e=>{lastError=e?.message||'reconnecting';reconnects+=1;});
  connection.onreconnected(async()=>{lastConnectedAt=Date.now();lastError=null;try{await connection.invoke('Subscribe',FOREX_SYMBOLS);}catch(e){lastError=e.message;}});
  connection.onclose(e=>{lastError=e?.message||'closed';started=false;setTimeout(()=>startForexTickStream().catch(()=>{}),10000);});
  try{await connection.start();lastConnectedAt=Date.now();lastError=null;await connection.invoke('Subscribe',FOREX_SYMBOLS);}catch(e){lastError=e.message;started=false;setTimeout(()=>startForexTickStream().catch(()=>{}),10000);}
}

function rowsIn(symbol,ms){const b=buffers.get(symbol)||[],cut=Date.now()-ms;return b.filter(x=>x.ts>=cut);}
function metrics(rows){
  if(rows.length<3)return null;
  const first=rows[0],last=rows.at(-1),moves=[];
  for(let i=1;i<rows.length;i++)moves.push(rows[i].mid-rows[i-1].mid);
  const up=moves.filter(x=>x>0).length,down=moves.filter(x=>x<0).length,imb=(up-down)/(up+down+1e-12);
  const net=(last.mid-first.mid)/(first.mid||1),path=moves.reduce((a,x)=>a+Math.abs(x),0)/(first.mid||1),eff=Math.abs(net)/(path+1e-12);
  const directional=clamp(sign(net)*eff*.7+imb*.3);
  return{net,path,eff,imb,directional,ticks:rows.length,first,last};
}
function segment(symbol,ms){return metrics(rowsIn(symbol,ms));}

export function getForexTickConfirmation(pair){
  const symbol=String(pair||'').toUpperCase();if(!FOREX_SYMBOLS.includes(symbol))return null;
  const r30=rowsIn(symbol,30000),m30=metrics(r30);
  if(!m30)return{available:false,symbol,tickCount:r30.length,ageMs:r30.length?Date.now()-r30.at(-1).ts:null};
  const m5=segment(symbol,5000),m10=segment(symbol,10000),m20=segment(symbol,20000);
  const last=m30.last,spreads=r30.map(x=>x.spread),spreadMean=mean(spreads),spreadChange=(last.spread-spreadMean)/(Math.abs(spreadMean)+1e-12),tickRate=r30.length/30;
  const d5=m5?.directional||0,d10=m10?.directional||0,d20=m20?.directional||0,d30=m30.directional||0;
  const acceleration=clamp((d5-d20)*.65+(d10-d30)*.35);
  const reversal=(sign(d5)!==0&&sign(d20)!==0&&sign(d5)!==sign(d20)&&Math.abs(d5)>.25&&Math.abs(d20)>.25);
  const persistence=[d5,d10,d20,d30].filter(v=>sign(v)===sign(d5)&&sign(v)!==0).length/4;
  const spreadPenalty=Math.max(0,clamp(spreadChange,0,1));
  const pressure=clamp(d5*.34+d10*.28+d20*.20+d30*.12+acceleration*.12-spreadPenalty*sign(d5)*.06);
  const direction=pressure>=0?'BUY':'SELL';
  const quality=clamp(Math.abs(pressure)*.52+m30.eff*.18+persistence*.18+Math.min(1,tickRate/4)*.12-(reversal?.12:0),0,1);
  return{available:true,source:'BIQUOTE_SIGNALR',symbol,timestamp:Date.now(),lastTickAt:last.ts,ageMs:Date.now()-last.ts,bid:last.bid,ask:last.ask,mid:last.mid,spread:last.spread,tickCount:r30.length,tickRate:Number(tickRate.toFixed(2)),tickImbalance:Number(m30.imb.toFixed(3)),net30s:Number(m30.net.toFixed(8)),efficiency:Number(m30.eff.toFixed(3)),pressure5s:Number(d5.toFixed(3)),pressure10s:Number(d10.toFixed(3)),pressure20s:Number(d20.toFixed(3)),pressure30s:Number(d30.toFixed(3)),acceleration:Number(acceleration.toFixed(3)),persistence:Number(persistence.toFixed(2)),reversal,spreadChange:Number(spreadChange.toFixed(3)),pressure:Number(pressure.toFixed(3)),direction,quality:Number(quality.toFixed(3))};
}

export function applyForexTickConfirmation(result,tick,horizon=1){
  if(!tick?.available)return{...result,features:{...(result.features||{}),forexTickStatus:'WARMING_OR_UNAVAILABLE'}};
  const h=Number(horizon)||1,weights={1:[.62,.38],2:[.66,.34],3:[.70,.30],5:[.76,.24],15:[.84,.16]}[h]||[.70,.30];
  const techDir=result.direction==='BUY'?1:-1,tickDir=tick.direction==='BUY'?1:-1;
  const techStrength=clamp((Number(result.confidence||50)-50)/28,0,1),tickStrength=clamp(Math.abs(tick.pressure)*(.75+.25*tick.quality),0,1);
  let evidence=clamp(techDir*techStrength*weights[0]+tickDir*tickStrength*weights[1]);
  const agreement=techDir===tickDir;
  if(tick.reversal&&tick.quality>.35)evidence*=.82;
  if(!agreement&&Math.abs(tick.pressure)>.55&&tick.quality>.45)evidence=clamp(evidence+tickDir*.08);
  const direction=evidence>=0?'BUY':'SELL';
  let confidence=50+Math.abs(evidence)*(h===1?23:h<=3?22:20);
  if(agreement&&tick.quality>.45&&tick.persistence>=.75)confidence+=1.8;
  if(tick.reversal)confidence-=2.5;
  if(Math.abs(tick.spreadChange)>.75)confidence-=1.5;
  confidence=clamp(confidence,50,h===1?72:70);
  return{...result,direction,confidence:Number(confidence.toFixed(1)),engine:`${result.engine||'TECHNICAL'}+LIVE_TICKS_V2`,probabilityType:'technical-live-tick-hybrid-v2',forexTicks:tick,features:{...(result.features||{}),forexTickPressure:tick.pressure,forexTickDirection:tick.direction,forexTickQuality:tick.quality,tickPressure5s:tick.pressure5s,tickPressure10s:tick.pressure10s,tickPressure20s:tick.pressure20s,tickPressure30s:tick.pressure30s,tickPersistence:tick.persistence,tickReversal:tick.reversal,tickImbalance:tick.tickImbalance,tickRate:tick.tickRate,tickEfficiency:tick.efficiency,tickAcceleration:tick.acceleration,spreadChange:tick.spreadChange,forexTickAgreement:agreement,forexTickWeight:weights[1]}};
}

export function getForexTickStatus(){const symbols={};for(const s of FOREX_SYMBOLS){const b=buffers.get(s)||[];symbols[s]={buffered:b.length,lastTickAt:b.at(-1)?.ts||null,ageMs:b.length?Date.now()-b.at(-1).ts:null};}return{started,connectionState:connection?.state||'Disconnected',lastConnectedAt,lastTickAt,lastError,reconnects,symbols};}
