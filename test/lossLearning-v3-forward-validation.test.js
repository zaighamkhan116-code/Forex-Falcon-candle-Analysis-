import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLossContext} from '../lib/lossLearning.js';

const base=(direction='BUY',features={})=>({direction,confidence:64,qualified:true,tradeQualified:true,regime:'MIXED',features});

test('USDJPY 2M mature breakout risk reranks instead of vetoing',()=>{
  const out=applyLossContext(base('BUY',{breakoutMaturityGate:false,breakoutMaturityRiskActive:true,failureToProgress:true}),'USDJPY',2).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.qualified,true);
  assert.equal(out.features.lossStreakRerankTrigger,'USDJPY_2M_MATURE_BREAKOUT_RERANK');
  assert.equal(out.features.lossStreakFrequencyImpact,'NONE');
});

test('EURUSD 2M failed continuation reranks',()=>{
  const out=applyLossContext(base('SELL',{continuationResetGate:false,continuationResetActive:true}),'EURUSD',2).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankTrigger,'EURUSD_2M_FAILED_CONTINUATION_RERANK');
});

test('GBPUSD 1M chop reranks only when chop state is confirmed',()=>{
  const risky=base('BUY',{oneMinuteChopGuard:false,microRangeChop:true});risky.regime='CHOPPY';
  const out=applyLossContext(risky,'GBPUSD',1).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.features.lossStreakRerankTrigger,'GBPUSD_1M_CHOP_RERANK');
  const clean=applyLossContext(base('BUY',{oneMinuteChopGuard:false}),'GBPUSD',1).result;
  assert.equal(clean.direction,'BUY');
});

test('GBPUSD 2M negative-edge compound conflict reranks',()=>{
  const risky=base('BUY',{originalDirectionScore:-4.2,oppositeDirectionScore:-3.3,frequencyConflicts:['ADVERSE_LOCATION','REJECTION_PRESSURE'],confirmationV2Opposed:4});
  const out=applyLossContext(risky,'GBPUSD',2).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.features.lossStreakRerankTrigger,'GBPUSD_2M_NEGATIVE_EDGE_CONFLICT_RERANK');
  assert.equal(out.features.lossStreakFrequencyImpact,'NONE');
});

test('GBPUSD 2M rerank requires material opposite advantage',()=>{
  const out=applyLossContext(base('BUY',{originalDirectionScore:-4.2,oppositeDirectionScore:-3.6,frequencyConflicts:['ADVERSE_LOCATION','REJECTION_PRESSURE'],confirmationV2Opposed:4}),'GBPUSD',2).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
});

test('GBPUSD 2M rerank requires compound conflict',()=>{
  const out=applyLossContext(base('BUY',{originalDirectionScore:-4.2,oppositeDirectionScore:-3.0,frequencyConflicts:[],confirmationV2Opposed:1}),'GBPUSD',2).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
});

test('EURJPY 2M conflict requires compound evidence',()=>{
  const weak=applyLossContext(base('BUY',{groupOpposingVotes:2,groupDominance:.3}),'EURJPY',2).result;
  assert.equal(weak.direction,'BUY');
  const strong=applyLossContext(base('BUY',{groupOpposingVotes:2,groupDominance:.3,mtfOppositionCount:2}),'EURJPY',2).result;
  assert.equal(strong.direction,'SELL');
  assert.equal(strong.features.lossStreakRerankTrigger,'EURJPY_2M_COMPOUND_CONFLICT_RERANK');
});

test('unrelated tracks remain unchanged',()=>{
  const out=applyLossContext(base('SELL',{breakoutMaturityGate:false,breakoutMaturityRiskActive:true}),'GBPUSD',5).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.features.lossStreakRerankApplied,false);
});
