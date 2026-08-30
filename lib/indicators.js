export function sma(values, period){if(values.length<period)return null;const s=values.slice(-period).reduce((a,b)=>a+b,0);return s/period;}
export function ema(values, period){if(values.length<period)return null;const k=2/(period+1);let e=sma(values.slice(0,period),period);for(let i=period;i<values.length;i++)e=values[i]*k+e*(1-k);return e;}
export function emaSeries(values, period){if(values.length<period)return[];const out=Array(period-1).fill(null);let e=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out.push(e);const k=2/(period+1);for(let i=period;i<values.length;i++){e=values[i]*k+e*(1-k);out.push(e)}return out;}
export function stdev(values,period){if(values.length<period)return null;const x=values.slice(-period);const m=x.reduce((a,b)=>a+b,0)/period;return Math.sqrt(x.reduce((a,b)=>a+(b-m)**2,0)/period);}
export function rsi(values,period=14){if(values.length<period+1)return null;let g=0,l=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l-=d;}g/=period;l/=period;if(l===0)return 100;const rs=g/l;return 100-100/(1+rs);}
export function atr(candles,period=14){if(candles.length<period+1)return null;const tr=[];for(let i=1;i<candles.length;i++){const c=candles[i],p=candles[i-1];tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));}return sma(tr,period);}
export function highest(values,period){if(values.length<period)return null;return Math.max(...values.slice(-period));}
export function lowest(values,period){if(values.length<period)return null;return Math.min(...values.slice(-period));}
export function bollinger(values,period=20,mult=2){const mid=sma(values,period),sd=stdev(values,period);if(mid==null||sd==null)return null;return{mid,upper:mid+mult*sd,lower:mid-mult*sd,sd};}
export function efficiency(values,period=13){if(values.length<period+1)return null;const end=values.length-1,start=end-period;let path=0;for(let i=start+1;i<=end;i++)path+=Math.abs(values[i]-values[i-1]);return path===0?0:Math.abs(values[end]-values[start])/path;}
export function slope(values,period=3){if(values.length<period+1)return null;const a=values[values.length-1],b=values[values.length-1-period];return b===0?0:a/b-1;}
export function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
