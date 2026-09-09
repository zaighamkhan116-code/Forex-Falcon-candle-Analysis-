import fs from 'fs/promises';
import path from 'path';
import {pulseFilter,LagSimulation} from './otc_quality.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const sign=n=>n>0?1:n<0?-1:0;
const EXPIRIES=[10,15,30,60,300];
const MIN_PER_MINUTE={10:3,15:2,30:1,60:1};
const MAX_CLIENT_LAG_MS={10:1250,15:1500,30:1800,60:2500,300:5000};
function safePair(v){return String(v||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,12)}
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

export class OtcShadowEngine{
  constructor({root='/data/quotex-otc',maxCandles=1200}={}){
    this.root=root;
    this.writeQueue=Promise.resolve();
    this.persistenceError=null;
    this.simulation=new LagSimulation({onResult:r=>{
      this.append(`lag-${r.expirySeconds}s-${r.lagMs}ms-results`,r.pair,r.settlementTimestampMs,r);
      this.queueWrite(async()=>{
        const file=path.join(this.root,'lag-summary.json');
        await fs.writeFile(file+'.tmp',JSON.stringify({results:this.simulation.results,recent:this.simulation.recent}));
        await fs.rename(file+'.tmp',file);
      });
    }});
    this.maxCandles=maxCandles;
    this.pairs=new Map();
    this.stats={ticksSeen:0,candlesClosed:0,predictions:0,settlements:0,wins:0,losses:0,draws:0,qualifiedPredictions:0,frequencyFloorPredictions:0};
  }

  pairState(pair){
    const key=safePair(pair);
    if(!this.pairs.has(key)){
      const blank=Object.fromEntries(EXPIRIES.map(x=>[x,null]));
      const results=Object.fromEntries(EXPIRIES.map(x=>[x,{wins:0,losses:0,draws:0,total:0}]));
      this.pairs.set(key,{pair:key,current:null,candles:[],recentTicks:[],pending:[],latestPrediction:{...blank},latestSettlement:{...blank},lastBoundary:{...blank},recentSignals:[],recentSettlements:[],results});
    }
    return this.pairs.get(key);
  }

  queueWrite(fn){this.writeQueue=this.writeQueue.then(async()=>{await fs.mkdir(this.root,{recursive:true});await fn();}).catch(e=>{this.persistenceError=e.message;});}
  async append(kind,pair,ts,row){const day=new Date(ts).toISOString().slice(0,10);this.queueWrite(()=>fs.appendFile(path.join(this.root,`${safePair(pair)}-OTC-${kind}-${day}.jsonl`),JSON.stringify(row)+'\n','utf8'));}
  async restore(){try{const data=JSON.parse(await fs.readFile(path.join(this.root,'lag-summary.json'),'utf8'));this.simulation.results=data.results||{};this.simulation.recent=(data.recent||[]).slice(0,2000);}catch(e){if(e.code!=='ENOENT')this.persistenceError=e.message;}}

  closeThrough(state,targetSec){
    if(!state.current)return[];
    if(targetSec-state.current.sec>this.maxCandles*1000){state.candles=[];state.current=null;return[];}
    const closed=[];
    while(state.current.sec<targetSec){
      closed.push(state.current);state.candles.push(state.current);this.stats.candlesClosed++;
      if(state.candles.length>this.maxCandles)state.candles.shift();
      const nextSec=state.current.sec+1000,px=state.current.close;
      state.current={sec:nextSec,open:px,high:px,low:px,close:px,tickCount:0,upTicks:0,downTicks:0,synthetic:true};
    }
    return closed;
  }

