const symbolMap={EURUSD:'EUR/USD',EURJPY:'EUR/JPY',GBPUSD:'GBP/USD',CADCHF:'CAD/CHF',USDJPY:'USD/JPY',NZDCHF:'NZD/CHF',USDPKR:'USD/PKR',USDINR:'USD/INR',BTCUSD:'BTC/USD',XAUUSD:'XAU/USD'};
const DAILY_LIMIT=800, CREDITS_PER_PREDICTION=4;
let budgetDay='', creditsUsed=0;
function utcDay(){return new Date().toISOString().slice(0,10)}
function resetBudget(){const d=utcDay();if(d!==budgetDay){budgetDay=d;creditsUsed=0}}
function normalize(values){return values.map(v=>({time:new Date(String(v.datetime).replace(' ','T')+'Z').getTime(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close),volume:v.volume==null?null:Number(v.volume)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);}
async function series(pair,interval,outputsize){
 const key=process.env.TWELVE_DATA_API_KEY;if(!key)throw new Error('TWELVE_DATA_API_KEY is not configured on the server');
 const symbol=symbolMap[pair];if(!symbol)throw new Error('Unsupported pair');
 const u=new URL('https://api.twelvedata.com/time_series');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('outputsize',String(outputsize));u.searchParams.set('timezone','UTC');u.searchParams.set('apikey',key);
 const r=await fetch(u,{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`Market data HTTP ${r.status}`);const j=await r.json();if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'Market data unavailable');
 creditsUsed+=1;return normalize(j.values);
}
export async function getPredictionBundle(pair){
 resetBudget();if(creditsUsed+CREDITS_PER_PREDICTION>DAILY_LIMIT)throw new Error('Daily trial API budget exhausted');
 // Exactly four market-data requests are used for each prediction cycle.
 const [m1,m5,m15,h1]=await Promise.all([series(pair,'1min',300),series(pair,'5min',220),series(pair,'15min',180),series(pair,'1h',120)]);
 return {m1,m5,m15,h1,budget:getBudget()};
}
export function getBudget(){resetBudget();return{dailyLimit:DAILY_LIMIT,creditsPerPrediction:CREDITS_PER_PREDICTION,creditsUsed,creditsRemaining:Math.max(0,DAILY_LIMIT-creditsUsed),predictionsRemaining:Math.floor(Math.max(0,DAILY_LIMIT-creditsUsed)/CREDITS_PER_PREDICTION),dayUTC:budgetDay};}
export function marketSymbol(pair){return symbolMap[pair]||pair;}
