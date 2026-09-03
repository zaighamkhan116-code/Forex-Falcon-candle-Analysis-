import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShadowPayload,requestShadowPrediction,settleShadowPrediction} from '../lib/shadowEnsemble.js';

test('shadow payload keeps numeric market-state features',()=>{
  const p=buildShadowPayload({pair:'USDJPY',horizon:1,direction:'SELL',confidence:64.2,regime:'CHOPPY',features:{moveQualityScore:3.2,bearExtended:true,label:'ignore'}});
  assert.equal(p.pair,'USDJPY');
  assert.equal(p.features.moveQualityScore,3.2);
  assert.equal(p.features.bearExtended,1);
  assert.equal('label' in p.features,false);
});

test('shadow inference is disabled without configured service',async()=>{
  const x=await requestShadowPrediction({pair:'EURUSD',horizon:1,features:{}},{url:''});
  assert.equal(x.status,'DISABLED');
});

test('shadow timeout or failure never changes live signal',async()=>{
  const signal={pair:'EURUSD',horizon:1,direction:'BUY',confidence:60,features:{}};
  const x=await requestShadowPrediction(signal,{url:'http://shadow',fetchImpl:async()=>{throw new Error('offline')}});
  assert.equal(x.status,'UNAVAILABLE');
  assert.equal(signal.direction,'BUY');
  assert.equal(signal.confidence,60);
});

test('shadow uses exact same candle for settlement',()=>{
  assert.equal(settleShadowPrediction({status:'READY',direction:'SELL',confidence:67},1.2,1.1).result,'WIN');
  assert.equal(settleShadowPrediction({status:'READY',direction:'BUY',confidence:67},1.2,1.1).result,'LOSS');
});