  updateCandle(state,tick){
    const sec=Math.floor(tick.timestamp_ms/1000)*1000;
    if(!state.current){state.current={sec,open:tick.price,high:tick.price,low:tick.price,close:tick.price,tickCount:1,upTicks:0,downTicks:0,synthetic:false};return[];}
    const previousClose=state.current.close,closed=this.closeThrough(state,sec);
    if(!state.current)return this.updateCandle(state,tick);
    if(state.current.sec!==sec)return closed;
    if(state.current.tickCount===0){state.current.open=previousClose;state.current.high=tick.price;state.current.low=tick.price;state.current.close=tick.price;state.current.synthetic=false;}
    else{
      state.current.high=Math.max(state.current.high,tick.price);state.current.low=Math.min(state.current.low,tick.price);
      if(tick.price>state.current.close)state.current.upTicks++;else if(tick.price<state.current.close)state.current.downTicks++;
      state.current.close=tick.price;
    }
    state.current.tickCount++;
    return closed;
  }

  recentReturns(state,seconds){
    const all=[...state.candles,state.current].filter(Boolean);if(all.length<2)return 0;
    const end=all.at(-1).close,cutoff=(state.current?.sec||Date.now())-seconds*1000;let start=all[0].open;
    for(const c of all){if(c.sec>=cutoff){start=c.open;break;}}
    return start?(end-start)/start:0;
  }

  tickPressure(state,nowMs,seconds){
    const ticks=state.recentTicks.filter(t=>t.timestamp_ms>=nowMs-seconds*1000);let ups=0,downs=0,travel=0;
    for(let i=1;i<ticks.length;i++){const d=ticks[i].price-ticks[i-1].price;travel+=Math.abs(d);if(d>0)ups++;else if(d<0)downs++;}
    const net=ticks.length>1?ticks.at(-1).price-ticks[0].price:0;
    return{pressure:(ups+downs)?(ups-downs)/(ups+downs):0,efficiency:travel?Math.abs(net)/travel:0,ups,downs};
  }

  featureSnapshot(state,nowMs){
    const all=[...state.candles,state.current].filter(Boolean),last=all.slice(-30),ranges=last.map(c=>c.high-c.low),avgRange=avg(ranges),lastClose=all.at(-1)?.close||0;
    const r={m3:this.recentReturns(state,3),m5:this.recentReturns(state,5),m10:this.recentReturns(state,10),m20:this.recentReturns(state,20),m30:this.recentReturns(state,30),m60:this.recentReturns(state,60),m120:this.recentReturns(state,120)};
    const p3=this.tickPressure(state,nowMs,3),p5=this.tickPressure(state,nowMs,5),p10=this.tickPressure(state,nowMs,10);
    const recent10=all.slice(-10),recent20=all.slice(-20);
    const hi10=Math.max(...recent10.map(c=>c.high)),lo10=Math.min(...recent10.map(c=>c.low)),hi20=Math.max(...recent20.map(c=>c.high)),lo20=Math.min(...recent20.map(c=>c.low));
    const px=lastClose,pos10=hi10>lo10?(px-lo10)/(hi10-lo10):.5,pos20=hi20>lo20?(px-lo20)/(hi20-lo20):.5;
    const lastC=all.at(-1),body=lastC?lastC.close-lastC.open:0,upper=lastC?lastC.high-Math.max(lastC.open,lastC.close):0,lower=lastC?Math.min(lastC.open,lastC.close)-lastC.low:0;
    const wickDen=Math.abs(body)+upper+lower||1,rejection=(lower-upper)/wickDen,velocity=r.m3-r.m10*.3,accel=r.m3-r.m5;
    const sequence=avg(all.slice(-5).map(c=>sign(c.close-c.open)));
    const prev10=all.slice(-11,-1),prevHi10=prev10.length?Math.max(...prev10.map(c=>c.high)):hi10,prevLo10=prev10.length?Math.min(...prev10.map(c=>c.low)):lo10;
    const breakout10=px>prevHi10?1:px<prevLo10?-1:0;
    return{...r,pressure:p10.pressure,pressure3:p3.pressure,pressure5:p5.pressure,pressure10:p10.pressure,eff3:p3.efficiency,eff5:p5.efficiency,eff10:p10.efficiency,rangeNorm:lastClose?avgRange/lastClose:0,avgRange,pos10,pos20,rejection,velocity,accel,sequence,breakout10};
  }

