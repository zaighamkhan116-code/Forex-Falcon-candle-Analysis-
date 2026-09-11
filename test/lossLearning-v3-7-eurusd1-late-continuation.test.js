import test from 'node:test';
import assert from 'node:assert/strict';
import {applyForwardTrackCalibration} from '../lib/lossLearning.js';

const lateConflict=(features={})=>({
  direction:'BUY',
  confidence:62,
  qualified:true,
  tradeQualified:true,
  regime:'MIXED',
  features:{
    continuationFreshEvidence:false,
    continuationResetRequired:true,
    continuationResetGate:false,
    failureToProgress:true,
    progressFailureRisk:true,
    lateContinuationGate:false,
    lateCounterTrendRisk:true,
    moveQualityScore:4.5,
    originalDirectionScore:-0.5,
    oppositeDirectionScore:-0.3,
    frequencyConflicts:['FAILURE_TO_PROGRESS','MTF_CONFLICT'],
    confirmationV2Opposed:3,
    m5Context:-0.4,
    m15Context:-0.3,
    momentum:-0.4,
    sequence:-0.3,
    ...features
  }
});

test('V3.7 reranks only severe EURUSD 1M late-continuation progress conflict without frequency loss',()=>{
  const out=applyForwardTrackCalibration(lateConflict(),'EURUSD',1);
  assert.equal(out.result.direction,'SELL');
  assert.equal(out.result.features.lossStreakRerankApplied,true);
  assert.equal(out.result.features.lossStreakRerankTrigger,'EURUSD_1M_LATE_CONTINUATION_PROGRESS_RERANK');
  assert.equal(out.result.features.lossStreakCalibrationVersion,'V3_7_EURUSD1_LATE_CONTINUATION_FORWARD');
  assert.equal(out.calibration.status,'FORWARD_VALIDATION');
  assert.equal(out.calibration.frequencyImpact,'NONE');
  assert.equal(out.calibration.globalThresholdChanged,false);
  assert.equal(out.calibration.shadowInfluence,'NONE');
  assert.equal(out.result.minimumConfidence,57);
});

test('V3.7 leaves fresh supported EURUSD 1M continuation untouched',()=>{
  const input=lateConflict({
    continuationFreshEvidence:true,
    continuationResetRequired:false,
    continuationResetGate:true,
    failureToProgress:false,
    progressFailureRisk:false,
    lateContinuationGate:true,
    lateCounterTrendRisk:false,
    moveQualityScore:7,
    breakoutAccepted:true,
    originalDirectionScore:1,
    oppositeDirectionScore:-1,
    frequencyConflicts:[],
    confirmationV2Opposed:0,
    m5Context:0.4,
    m15Context:0.3,
    momentum:0.4,
    sequence:0.3
  });
  const out=applyForwardTrackCalibration(input,'EURUSD',1);
  assert.equal(out.result.direction,'BUY');
  assert.equal(out.result.features.lossStreakRerankApplied,false);
});
