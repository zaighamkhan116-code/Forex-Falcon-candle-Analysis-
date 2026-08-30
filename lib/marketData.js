const cache=new Map();
const TTL=45_000;
const symbolMap={EURUSD:'EUR/USD',EURJPY:'EUR/JPY',GBPUSD:'GBP/USD',CADCHF:'CAD/CHF',USDJPY:'USD/JPY',NZDCHF:'NZD/CHF',USDPKR:'USD/PKR',USDINR:'USD/INR',BTCUSD:'BTC/USD',XAUUSD:'XAU/USD'};
function normalize(values){return values.map(v=>({time:new Date(String(v.datetime).replace(' ','T')+'Z').getTime(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close),volume:v.volume==null?null:Number(v.volume)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);}
export async function getM1(pair,outputsize=300){
 const key=process.env.TWELVE_DATA_API_KEY;if(!key)throw new Error('TWELVE_DATA_API_KEY is not configured on the server');
 const symbol=symbolMap[pair];if(!symbol)throw new Error('Unsupported pair');const hit=cache.get(pair);if(hit&&Date.now()-hit.at<TTL)return hit.data;
 const u=new URL('https://api.twelvedata.com/time_series');u.searchParams.set('symbol',symbol);u.searchParams.set('interval','1min');u.searchParams.set('outputsize',String(outputsize));u.searchParams.set('timezone','UTC');u.searchParams.set('apikey',key);
 const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`Market data HTTP ${r.status}`);const j=await r.json();if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'Market data unavailable');const data=normalize(j.values);cache.set(pair,{at:Date.now(),data});return data;
}
export function marketSymbol(pair){return symbolMap[pair]||pair;}
