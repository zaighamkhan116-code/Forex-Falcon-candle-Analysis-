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
