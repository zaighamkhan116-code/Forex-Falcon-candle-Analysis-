import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShadowPayload,requestShadowPrediction,settleShadowPrediction,getShadowHealth,checkShadowHealth} from '../lib/shadowEnsemble.js';

test('shadow payload keeps numeric market-state features and raw candles',()=>{
  const p=buildShadowPayload({pair:'USDJPY',horizon:1,direction:'SELL',confidence:64.2,regime:'CHOPPY',features:{moveQualityScore:3.2,bearExtended:true,label:'ignore'}},{candles:[{time:1,open:1,high:2,low:.5,close:1.5,volume:3}]});
  assert.equal(p.pair,'USDJPY');
  assert.equal(p.horizon,1);
  assert.equal(p.features.moveQualityScore,3.2);
  assert.equal(p.features.bearExtended,1);
  assert.equal('label' in p.features,false);
  assert.equal(p.candles.length,1);
  assert.equal(p.candles[0].close,1.5);
});

test('shadow service failure is visible and never silently disabled',async()=>{
  const x=await requestShadowPrediction({pair:'EURUSD',horizon:5,features:{}},{url:'http://shadow',candles:[],fetchImpl:async()=>{throw new Error('offline')}});
  assert.equal(x.status,'UNAVAILABLE');
  assert.match(x.reason,/offline/);
});

test('health exposes all supported research-only horizons',async()=>{
  const response={ok:true,status:200,json:async()=>({ok:true,modelVersion:'MULTI',supportedPairs:['EURUSD'],supportedHorizons:[1,2,3,5,15],validationByHorizon:{'1':{},'2':{},'3':{},'5':{},'15':{}},researchOnly:true})};
  const x=await checkShadowHealth({url:'http://shadow',fetchImpl:async()=>response});
  assert.equal(x.status,'READY');
  assert.deepEqual(x.supportedHorizons,[1,2,3,5,15]);
  assert.deepEqual(x.supportedPairs,['EURUSD']);
  assert.equal(x.researchOnly,true);
});

test('unsupported pair or horizon is explicit and does not overwrite READY health',async()=>{
  const readyResponse={ok:true,status:200,json:async()=>({model:'RF+EXTRATREES+HISTGB_SHADOW_V2_MULTI_HORIZON',modelVersion:'REBUILD',direction:'BUY',confidence:62.1,researchOnly:true,horizon:5})};
  await requestShadowPrediction({pair:'EURUSD',horizon:5,features:{}},{url:'http://shadow',candles:[],fetchImpl:async()=>readyResponse});
  assert.equal(getShadowHealth().status,'READY');
  const unsupported={ok:false,status:422,text:async()=>JSON.stringify({detail:'Current validated shadow family is EURUSD-only'})};
  const x=await requestShadowPrediction({pair:'GBPUSD',horizon:5,features:{}},{url:'http://shadow',candles:[],fetchImpl:async()=>unsupported});
  assert.equal(x.status,'UNSUPPORTED');
  assert.match(x.reason,/EURUSD-only/);
  assert.equal(getShadowHealth().status,'READY');
});

test('shadow timeout or failure never changes live signal',async()=>{
  const signal={pair:'EURUSD',horizon:5,direction:'BUY',confidence:60,features:{}};
  const x=await requestShadowPrediction(signal,{url:'http://shadow',candles:[],fetchImpl:async()=>{throw new Error('offline')}});
  assert.equal(x.status,'UNAVAILABLE');
  assert.equal(signal.direction,'BUY');
  assert.equal(signal.confidence,60);
  assert.equal(x.influencedLiveSignal,false);
});

test('all Falcon timeframes can return independent READY shadow predictions',async()=>{
  for(const horizon of [1,2,3,5,15]){
    const signal={pair:'EURUSD',horizon,analysisTimeframe:`${horizon}M`,direction:'SELL',confidence:61,features:{}};
    const response={ok:true,status:200,json:async()=>({model:'RF+EXTRATREES+HISTGB_SHADOW_V2_MULTI_HORIZON',modelVersion:'MULTI',pair:'EURUSD',horizon,analysisTimeframe:`${horizon}M`,direction:horizon%2?'BUY':'SELL',confidence:62.1,calibratedProbability:.621,memberProbabilities:{randomForestBuy:.6,extraTreesBuy:.58,histGradientBoostingBuy:.64},supportedHorizons:[1,2,3,5,15],researchOnly:true})};
    const x=await requestShadowPrediction(signal,{url:'http://shadow',candles:[],fetchImpl:async()=>response});
    assert.equal(x.status,'READY');
    assert.equal(x.horizon,horizon);
    assert.equal(x.analysisTimeframe,`${horizon}M`);
    assert.equal(x.influencedLiveSignal,false);
    assert.equal(signal.direction,'SELL');
    assert.equal(signal.confidence,61);
  }
});

test('shadow uses exact same candle for settlement',()=>{
  assert.equal(settleShadowPrediction({status:'READY',direction:'SELL',confidence:67},1.2,1.1).result,'WIN');
  assert.equal(settleShadowPrediction({status:'READY',direction:'BUY',confidence:67},1.2,1.1).result,'LOSS');
});