  wickMemory(state,nowMs){
    const all=[...state.candles,state.current].filter(Boolean);
    if(all.length<14)return{active:false,reason:'INSUFFICIENT_HISTORY'};
    const current=all.at(-1),px=current.close;
    const recentRanges=all.slice(-30).map(c=>c.high-c.low).filter(x=>x>0);
    const avgRange=Math.max(avg(recentRanges),Math.abs(px)*1e-7,1e-9);
    const zoneWidth=Math.max(avgRange*.30,Math.abs(px)*2e-7,1e-9);
    const history=all.filter(c=>c.sec<=nowMs-4000).slice(-90);
    const candidates=[];
    for(const c of history){
      if(c.synthetic)continue;
      const body=Math.abs(c.close-c.open),upper=c.high-Math.max(c.open,c.close),lower=Math.min(c.open,c.close)-c.low,range=Math.max(c.high-c.low,1e-9);
      if(upper>=Math.max(body*.70,range*.28,avgRange*.18))candidates.push({side:'UPPER',level:c.high,sec:c.sec,wick:upper,range});
      if(lower>=Math.max(body*.70,range*.28,avgRange*.18))candidates.push({side:'LOWER',level:c.low,sec:c.sec,wick:lower,range});
    }
    if(!candidates.length)return{active:false,reason:'NO_SIGNIFICANT_WICK'};
    let nearest=null;
    for(const c of candidates){const distance=Math.abs(px-c.level);if(!nearest||distance<nearest.distance)nearest={...c,distance};}
    if(!nearest||nearest.distance>zoneWidth*2.25)return{active:false,reason:'NO_NEARBY_WICK',zoneWidth:Math.round(zoneWidth*1e8)/1e8};
    const last4=all.slice(-4),last3=all.slice(-3);
    const recentHigh=Math.max(...last4.map(c=>c.high)),recentLow=Math.min(...last4.map(c=>c.low));
    const closeAvg=avg(last3.map(c=>c.close));
    let reaction='APPROACH',direction=0,strength=.25,broken=false,retested=false;
    if(nearest.side==='UPPER'){
      broken=recentHigh>nearest.level+zoneWidth*.35&&closeAvg>nearest.level;
      retested=broken&&recentLow<=nearest.level+zoneWidth*.55&&px>=nearest.level-zoneWidth*.10;
      const rejected=recentHigh>=nearest.level-zoneWidth*.65&&px<nearest.level-zoneWidth*.12;
      if(retested){reaction='BREAK_RETEST_HOLD';direction=1;strength=.85;}
      else if(broken){reaction='BREAK_HOLD';direction=1;strength=.65;}
      else if(rejected){reaction='REJECTION';direction=-1;strength=.75;}
    }else{
      broken=recentLow<nearest.level-zoneWidth*.35&&closeAvg<nearest.level;
      retested=broken&&recentHigh>=nearest.level-zoneWidth*.55&&px<=nearest.level+zoneWidth*.10;
      const rejected=recentLow<=nearest.level+zoneWidth*.65&&px>nearest.level+zoneWidth*.12;
      if(retested){reaction='BREAK_RETEST_HOLD';direction=-1;strength=.85;}
      else if(broken){reaction='BREAK_HOLD';direction=-1;strength=.65;}
      else if(rejected){reaction='REJECTION';direction=1;strength=.75;}
    }
    return{active:true,side:nearest.side,level:nearest.level,ageMs:nowMs-nearest.sec,distance:nearest.distance,zoneWidth,reaction,direction,strength,broken,retested};
  }

