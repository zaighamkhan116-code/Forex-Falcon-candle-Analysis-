import {ema,emaSeries,rsi,atr,bollinger,efficiency,highest,lowest,clamp} from './indicators.js';

const weights={1:{mom:1.35,trend:.8,structure:.75,mean:.55,candle:.85},2:{mom:1.2,trend:.95,structure:.9,mean:.55,candle:.7},3:{mom:1.05,trend:1.1,structure:1,mean:.5,candle:.6},5:{mom:.9,trend:1.3,structure:1.15,mean:.45,candle:.45},15:{mom:.65,trend:1.55,structure:1.35,mean:.35,candle:.3}};
function sign(v){return v>0?1:v<0?-1:0}
function swingStructure(c){const h=c.map(x=>x.high),l=c.map(x=>x.low);const last=c.at(-1),hh=highest(h.slice(0,-1),20),ll=lowest(l.slice(0,-1),20);let score=0,label='RANGE';if(hh&&last.close>hh){score=1;label='BULL BREAK'}else if(ll&&last.close<ll){score=-1;label='BEAR BREAK'}else{const hi5=highest(h,5),lo5=lowest(l,5),hi13=highest(h,13),lo13=lowest(l,13);if(hi5>=hi13&&last.close>(hi13+lo13)/2){score=.45;label='BULL STRUCTURE'}else if(lo5<=lo13&&last.close<(hi13+lo13)/2){score=-.45;label='BEAR STRUCTURE'}}return{score,label,resistance:hh,support:ll};}
function fvg(c){if(c.length<3)return 0;const a=c.at(-3),z=c.at(-1);if(z.low>a.high)return 1;if(z.high<a.low)return-1;return 0;}
function candlePressure(c){const x=c.at(-1),range=Math.max(x.high-x.low,1e-12),body=(x.close-x.open)/range,upper=(x.high-Math.max(x.open,x.close))/range,lower=(Math.min(x.open,x.close)-x.low)/range;return clamp(body+(lower-upper)*.45,-1,1);}
function contextScore(candles){if(!candles?.length||candles.length<30)return 0;const closes=candles.map(x=>x.close),last=closes.at(-1),e20=ema(closes,20),e50=ema(closes,50),rs=rsi(closes,14),st=swingStructure(candles);let s=0;s+=sign(last-e20)*.28;s+=sign(e20-e50)*.28;s+=st.score*.28;if(rs!=null)s+=clamp((rs-50)/30,-1,1)*.16;return clamp(s,-1,1);}
function baseAnalysis(candles,horizon=1){
 if(!Array.isArray(candles)||candles.length<80)throw new Error('At least 80 completed M1 candles are required');
 const c=candles.slice(-300),closes=c.map(x=>x.close),last=closes.at(-1),w=weights[horizon]||weights[1];
 const e8=ema(closes,8),e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200);const es20=emaSeries(closes,20);const slope20=es20.length>4&&es20.at(-4)?es20.at(-1)/es20.at(-4)-1:0;
 const rv=atr(c,14)||Math.abs(last)*.0001,rs=rsi(closes,14),bb=bollinger(closes,20),eff=efficiency(closes,13)||0;
 const ret=n=>closes.length>n?last/closes.at(-1-n)-1:0;const scale=Math.max(rv/last,1e-8);
 const momentum=clamp((ret(1)*.8+ret(2)*.7+ret(3)*.55+ret(5)*.4)/(scale*2.5),-1,1);
 const trend=clamp((sign(last-e20)*.35+sign(e8-e20)*.3+sign(e20-e50)*.25+sign(slope20)*.25+(e200?sign(e50-e200)*.15:0))*(.55+.45*eff),-1,1);
 const structure=swingStructure(c);const gap=fvg(c);const cp=candlePressure(c);
 let mean=0;if(bb&&bb.sd){const z=(last-bb.mid)/bb.sd;mean=clamp(z/2,-1,1)*.55;}if(rs!=null){mean+=clamp((rs-50)/35,-1,1)*.45;}mean=clamp(mean,-1,1);
 const raw=w.mom*momentum+w.trend*trend+w.structure*structure.score+w.mean*mean+w.candle*cp+gap*.18;
 const regime=eff>.42?'TRENDING':eff>.22?'MIXED':'CHOPPY';
 return{raw,last,w,regime,features:{momentum:Number(momentum.toFixed(3)),trend:Number(trend.toFixed(3)),structure:structure.label,rsi:rs?Number(rs.toFixed(1)):null,efficiency:Number(eff.toFixed(3)),fvg:gap===1?'BULL':gap===-1?'BEAR':'NONE',ema8:e8,ema20:e20,ema50:e50,atr:rv,support:structure.support,resistance:structure.resistance}};
}
export function analyze(bundle,horizon=1){
 const b=baseAnalysis(bundle.m1,horizon),m5=contextScore(bundle.m5),m15=contextScore(bundle.m15),h1=contextScore(bundle.h1);
 const horizonMix={1:[.16,.08,.04],2:[.18,.10,.05],3:[.20,.12,.06],5:[.24,.16,.08],15:[.22,.22,.14]}[horizon]||[.16,.08,.04];
 const mtf=m5*horizonMix[0]+m15*horizonMix[1]+h1*horizonMix[2];const raw=b.raw+mtf;const direction=raw>=0?'BUY':'SELL';
 const denom=b.w.mom+b.w.trend+b.w.structure+b.w.mean+b.w.candle+.18+horizonMix.reduce((a,x)=>a+x,0);const strength=Math.abs(raw)/denom;
 // Forward-test score only. It is not yet a calibrated empirical win probability.
 const confidence=clamp(50+strength*40,50,90);
 return{direction,confidence:Number(confidence.toFixed(1)),qualified:confidence>=60,horizon,price:b.last,regime:b.regime,score:Number(raw.toFixed(4)),features:{...b.features,m5Context:Number(m5.toFixed(3)),m15Context:Number(m15.toFixed(3)),h1Context:Number(h1.toFixed(3))}};
}
