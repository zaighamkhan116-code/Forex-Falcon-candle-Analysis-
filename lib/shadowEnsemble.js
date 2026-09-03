const DEFAULT_TIMEOUT_MS=1200;

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function scalar(v){if(typeof v==='boolean')return v?1:0;if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v==='string'){const n=Number(v);return Number.isFinite(n)?n:null}return null}

export function buildShadowPayload(signal){
  const f=signal?.features||{},features={};
  for(const [k,v] of Object.entries(f)){const x=scalar(v);if(x!==null)features[k]=x}
  const top={
    confidence:finite(signal?.confidence),qualityScore:finite(signal?.qualityScore),evidenceScore:finite(signal?.evidenceScore),
    technicalConfidence:finite(signal?.technicalConfidence),liveConfirmationConfidence:finite(signal?.liveConfirmationConfidence)
  };
  for(const [k,v] of Object.entries(top))if(v!==null)features[k]=v;
  return{
    pair:String(signal?.pair||'').toUpperCase(),horizon:Number(signal?.horizon||f.horizon||1),analysisTimeframe:signal?.analysisTimeframe||f.analysisTimeframe||null,
    signalBoundary:Number(signal?.signalBoundary||signal?.boundary||0),falconDirection:String(signal?.direction||'').toUpperCase(),falconConfidence:finite(signal?.confidence),
    regime:signal?.regime||null,features
  };
}

export function settleShadowPrediction(shadow,open,close){
  if(!shadow||shadow.status!=='READY'||!['BUY','SELL'].includes(shadow.direction))return shadow||null;
  const d=Number(close)-Number(open);if(!Number.isFinite(d))return shadow;
  const result=d===0?'TIE':(shadow.direction==='BUY'?d>0:d<0)?'WIN':'LOSS';
  return{...shadow,result,settled:true,priceDifference:d};
}

export async function requestShadowPrediction(signal,{url=process.env.SHADOW_MODEL_URL,timeoutMs=Number(process.env.SHADOW_MODEL_TIMEOUT_MS||DEFAULT_TIMEOUT_MS),fetchImpl=globalThis.fetch}={}){
  const requestedAt=Date.now();
  if(!url)return{status:'DISABLED',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:'SHADOW_MODEL_URL_NOT_CONFIGURED'};
  if(typeof fetchImpl!=='function')return{status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:'FETCH_UNAVAILABLE'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(100,timeoutMs));
  try{
    const res=await fetchImpl(`${String(url).replace(/\/$/,'')}/predict`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(buildShadowPayload(signal)),signal:controller.signal});
    if(!res.ok){let detail='';try{detail=(await res.text()).slice(0,240)}catch{}return{status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,httpStatus:res.status,reason:detail||`HTTP_${res.status}`}}
    const x=await res.json(),direction=String(x.direction||'').toUpperCase(),confidence=finite(x.confidence);
    if(!['BUY','SELL'].includes(direction)||confidence===null)return{status:'INVALID',model:x.model||'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:'INVALID_PREDICTION'};
    return{status:'READY',model:x.model||'RF+EXTRATREES+HISTGB_SHADOW_V1',modelVersion:x.modelVersion||null,direction,confidence,memberProbabilities:x.memberProbabilities||null,calibratedProbability:finite(x.calibratedProbability),featureSchema:x.featureSchema||null,requestedAt,receivedAt:Date.now(),influencedLiveSignal:false};
  }catch(e){return{status:e?.name==='AbortError'?'TIMEOUT':'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt,reason:e?.message||String(e)}}finally{clearTimeout(timer)}
}

export function attachShadowPrediction(signal,options){
  signal.shadowModel={status:'PENDING',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',requestedAt:Date.now(),influencedLiveSignal:false};
  requestShadowPrediction(signal,options).then(x=>{signal.shadowModel=x}).catch(e=>{signal.shadowModel={status:'UNAVAILABLE',model:'RF+EXTRATREES+HISTGB_SHADOW_V1',reason:e?.message||String(e),influencedLiveSignal:false}});
  return signal;
}
