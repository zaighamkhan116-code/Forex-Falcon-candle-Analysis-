const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;

function trueRange(c,p){return Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close))}

export function marketFlowContext(candles=[],horizon=1){
  if(!Array.isArray(candles)||candles.length<25)return{score:0,features:{atr14:null,vwap:null,vwapDistanceAtr:null,vwapSlopeAtr:null,vsaState:'NONE',vsaScore:0,relativeVolume:null,rangeAtr:null,bodyAtr:null,closeLocation:null}};
  const c=candles.slice(-300),x=c.at(-1),prev=c.at(-2),trs=[];
  for(let i=1;i<c.length;i++)trs.push(trueRange(c[i],c[i-1]));
  const atr14=mean(trs.slice(-14))||Math.max(x.high-x.low,1e-12),atrSafe=Math.max(atr14,1e-12);

  // Session-style rolling VWAP from the most recent 120 completed candles. FX volume is normally tick volume;
  // when unavailable, use equal weights so the feature degrades to a typical-price mean rather than fabricating volume.
  const window=c.slice(-120),hasVolume=window.some(v=>Number(v.volume)>0),weight=v=>hasVolume?Math.max(Number(v.volume)||0,1):1,tp=v=>(Number(v.high)+Number(v.low)+Number(v.close))/3;
  const wsum=window.reduce((a,v)=>a+weight(v),0)||1,vwap=window.reduce((a,v)=>a+tp(v)*weight(v),0)/wsum;
  const prevWindow=c.slice(-121,-1),pwsum=prevWindow.reduce((a,v)=>a+(hasVolume?Math.max(Number(v.volume)||0,1):1),0)||1,prevVwap=prevWindow.reduce((a,v)=>a+tp(v)*(hasVolume?Math.max(Number(v.volume)||0,1):1),0)/pwsum;
  const vwapDistanceAtr=(x.close-vwap)/atrSafe,vwapSlopeAtr=(vwap-prevVwap)/atrSafe;

  const recent=c.slice(-21,-1),avgVol=mean(recent.map(v=>Number(v.volume)||0)),relVol=hasVolume&&avgVol>0?(Number(x.volume)||0)/avgVol:null,avgRange=mean(recent.map(v=>Math.max(v.high-v.low,1e-12))),range=Math.max(x.high-x.low,1e-12),body=x.close-x.open,bodyAbs=Math.abs(body),upper=(x.high-Math.max(x.open,x.close))/range,lower=(Math.min(x.open,x.close)-x.low)/range,closeLocation=clamp((x.close-x.low)/range,0,1),rangeAtr=range/atrSafe,bodyAtr=bodyAbs/atrSafe;
  const effort=relVol==null?rangeAtr:relVol,poorResult=rangeAtr<.75||bodyAbs/range<.35,highEffort=effort>=1.35,wide=rangeAtr>=1.15,narrow=rangeAtr<=.7;

  let vsaScore=0,vsaState='NEUTRAL';
  if(highEffort&&poorResult){
    if(upper>=.38&&closeLocation<.55){vsaScore=-.55;vsaState='BEAR_ABSORPTION_OR_UPTHRUST'}
    else if(lower>=.38&&closeLocation>.45){vsaScore=.55;vsaState='BULL_ABSORPTION_OR_STOPPING'}
    else{vsaScore=body>=0?-.25:.25;vsaState='HIGH_EFFORT_LOW_RESULT'}
  }else if(highEffort&&wide){vsaScore=body>=0?.48:-.48;vsaState=body>=0?'BULL_EFFORT_RESULT':'BEAR_EFFORT_RESULT'}
  else if(narrow&&relVol!=null&&relVol<.75){vsaScore=body>=0?.12:-.12;vsaState=body>=0?'LOW_SUPPLY_DEMAND_BULL':'LOW_SUPPLY_DEMAND_BEAR'}
  else if(upper>.48&&closeLocation<.45){vsaScore=-.35;vsaState='UPPER_REJECTION'}
  else if(lower>.48&&closeLocation>.55){vsaScore=.35;vsaState='LOWER_REJECTION'}

  let score=vsaScore*.55;
  if(vwapDistanceAtr>0&&vwapSlopeAtr>0)score+=.12;
  if(vwapDistanceAtr<0&&vwapSlopeAtr<0)score-=.12;
  // Extreme VWAP distance is diagnostic exhaustion pressure, not a directional reversal trigger.
  const vwapExtended=Math.abs(vwapDistanceAtr)>=1.8;
  const scale={1:1,2:.95,3:.9,5:.82,15:.7}[Number(horizon)]||.9;
  score=clamp(score*scale,-.65,.65);
  return{score,features:{
    atr14:Number(atr14.toFixed(8)),atrNormalized:Number((atr14/Math.max(Math.abs(x.close),1e-12)).toFixed(7)),
    rangeAtr:Number(rangeAtr.toFixed(3)),bodyAtr:Number(bodyAtr.toFixed(3)),
    vwap:Number(vwap.toFixed(8)),vwapDistanceAtr:Number(vwapDistanceAtr.toFixed(3)),vwapSlopeAtr:Number(vwapSlopeAtr.toFixed(3)),vwapExtended,
    relativeVolume:relVol==null?null:Number(relVol.toFixed(3)),volumeSource:hasVolume?'TICK_VOLUME':'EQUAL_WEIGHT_FALLBACK',
    candleBodyRatio:Number((bodyAbs/range).toFixed(3)),upperWickRatioVsa:Number(upper.toFixed(3)),lowerWickRatioVsa:Number(lower.toFixed(3)),closeLocation:Number(closeLocation.toFixed(3)),
    vsaState,vsaScore:Number(vsaScore.toFixed(3)),marketFlowScore:Number(score.toFixed(3)),
    vsaHighEffort:highEffort,vsaPoorResult:poorResult,vsaWideSpread:wide,vsaNarrowSpread:narrow
  }};
}
