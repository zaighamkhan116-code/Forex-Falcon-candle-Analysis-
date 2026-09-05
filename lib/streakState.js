const keyOf=(pair,h)=>`${String(pair||'').toUpperCase()}:${Number(h)||1}`;
const states=new Map();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function signature(signal={}){
  const f=signal.features||{},d=String(signal.direction||'').toUpperCase(),sign=d==='BUY'?1:-1;
  const tags=[];
  if(f.failureToProgress===true||Number(f.progressScore||0)*sign<=0)tags.push('NO_PROGRESS');
  if(Number(f.mtfOppositionCount||0)>=2)tags.push('MTF_CONFLICT');
  if(f.transitionRiskActive===true)tags.push('TRANSITION');
  if(f.lateCounterTrendRisk===true)tags.push('LATE');
  if(f.bullExtended===true||f.bearExtended===true||f.vwapExtended===true)tags.push('EXTENDED');
  if(['APPROACHING','MITIGATING'].includes(String(f.activeFvgState||'').toUpperCase()))tags.push('UNRESOLVED_FVG');
  if(Number(f.vsaScore||0)*sign<-.15||f.vsaPoorResult===true)tags.push('POOR_VSA');
  if(Number(f.candleBodyRatio||0)<.35)tags.push('WEAK_BODY');
  const hostile=d==='BUY'?Number(f.upperWickRatioVsa??f.lastUpperWickRatio??0):Number(f.lowerWickRatioVsa??f.lastLowerWickRatio??0);
  if(hostile>=.38)tags.push('HOSTILE_WICK');
  if(Number(f.efficiency||0)<.22)tags.push('LOW_EFFICIENCY');
  if(Number(f.sequencePressure||0)*sign<-.08)tags.push('SEQUENCE_CONFLICT');
  return [...new Set(tags)].sort();
}

export function recordTrackOutcome(signal={}){
  if(!['WIN','LOSS','TIE'].includes(String(signal.result||'').toUpperCase()))return null;
  const k=keyOf(signal.pair,signal.horizon),s=states.get(k)||{lossRun:0,winRun:0,recent:[]};
  const r=String(signal.result).toUpperCase();
  if(r==='LOSS'){s.lossRun++;s.winRun=0}else if(r==='WIN'){s.winRun++;s.lossRun=0}
  s.recent.push({result:r,direction:String(signal.direction||'').toUpperCase(),tags:signature(signal),at:Number(signal.resolvedAt||Date.now())});
  s.recent=s.recent.slice(-12);states.set(k,s);return snapshot(signal.pair,signal.horizon);
}

export function snapshot(pair,horizon){
  const s=states.get(keyOf(pair,horizon))||{lossRun:0,winRun:0,recent:[]};
  const losses=s.recent.filter(x=>x.result==='LOSS'),wins=s.recent.filter(x=>x.result==='WIN');
  const countTags=rows=>{const m={};for(const x of rows)for(const t of x.tags)m[t]=(m[t]||0)+1;return m};
  return{lossRun:s.lossRun,winRun:s.winRun,recent:[...s.recent],lossTags:countTags(losses),winTags:countTags(wins)};
}

export function applyStreakState(signal={}){
  const st=snapshot(signal.pair,signal.horizon),f=signal.features||{},tags=signature(signal),lossCounts=st.lossTags,winCounts=st.winTags;
  let adjustment=0;const reasons=[];
  // Never react to one loss. Start only after repeat evidence within this exact track.
  if(st.lossRun>=2){
    for(const t of tags){
      const lc=lossCounts[t]||0,wc=winCounts[t]||0;
      if(lc>=2&&lc>wc+1){adjustment-=0.9;reasons.push(`REPEAT_LOSS_${t}`)}
    }
    if(st.lossRun>=3&&reasons.length>=2){adjustment-=1.2;reasons.push('COMPOUND_LOSS_STATE')}
  }
  // Positive templates can earn confidence back, but only when repeatedly associated with wins.
  if(st.winRun>=2){
    for(const t of tags){const wc=winCounts[t]||0,lc=lossCounts[t]||0;if(wc>=2&&wc>lc+1){adjustment+=0.45;reasons.push(`REPEAT_WIN_${t}`)}}
  }
  adjustment=clamp(adjustment,-4,2);
  return{...signal,confidence:Number(clamp(Number(signal.confidence||57)+adjustment,57,82).toFixed(1)),features:{...f,streakStateVersion:'V6.1',streakLossRun:st.lossRun,streakWinRun:st.winRun,streakAdjustment:Number(adjustment.toFixed(2)),streakStateTags:tags,streakStateReasons:[...new Set(reasons)]}};
}
