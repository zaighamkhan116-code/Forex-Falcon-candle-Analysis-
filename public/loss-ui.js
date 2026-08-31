(()=>{
  let lastId='';
  function ensureBox(){
    const card=document.querySelector('.analysis-card');if(!card)return null;
    let box=document.getElementById('lossReview');
    if(!box){box=document.createElement('div');box.id='lossReview';box.style.cssText='margin-top:12px;padding-top:11px;border-top:1px solid rgba(156,92,255,.18);font-size:11px;line-height:1.5;color:#bcb1cc';card.appendChild(box);}
    return box;
  }
  const pretty=s=>String(s||'').replaceAll('_',' ').toLowerCase();
  async function refresh(){
    try{
      const r=await fetch('/api/engine/state',{cache:'no-store'});if(!r.ok)return;
      const x=await r.json(),box=ensureBox();if(!box)return;
      const rev=x.lastLossReview,ctx=x.adaptiveContext;
      if(!rev){box.innerHTML='<span style="color:#746a86">POST-LOSS REVIEW: waiting for a losing signal to diagnose.</span>';return;}
      const id=rev.signalId||rev.createdAt||'';lastId=id;
      const reasons=(rev.reasons||[]).map(pretty).join(', ');
      const active=ctx?` Adaptive filter active for ${ctx.remainingCycles} more cycle${ctx.remainingCycles===1?'':'s'}.`:'';
      box.innerHTML=`<b style="color:#d6c4ff">POST-LOSS REVIEW</b><br>${rev.lostDirection} failed: ${reasons}.${active}`;
    }catch{}
  }
  setInterval(refresh,2200);setTimeout(refresh,900);
})();
