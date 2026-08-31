const BINANCE='https://api.binance.com';
const history=new Map();
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
const sum=a=>a.reduce((x,y)=>x+y,0);
const num=v=>Number(v)||0;

export function microstructureSupported(pair){return String(pair).toUpperCase()==='BTCUSD';}
export function microstructureSymbol(pair){return microstructureSupported(pair)?'BTCUSDT':null;}

async function getJson(url){
  const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(4500)});
  if(!r.ok)throw new Error(`Binance microstructure HTTP ${r.status}`);
  return r.json();
}
function depthImbalance(bids,asks,n){
  const b=sum(bids.slice(0,n).map(x=>num(x[1]))),a=sum(asks.slice(0,n).map(x=>num(x[1])));
  return (b-a)/(b+a+1e-12);
}
function tradeImbalance(trades){
  let buy=0,sell=0;
  for(const t of trades){const q=num(t.qty);if(t.isBuyerMaker)sell+=q;else buy+=q;}
  return{score:(buy-sell)/(buy+sell+1e-12),buyQty:buy,sellQty:sell};
}
function previous(symbol){const h=history.get(symbol)||[];return h.at(-1)||null;}
function remember(symbol,x){const h=history.get(symbol)||[];h.push(x);history.set(symbol,h.slice(-12));}

export async function getMicrostructureSnapshot(pair){
  const symbol=microstructureSymbol(pair);if(!symbol)return null;
  const [book,trades]=await Promise.all([
    getJson(`${BINANCE}/api/v3/depth?symbol=${symbol}&limit=20`),
    getJson(`${BINANCE}/api/v3/trades?symbol=${symbol}&limit=200`)
  ]);
  const bids=book.bids||[],asks=book.asks||[];
  if(!bids.length||!asks.length)throw new Error('Binance order book is empty');
  const bid=num(bids[0][0]),ask=num(asks[0][0]),bidQty=num(bids[0][1]),askQty=num(asks[0][1]);
  const mid=(bid+ask)/2,spread=Math.max(ask-bid,1e-12);
  const microprice=(ask*bidQty+bid*askQty)/(bidQty+askQty+1e-12);
  const micropricePressure=clamp((microprice-mid)/(spread*.5+1e-12));
  const imbalance1=depthImbalance(bids,asks,1),imbalance5=depthImbalance(bids,asks,5),imbalance10=depthImbalance(bids,asks,10);
  const trade=tradeImbalance(trades);
  const prev=previous(symbol);
  const ofiAcceleration=prev?clamp((imbalance5-prev.imbalance5)*1.8+(imbalance10-prev.imbalance10)*1.1):0;
  const tradeAcceleration=prev?clamp(trade.score-prev.tradeImbalance):0;
  const pressure=clamp(imbalance1*.12+imbalance5*.22+imbalance10*.22+micropricePressure*.14+trade.score*.22+ofiAcceleration*.06+tradeAcceleration*.02);
  const direction=pressure>=0?'BUY':'SELL';
  const quality=clamp(Math.abs(pressure)*.70+Math.abs(imbalance10)*.15+Math.abs(trade.score)*.15,0,1);
  const out={source:'BINANCE_SPOT',symbol,timestamp:Date.now(),bid,ask,mid,spread,imbalance1,imbalance5,imbalance10,microprice,micropricePressure,tradeImbalance:trade.score,buyQty:trade.buyQty,sellQty:trade.sellQty,ofiAcceleration,tradeAcceleration,pressure,direction,quality};
  remember(symbol,out);return out;
}

export function applyMicrostructure(result,micro){
  if(!micro)return result;
  const technicalDir=result.direction==='BUY'?1:-1,microDir=micro.direction==='BUY'?1:-1;
  const techStrength=clamp((Number(result.confidence||50)-50)/30,0,1);
  const microStrength=clamp(Math.abs(micro.pressure),0,1);
  const evidence=clamp(technicalDir*techStrength*.56+microDir*microStrength*.44);
  const direction=evidence>=0?'BUY':'SELL';
  const agreement=technicalDir===microDir;
  // Deliberately conservative: microstructure changes direction/evidence, but does not invent 70-80% probabilities.
  let confidence=50+Math.abs(evidence)*18+(agreement?1.5:0)-(!agreement&&microStrength>.45?2:0);
  confidence=clamp(confidence,50,68);
  return{...result,direction,confidence:Number(confidence.toFixed(1)),engine:`${result.engine||'TECHNICAL'}+ORDER_FLOW`,probabilityType:'microstructure-hybrid',microstructure:micro,features:{...(result.features||{}),orderFlow:Number(micro.pressure.toFixed(3)),ofi1:Number(micro.imbalance1.toFixed(3)),ofi5:Number(micro.imbalance5.toFixed(3)),ofi10:Number(micro.imbalance10.toFixed(3)),micropricePressure:Number(micro.micropricePressure.toFixed(3)),tradeFlow:Number(micro.tradeImbalance.toFixed(3)),ofiAcceleration:Number(micro.ofiAcceleration.toFixed(3)),orderFlowQuality:Number(micro.quality.toFixed(3)),orderFlowDirection:micro.direction}};
}
