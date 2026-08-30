const state={running:false,pair:'EURUSD',horizon:1,signals:[],timer:null,nextAt:null};
const $=id=>document.getElementById(id);
const pair=$('pair'),horizons=$('horizons'),orb=$('signalButton'),direction=$('direction'),prob=$('probability'),status=$('status'),countdown=$('countdown'),body=$('historyBody');

async function boot(){
  const cfg=await fetch('/api/config').then(r=>r.json());
  cfg.pairs.forEach(p=>pair.add(new Option(p,p)));
  cfg.horizons.forEach(m=>{const b=document.createElement('button');b.textContent=`${m}M`;b.dataset.m=m;b.onclick=()=>selectHorizon(m);horizons.appendChild(b)});
  selectHorizon(1); render();
}
function selectHorizon(m){state.horizon=Number(m);[...horizons.children].forEach(b=>b.classList.toggle('active',Number(b.dataset.m)===state.horizon));if(state.running)scheduleNext();}
pair.onchange=()=>{state.pair=pair.value;if(state.running){status.textContent=`Reloading ${state.pair} market context…`;scheduleNext();}};
orb.onclick=()=>state.running?null:start();$('stopButton').onclick=stop;
function start(){state.running=true;$('stopButton').classList.remove('hidden');$('sessionState').textContent='ANALYZING';status.textContent='Analysis engine started · waiting for qualifying probability';scheduleNext();}
function stop(){state.running=false;clearInterval(state.timer);state.timer=null;state.nextAt=null;orb.className='signal-orb idle';direction.textContent='START';prob.textContent='ANALYSIS';status.textContent='Tap the circle to start';countdown.textContent='--:--';$('sessionState').textContent='STOPPED';$('stopButton').classList.add('hidden');}
function scheduleNext(){clearInterval(state.timer);const now=Date.now(),span=state.horizon*60000;state.nextAt=Math.ceil(now/span)*span;tick();state.timer=setInterval(tick,250);}
function tick(){if(!state.running)return;const left=Math.max(0,state.nextAt-Date.now());countdown.textContent=`${String(Math.floor(left/60000)).padStart(2,'0')}:${String(Math.floor((left%60000)/1000)).padStart(2,'0')}`;if(left<=0){onBoundary();state.nextAt+=state.horizon*60000;}}
function onBoundary(){
  // UI prototype only. Real probability will come from the server analysis endpoint.
  status.textContent='New candle boundary · awaiting live analysis';
  orb.className='signal-orb idle';direction.textContent='ANALYZING';prob.textContent='…';
}
function showSignal(signal){
  if(signal.probability<60)return;
  orb.className=`signal-orb ${signal.direction.toLowerCase()}`;direction.textContent=signal.direction;prob.textContent=`${signal.probability.toFixed(1)}%`;
  status.textContent=`${state.pair} · ${state.horizon}M qualifying signal`;
  state.signals.unshift(signal);state.signals=state.signals.slice(0,11);render();
}
function render(){
  const rows=state.signals;
  if(!rows.length){body.innerHTML='<tr class="empty"><td colspan="7">No qualifying signals yet</td></tr>';}else body.innerHTML=rows.map((s,i)=>`<tr><td>${rows.length-i}</td><td>${s.pair}</td><td>${s.horizon}M</td><td class="${s.direction==='BUY'?'buy-text':'sell-text'}">${s.direction}</td><td>${s.probability.toFixed(1)}%</td><td>${new Date(s.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td class="${(s.result||'PENDING').toLowerCase()}">${s.result||'PENDING'}</td></tr>`).join('');
  const resolved=rows.filter(s=>s.result==='WIN'||s.result==='LOSS').slice(0,10),wins=resolved.filter(s=>s.result==='WIN').length;$('record').textContent=`${wins} / ${resolved.length}`;$('winrate').textContent=resolved.length?`${Math.round(wins/resolved.length*100)}%`:'--';
}
window.ForexFalcon={showSignal};
boot();
