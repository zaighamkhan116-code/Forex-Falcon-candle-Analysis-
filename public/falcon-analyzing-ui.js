(()=>{
  const $=id=>document.getElementById(id);
  let startup=false;
  let baseline='';

  function signature(a){
    if(!a)return '';
    return JSON.stringify([
      a.candleTime||null,
      a.direction||null,
      Number(a.confidence||0),
      Number(a.evidenceScore||0),
      a.engine||null,
      a.features?.snapshotDirections||null,
      a.features?.finalEvidenceScore||null
    ]);
  }

  function addStyles(){
    if(document.getElementById('falcon-analyzing-style'))return;
    const s=document.createElement('style');
    s.id='falcon-analyzing-style';
    s.textContent=`
      .signal-orb.falcon-analyzing{
        border-color:rgba(79,218,255,.95)!important;
        box-shadow:inset 10px 14px 28px rgba(130,230,255,.10),inset -20px -24px 34px rgba(0,0,0,.42),0 0 20px rgba(74,215,255,.50),0 0 48px rgba(49,187,255,.30),0 18px 48px rgba(0,0,0,.40)!important
      }
      .signal-orb.falcon-analyzing span,.signal-orb.falcon-analyzing strong{
        color:#58dcff!important;
        text-shadow:0 0 7px rgba(88,220,255,.95),0 0 18px rgba(52,196,255,.85),0 0 34px rgba(29,151,255,.50)!important
      }
      .signal-orb.falcon-analyzing span{font-size:21px!important;letter-spacing:.06em}
      .signal-orb.falcon-analyzing strong{font-size:22px!important;letter-spacing:.06em}
      .status.falcon-startup-status{
        color:#58dcff!important;
        text-shadow:0 0 7px rgba(88,220,255,.9),0 0 16px rgba(52,196,255,.55)!important
      }
    `;
    document.head.appendChild(s);
  }

  function selectedPair(){return $('pair')?.value||'EURUSD'}

  function showStartup(){
    const orb=$('signalButton'),dir=$('direction'),prob=$('probability'),status=$('status');
    if(!orb||!dir||!prob)return;
    orb.className='signal-orb idle analyzing falcon-analyzing';
    dir.textContent='ANALYSING';
    prob.textContent='MARKET';
    if(status){
      status.classList.add('falcon-startup-status');
      status.textContent=`Falcon is analysing ${selectedPair()}…`;
    }
  }

  function clearStartupStyle(){
    $('status')?.classList.remove('falcon-startup-status');
  }

  function beginStartup(){
    if(state?.engine?.running)return;
    baseline=signature(state?.engine?.lastAnalysis);
    startup=true;
    showStartup();
  }

  function fixedRenderSignal(x){
    const a=x?.lastAnalysis;
    const h=(x?.history||[])[0];
    const phase=String(x?.phase||'');

    if(startup){
      const current=signature(a);
      if(a&&current&&current!==baseline){
        startup=false;
        clearStartupStyle();
      }else{
        showStartup();
        return;
      }
    }

    clearStartupStyle();

    if(phase==='PAUSED_20'||phase==='SETTLING'){
      orb.className='signal-orb paused';
      direction.textContent='SESSION';
      prob.textContent=phase==='SETTLING'?'SETTLING':'PAUSED';
      status.textContent=phase==='SETTLING'?'20/20 signals complete · settling final result':'20/20 signals complete · tap circle to start again';
      return;
    }

    if(a&&(String(a.direction).toUpperCase()==='BUY'||String(a.direction).toUpperCase()==='SELL')){
      orb.className=`signal-orb ${String(a.direction).toLowerCase()}`;
      direction.textContent=String(a.direction).toUpperCase();
      prob.textContent=`${Number(a.confidence).toFixed(1)}%`;
      status.textContent=x.running?`${selectedPair()} live signals · ${x.runSignals}/${x.targetSignals}`:`${phase||'STOPPED'} · background research continues`;
      return;
    }

    if(h&&(String(h.direction).toUpperCase()==='BUY'||String(h.direction).toUpperCase()==='SELL')){
      orb.className=`signal-orb ${String(h.direction).toLowerCase()}`;
      direction.textContent=String(h.direction).toUpperCase();
      prob.textContent=`${Number(h.probability).toFixed(1)}%`;
      status.textContent=`${selectedPair()} live signals`;
      return;
    }

    if(x.running){
      orb.className='signal-orb idle';
      direction.textContent='WAITING';
      prob.textContent='SIGNAL';
      status.textContent=`${selectedPair()} live analysis active`;
      return;
    }

    orb.className='signal-orb idle';
    direction.textContent='START';
    prob.textContent='ANALYSIS';
    status.textContent=`Background research active · ${selectedPair()} ${state?.horizon||1}M`;
  }

  function start(){
    addStyles();
    const button=$('signalButton');
    if(button)button.addEventListener('click',beginStartup);
    window.renderSignal=fixedRenderSignal;
    try{renderSignal=fixedRenderSignal}catch{}
  }

  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();