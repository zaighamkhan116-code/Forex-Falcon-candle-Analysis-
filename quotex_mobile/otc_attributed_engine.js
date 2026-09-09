import {OtcIndependentEngine} from './otc_independent_engine.js';
import {bollingerContext,buildSignalAttribution} from './otc_attribution.js';

function aggregate1m(state,nowMs){
  const cutoff=Math.floor(nowMs/60000)*60000;
  const src=[...(state?.candles||[]),state?.current].filter(Boolean).filter(c=>Number(c.sec)<cutoff);
  const map=new Map();
  for(const c of src){
    const minute=Math.floor(Number(c.sec)/60000)*60000;
    let r=map.get(minute);
    if(!r){r={sec:minute,open:c.open,high:c.high,low:c.low,close:c.close};map.set(minute,r)}
    else{r.high=Math.max(r.high,c.high);r.low=Math.min(r.low,c.low);r.close=c.close}
  }
  return[...map.values()].sort((a,b)=>a.sec-b.sec).slice(-80)
}

export class OtcAttributedEngine extends OtcIndependentEngine{
  async onTick(tick){
    const event=await super.onTick(tick);
    const state=this.pairState(tick.pair);
    const context=state.structureContext||null;
    const bars=aggregate1m(state,tick.timestamp_ms);
    const bb=bollingerContext(bars,state.current?.close??tick.price,20,2);
    for(const p of event.predictions||[]){
      const decision={primary:p.primaryAnalysis||null,validation:p.validation||null,agreementCount:p.agreementCount??null,strongest:p.primaryAnalysis?.strength??null};
      p.attribution=buildSignalAttribution({pair:p.pair||tick.pair,expiry:p.expirySeconds,direction:p.direction,decision,context,bb});
      p.attribution.bbPeriod=20;p.attribution.bbDeviation=2;
    }
    for(const s of event.settlements||[]){
      if(s.attribution)continue;
      const source=(state.recentSignals||[]).find(x=>x.id===s.id);
      if(source?.attribution)s.attribution=source.attribution;
      else{
        const decision={primary:s.primaryAnalysis||null,validation:s.validation||null,agreementCount:s.agreementCount??null,strongest:s.primaryAnalysis?.strength??null};
        s.attribution=buildSignalAttribution({pair:s.pair||tick.pair,expiry:s.expirySeconds,direction:s.direction,decision,context:s.structureContext||context,bb});
        s.attribution.bbPeriod=20;s.attribution.bbDeviation=2;
      }
    }
    return event;
  }
}