  baseScore(f,expiry){
    const vol=Math.max(f.rangeNorm,1e-7),norm=x=>clamp(x/(vol*4),-1,1);
    if(expiry===10)return norm(f.m3)*.22+norm(f.m5)*.17+norm(f.velocity)*.13+norm(f.accel)*.10+f.pressure3*.14+f.pressure5*.08+f.rejection*.06+f.sequence*.05+(f.pos10-.5)*.10;
    if(expiry===15)return norm(f.m3)*.14+norm(f.m5)*.18+norm(f.m10)*.12+norm(f.velocity)*.10+f.pressure5*.13+f.pressure10*.09+f.rejection*.08+f.sequence*.07+(f.pos10-.5)*.09;
    if(expiry===30)return norm(f.m5)*.10+norm(f.m10)*.19+norm(f.m20)*.18+norm(f.m30)*.10+f.pressure10*.11+f.rejection*.09+f.sequence*.08+(f.pos20-.5)*.08+clamp(f.breakout10,-1,1)*.07;
    if(expiry===60)return norm(f.m5)*.08+norm(f.m10)*.18+norm(f.m20)*.27+norm(f.m60)*.30+norm(f.m120)*.04+f.pressure10*.09+f.sequence*.04;
    return norm(f.m10)*.08+norm(f.m20)*.16+norm(f.m60)*.28+norm(f.m120)*.36+f.pressure10*.08+f.sequence*.04;
  }

  quality(f,expiry){
    const eff=expiry===10?f.eff3:expiry===15?f.eff5:f.eff10;
    const agreement=[sign(f.m3),sign(f.m5),sign(f.m10)].filter(Boolean),agree=agreement.length?Math.abs(agreement.reduce((a,b)=>a+b,0))/agreement.length:0,noisePenalty=eff<.18?.10:0;
    return clamp(.45*eff+.35*agree+.20*Math.min(1,Math.abs(f.pressure10))-noisePenalty,0,1);
  }

  minuteCadenceDue(state,tick,expiry){
    const target=MIN_PER_MINUTE[expiry];if(!target)return false;
    const minuteStart=Math.floor(tick.timestamp_ms/60000)*60000,phase=tick.timestamp_ms-minuteStart,slot=60000/target,due=Math.min(target,Math.floor((phase+slot/2)/slot));
    if(due<=0)return false;
    const emitted=state.recentSignals.filter(s=>s.expirySeconds===expiry&&s.entryTimestampMs>=minuteStart).length;
    return emitted<due;
  }

  consensusBias(f,expiry,threshold){
    const votes=expiry===10?[sign(f.m3),sign(f.m5),sign(f.velocity),sign(f.pressure3),sign(f.accel)]:expiry===15?[sign(f.m3),sign(f.m5),sign(f.m10),sign(f.pressure5),sign(f.pressure10),sign(f.sequence)]:[sign(f.m5),sign(f.m10),sign(f.m20),sign(f.pressure10),sign(f.sequence),sign(f.breakout10)];
    const nz=votes.filter(Boolean),sum=nz.reduce((a,b)=>a+b,0),need=expiry===10?3:expiry===15?3:2;
    if(nz.length<need||Math.abs(sum)<need)return 0;
    return sign(sum)*Math.max(threshold*.65,.025);
  }

