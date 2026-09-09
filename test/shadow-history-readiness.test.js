import test from 'node:test';
import assert from 'node:assert/strict';
import {requestShadowPrediction} from '../lib/shadowEnsemble.js';

function fakeResponse(status,detail){return{ok:status>=200&&status<300,status,async text(){return JSON.stringify({detail})}}}
const signal={pair:'EURUSD',horizon:5,analysisTimeframe:'5M',direction:'BUY',confidence:64,features:{}};
const candles=Array.from({length:60},(_,i)=>({time:i+1,open:1+i*0.0001,high:1.0002+i*0.0001,low:0.9998+i*0.0001,close:1.0001+i*0.0001,volume:1}));

test('insufficient local history stays NOT_READY and skips shadow inference',async()=>{
  let calls=0;
  const out=await requestShadowPrediction(signal,{fetchImpl:async()=>{calls++;return fakeResponse(200,'unexpected')},candles:[]});
  assert.equal(out.status,'NOT_READY');
  assert.match(out.reason,/INSUFFICIENT_CANDLE_HISTORY/);
  assert.equal(calls,0);
  assert.equal(out.influencedLiveSignal,false);
});

test('unsupported pair is classified locally and skips shadow inference',async()=>{
  let calls=0;
  const out=await requestShadowPrediction({...signal,pair:'GBPUSD'},{fetchImpl:async()=>{calls++;return fakeResponse(422,'Current validated shadow family is EURUSD-only')},candles});
  assert.equal(out.status,'UNSUPPORTED');
  assert.match(out.reason,/UNSUPPORTED_SHADOW_PAIR/);
  assert.equal(calls,0);
  assert.equal(out.influencedLiveSignal,false);
});

test('unsupported horizon is classified locally and skips shadow inference',async()=>{
  let calls=0;
  const out=await requestShadowPrediction({...signal,horizon:30},{fetchImpl:async()=>{calls++;return fakeResponse(422,'Unsupported horizon 30')},candles});
  assert.equal(out.status,'UNSUPPORTED');
  assert.equal(calls,0);
  assert.equal(out.influencedLiveSignal,false);
});

test('supported-track feature-history 422 is NOT_READY and does not poison shadow health',async()=>{
  const out=await requestShadowPrediction(signal,{fetchImpl:async()=>fakeResponse(422,"Insufficient candle history for features: ['body', 'uw', 'lw']"),candles});
  assert.equal(out.status,'NOT_READY');
  assert.equal(out.httpStatus,422);
  assert.equal(out.influencedLiveSignal,false);
});

test('supported-track unrelated 422 remains infrastructure UNAVAILABLE',async()=>{
  const out=await requestShadowPrediction(signal,{fetchImpl:async()=>fakeResponse(422,'Model schema mismatch'),candles});
  assert.equal(out.status,'UNAVAILABLE');
  assert.equal(out.httpStatus,422);
  assert.equal(out.influencedLiveSignal,false);
});
