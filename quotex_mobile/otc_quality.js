// Quote-tick activity is a proxy, not exchange volume or an order book.
export function pulseFilter(ticks, now, direction, config={}) {
 const c={baselineMs:30000,windowMs:2000,minBaseline:20,minChanges:4,minPressure:.65,minEfficiency:.65,minSurge:1.5,maxFeedLagMs:750,...config};
 const ordered=ticks.filter(t=>t.timestamp_ms<=now&&t.timestamp_ms>=now-c.baselineMs);
 const changes=[];for(let i=1;i<ordered.length;i++){const d=ordered[i].price-ordered[i-1].price;if(d)changes.push({at:ordered[i].timestamp_ms,d});}
 const recent=changes.filter(t=>t.at>now-c.windowMs),baseline=changes.filter(t=>t.at<=now-c.windowMs);
 const travel=recent.reduce((s,t)=>s+Math.abs(t.d),0),net=recent.reduce((s,t)=>s+t.d,0),pressure=recent.length?recent.reduce((s,t)=>s+Math.sign(t.d),0)/recent.length:0;
 const efficiency=travel?Math.abs(net)/travel:0,baseTravel=baseline.reduce((s,t)=>s+Math.abs(t.d),0),rateSurge=(recent.length/c.windowMs)/(baseline.length/(c.baselineMs-c.windowMs)||Infinity),movementSurge=(travel/c.windowMs)/(baseTravel/(c.baselineMs-c.windowMs)||Infinity);
 const reasons=[];if(baseline.length<c.minBaseline||!ordered.length||ordered[0].timestamp_ms>now-c.baselineMs+1000)reasons.push('WARMUP');
 if(now-(ordered.at(-1)?.timestamp_ms||0)>c.maxFeedLagMs)reasons.push('STALE_FEED');
 if(recent.length<c.minChanges)reasons.push('LOW_ACTIVITY');
 if(pressure*direction<c.minPressure||Math.sign(net)!==direction||Math.sign(recent.at(-1)?.d||0)!==direction)reasons.push('DIRECTION_CONFLICT');
 if(efficiency<c.minEfficiency)reasons.push('CHOP');
 if(Math.max(rateSurge,movementSurge)<c.minSurge)reasons.push('NO_PULSE');
 return {passed:reasons.length===0,reasons,pressure,efficiency,rateSurge,movementSurge,changes:recent.length,source:'QUOTE_TICK_PROXY'};
}
export class LagSimulation {
 constructor({lags=[0,250,500,1000,2000],maxSamplingDelayMs=500,onResult=()=>{}}={}){this.lags=lags;this.maxSamplingDelayMs=maxSamplingDelayMs;this.onResult=onResult;this.pending=[];this.recent=[];this.results={};}
 add(signal){const {pair,expirySeconds,direction,confidence,entryTimestampMs,entryPrice,engine}=signal;for(const lagMs of this.lags)this.pending.push({pair,expirySeconds,direction,confidence,entryTimestampMs,entryPrice,engine,id:signal.id+':lag:'+lagMs,signalId:signal.id,lagMs,simulation:true,status:'WAITING_ENTRY',scheduledEntryMs:signal.entryTimestampMs+lagMs});}
 tick(tick){const keep=[];for(const r of this.pending){if(r.pair!==tick.pair){keep.push(r);continue;}if(r.status==='WAITING_ENTRY'&&tick.timestamp_ms>=r.scheduledEntryMs){if(tick.timestamp_ms-r.scheduledEntryMs>this.maxSamplingDelayMs){this.finish({...r,status:'SKIPPED',reason:'ENTRY_DATA_GAP'},tick.timestamp_ms);continue;}r.simulatedEntryMs=tick.timestamp_ms;r.simulatedEntryPrice=tick.price;r.effectiveLagMs=tick.timestamp_ms-r.entryTimestampMs;r.simulatedExpiryMs=tick.timestamp_ms+r.expirySeconds*1000;r.status='OPEN';}
 if(r.status==='OPEN'&&tick.timestamp_ms>=r.simulatedExpiryMs){if(tick.timestamp_ms-r.simulatedExpiryMs>this.maxSamplingDelayMs){this.finish({...r,status:'SKIPPED',reason:'EXPIRY_DATA_GAP'},tick.timestamp_ms);continue;}const delta=tick.price-r.simulatedEntryPrice;this.finish({...r,status:'SETTLED',outcome:delta===0?'DRAW':Math.sign(delta)===(r.direction==='UP'?1:-1)?'WIN':'LOSS',simulatedExitPrice:tick.price,exitSamplingDelayMs:tick.timestamp_ms-r.simulatedExpiryMs},tick.timestamp_ms);continue;}keep.push(r);}this.pending=keep;}
 finish(r,ts){r.settlementTimestampMs=ts;const k=`${r.pair}:${r.expirySeconds}:${r.lagMs}`,s=this.results[k]??={wins:0,losses:0,draws:0,skipped:0,total:0};if(r.status==='SKIPPED')s.skipped++;else{s.total++;s[r.outcome==='WIN'?'wins':r.outcome==='LOSS'?'losses':'draws']++;}this.recent.unshift(r);this.recent=this.recent.slice(0,2000);this.onResult(r);}
 snapshot(pair){return{lags:this.lags,expiryMode:'DURATION_FROM_SIMULATED_ENTRY',maxSamplingDelayMs:this.maxSamplingDelayMs,results:Object.fromEntries(Object.entries(this.results).filter(([k])=>k.startsWith(pair+':'))),recent:this.recent.filter(r=>r.pair===pair).slice(0,500)};}
}
