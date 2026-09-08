import test from 'node:test';
import assert from 'node:assert/strict';
import {applyForwardTrackCalibration,diagnoseLoss} from '../lib/lossLearning.js';

const dangerous=(overrides={})=>({
  direction:'BUY',confidence:72,qualified:true,tradeQualified:true,regime:'CHOPPY',
  shadowModel:{status:'READY',direction:'BUY',confidence:99},
  features:{
    continuationFreshEvidence:false,continuationResetRequired:true,
    failureToProgress:true,progressFailureRisk:true,
    scoreRedistributionPenaltyTags:'FAILURE_TO_PROGRESS|REJECTION_PRESSURE|UNRESOLVED_FVG|EMA_COMPRESSION',
    frequencyStructuralTags:['WEAKPROGRESS','TRANSITION'],
    sr:'AT RESISTANCE',pattern:'BEAR ENGULF',breakout:'FAILED BULL BREAK',
    activeFvgType:'BEAR',activeFvgState:'MITIGATING',activeFvgBias:-.38,
    m5Context:-.4,m15Context:-.5,h1Context:-.3,
    efficiency:.08,moveQualityScore:4.4,adx:14,
    momentum:-.4,sequence:-.3,advancedMomentumScore:-.2,structure:'BEAR STRUCTURE',
    confirmationV2Opposed:3,originalDirectionScore:8,oppositeDirectionScore:-7,
    ...overrides
  }
});

test('generic transition reranker flips strong multi-family stale BUY without dropping signal',()=>{
  const out=applyForwardTrackCalibration(dangerous(),'AUDUSD',3).result;
  assert.equal(out.direction,'SELL');
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.equal(out.minimumConfidence,57);
  assert.equal(out.features.lossStreakRerankTrigger,'CROSS_TRACK_TRANSITION_DIRECTION_RERANK');
  assert.equal(out.features.transitionDirectionFrequencyImpact,'NONE');
  assert.equal(out.features.transitionDirectionShadowInfluence,'NONE');
  assert.ok(out.confidence<=66&&out.confidence>=57);
});

test('weak conflict does not reverse',()=>{
  const clean={direction:'BUY',confidence:64,qualified:true,tradeQualified:true,regime:'TRENDING',features:{continuationFreshEvidence:false,continuationResetRequired:true,failureToProgress:true,frequencyStructuralTags:['WEAKPROGRESS'],m5Context:-.3,m15Context:-.3,h1Context:.2,efficiency:.55,moveQualityScore:7,adx:30,momentum:.4,sequence:.3,structure:'BULL STRUCTURE',sr:'AT SUPPORT',activeFvgState:'FULLY_MITIGATED',activeFvgType:'BULL',confirmationV2Opposed:1}};
  const out=applyForwardTrackCalibration(clean,'AUDUSD',3).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.lossStreakRerankApplied,false);
});

test('opposing ticks count only when reliable and directional quality is adequate',()=>{
  const base=dangerous({activeFvgState:'FULLY_MITIGATED',activeFvgType:'BULL',activeFvgBias:0,efficiency:.5,moveQualityScore:6,adx:24,momentum:.25,sequence:.2,advancedMomentumScore:.05,structure:'BULL STRUCTURE',m5Context:-.4,m15Context:-.5,h1Context:.2,forexTickDirection:'SELL',tickFeedReliabilityScore:3,tickDirectionQualityScore:2});
  let out=applyForwardTrackCalibration(base,'AUDUSD',3).result;
  assert.equal(out.direction,'BUY');
  const reliable=structuredClone(base);
  reliable.features.tickFeedReliabilityScore=9;
  reliable.features.tickDirectionQualityScore=6;
  out=applyForwardTrackCalibration(reliable,'AUDUSD',3).result;
  assert.equal(out.direction,'SELL');
  assert.ok(out.features.transitionDirectionFamilies.includes('TICKS'));
});

test('loss streak alone never reverses a clean fresh continuation',()=>{
  for(let i=0;i<2;i++)diagnoseLoss({id:`l${i}`,pair:'TESTPAIRX',horizon:3,direction:'BUY',confidence:65,regime:'TRENDING',features:{}},null);
  const clean={direction:'BUY',confidence:65,qualified:true,tradeQualified:true,regime:'TRENDING',features:{continuationFreshEvidence:true,breakoutAccepted:true,failureToProgress:false,moveQualityScore:7,confirmationV2Opposed:0,efficiency:.6,adx:30,momentum:.5,sequence:.4,structure:'BULL STRUCTURE',sr:'AT SUPPORT',activeFvgState:'FULLY_MITIGATED',activeFvgType:'BULL'}};
  const out=applyForwardTrackCalibration(clean,'TESTPAIRX',3).result;
  assert.equal(out.direction,'BUY');
});

test('shadow prediction never votes in live reranking',()=>{
  const clean={direction:'BUY',confidence:65,qualified:true,tradeQualified:true,regime:'TRENDING',shadowModel:{status:'READY',direction:'SELL',confidence:99},features:{continuationFreshEvidence:true,breakoutAccepted:true,failureToProgress:false,moveQualityScore:7,confirmationV2Opposed:0,efficiency:.6,adx:30,momentum:.5,sequence:.4,structure:'BULL STRUCTURE',sr:'AT SUPPORT',activeFvgState:'FULLY_MITIGATED',activeFvgType:'BULL'}};
  const out=applyForwardTrackCalibration(clean,'EURUSD',3).result;
  assert.equal(out.direction,'BUY');
  assert.equal(out.features.transitionDirectionShadowInfluence,'NONE');
});

test('generic rule works across active pairs without pair-specific hard-coding',()=>{
  for(const [pair,h] of [['EURUSD',3],['GBPUSD',5],['EURJPY',3],['USDJPY',1],['AUDUSD',3]]){
    const out=applyForwardTrackCalibration(dangerous(),pair,h).result;
    assert.equal(out.direction,'SELL',`${pair}-${h}`);
    assert.equal(out.features.lossStreakRerankTrigger,'CROSS_TRACK_TRANSITION_DIRECTION_RERANK',`${pair}-${h}`);
  }
});
