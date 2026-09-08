import test from 'node:test';
import assert from 'node:assert/strict';
import {requestShadowPrediction} from '../lib/shadowEnsemble.js';

function fakeResponse(status,detail){return{ok:status>=200&&status<300,status,async text(){return JSON.stringify({detail})}}}
const signal={pair:'EURUSD',horizon:5,analysisTimeframe:'5M',direction:'BUY',confidence:64,features:{}};

test('supported-track insufficient history is infrastructure UNAVAILABLE, not UNSUPPORTED',async()=>{
  const out=await requestShadowPrediction(signal,{fetchImpl:async()=>fakeResponse(422,"Insufficient candle history for features: ['body', 'uw', 'lw']"),candles:[]});
  assert.equal(out.status,'UNAVAILABLE');
  assert.equal(out.httpStatus,422);
  assert.equal(out.influencedLiveSignal,false);
});

test('explicit unsupported horizon remains UNSUPPORTED and fail-open',async()=>{
  const out=await requestShadowPrediction({...signal,horizon:30},{fetchImpl:async()=>fakeResponse(422,'Unsupported horizon 30'),candles:[]});
  assert.equal(out.status,'UNSUPPORTED');
  assert.equal(out.influencedLiveSignal,false);
});
