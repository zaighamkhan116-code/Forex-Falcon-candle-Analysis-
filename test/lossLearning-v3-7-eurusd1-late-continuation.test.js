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

test('EURUSD 1M late-continuation conflict is not given a pair-specific V3.7 override',()=>{
  const out=applyForwardTrackCalibration(lateConflict(),'EURUSD',1);
  assert.notEqual(out.result.features.lossStreakRerankTrigger,'EURUSD_1M_LATE_CONTINUATION_PROGRESS_RERANK');
  assert.notEqual(out.result.features.lossStreakCalibrationVersion,'V3_7_EURUSD1_LATE_CONTINUATION_FORWARD');
  assert.equal(out.result.minimumConfidence??57,57);
  assert.equal(out.result.qualified,true);
  assert.equal(out.result.tradeQualified,true);
});

test('cross-track transition logic still preserves frequency, threshold, and Shadow independence',()=>{
  const out=applyForwardTrackCalibration(lateConflict(),'EURUSD',1);
  if(out.calibration){
    assert.equal(out.calibration.frequencyImpact,'NONE');
    assert.equal(out.calibration.globalThresholdChanged,false);
    assert.equal(out.calibration.shadowInfluence,'NONE');
  }
  assert.equal(out.result.qualified,true);
  assert.equal(out.result.tradeQualified,true);
  assert.equal(out.result.minimumConfidence??57,57);
});
