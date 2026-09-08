import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLossContext} from '../lib/lossLearning.js';

const signal=(direction='BUY',features={})=>({direction,confidence:64,qualified:true,tradeQualified:true,regime:'CHOPPY',features});

test('AUDUSD 1M reranks stale progress failure only with compound conflict',()=>{
  const risky=applyLossContext(signal('BUY',{
    progressFailureRisk:true,
    continuationFreshEvidence:false,
    frequencyConflicts:['FAILURE_TO_PROGRESS','UNRESOLVED_FVG']
  }),'AUDUSD',1).result;
  assert.equal(risky.direction,'SELL');
  assert.equal(risky.qualified,true);
  assert.equal(risky.features.lossStreakRerankTrigger,'AUDUSD_1M_PROGRESS_FAILURE_CONFLICT_RERANK');
  assert.equal(risky.features.lossStreakFrequencyImpact,'NONE');

  const clean=applyLossContext(signal('BUY',{
    progressFailureRisk:true,
    continuationFreshEvidence:true,
    frequencyConflicts:[]
  }),'AUDUSD',1).result;
  assert.equal(clean.direction,'BUY');
  assert.equal(clean.features.lossStreakRerankApplied,false);
});

test('GBPUSD 3M transition conflict reranks only when opposite score is not materially worse',()=>{
  const risky=applyLossContext(signal('SELL',{
    transitionGate:false,
    continuationFreshEvidence:false,
    frequencyConflicts:['TRANSITION','FAILURE_TO_PROGRESS'],
    confirmationV2Opposed:3,
    originalDirectionScore:-1.0,
    oppositeDirectionScore:-0.8
  }),'GBPUSD',3).result;
  assert.equal(risky.direction,'BUY');
  assert.equal(risky.features.lossStreakRerankTrigger,'GBPUSD_3M_TRANSITION_CONFLICT_RERANK');

  const supportedOriginal=applyLossContext(signal('SELL',{
    transitionGate:false,
    continuationFreshEvidence:false,
    frequencyConflicts:['TRANSITION','FAILURE_TO_PROGRESS'],
    confirmationV2Opposed:3,
    originalDirectionScore:1.5,
    oppositeDirectionScore:-2.0
  }),'GBPUSD',3).result;
  assert.equal(supportedOriginal.direction,'SELL');
  assert.equal(supportedOriginal.features.lossStreakRerankApplied,false);
});

test('V3.3 does not change an unrelated clean track',()=>{
  const out=applyLossContext(signal('BUY',{
    progressFailureRisk:true,
    continuationFreshEvidence:false,
    frequencyConflicts:['FAILURE_TO_PROGRESS','UNRESOLVED_FVG']
  }),'USDJPY',3).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
});
