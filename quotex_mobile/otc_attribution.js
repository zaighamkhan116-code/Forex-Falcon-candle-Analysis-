const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const sign=n=>n>0?1:n<0?-1:0;

export function bollingerContext(bars,price,period=20,mult=2){
  const rows=(bars||[]).slice(-period);
  if(rows.length<period)return{available:false,period,mult};
  const closes=rows.map(x=>Number(x.close)).filter(Number.isFinite);
  if(closes.length<period)return{available:false,period,mult};
  const middle=avg(closes),variance=avg(closes.map(x=>(x-middle)**2)),sd=Math.sqrt(variance),upper=middle+mult*sd,lower=middle-mult*sd,width=middle?((upper-lower)/Math.abs(middle)):0,px=Number(price),bandPos=upper>lower?(px-lower)/(upper-lower):.5;
  const prev=(bars||[]).at(-1),range=prev?Math.max(prev.high-prev.low,1e-9):1,upperWick=prev?prev.high-Math.max(prev.open,prev.close):0,lowerWick=prev?Math.min(prev.open,prev.close)-prev.low:0;
  let state='MID',reclaimDirection=0;
  if(px>upper)state='OUTSIDE_UPPER';else if(px<lower)state='OUTSIDE_LOWER';else if(bandPos>=.82)state='UPPER_ZONE';else if(bandPos<=.18)state='LOWER_ZONE';
  if(prev?.high>upper&&prev.close<upper&&upperWick/range>=.25){state='UPPER_RECLAIM';reclaimDirection=-1;}
  if(prev?.low<lower&&prev.close>lower&&lowerWick/range>=.25){state='LOWER_RECLAIM';reclaimDirection=1;}
  return{available:true,period,mult,middle,upper,lower,width,bandPos,state,reclaimDirection};
}

export function emaAlignment(context,direction){
  const e=context?.ema30;if(!e?.available||!direction)return'UNKNOWN';
  const slope=sign(e.slope),side=sign((context?.price||0)-e.ema30),d=direction==='UP'||direction===1?1:-1;
  if(slope===d&&side===d)return'WITH_EMA';
  if(slope===-d&&side===-d)return'AGAINST_EMA';
  return'MIXED_EMA';
}

export function locationLabel(context,bb){
  const i=context?.interaction;
  if(i?.touched)return i.state==='ACCEPTED_BREAK'?'ACCEPTED_LEVEL_BREAK':'STRUCTURE_LEVEL';
  if(bb?.state==='UPPER_RECLAIM'||bb?.state==='LOWER_RECLAIM')return'BB_RECLAIM';
  if(bb?.state==='UPPER_ZONE'||bb?.state==='LOWER_ZONE')return'BB_EDGE';
  if(context?.ema30?.available&&Math.abs(context.price-context.ema30.ema30)<=Math.max((context.avgRange||0)*.35,1e-9))return'EMA30_ZONE';
  return'OPEN_SPACE';
}

export function buildSignalAttribution({pair,expiry,direction,decision,context,bb}){
  return{
    version:'OTC_ATTRIBUTION_V1',pair,expirySeconds:Number(expiry),setup:decision?.primary?.name||decision?.validation||'UNKNOWN',validation:decision?.validation||null,regime:context?.structure?.regime||'UNKNOWN',location:locationLabel(context,bb),emaAlignment:emaAlignment(context,direction),bbState:bb?.state||'UNAVAILABLE',bbWidth:Number.isFinite(bb?.width)?bb.width:null,bbBandPos:Number.isFinite(bb?.bandPos)?bb.bandPos:null,bbReclaimDirection:bb?.reclaimDirection||0,structureHighState:context?.structure?.highState||null,structureLowState:context?.structure?.lowState||null,levelState:context?.interaction?.state||null,levelTouches:context?.interaction?.touchCount??null,agreementCount:decision?.agreementCount??null,primaryStrength:decision?.primary?.strength??decision?.strongest??null
  };
}
