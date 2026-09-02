// Advanced momentum family: RSI/price divergence, MACD histogram state, ADX trend quality.
// Causal (uses completed candles only) and designed to slot into confirmationModelV2.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sign=v=>v>0?1:v<0?-1:0;

export function rsiSeries(values,period=14){
  if(values.length<period+1)return[];
  const out=new Array(values.length).fill(null);
  let g=0,l=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];if(d>=0)g+=d;else l-=d;}
  g/=period;l/=period;
  out[period]=l===0?100:100-100/(1+g/l);
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];const gain=d>0?d:0,loss=d<0?-d:0;
    g=(g*(period-1)+gain)/period;l=(l*(period-1)+loss)/period;
    out[i]=l===0?100:100-100/(1+g/l);
  }
  return out;
}

export function macdState(values){
  if(values.length<35)return{score:0,label:'NONE',hist:0,histSlope:0};
  const k12=2/13,k26=2/27;let e12=values[0],e26=values[0];const macd=[];
  for(let i=0;i<values.length;i++){e12=values[i]*k12+e12*(1-k12);e26=values[i]*k26+e26*(1-k26);macd.push(e12-e26);}
  const k9=2/10;let sig=macd[0];const hist=[];
  for(let i=0;i<macd.length;i++){sig=macd[i]*k9+sig*(1-k9);hist.push(macd[i]-sig);}
  const h=hist.at(-1),hPrev=hist.at(-2),hPrev2=hist.at(-3);
  const scale=Math.max(Math.abs(values.at(-1))*1e-4,1e-9);
  const norm=clamp(h/scale/2,-1,1),slope=clamp((h-hPrev)/scale/2,-1,1);
  let score=clamp(norm*.55+slope*.45,-1,1);
  // Momentum-flip bonus: two shrinking bars in the dominant direction before a flip back.
  if(sign(h)!==sign(hPrev)&&sign(hPrev)!==sign(hPrev2)&&sign(h)===sign(hPrev2))score+=sign(h)*.15;
  const label=sign(h)>0?(slope>0?'MACD_BULL_STRONG':'MACD_BULL_FADING'):sign(h)<0?(slope<0?'MACD_BEAR_STRONG':'MACD_BEAR_FADING'):'MACD_FLAT';
  return{score:clamp(score,-1,1),label,hist:h,histSlope:slope};
}

export function adxValue(candles,period=14){
  if(candles.length<period*2+1)return null;
  const plus=[],minus=[],tr=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i],p=candles[i-1];
    const up=c.high-p.high,down=p.low-c.low;
    plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);
    tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  const smooth=(arr)=>{let s=arr.slice(0,period).reduce((a,b)=>a+b,0);const out=[s];for(let i=period;i<arr.length;i++){s=s-s/period+arr[i];out.push(s);}return out;};
  const sP=smooth(plus),sM=smooth(minus),sT=smooth(tr);
  const dx=[];
  for(let i=0;i<sP.length;i++){
    const t=sT[i]||1e-9,pdi=100*sP[i]/t,mdi=100*sM[i]/t;
    dx.push(100*Math.abs(pdi-mdi)/Math.max(pdi+mdi,1e-9));
  }
  const adx=sP.length>=period?dx.slice(-period).reduce((a,b)=>a+b,0)/period:dx.at(-1);
  // Directional component: which DI dominates.
  const t=sT.at(-1)||1e-9,di=100*(sP.at(-1)-sM.at(-1))/t;
  return{adx,di,diScore:clamp(di/25,-1,1)};
}

// Regular divergence: price makes a lower low while RSI makes a higher low (bull),
// or price higher high while RSI lower high (bear), over the recent swing window.
export function divergenceContext(candles){
  if(!Array.isArray(candles)||candles.length<40)return{score:0,label:'NONE',rsi:null};
  const closes=candles.map(x=>x.close),rs=rsiSeries(closes,14);
  const n=closes.length-1,win=Math.min(30,candles.length-2);
  // Recent swing extremes vs prior extremes in the earlier half of the window.
  const recentHi=Math.max(...closes.slice(n-Math.floor(win/2)+1,n+1));
  const recentLo=Math.min(...closes.slice(n-Math.floor(win/2)+1,n+1));
  const priorHi=Math.max(...closes.slice(n-win+1,n-Math.floor(win/2)+1));
  const priorLo=Math.min(...closes.slice(n-win+1,n-Math.floor(win/2)+1));
  const rsiAt=i=>rs[i];
  const rNow=rsiAt(n),rPrevHi=rsiAt(n-win+Math.floor(win/2)),rPrevLo=rPrevHi;
  let score=0,label='NONE';
  if(closes[n]<=recentLo&&recentLo<=priorLo&&rNow!=null&&rPrevLo!=null&&rNow>rPrevLo+3){
    score=.7;label='BULL RSI DIVERGENCE';
  }else if(closes[n]>=recentHi&&recentHi>=priorHi&&rNow!=null&&rPrevHi!=null&&rNow<rPrevHi-3){
    score=-.7;label='BEAR RSI DIVERGENCE';
  }
  // Hidden divergence (trend-continuation): price higher low / RSI higher low mismatch.
  else if(closes[n]>priorLo&&rNow!=null&&rPrevLo!=null&&rNow<rPrevLo-3){score=-.25;label='HIDDEN BEAR DIVERGENCE';}
  else if(closes[n]<priorHi&&rNow!=null&&rPrevHi!=null&&rNow>rPrevHi+3){score=.25;label='HIDDEN BULL DIVERGENCE';}
  return{score,label,rsi:rNow!=null?Number(rNow.toFixed(1)):null};
}

export function advancedMomentumFeatures(candles){
  const closes=candles.map(x=>x.close);
  const div=divergenceContext(candles);
  const macd=macdState(closes);
  const adx=adxValue(candles,14);
  const adxVal=adx?Number(adx.adx.toFixed(1)):null;
  // Composite: divergence dominates; MACD supports; ADX scales trend-side confidence.
  // In strong trend (adx>=25) MACD gets more voice; in chop, divergence/mean-reversion gets more.
  let composite=0;
  if(adx&&adx.adx>=25)composite=clamp(div.score*.35+macd.score*.55+adx.diScore*.10,-1,1);
  else composite=clamp(div.score*.60+macd.score*.40,-1,1);
  return{
    divergence:div.label,divergenceScore:Number(div.score.toFixed(3)),rsiSeriesLast:div.rsi,
    macdState:macd.label,macdHistScore:Number(macd.score.toFixed(3)),
    adx:adxVal,adxDirectional:Number(adx?adx.diScore.toFixed(3):0),
    advancedMomentumScore:Number(composite.toFixed(3))
  };
}