  async maybePredict(state,tick,expiry){
    const boundary=Math.floor(tick.timestamp_ms/(expiry*1000));if(state.lastBoundary[expiry]===boundary)return null;
    const minHistory=expiry===10?8:expiry===15?10:expiry===30?15:expiry===60?20:120;if(state.candles.length<minHistory)return null;
    const features=this.featureSnapshot(state,tick.timestamp_ms);let raw=this.baseScore(features,expiry),q=this.quality(features,expiry);
    const threshold=expiry===10?.055:expiry===15?.060:expiry===30?.065:expiry===60?.050:.08,minQuality=expiry===10?.22:expiry===15?.20:expiry===30?.10:expiry===60?.08:.18;
    const wickMemory=expiry<=15?this.wickMemory(state,tick.timestamp_ms):null;
    if(wickMemory?.active&&wickMemory.direction){
      const rawDir=sign(raw);
      if(rawDir===wickMemory.direction){raw+=wickMemory.direction*(expiry===10?.018:.022)*wickMemory.strength;q=clamp(q+.05*wickMemory.strength,0,1);}
      else if(wickMemory.reaction==='REJECTION'||wickMemory.reaction==='BREAK_RETEST_HOLD'){
        raw*=expiry===10?.58:.52;
        q=clamp(q-.08*wickMemory.strength,0,1);
      }
    }
    const pulseCfg=expiry===10?{windowMs:2500,minChanges:3,minPressure:.55,minEfficiency:.50,minSurge:1.15,maxFeedLagMs:1250}:expiry===15?{windowMs:3500,minChanges:3,minPressure:.50,minEfficiency:.45,minSurge:1.10,maxFeedLagMs:1500}:{};
    const pulse=expiry<=15?pulseFilter(state.recentTicks,tick.timestamp_ms,sign(raw),pulseCfg):null;
    state.qualityStatus??={};
    const lag=Number(tick.client_lag_ms||0),lagLimit=MAX_CLIENT_LAG_MS[expiry]||2500;if(this.persistenceError||lag>lagLimit)return null;
    let qualified=Math.abs(raw)>=threshold&&q>=minQuality&&(!pulse||pulse.passed);
    if(expiry<=15&&qualified&&wickMemory?.active&&wickMemory.direction&&sign(raw)!==wickMemory.direction&&(wickMemory.reaction==='REJECTION'||wickMemory.reaction==='BREAK_RETEST_HOLD'))qualified=false;
    let frequencyFloor=false;
    if(!qualified){
      const cadenceDue=expiry<=30&&this.minuteCadenceDue(state,tick,expiry);if(!cadenceDue)return null;
      const floorRaw=this.consensusBias(features,expiry,threshold);if(!floorRaw)return null;
      if(expiry<=15&&wickMemory?.active&&wickMemory.direction&&sign(floorRaw)!==wickMemory.direction&&(wickMemory.reaction==='REJECTION'||wickMemory.reaction==='BREAK_RETEST_HOLD'))return null;
      raw=floorRaw;frequencyFloor=true;
    }
    state.qualityStatus[expiry]={...(pulse||{}),passed:true,qualified,frequencyFloor,lagMs:lag,lagLimitMs:lagLimit,wickMemory};
    state.lastBoundary[expiry]=boundary;
    const direction=raw>0?'UP':'DOWN',confidence=Math.round(clamp(50+Math.abs(raw)*30+q*12,50,frequencyFloor?60:86)*10)/10,id=`${state.pair}-${expiry}-${tick.timestamp_ms}`,engine=expiry<=60?`OTC_${expiry}S_SHADOW_V2`:`OTC_${expiry}S_SHADOW_V1`;
    const entryPattern=wickMemory?.active&&wickMemory.direction===sign(raw)?`WICK_${wickMemory.reaction}`:'STANDARD';
    const prediction={id,engine:engine+'_WICK_MEMORY_V5',generatedAtMs:Date.now(),confidenceKind:'HEURISTIC_SCORE_NOT_CALIBRATED_PROBABILITY',pulse,wickMemory,entryPattern,mode:'SHADOW',tradingEnabled:false,pair:state.pair,marketType:'OTC',expirySeconds:expiry,direction,confidence,score:Math.round(raw*10000)/10000,quality:Math.round(q*1000)/1000,entryTimestampMs:tick.receivedAtMs??tick.timestamp_ms,sourceTickTimestampMs:tick.timestamp_ms,entryPrice:tick.price,targetTimestampMs:(tick.receivedAtMs??tick.timestamp_ms)+expiry*1000,features:{...features,wickMemory},status:'PENDING',frequencyFloor,signalClass:frequencyFloor?'FREQUENCY_FLOOR':'QUALIFIED'};
    state.pending.push(prediction);this.simulation.add(prediction);state.latestPrediction[expiry]=prediction;state.recentSignals.unshift(prediction);state.recentSignals=state.recentSignals.slice(0,100);this.stats.predictions++;if(frequencyFloor)this.stats.frequencyFloorPredictions++;else this.stats.qualifiedPredictions++;
    await this.append(`shadow-${expiry}s-signals`,state.pair,tick.timestamp_ms,prediction);return prediction;
  }

