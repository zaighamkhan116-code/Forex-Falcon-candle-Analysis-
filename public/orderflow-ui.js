(() => {
  if(typeof renderAnalysis!=='function')return;
  const original=renderAnalysis;
  renderAnalysis=function(x){
    original(x);
    if(!x?.features)return;
    const f=x.features,host=document.getElementById('marketAnalysis');
    if(!host)return;
    if(Number.isFinite(Number(f.orderFlow))){
      const flow=Number(f.orderFlow),ofi5=Number(f.ofi5||0),ofi10=Number(f.ofi10||0),trade=Number(f.tradeFlow||0),micro=Number(f.micropricePressure||0),accel=Number(f.ofiAcceleration||0);
      const side=flow>.08?'BUY pressure':flow<-.08?'SELL pressure':'balanced';
      const quality=Math.round(Number(f.orderFlowQuality||0)*100);
      host.innerHTML+=`<br><b>ORDER FLOW:</b> ${side} · OFI5 ${ofi5.toFixed(2)} · OFI10 ${ofi10.toFixed(2)} · trades ${trade.toFixed(2)} · microprice ${micro.toFixed(2)} · acceleration ${accel.toFixed(2)} · quality ${quality}%`;
    }else if(f.orderFlowStatus==='UNAVAILABLE'){
      host.innerHTML+='<br><b>ORDER FLOW:</b> temporarily unavailable — technical engine used as fallback.';
    }
  };
})();
