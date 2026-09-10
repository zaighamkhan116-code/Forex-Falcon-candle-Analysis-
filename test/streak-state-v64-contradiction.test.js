import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStreakState,recordTrackOutcome} from '../lib/streakState.js';

const sig=(result,features={highConfidenceContradictionRisk:true})=>({pair:'GBPUSD',horizon:1,direction:'BUY',result,confidence:70,features});

test('single contradiction loss does not alter confidence',()=>{
  recordTrackOutcome(sig('LOSS'));
  const out=applyStreakState(sig(undefined));
  assert.equal(out.confidence,70);
});

test('repeated contradiction losses receive soft track-local calibration',()=>{
  recordTrackOutcome(sig('LOSS'));
  const out=applyStreakState(sig(undefined));
  assert.ok(out.confidence<70);
  assert.ok(out.features.streakStateReasons.includes('REPEAT_LOSS_HIGH_CONFIDENCE_CONTRADICTION'));
});

test('57 floor and other horizons remain protected',()=>{
  const floor=applyStreakState({...sig(undefined),confidence:57});
  assert.equal(floor.confidence,57);
  const other=applyStreakState({pair:'GBPUSD',horizon:2,direction:'BUY',confidence:70,features:{highConfidenceContradictionRisk:true}});
  assert.equal(other.confidence,70);
});