  async settlePending(state,tick){
    const due=state.pending.filter(p=>tick.timestamp_ms>=p.targetTimestampMs);if(!due.length)return[];
    state.pending=state.pending.filter(p=>tick.timestamp_ms<p.targetTimestampMs);const settled=[];
    for(const p of due){
      const delta=tick.price-p.entryPrice,actual=sign(delta),predicted=p.direction==='UP'?1:-1,outcome=actual===0?'DRAW':actual===predicted?'WIN':'LOSS',row={...p,status:'SETTLED',settlementTimestampMs:tick.timestamp_ms,settlementPrice:tick.price,settlementDelayMs:tick.timestamp_ms-p.targetTimestampMs,outcome,priceDelta:delta};
      const r=state.results[p.expirySeconds];r.total++;
      if(outcome==='WIN'){r.wins++;this.stats.wins++;}else if(outcome==='LOSS'){r.losses++;this.stats.losses++;}else{r.draws++;this.stats.draws++;}
      this.stats.settlements++;state.latestSettlement[p.expirySeconds]=row;state.recentSettlements.unshift(row);state.recentSettlements=state.recentSettlements.slice(0,100);
      await this.append(`shadow-${p.expirySeconds}s-results`,state.pair,tick.timestamp_ms,row);settled.push(row);
    }
    return settled;
  }

  async onTick(tick){
    this.stats.ticksSeen++;const state=this.pairState(tick.pair);if(state.lastTickTs!=null&&tick.timestamp_ms<=state.lastTickTs)return{predictions:[],settlements:[]};state.lastTickTs=tick.timestamp_ms;this.simulation.tick(tick);
    state.recentTicks.push({timestamp_ms:tick.timestamp_ms,price:tick.price});const cutoff=tick.timestamp_ms-360000;while(state.recentTicks.length&&state.recentTicks[0].timestamp_ms<cutoff)state.recentTicks.shift();
    const closed=this.updateCandle(state,tick);
    for(const c of closed)await this.append('micro-1s',state.pair,c.sec,{pair:state.pair,marketType:'OTC',timeframeSeconds:1,timestamp_ms:c.sec,timestamp_iso:new Date(c.sec).toISOString(),open:c.open,high:c.high,low:c.low,close:c.close,tickCount:c.tickCount,upTicks:c.upTicks,downTicks:c.downTicks,synthetic:Boolean(c.synthetic),source:'QUOTEX_BROWSER_BRIDGE'});
    const settlements=await this.settlePending(state,tick),predictions=[];
    for(const expiry of EXPIRIES){const p=await this.maybePredict(state,tick,expiry);if(p)predictions.push(p);}
    this.simulation.tick(tick);return{predictions,settlements};
  }

  snapshot(pair=null){
    const serialize=state=>({pair:state.pair,qualityStatus:state.qualityStatus||{},executionSimulation:this.simulation.snapshot(state.pair),persistenceError:this.persistenceError,currentCandle:state.current,candleCount:state.candles.length,pendingCount:state.pending.length,latestPrediction:state.latestPrediction,latestSettlement:state.latestSettlement,recentSignals:state.recentSignals.slice(0,50),recentSettlements:state.recentSettlements.slice(0,50),results:Object.fromEntries(Object.entries(state.results).map(([k,v])=>[k,{...v,winRate:(v.wins+v.losses)?Math.round(v.wins/(v.wins+v.losses)*10000)/100:null}]))});
    if(pair)return serialize(this.pairState(pair));
    return{mode:'SHADOW',tradingEnabled:false,engines:EXPIRIES.map(x=>x<=60?`OTC_${x}S_SHADOW_V2`:`OTC_${x}S_SHADOW_V1`),expiries:EXPIRIES,stats:this.stats,pairs:[...this.pairs.values()].map(serialize)};
  }
}
