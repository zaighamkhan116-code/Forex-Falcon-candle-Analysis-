import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyForwardTrackCalibration} from '../lib/lossLearning.js';

const risky=(direction='BUY',features={},regime='CHOPPY')=>({
  direction,confidence:66,qualified:true,tradeQualified:true,regime,
  features:{
    continuationFreshEvidence:false,
    failureToProgress:true,
    moveQualityScore:4.8,
    emaCompression:.00004,
    originalDirectionScore:-.8,
    oppositeDirectionScore:-.6,
    ...features
  }
});

const assertCandidate=(pair,horizon,input,trigger)=>{
  const out=applyForwardTrackCalibration(input,pair,horizon).result;
  assert.equal(out.direction,input.direction);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.equal(out.features.lossStreakRerankApplied,false);
  assert.equal(out.features.lossStreakCandidateTrigger,trigger);
  assert.equal(out.features.lossStreakCandidateDirection,input.direction==='BUY'?'SELL':'BUY');
  assert.equal(out.features.lossStreakCandidateFrequencyImpact,'NONE');
  assert.ok(out.features.lossStreakOpposedFamilyCount>=2);
};

test('V3.5 shadows only the configured pair/timeframe compound-loss signatures',()=>{
  assertCandidate('EURJPY',1,risky('BUY',{trend:-.5,sequence:-.4}),
    'EURJPY_1M_COMPRESSION_PROGRESS_OPPOSITION_RERANK');
  assertCandidate('EURJPY',2,risky('SELL',{trend:.5,momentum:.4,frequencyConflicts:['TRANSITION','FAILURE_TO_PROGRESS']}),
    'EURJPY_2M_SEVERE_COMPOUND_OPPOSITION_RERANK');
  assertCandidate('GBPUSD',1,risky('BUY',{sequencePressure:-.5,momentum:-.4}),
    'GBPUSD_1M_PROGRESS_MOMENTUM_OPPOSITION_RERANK');
  assertCandidate('EURUSD',5,risky('SELL',{trend:.5,m15Context:.4,transitionGate:false}),
    'EURUSD_5M_STALE_TRANSITION_OPPOSITION_RERANK');
  assertCandidate('USDJPY',5,risky('BUY',{trend:-.5,structure:'BEARISH',breakoutAccepted:true}),
    'USDJPY_5M_COMPRESSION_FALSE_BREAKOUT_RERANK');
  assertCandidate('AUDUSD',2,risky('SELL',{advancedMomentumScore:.5,structure:'BULLISH'}),
    'AUDUSD_2M_MOMENTUM_STRUCTURE_OPPOSITION_RERANK');
});

test('V3.5 does not flip when the original score is materially supported',()=>{
  const input=risky('BUY',{trend:-.5,sequence:-.4,originalDirectionScore:1.5,oppositeDirectionScore:-1});
  const out=applyForwardTrackCalibration(input,'EURJPY',1).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
  assert.equal(out.features.lossStreakCandidateActive,false);
});

test('validated AUDUSD 1M behavior is not captured by new AUDUSD 2M rule',()=>{
  const input=risky('BUY',{
    continuationFreshEvidence:true,
    failureToProgress:false,
    progressFailureRisk:false,
    advancedMomentumScore:-.5,
    structure:'BEARISH'
  },'TRENDING');
  const out=applyForwardTrackCalibration(input,'AUDUSD',1).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
});

test('canonical audit persists direct tick and rerank evidence in both capture paths',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/capture-live-audit.yml',import.meta.url),'utf8');
  for(const field of ['forexTickDirection','forexTickPressure','tickFeedReliabilityScore','lossStreakRerankTrigger','lossStreakCandidateTrigger','lossStreakOpposedFamilies']){
    assert.equal(workflow.split(`${field}:.features.${field}`).length-1,2,`${field} must be retained by live and seed canonicalization`);
  }
});
