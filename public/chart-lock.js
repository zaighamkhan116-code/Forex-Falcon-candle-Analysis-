(()=>{
  const original=window.renderTradingView;
  if(typeof original!=='function') return;
  let lastKey='';
  window.renderTradingView=function(force=false){
    const pair=document.getElementById('pair')?.value||'EURUSD';
    const active=[...document.querySelectorAll('#horizons button')].find(b=>b.classList.contains('active'));
    const tf=active?.dataset?.m||'1';
    const key=`${pair}:${tf}`;
    if(!force && key===lastKey) return;
    lastKey=key;
    return original();
  };
})();