(()=>{
  const $=id=>document.getElementById(id),host=()=>$('marketAnalysis'),pairEl=()=>$('pair');
  let timer=null,requestId=0,lastHtml='',lastKey='',writing=false;
  function horizon(){const b=document.querySelector('#horizons button.active');return Number(b?.dataset?.m)||1}
  function key(){return`${pairEl()?.value||'EURUSD'}:${horizon()}`}
  function tone(v){return v>.18?'bullish':v<-.18?'bearish':'neutral'}
  function contextTone(v){return v>.12?'bullish':v<-.12?'bearish':'mixed'}
  function volCondition(pairName,v,eff){if(eff<.22)return'Market is choppy with weak directional efficiency and frequent two-way movement.';let high=.00022,low=.00007;if(pairName==='BTCUSD'){high=.0012;low=.00035}else if(pairName==='XAUUSD'){high=.00032;low=.00010}else if(pairName==='USDPKR'||pairName==='USDINR'){high=.00014;low=.00004}if(v>=high)return'Market is highly volatile with expanded candle ranges and active price movement.';if(v<=low)return'Market is less volatile with compressed ranges and slower price expansion.';return eff>.42?'Market volatility is normal and price is moving with clean directional efficiency.':'Market volatility is moderate with mixed directional efficiency.'}
  function tfSentence(tf,t){if(t==='bullish')return`${tf} context is bullish, providing upward directional support.`;if(t==='bearish')return`${tf} context is bearish, providing downward directional pressure.`;return`${tf} context is mixed, with no clean directional alignment.`}
  function contextsFor(h){if(h>=15)return[['H1','h1Context']];if(h>=5)return[['M15','m15Context'],['H1','h1Context']];return[['M5','m5Context'],['M15','m15Context'],['H1','h1Context']]}

  function build(x,p,h){
    const f=x?.features||{},items=[];
    const rsi=Number(f.rsi),mom=tone(Number(f.momentum||0)),trend=tone(Number(f.trend||0)),seq=Number(f.sequence||0),eff=Number(f.efficiency||0),vol=Number(f.volatility||0),structure=String(f.structure||'RANGE').toUpperCase(),liq=String(f.liquidity||'NONE').toUpperCase(),br=String(f.breakout||'NONE').toUpperCase(),gap=String(f.fvg||'NONE').toUpperCase(),pat=String(f.pattern||'NONE').toUpperCase(),sr=String(f.sr||'CLEAR').toUpperCase();
    items.push(`<li><b>Market Condition:</b> ${volCondition(p,vol,eff)}</li>`);
    if(structure.includes('BULL'))items.push(`<li><b>Structure:</b> ${structure.includes('BOS')?'Market has bullish structure and has broken the recent swing high.':'Market has bullish structure with price holding above the central structural range.'}</li>`);
    else if(structure.includes('BEAR'))items.push(`<li><b>Structure:</b> ${structure.includes('BOS')?'Market has bearish structure and has broken the recent swing low.':'Market has bearish structure with price holding below the central structural range.'}</li>`);
    else items.push('<li><b>Structure:</b> Market is ranging with no confirmed directional structure.</li>');
    let mt=`Momentum is ${mom}`;if(Number.isFinite(rsi)){mt+=` based on RSI at ${rsi.toFixed(0)}`;if(rsi>=55)mt+=', supporting bullish pressure';else if(rsi<=45)mt+=', supporting bearish pressure';else mt+=', showing balanced pressure'}if(Math.abs(seq)>.18)mt+=`; recent candle sequence confirms ${seq>0?'bullish':'bearish'} pressure`;if(trend!=='neutral')mt+=`; EMA and trend alignment are ${trend}`;items.push(`<li><b>Momentum:</b> ${mt}.</li>`);
    if(Math.abs(Number(f.trend||0))>.45&&eff>.42)items.push(`<li><b>Trend Quality:</b> The market is in a ${trend} trend with clean directional follow-through.</li>`);else if(eff<.22)items.push('<li><b>Trend Quality:</b> Trend quality is weak because price is rotating rather than progressing directionally.</li>');else items.push(`<li><b>Trend Quality:</b> ${trend==='neutral'?'The current trend is still developing.':`The ${trend} trend is present but not yet fully established.`}</li>`);
    if(liq==='SELL-SIDE SWEEP')items.push('<li><b>Liquidity:</b> Recent sell-side liquidity has been swept and price has reclaimed above the liquidity pool.</li>');else if(liq==='BUY-SIDE SWEEP')items.push('<li><b>Liquidity:</b> Recent buy-side liquidity has been swept and price has rejected back below the liquidity pool.</li>');else if(sr==='AT SUPPORT')items.push('<li><b>Liquidity:</b> Price is trading inside or near a support liquidity area where sell-side liquidity may be resting.</li>');else if(sr==='AT RESISTANCE')items.push('<li><b>Liquidity:</b> Price is trading inside or near a resistance liquidity area where buy-side liquidity may be resting.</li>');
    if(br==='BULL ACCEPTANCE')items.push('<li><b>Breakout:</b> Market has just completed a bullish breakout and is accepting above the broken resistance level.</li>');else if(br==='BEAR ACCEPTANCE')items.push('<li><b>Breakout:</b> Market has just completed a bearish breakout and is accepting below the broken support level.</li>');else if(br==='FAILED BULL BREAK')items.push('<li><b>Breakout:</b> The bullish breakout attempt failed; price rejected the breakout level and returned below resistance.</li>');else if(br==='FAILED BEAR BREAK')items.push('<li><b>Breakout:</b> The bearish breakdown attempt failed; price reclaimed the broken support level.</li>');
    if(gap==='BULL')items.push('<li><b>FVG / Imbalance:</b> A fresh bullish FVG is active below current price and may act as a reaction area on retracement.</li>');else if(gap==='BEAR')items.push('<li><b>FVG / Imbalance:</b> A fresh bearish FVG is active above current price and may act as a reaction area on retracement.</li>');
    if(pat!=='NONE')items.push(`<li><b>Candle Pressure:</b> Current candle action shows ${pat.replaceAll('_',' ').toLowerCase()}, adding ${pat.includes('BULL')?'bullish':'bearish'} pressure.</li>`);
    if(eff<.22&&vol<=.00012)items.push('<li><b>Compression / Expansion:</b> Price is compressing with limited directional expansion; watch for volatility expansion from the range.</li>');else if(vol>.00022)items.push('<li><b>Compression / Expansion:</b> Price is already in an expansion phase with wider recent ranges.</li>');
    const conf=Number(x?.confidence||0),dir=String(x?.direction||'').toUpperCase(),aligned=(dir==='BUY'&&mom==='bullish'&&trend==='bullish')||(dir==='SELL'&&mom==='bearish'&&trend==='bearish');items.push(`<li><b>Signal Environment:</b> ${aligned&&conf>=65?`Conditions currently support ${dir} with momentum and trend aligned.`:conf>=60?`Conditions are partially aligned toward ${dir}, but confirmation is mixed.`:'Market conditions are mixed and signal quality is currently reduced.'}</li>`);
    const primary=x.analysisTimeframe||f.analysisTimeframe||`${h}M`;
    const ctx=contextsFor(h).map(([tf,k])=>{const t=contextTone(Number(f[k]||0));return`<section class="tf-analysis-block tf-${tf.toLowerCase()} ${t}"><div class="tf-analysis-head"><strong>${tf} CONTEXT</strong></div><ul class="falcon-analysis-list"><li><b>Market Context:</b> ${tfSentence(tf,t)}</li></ul></section>`}).join('');
    return`<div class="tf-analysis-stack"><section class="tf-analysis-block tf-primary"><div class="tf-analysis-head"><strong>${primary} ANALYSIS</strong></div><ul class="falcon-analysis-list">${items.join('')}</ul></section>${ctx}</div>`;
  }

  function selectedSignal(x,p,h){const pr=(x.backgroundResearch||[]).find(r=>r.pair===p);const hr=pr?.horizons?.[h]||pr?.horizons?.[String(h)]||(Number(pr?.horizon)===Number(h)?pr:null);return{signal:hr?.displaySignal||hr?.currentCandidate||null,research:hr}}
  function apply(html,p,h,meta=''){const el=host();if(!el)return;writing=true;lastHtml=html;lastKey=`${p}:${h}`;el.innerHTML=html;el.dataset.tfFormatted='1';const t=$('analysisTime');if(t)t.textContent=meta||`${p} ${h}M independent timeframe analysis`;queueMicrotask(()=>writing=false)}
  function loading(){const p=pairEl()?.value||'PAIR',h=horizon();lastHtml='';lastKey='';apply(`<ul class="falcon-analysis-list"><li><b>Falcon status:</b> Analyzing ${p} ${h}M independently…</li><li><b>Timeframe isolation:</b> Waiting for the fresh ${h}M boundary analysis.</li></ul>`,p,h,`Waiting for fresh ${p} ${h}M analysis`)}

  async function refresh(force=false){
    const p=pairEl()?.value;if(!p)return;const h=horizon(),k=`${p}:${h}`,id=++requestId;if(force)loading();
    try{
      const r=await fetch('/api/engine/state',{cache:'no-store'}),x=await r.json();if(id!==requestId||key()!==k)return;if(!r.ok)throw new Error(x.error||'Analysis unavailable');
      const {signal,research}=selectedSignal(x,p,h);
      if(!signal){apply(`<ul class="falcon-analysis-list"><li><b>Falcon status:</b> ${p} ${h}M engine is active.</li><li><b>Timeframe isolation:</b> Waiting for analysis near the next true ${h}M candle boundary.</li></ul>`,p,h,`${p} ${h}M · next boundary pending`);return}
      apply(build(signal,p,h),p,h,`${p} ${signal.analysisTimeframe||`${h}M`} · ${signal.qualified?'qualified ≥60%':'below 60%'} · independent results ${research?.sample||0}/20`);
    }catch{if(id!==requestId||key()!==k)return;if(!lastHtml||lastKey!==k)apply(`<ul class="falcon-analysis-list"><li><b>Falcon status:</b> ${p} ${h}M analysis is temporarily unavailable.</li><li><b>Timeframe isolation:</b> No analysis from another timeframe will be displayed.</li></ul>`,p,h)}
  }

  function selectionChanged(){requestId++;loading();setTimeout(()=>refresh(false),80)}
  function protect(){const el=host();if(!el||writing||!lastHtml||lastKey!==key())return;if(el.innerHTML!==lastHtml)apply(lastHtml,pairEl()?.value||'PAIR',horizon())}
  function start(){const el=host();if(!el)return;pairEl()?.addEventListener('change',selectionChanged);$('horizons')?.addEventListener('click',e=>{if(e.target.closest('button'))setTimeout(selectionChanged,0)});new MutationObserver(protect).observe(el,{childList:true,subtree:false});timer=setInterval(()=>refresh(false),1000);setTimeout(()=>refresh(true),250)}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();
