import test from 'node:test';
import assert from 'node:assert/strict';
import {applyForwardTrackCalibration} from '../lib/lossLearning.js';

const matureChop=(features={})=>({
  direction:'BUY',
  confidence:74,
  qualified:true,
  tradeQualified:true,
  regime:'CHOPPY',
  evidenceScore:0.42,
  features:{
    breakoutAccepted:true,
    breakoutMaturityGate:false,
    breakoutMaturityRiskActive:true,
    fragileAcceptedBreakout:true,
    failureToProgress:true,
    progressFailureRisk:true,
    continuationFreshEvidence:false,
    continuationResetGate:true,
    continuationResetActive:false,
    continuationResetRequired:false,
    moveQualityScore:4.4,
    originalDirectionScore:-0.35,
    oppositeDirectionScore:0.15,
    trend:-0.35,
    sequencePressure:-0.3,
    momentum:-0.4,
    advancedMomentumScore:-0.3,
    m5Context:-0.25,
    m15Context:-0.2,
    sr:'AT RESISTANCE',
    confirmationV2Opposed:3,
    ...features
  }
});

test('EURUSD 2M mature choppy breakout can rerank without suppressing frequency',()=>{
  const out=applyForwardTrackCalibration(matureChop(),'EURUSD',2);
  assert.equal(out.result.direction,'SELL');
  assert.equal(out.result.features.lossStreakRerankTrigger,'EURUSD_2M_CONTEXT_ROUTER_RERANK');
  assert.equal(out.result.features.contextRouterActive,true);
  assert.equal(out.result.features.contextRouterRerankEligible,true);
  assert.equal(out.result.features.contextRouterOriginalDirection,'BUY');
  assert.equal(out.result.features.contextRouterFinalDirection,'SELL');
  assert.equal(out.result.qualified,true);
  assert.equal(out.result.tradeQualified,true);
  assert.equal(out.result.minimumConfidence,57);
  assert.ok(out.result.confidence>=57&&out.result.confidence<=66);
  assert.equal(out.calibration.status,'FORWARD_VALIDATION');
  assert.equal(out.calibration.frequencyImpact,'NONE');
  assert.equal(out.calibration.globalThresholdChanged,false);
  assert.equal(out.calibration.shadowInfluence,'NONE');
  assert.equal(out.calibration.confidenceRecalibrated,true);
});

test('same mature-chop evidence does not activate EURUSD 2M router on EURUSD 1M',()=>{
  const out=applyForwardTrackCalibration(matureChop(),'EURUSD',1);
  assert.notEqual(out.result.features.lossStreakRerankTrigger,'EURUSD_2M_CONTEXT_ROUTER_RERANK');
  assert.equal(out.result.features.contextRouterActive,false);
  assert.equal(out.result.minimumConfidence??57,57);
  assert.equal(out.result.qualified,true);
  assert.equal(out.result.tradeQualified,true);
});

test('strong fresh continuation protects EURUSD 2M from the new context rerank',()=>{
  const out=applyForwardTrackCalibration(matureChop({
    continuationFreshEvidence:true,
    failureToProgress:false,
    progressFailureRisk:false,
    fragileAcceptedBreakout:false,
    moveQualityScore:7.2,
    confirmationV2Opposed:0,
    originalDirectionScore:0.6,
    oppositeDirectionScore:-0.2,
    trend:0.4,
    sequencePressure:0.3,
    momentum:0.35,
    advancedMomentumScore:0.25,
    m5Context:0.2,
    m15Context:0.25,
    sr:'MID RANGE'
  }),'EURUSD',2);
  assert.notEqual(out.result.features.lossStreakRerankTrigger,'EURUSD_2M_CONTEXT_ROUTER_RERANK');
  assert.equal(out.result.features.contextRouterRerankEligible,false);
  assert.equal(out.result.direction,'BUY');
});
