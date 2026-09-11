import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStreakState,recordTrackOutcome} from '../lib/streakState.js';

const stale={lateCounterTrendRisk:true,continuationResetRequired:true,continuationFreshEvidence:false,efficiency:.10};
const loss=(pair)=>recordTrackOutcome({pair,horizon:1,direction:'BUY',regime:'CHOPPY',result:'LOSS',features:stale});

test('V6.2 pair-specific stale-chop calibration is retired; repeated-loss logic is cross-track V6.4',()=>{
  loss('EURUSD');
  const one=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});
  assert.equal(one.confidence,65);
  loss('EURUSD');
  const eur=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});

  loss('GBPUSD');
  loss('GBPUSD');
  const gbp=applyStreakState({pair:'GBPUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});

  assert.equal(eur.features.streakStateVersion,'V6.4_REPEAT_CONTRADICTION_STATE');
  assert.equal(eur.features.highConfidenceContradictionRepeatLearning,true);
  assert.equal(eur.features.pairSpecificForwardCalibration,false);
  assert.equal(eur.confidence,gbp.confidence);
  assert.ok(eur.confidence<65);
  assert.equal(eur.direction,'BUY');
});

test('57 floor and cadence-preserving semantics remain unchanged',()=>{
  const floor=applyStreakState({pair:'EURUSD',horizon:1,direction:'SELL',regime:'CHOPPY',confidence:57,features:stale});
  assert.equal(floor.confidence,57);
  assert.equal(floor.direction,'SELL');
});
