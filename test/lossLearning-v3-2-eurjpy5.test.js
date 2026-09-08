import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLossContext} from '../lib/lossLearning.js';

const base=(pair='EURJPY',horizon=5,features={})=>({
  pair,horizon,direction:'SELL',confidence:68,qualified:true,tradeQualified:true,regime:'MIXED',features
});

test('EURJPY 5M reranks accepted breakout only with weak-progress compound conflict',()=>{
  const risky=base('EURJPY',5,{
    breakoutAccepted:true,
    continuationFreshEvidence:true,
    frequencyStructuralTags:['WEAKPROGRESS'],
    activeFvgState:'MITIGATING',
    confirmationV2Opposed:4,
    sr:'AT SUPPORT'
  });
  const out=applyLossContext(risky,'EURJPY',5).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.equal(out.features.lossStreakRerankTrigger,'EURJPY_5M_BREAKOUT_PROGRESS_CONFLICT_RERANK');
  assert.equal(out.features.lossStreakFrequencyImpact,'NONE');
  assert.ok(out.features.lossStreakConflictCount>=2);
});

test('EURJPY 5M clean accepted continuation remains unchanged',()=>{
  const clean=base('EURJPY',5,{
    breakoutAccepted:true,
    continuationFreshEvidence:true,
    frequencyStructuralTags:[],
    activeFvgState:'FULLY_MITIGATED',
    confirmationV2Opposed:0,
    sr:'CLEAR',
    moveQualityScore:6.8
  });
  const out=applyLossContext(clean,'EURJPY',5).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.features.lossStreakRerankApplied,false);
});

test('weak progress without accepted breakout is not reranked',()=>{
  const out=applyLossContext(base('EURJPY',5,{
    breakoutAccepted:false,
    continuationFreshEvidence:true,
    frequencyStructuralTags:['WEAKPROGRESS'],
    activeFvgState:'MITIGATING',
    confirmationV2Opposed:4
  }),'EURJPY',5).result;
  assert.equal(out.direction,'SELL');
});

test('same conflict on unrelated track remains unchanged',()=>{
  const out=applyLossContext(base('GBPUSD',5,{
    breakoutAccepted:true,
    continuationFreshEvidence:true,
    frequencyStructuralTags:['WEAKPROGRESS'],
    activeFvgState:'MITIGATING',
    confirmationV2Opposed:4,
    sr:'AT SUPPORT'
  }),'GBPUSD',5).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.features.lossStreakRerankApplied,false);
});
