const symbolMap={EURUSD:'EUR/USD',EURJPY:'EUR/JPY',GBPUSD:'GBP/USD',CADCHF:'CAD/CHF',USDJPY:'USD/JPY',NZDCHF:'NZD/CHF',USDPKR:'USD/PKR',USDINR:'USD/INR',BTCUSD:'BTC/USD',XAUUSD:'XAU/USD'};
const DAILY_LIMIT=800,MINUTE_LIMIT=8,CREDITS_PER_PREDICTION=4;
const intervalMs={'1min':60_000,'5min':300_000,'15min':900_000,'1h':3_600_000};
let budgetDay='',creditsUsed=0,minuteKey='',minuteReserved=0,lastProviderUsed=null,lastProviderLeft=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function utcDay(){return new Date().toISOString().slice(0,10)}
function utcMinute(){return new Date().toISOString().slice(0,16)}
function resetBudget(){const d=utcDay();if(d!==budgetDay){budgetDay=d;creditsUsed=0}}
function resetMinute(){const m=utcMinute();if(m!==minuteKey){minuteKey=m;minuteReserved=0;lastProviderUsed=null;lastProviderLeft=null}}
function msToNextMinute(){return 60_000-(Date.now()%60_000)+350}
function normalize(values,interval){const now=Date.now(),dur=intervalMs[interval]||60_000;return values.map(v=>({time:new Date(String(v.datetime).replace(' ','T')+'Z').getTime(),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close),volume:v.volume==null?null:Number(v.volume)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.time+dur<=now-250).sort((a,b)=>a.time-b.time);}
async function reservePredictionCredits(){resetBudget();resetMinute();if(creditsUsed+CREDITS_PER_PREDICTION>DAILY_LIMIT)throw new Error('Daily Twelve Data trial limit reached (800/800). Resets at 00:00 UTC.');if(minuteReserved+CREDITS_PER_PREDICTION>MINUTE_LIMIT){await sleep(msToNextMinute());resetMinute();}minuteReserved+=CREDITS_PER_PREDICTION;}
function syncProviderHeaders(r){const used=Number(r.headers.get('api-credits-used')),left=Number(r.headers.get('api-credits-left'));if(Number.isFinite(used))lastProviderUsed=used;if(Number.isFinite(left))lastProviderLeft=left;}
async function requestSeries(pair,interval,outputsize,retry429=true){
 const key=process.env.TWELVE_DATA_API_KEY;if(!key)throw new Error('TWELVE_DATA_API_KEY is not configured on the server');
 const symbol=symbolMap[pair];if(!symbol)throw new Error('Unsupported pair');
 const u=new URL('https://api.twelvedata.com/time_series');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('outputsize',String(outputsize));u.searchParams.set('timezone','UTC');u.searchParams.set('apikey',key);
 const r=await fetch(u,{headers:{accept:'application/json'},cache:'no-store'});syncProviderHeaders(r);
 if(r.status===429){if(retry429){await sleep(msToNextMinute());resetMinute();return requestSeries(pair,interval,outputsize,false);}let detail='';try{const j=await r.json();detail=j?.message||''}catch{}throw new Error(detail?`Twelve Data rate limit: ${detail}`:'Twelve Data quota still exhausted after minute reset; the 800/day limit may have been reached.');}
 if(!r.ok)throw new Error(`Market data HTTP ${r.status}`);const j=await r.json();if(j.status==='error'||!Array.isArray(j.values))throw new Error(j.message||'Market data unavailable');creditsUsed+=1;return normalize(j.values,interval);
}
export async function getPredictionBundle(pair){
 await reservePredictionCredits();
 // Basic plan: 8 API credits/minute, 800/day. One prediction intentionally uses exactly four 1-credit time_series calls.
 // Requests are sequential to avoid a burst and to make 429 recovery deterministic.
 const m1=await requestSeries(pair,'1min',320);
 const m5=await requestSeries(pair,'5min',220);
 const m15=await requestSeries(pair,'15min',180);
 const h1=await requestSeries(pair,'1h',120);
 if(m1.length<80)throw new Error('Not enough completed M1 candles available');
 return {m1,m5,m15,h1,budget:getBudget()};
}
export function getBudget(){resetBudget();resetMinute();const dailyRemaining=Math.max(0,DAILY_LIMIT-creditsUsed);return{dailyLimit:DAILY_LIMIT,minuteLimit:MINUTE_LIMIT,creditsPerPrediction:CREDITS_PER_PREDICTION,creditsUsed,creditsRemaining:dailyRemaining,predictionsRemaining:Math.floor(dailyRemaining/CREDITS_PER_PREDICTION),minuteReserved,minuteCreditsRemaining:Math.max(0,MINUTE_LIMIT-minuteReserved),providerMinuteUsed:lastProviderUsed,providerMinuteLeft:lastProviderLeft,dayUTC:budgetDay};}
export function marketSymbol(pair){return symbolMap[pair]||pair;}
