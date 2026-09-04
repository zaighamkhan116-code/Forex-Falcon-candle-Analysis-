const DEFAULT_TIMEOUT_MS=5000;
const DEFAULT_URL='http://127.0.0.1:8001';
let shadowHealth={status:'STARTING',url:process.env.SHADOW_MODEL_URL||DEFAULT_URL,lastCheckedAt:null,lastReadyAt:null,lastError:null,modelVersion:null};

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function scalar(v){if(typeof v==='boolean')return v?1:0;if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v==='string'){const n=Number(v);return Number.isFinite(n)?n:null}return null}
function cleanCandles(rows){return (rows||[]).slice(-90).map(x=>({time:finite(x?.time),open:finite(x?.open),high:finite(x?.high),low:finite(x?.low),close:finite(x?.close),volume:finite(x?.volume)||0})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite))}

export function buildShadowPayload(signal,{candles=[]}={}){
  const f=signal?.features||{},features={};
  for(const [k,v] of Object.entries(f)){const x=scalar(v);if(x!==null)features[k]=x}
  const top={confidence:finite(signal?.confidence),qualityScore:finite(signal?.qualityScore),evidenceScore:finite(signal?.evidenceScore),technicalConfidence:finite(signal?.technicalConfidence),liveConfirmationConfidence:finite(signal?.liveConfirmationConfidence)};
  for(const [k,v] of Object.entries(top))if(v!==null)features[k]=v;
  return{pair:String(signal?.pair||'').toUpperCase(),horizon:Number(signal?.horizon||f.horizon||1),analysisTimeframe:signal?.analysisTimeframe||f.analysisTimeframe||null,signalBoundary:Number(signal?.signalBoundary||signal?.boundary||0),falconDirection:String(signal?.direction||'').toUpperCase(),falconConfidence:finite(signal?.confidence),regime:signal?.regime||null,features,candles:cleanCandles(candles)};
}

export function settleShadowPrediction(shadow,open,close){
  if(!shadow||shadow.status!=='READY'||!['BUY','SELL'].includes(shadow.direction))return shadow||null;
  const d=Number(close)-Number(open);if(!Number.isFinite(d))return shadow;
  const result=d===0?'TIE':(shadow.direction==='BUY'?d>0:d<0)?'WIN':'LOSS';
  return{...shadow,result,settled:true,priceDifference:d};
}

export function getShadowHealth(){return{...shadowHealth}}

export async function checkShadowHealth({url=process.env.SHADOW_MODEL_URL||DEFAULT_URL,timeoutMs=Number(process.env.SHADOW_MODEL_TIMEOUT_MS||DEFAULT_TIMEOUT_MS),fetchImpl=globalThis.fetch}={}){
  const checkedAt=Date.now();shadowHealth={...shadowHealth,url,lastCheckedAt:checkedAt};
  if(typeof fetchImpl!=='function'){shadowHealth={...shadowHealth,status:'UNAVAILABLE',lastError:'FETCH_UNAVAILABLE'};return getShadowHealth()}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(250,timeoutMs));
  try{const res=await fetchImpl(`${String(url).replace(/\/$/,'')}/health`,{signal:controller.signal});const x=await res.json().catch(()=>({}));if(!res.ok||x?.ok!==true){shadowHealth={...shadowHealth,status:'UNAVAILABLE',lastError:x?.error||x?.detail||`HTTP_${res.status}`,modelVersion:x?.modelVersion||null};return getShadowHealth()}shadowHealth={...shadowHealth,status:'READY',lastReadyAt:Date.now(),lastError:null,modelVersion:x?.modelVersion||null,validation:x?.validation||null,researchOnly:x?.researchOnly!==false};return getShadowHealth()}catch(e){shadowHealth={...shadowHealth,status:e?.name==='AbortError'?'TIMEOUT':'UNAVAILABLE',lastError:e?.message||String(e)};return getShadowHealth()}finally{clearTimeout(timer)}}

async function defaultM1History(signal){
  try{const {getStagedSnapshot}=await import('./marketData.js');const bundle=await getStagedSnapshot(String(signal?.pair||'').toUpperCase());return cleanCandles(bundle?.m1||[])}catch(e){throw new Error(`CANDLE_HISTORY_UNAVAILABLE: ${e?.message||e}`)}
}

export async function requestShadowPrediction(signal,{url=process.env.SHADOW_MODEL_URL||DEFAULT_URL,timeoutMs=Number(process.env.SHADOW_MODEL_TIMEOUT_MS||DEFAULT_TIMEOUT_MS),fetchImpl=globalThis.fetch,candles=[]}={}){
  const requestedAt=Date.now();
  if(typeof fetchImpl!=='function')return{status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:'FETCH_UNAVAILABLE',influencedLiveSignal:false};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(250,timeoutMs));
  try{
    const res=await fetchImpl(`${String(url).replace(/\/$/,'')}/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(buildShadowPayload(signal,{candles})),signal:controller.signal});
    if(!res.ok){let detail='';try{detail=(await res.text()).slice(0,400)}catch{}const reason=detail||`HTTP_${res.status}`;shadowHealth={...shadowHealth,status:'UNAVAILABLE',lastCheckedAt:Date.now(),lastError:reason};return{status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,httpStatus:res.status,reason,influencedLiveSignal:false}}
    const x=await res.json(),direction=String(x.direction||'').toUpperCase(),confidence=finite(x.confidence);
    if(!['BUY','SELL'].includes(direction)||confidence===null)return{status:'INVALID',model:x.model||'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:'INVALID_PREDICTION',influencedLiveSignal:false};
    shadowHealth={...shadowHealth,status:'READY',lastCheckedAt:Date.now(),lastReadyAt:Date.now(),lastError:null,modelVersion:x.modelVersion||null,validation:x.validation||null,researchOnly:x.researchOnly!==false};
    return{status:'READY',model:x.model||'RF+EXTRATREES+HISTGB_SHADOW_V1',modelVersion:x.modelVersion||null,direction,confidence,memberProbabilities:x.memberProbabilities||null,calibratedProbability:finite(x.calibratedProbability),rawDirectionalConfidence:finite(x.rawDirectionalConfidence),featureSchema:x.featureSchema||null,validation:x.validation||null,researchOnly:x.researchOnly!==false,requestedAt,receivedAt:Date.now(),influencedLiveSignal:false};
  }catch(e){const status=e?.name==='AbortError'?'TIMEOUT':'UNAVAILABLE',reason=e?.message||String(e);shadowHealth={...shadowHealth,status,lastCheckedAt:Date.now(),lastError:reason};return{status,model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason,influencedLiveSignal:false}}finally{clearTimeout(timer)}
}

export function attachShadowPrediction(signal,options={}){
  signal.shadowModel={status:'PENDING',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt:Date.now(),influencedLiveSignal:false};
  const run=async()=>{let candles=options.candles||[];if(options.candlesPromise){candles=await options.candlesPromise}else if(!candles.length){candles=await defaultM1History(signal)}return requestShadowPrediction(signal,{...options,candles})};
  run().then(x=>{signal.shadowModel=x}).catch(e=>{const reason=e?.message||String(e);shadowHealth={...shadowHealth,status:'UNAVAILABLE',lastCheckedAt:Date.now(),lastError:reason};signal.shadowModel={status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',reason,influencedLiveSignal:false}});
  return signal;
}
